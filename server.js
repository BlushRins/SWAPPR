require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const { isIPv6 } = require("node:net");
const { Address6 } = require("ip-address");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
const { initializeIntegrity } = require("./lib/storeIntegrity");
const { normalizeCatalog } = require("./lib/catalog");
const { cleanDepartments } = require("./lib/cleanDepartments");
const {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  hashOtp,
  secondsUntilResend,
  verifyOtpHash,
} = require("./lib/otpPolicy");
const { subjectsForCourse, filterSubjects } = require("./lib/subjects");
const { hashPassword, isHashed, passwordError, verifyPassword } = require("./lib/passwordHash");
const {
  CHAT_RETENTION_DAYS,
  COURSE_TO_DEPARTMENT,
  WARNING_HIGHLIGHT_THRESHOLD,
} = require("./lib/constants");
const { isCourse } = require("./public/js/course-options");
const { COUNT_DIGITS, parseCount } = require("./public/js/notebook-metrics");
const { isHttpUrl, screenNotebook, screeningComplaint } = require("./lib/contentScreening");
const {
  TRUST_CHANGE,
  TRUST_SCORE_DEFAULT,
  TRUST_SCORE_MAX,
  TRUST_SCORE_MIN,
} = require("./lib/trustScore");

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
const SESSION_SECRET = process.env.SESSION_SECRET;
const credentialKey = SESSION_SECRET || crypto.randomBytes(32);
const APP_ORIGIN = process.env.APP_ORIGIN;
if (IS_PRODUCTION && Buffer.byteLength(SESSION_SECRET || "") < 32) {
  throw new Error("Production requires a random SESSION_SECRET of at least 32 bytes.");
}
if (APP_ORIGIN && new URL(APP_ORIGIN).origin !== APP_ORIGIN ||
    IS_PRODUCTION && !APP_ORIGIN?.startsWith("https://")) {
  throw new Error("APP_ORIGIN must be the site's origin, using HTTPS in production.");
}
if (process.env.TRUST_PROXY) {
  const proxies = process.env.TRUST_PROXY.split(",").map((proxy) => proxy.trim());
  if (proxies.some((proxy) => !proxy || proxy === "true" || /^\d+$/.test(proxy))) {
    throw new Error("TRUST_PROXY must contain trusted proxy addresses or CIDRs.");
  }
  app.set("trust proxy", proxies);
}
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
// Dev-only escape hatch: print OTPs to the server console instead of emailing
// them, so registration works locally without SMTP credentials. Never active
// when NODE_ENV=production, regardless of what .env says.
const OTP_DEV_MODE =
  process.env.OTP_DEV_MODE === "true" && !IS_PRODUCTION;
const SESSION_COOKIE = "swappr_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// SQLite datetime() modifier for a chat's retention timestamp, e.g. '+14 days'.
const CHAT_EXPIRY_OFFSET = `'+${CHAT_RETENTION_DAYS} days'`;
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

function textField(value, maximum) {
  if (typeof value !== "string" || value.length > maximum) return "";
  return value.trim();
}

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,40}$/;
const INVALID_CREDENTIALS = "Invalid username or password.";
// Verify an equivalent scrypt record when a lookup has no usable credential.
const UNKNOWN_ACCOUNT_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

function internalError(res, err) {
  console.error("[API]", err.message);
  return res.status(500).json({ success: false, message: "Server error. Please try again." });
}

function normalizeEmail(email) {
  return (typeof email === "string" ? email : "")
    .trim()
    .toLowerCase();
}

// FUNC-002 REQT-005 wording, also used by Edit Profile.
const USERNAME_TAKEN_MESSAGE = "Username already taken. Please choose a different one.";

// A username is taken by a student (other than `exceptUserId`) or by an
// administrator: login checks students first, so a student with an admin's
// username would lock that admin out.
async function isUsernameTaken(username, exceptUserId = null) {
  const [student, admin] = await Promise.all([
    dbGet("SELECT id FROM Users WHERE trim(username) = ? AND id IS NOT ?", [username, exceptUserId]),
    dbGet("SELECT admin_ID FROM Admin WHERE trim(username) = ?", [username]),
  ]);
  return Boolean(student || admin);
}

function isValidSchoolEmail(email) {
  return /^\d{1,64}@usc\.edu\.ph$/i.test(email);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    course: user.course || "",
  };
}

function publicAdmin(admin) {
  return {
    id: admin.admin_ID,
    username: admin.username,
    name: admin.name || admin.username,
  };
}

const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: IS_PRODUCTION,
  path: "/",
};

function credentialDigest(token) {
  return crypto.createHmac("sha256", credentialKey).update(token).digest("hex");
}

async function startSession(res, role, id, passwordHash) {
  const token = crypto.randomBytes(32).toString("hex");
  const accountQuery = role === "admin"
    ? "SELECT admin_ID AS accountId FROM Admin WHERE admin_ID = ? AND password = ?"
    : "SELECT id AS accountId FROM Users WHERE id = ? AND password = ? AND COALESCE(account_status, 'active') = 'active'";
  // A password change or suspension may have happened while checking the KDF.
  const inserted = await dbRun(
    `INSERT INTO Sessions (digest, role, accountId, expiresAt)
     SELECT ?, ?, accountId, ? FROM (${accountQuery})`,
    [credentialDigest(token), role, Date.now() + SESSION_TTL_MS, id, passwordHash],
  );
  if (!inserted.changes) return false;
  res.set("Cache-Control", "no-store");
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_TTL_MS });
  return true;
}

async function clearSession(req, res) {
  if (req.sessionDigest) await dbRun("DELETE FROM Sessions WHERE digest = ?", [req.sessionDigest]);
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
}

async function sessionMiddleware(req, res, next) {
  const cookie = (req.get("Cookie") || "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!token) return next();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    return next();
  }

  const digest = credentialDigest(token);
  const session = await dbGet(
    `SELECT Sessions.role, Admin.admin_ID, Users.id,
            COALESCE(Admin.username, Users.username) AS username,
            COALESCE(Admin.name, Users.name) AS name, Users.course
     FROM Sessions
     LEFT JOIN Admin ON role = 'admin' AND Admin.admin_ID = accountId
     LEFT JOIN Users ON role = 'student' AND Users.id = accountId
       AND COALESCE(Users.account_status, 'active') = 'active'
     WHERE digest = ? AND expiresAt > ?`,
    [digest, Date.now()],
  );
  if (session?.admin_ID) req.currentAdmin = publicAdmin(session);
  else if (session?.id) req.currentUser = publicUser(session);
  else {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    return next();
  }

  req.sessionDigest = digest;
  // A cached authenticated response could outlive its session.
  res.set("Cache-Control", "no-store");
  next();
}

function clientIp(req) {
  if (!isIPv6(req.ip)) return req.ip;
  const address = new Address6(req.ip);
  const bits = address.bigInt();
  // Canonicalize IPv4-mapped peers, and group native IPv6 addresses by /56.
  return bits >> 32n === 0xffffn ? address.to4().correctForm() : (bits >> 72n).toString(16) + "/56";
}

function requestLimit(bucket, maxAttempts, windowMs, identifier = clientIp) {
  return async (req, res, next) => {
    const value = identifier(req);
    if (!value) return next();

    const key = credentialDigest(`${bucket}:${value}`);
    const now = Date.now();
    const record = await dbGet(
      `INSERT INTO RequestLimits (key, attempts, expiresAt) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         attempts = CASE WHEN expiresAt <= ? THEN 1 ELSE attempts + 1 END,
         expiresAt = CASE WHEN expiresAt <= ? THEN excluded.expiresAt ELSE expiresAt END
       WHERE expiresAt <= ? OR attempts < ?
       RETURNING expiresAt`,
      [key, now + windowMs, now, now, now, maxAttempts],
    );
    if (!record) {
      const limit = await dbGet("SELECT expiresAt FROM RequestLimits WHERE key = ?", [key]);
      const retryAfterSeconds = Math.max(1, Math.ceil(((limit?.expiresAt ?? now) - now) / 1000));
      return res.set("Retry-After", String(retryAfterSeconds)).status(429).json({
        success: false,
        message: "Too many requests. Try again later.",
        retryAfterSeconds,
      });
    }
    if (bucket === "login-account") {
      req.releaseLoginAttempt = () => dbRun(
        "UPDATE RequestLimits SET attempts = attempts - 1 WHERE key = ? AND expiresAt = ?",
        [key, record.expiresAt],
      );
    }
    next();
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const emailKey = (req) => {
  const email = normalizeEmail(req.body?.email);
  return isValidSchoolEmail(email) ? email : "";
};

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.status(401).json({ success: false, message: "Login required" });
  }
  next();
}

function requirePageAuth(req, res, next) {
  if (req.currentAdmin) return res.redirect("/admin.html");
  if (!req.currentUser) return res.redirect("/login.html");
  next();
}

function requireAnyAuth(req, res, next) {
  if (!req.currentUser && !req.currentAdmin) {
    return res.status(401).json({ success: false, message: "Login required" });
  }
  next();
}

function requireAdminAuth(req, res, next) {
  if (!req.currentAdmin) {
    return res
      .status(req.currentUser ? 403 : 401)
      .json({ success: false, message: "Admin access required" });
  }
  next();
}

function requireAdminPageAuth(req, res, next) {
  if (req.currentAdmin) return next();
  res.redirect(req.currentUser ? "/index.html" : "/login.html");
}

function createMailTransport() {
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });
  }

  if (
    process.env.GMAIL_USER &&
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  ) {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        type: "OAuth2",
        user: process.env.GMAIL_USER,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      },
    });
  }

  if (OTP_DEV_MODE) {
    // jsonTransport serializes the message and resolves without opening a
    // connection, so the normal send path runs unchanged.
    return nodemailer.createTransport({ jsonTransport: true });
  }

  return null;
}

const mailFromAddress =
  process.env.SMTP_FROM ||
  process.env.SMTP_USER ||
  process.env.GMAIL_USER ||
  (OTP_DEV_MODE ? "dev@localhost" : "");

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
    },
  },
  strictTransportSecurity: IS_PRODUCTION ? { includeSubDomains: false } : false,
}));
app.use("/api", (req, res, next) => {
  const fetchSite = req.get("Sec-Fetch-Site");
  const crossSite = fetchSite === "cross-site" || fetchSite === "same-site";
  if (!crossSite) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("Origin");
    const ownOrigin = APP_ORIGIN || `${req.protocol}://${req.get("Host")}`;
    if (origin ? origin === ownOrigin : fetchSite === "same-origin") return next();
  }
  res.status(403).json({ success: false, message: "Cross-origin request blocked." });
});
app.use(express.json());
app.use("/api", (req, res, next) => {
  req.body ??= {};
  if (typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ success: false, message: "Expected a JSON object." });
  }
  next();
});
app.get("/js/vendor/lucide.js", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "js", "vendor", "lucide.js"));
});
app.get("/favicon.ico", (req, res) => {
  res.redirect("/Images/swappr_logo_updated.jpg");
});
app.get("/healthz", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await dbGet("SELECT 1 FROM Users LIMIT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});
app.use(sessionMiddleware);

app.get(["/", "/index.html"], requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/profile.html", requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"));
});

app.get("/admin.html", requireAdminPageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/login.html", (req, res) => {
  if (req.currentAdmin) return res.redirect("/admin.html");
  if (req.currentUser) return res.redirect("/index.html");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use(express.static(path.join(__dirname, "public")));

const SQL_DIR = process.env.SWAPPR_SQL_DIR || path.join(__dirname, "sql");
const accountDbPath = path.join(SQL_DIR, "swappr.db");
const db = new sqlite3.Database(accountDbPath, (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");
});
db.configure("busyTimeout", 5000);

let courseCatalog = [];
let catalogByCode = new Map();
const coursesDb = new sqlite3.Database(path.join(SQL_DIR, "courses.db"), sqlite3.OPEN_READONLY, (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to Courses database.");
});

async function loadCatalog() {
  const rows = await new Promise((resolve, reject) => {
    coursesDb.all("SELECT course_code, course_description, department_reserved FROM courses",
      (error, entries) => error ? reject(error) : resolve(entries));
  });
  courseCatalog = normalizeCatalog(rows);
  catalogByCode = new Map(courseCatalog.map((row) => [row.course_code, row]));
}

function accountQueries(connection) {
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        connection.run(sql, params, function onRun(err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        connection.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
  };
}

const { run: dbRun, get: dbGet } = accountQueries(db);

async function withAccountTransaction(change) {
  // Use a separate connection so unrelated requests cannot enter this transaction.
  const connection = await new Promise((resolve, reject) => {
    const opened = new sqlite3.Database(accountDbPath, sqlite3.OPEN_READWRITE, (err) => {
      if (err) reject(err);
      else resolve(opened);
    });
  });
  connection.configure("busyTimeout", 5000);
  const queries = accountQueries(connection);
  try {
    await queries.run("PRAGMA foreign_keys = ON");
    await queries.run("BEGIN IMMEDIATE");
    try {
      const result = await change(queries);
      await queries.run("COMMIT");
      return result;
    } catch (error) {
      await queries.run("ROLLBACK").catch((rollbackError) => {
        console.error("[DB] transaction rollback failed:", rollbackError.message);
      });
      throw error;
    }
  } finally {
    await new Promise((resolve) => connection.close((err) => {
      if (err) console.error("[DB] transaction close failed:", err.message);
      resolve();
    }));
  }
}

function sendChangeResult(res, result) {
  if (result) return res.status(result[0]).json({ success: false, message: result[1] });
  return res.json({ success: true });
}

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

async function addColumnIfMissing(table, columnDefinition) {
  await dbRun(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`).catch(
    (err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    },
  );
}

async function initializeAuthStorage() {
  await dbRun("PRAGMA secure_delete = ON");
  await dbRun(`CREATE TABLE IF NOT EXISTS Sessions (
    digest TEXT PRIMARY KEY, role TEXT NOT NULL, accountId INTEGER NOT NULL, expiresAt INTEGER NOT NULL
  )`);
  await dbRun("CREATE INDEX IF NOT EXISTS idx_sessions_account ON Sessions(role, accountId)");
  await dbRun(`CREATE TABLE IF NOT EXISTS RequestLimits (
    key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expiresAt INTEGER NOT NULL
  )`);

  for (const [table, idColumn, role] of [["Users", "id", "student"], ["Admin", "admin_ID", "admin"]]) {
    const changes = table === "Users" ? "password, account_status" : "password";
    const statusChanged = table === "Users" ? "OR OLD.account_status IS NOT NEW.account_status" : "";
    // Triggers make credential or account changes and session revocation one write,
    // including administrator password resets performed outside the HTTP app.
    await dbRun(`CREATE TRIGGER IF NOT EXISTS revoke_${role}_sessions_after_update
      AFTER UPDATE OF ${changes} ON ${table}
      WHEN OLD.password IS NOT NEW.password ${statusChanged}
      BEGIN DELETE FROM Sessions WHERE role = '${role}' AND accountId = OLD.${idColumn}; END`);
    await dbRun(`CREATE TRIGGER IF NOT EXISTS revoke_${role}_sessions_after_delete
      AFTER DELETE ON ${table}
      BEGIN DELETE FROM Sessions WHERE role = '${role}' AND accountId = OLD.${idColumn}; END`);

    // Legacy plaintext credentials require an operator reset in production.
    // Local databases can retain their logins without storing plaintext.
    const legacy = await dbAll(`SELECT ${idColumn} AS id, password FROM ${table}
      WHERE password IS NOT NULL AND password != ''
      AND (length(password) != 168 OR substr(password, 1, 7) != 'scrypt$'
        OR substr(password, 40, 1) != '$' OR substr(password, 8, 32) GLOB '*[^0-9a-f]*'
        OR substr(password, 41) GLOB '*[^0-9a-f]*')`);
    for (const { id, password } of legacy) {
      if (isHashed(password)) continue;
      const replacement = IS_PRODUCTION || password.startsWith("scrypt$")
        ? null
        : await hashPassword(password);
      await dbRun(`UPDATE ${table} SET password = ? WHERE ${idColumn} = ? AND password = ?`,
        [replacement, id, password]);
    }
  }
}

async function initializeEnrollmentIdentity() {
  const exists = await dbGet("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_student_id'");
  if (exists) return;
  await dbRun("BEGIN IMMEDIATE");
  try {
    // An existing email was verified by the previous registration flow.
    // Clear IDs whose ownership was never verified before making them unique.
    if (!await dbGet("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_student_id'")) {
      await dbRun(`UPDATE Users SET studentId = CASE
        WHEN instr(email, '@') > 1 AND lower(substr(email, instr(email, '@'))) = '@usc.edu.ph'
          AND substr(email, 1, instr(email, '@') - 1) NOT GLOB '*[^0-9]*'
          AND id = (SELECT min(other.id) FROM Users other WHERE lower(trim(other.email)) = lower(trim(Users.email)))
        THEN substr(email, 1, instr(email, '@') - 1) ELSE NULL END`);
      await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_student_id ON Users(studentId) WHERE studentId IS NOT NULL");
    }
    await dbRun("COMMIT");
  } catch (err) {
    await dbRun("ROLLBACK");
    throw err;
  }
}

async function initializeDatabase() {
  try {
    await dbRun("PRAGMA journal_mode = WAL");
    console.log("Creating tables...");
    await dbRun(`CREATE TABLE IF NOT EXISTS Users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT,
username TEXT UNIQUE,
password TEXT,
bio TEXT,
course TEXT,
department TEXT,
yearLevel TEXT,
email TEXT,
studentId TEXT
)`);
    await dbRun(`ALTER TABLE Users ADD COLUMN email TEXT`).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    await dbRun(`ALTER TABLE Users ADD COLUMN studentId TEXT`).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    await dbRun(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
       ON Users(email)
       WHERE email IS NOT NULL AND TRIM(email) != ''`,
    );
    await initializeEnrollmentIdentity();
    await dbRun(`CREATE TABLE IF NOT EXISTS EmailOtps (
email TEXT PRIMARY KEY,
otp TEXT NOT NULL DEFAULT '',
otpHash TEXT,
expiresAt INTEGER NOT NULL,
verified INTEGER NOT NULL DEFAULT 0,
resendAvailableAt INTEGER NOT NULL DEFAULT 0,
attempts INTEGER NOT NULL DEFAULT 0,
createdAt INTEGER NOT NULL,
updatedAt INTEGER NOT NULL
)`);
    await addColumnIfMissing("EmailOtps", "verificationDigest TEXT");
    await dbRun(`ALTER TABLE EmailOtps ADD COLUMN otpHash TEXT`).catch(
      (err) => {
        if (!/duplicate column name/i.test(err.message)) throw err;
      },
    );
    await dbRun(
      `ALTER TABLE EmailOtps ADD COLUMN resendAvailableAt INTEGER NOT NULL DEFAULT 0`,
    ).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    await dbRun(
      `ALTER TABLE EmailOtps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
    ).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    await dbRun(`CREATE TABLE IF NOT EXISTS Notebooks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT,
description TEXT,
department TEXT,
course_code TEXT,
author_id INTEGER,
file_url TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
    await dbRun(`ALTER TABLE Notebooks ADD COLUMN course_code TEXT`).catch(
      (err) => {
        if (!/duplicate column name/i.test(err.message)) throw err;
      },
    );
    const hasNotebookProgram = await dbGet(
      "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_notebook_program'",
    );
    if (!hasNotebookProgram) {
      await addColumnIfMissing("Notebooks", "program TEXT");
      await dbRun(`UPDATE Notebooks SET program = (SELECT course FROM Users WHERE id = author_id)
        WHERE program IS NULL`);
      await dbRun("CREATE INDEX IF NOT EXISTS idx_notebook_program ON Notebooks(program)");
    }
    await dbRun(`CREATE TABLE IF NOT EXISTS Likes (
user_id INTEGER,
notebook_id INTEGER,
PRIMARY KEY (user_id, notebook_id)
)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS Swapps (
id INTEGER PRIMARY KEY AUTOINCREMENT,
sender_id INTEGER,
receiver_id INTEGER,
status TEXT,
date_created DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
    // SQLite can't add a column with a CURRENT_TIMESTAMP default, so older
    // databases get a plain column and new requests set it explicitly.
    // Requests made before this column existed keep a NULL date.
    await addColumnIfMissing("Swapps", "date_created DATETIME");
    // FUNC-011 REQT-009: who cancelled an accepted SWAPP and when, and
    // whether the other student has been shown the notice yet.
    await addColumnIfMissing("Swapps", "cancelled_by INTEGER");
    await addColumnIfMissing("Swapps", "cancelled_at DATETIME");
    await addColumnIfMissing("Swapps", "cancel_notified INTEGER DEFAULT 0");
    await dbRun(`CREATE TABLE IF NOT EXISTS Chats (
id INTEGER PRIMARY KEY AUTOINCREMENT,
swapp_id INTEGER,
user_a_id INTEGER,
user_b_id INTEGER,
status TEXT DEFAULT 'active',
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
archived_at DATETIME,
user_a_last_read INTEGER DEFAULT 0,
user_b_last_read INTEGER DEFAULT 0,
expires_at DATETIME,
archived_reason TEXT
)`);
    await dbRun(
      `ALTER TABLE Chats ADD COLUMN user_a_last_read INTEGER DEFAULT 0`,
    ).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    await dbRun(
      `ALTER TABLE Chats ADD COLUMN user_b_last_read INTEGER DEFAULT 0`,
    ).catch((err) => {
      if (!/duplicate column name/i.test(err.message)) throw err;
    });
    // FUNC-013 REQT-005: the retention timestamp, and why a chat closed
    // (ended / expired / swapp_cancelled).
    await addColumnIfMissing("Chats", "expires_at DATETIME");
    await addColumnIfMissing("Chats", "archived_reason TEXT");
    await dbRun(
      `UPDATE Chats SET expires_at = datetime(created_at, ${CHAT_EXPIRY_OFFSET})
       WHERE expires_at IS NULL`,
    );
    await dbRun(
      `UPDATE Chats SET archived_reason = CASE
         WHEN (SELECT status FROM Swapps WHERE Swapps.id = Chats.swapp_id) = 'cancelled'
           THEN 'swapp_cancelled'
         ELSE 'ended' END
       WHERE status = 'archived' AND archived_reason IS NULL`,
    );
    await dbRun(`CREATE TABLE IF NOT EXISTS ChatMessages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id INTEGER,
sender_id INTEGER,
body TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
    // Moderation (FUNC-015 to FUNC-018): account standing, notebook review
    // state, administrators, and the reports students file.
    await addColumnIfMissing("Users", `trust_score INTEGER DEFAULT ${TRUST_SCORE_DEFAULT}`);
    await addColumnIfMissing("Users", "warning_count INTEGER DEFAULT 0");
    await addColumnIfMissing("Users", "account_status TEXT DEFAULT 'active'");
    await addColumnIfMissing("Notebooks", "status TEXT DEFAULT 'active'");
    await addColumnIfMissing("Notebooks", "report_count INTEGER DEFAULT 0");
    // Optional counts the author enters; they drive the card's size label
    // and reading time (FUNC-007 REQT-002).
    await addColumnIfMissing("Notebooks", "word_count INTEGER");
    await addColumnIfMissing("Notebooks", "page_count INTEGER");
    await addColumnIfMissing("Notebooks", "diagram_count INTEGER");
    // The join and filter keys of every feed query (DB Design, Notebooks).
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_notebooks_author ON Notebooks(author_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_notebooks_course ON Notebooks(course_code)`);
    // Older seeds stored the student ID in yearLevel. Move it to studentId
    // (when that's empty) so profiles don't show an ID as the year of study.
    await dbRun(
      `UPDATE Users
       SET studentId = CASE WHEN COALESCE(TRIM(studentId), '') = '' THEN yearLevel ELSE studentId END,
           yearLevel = NULL
       WHERE yearLevel GLOB '[0-9]*' AND yearLevel NOT GLOB '*[^0-9]*'`,
    );
    await dbRun(`CREATE TABLE IF NOT EXISTS Admin (
admin_ID INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE,
name TEXT,
password TEXT
)`);
    await initializeAuthStorage();
    await dbRun(`CREATE TABLE IF NOT EXISTS Reports (
report_ID INTEGER PRIMARY KEY AUTOINCREMENT,
reporter_ID INTEGER,
notebook_ID INTEGER,
resolved_by INTEGER,
reason TEXT,
complaint TEXT,
status TEXT DEFAULT 'open',
date_submitted DATETIME DEFAULT CURRENT_TIMESTAMP,
reported_user_ID INTEGER,
date_resolved DATETIME
)`);
    // FUNC-015 REQT-001: a report targets a notebook or a student account.
    await addColumnIfMissing("Reports", "reported_user_ID INTEGER");
    // FUNC-016 REQT-011, FUNC-017 REQT-008: when an administrator closed it.
    await addColumnIfMissing("Reports", "date_resolved DATETIME");
    // Backfill: swapps accepted before chats existed get their chat now.
    await dbRun(
      `INSERT INTO Chats (swapp_id, user_a_id, user_b_id, expires_at)
       SELECT id, sender_id, receiver_id, datetime(CURRENT_TIMESTAMP, ${CHAT_EXPIRY_OFFSET}) FROM Swapps
       WHERE status = 'accepted'
         AND id NOT IN (SELECT swapp_id FROM Chats WHERE swapp_id IS NOT NULL)`,
    );
    // FUNC-010 REQT-005, FUNC-011 REQT-006: one line per notebook exchanged in
    // a SWAPP, both the notebook requested and every notebook offered.
    // is_confirmed turns 1 when the receiver accepts.
    const hasManifest = await dbGet("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Transaction_Manifest'");
    await dbRun(`CREATE TABLE IF NOT EXISTS Transaction_Manifest (
Transaction_Manifest_ID INTEGER PRIMARY KEY AUTOINCREMENT,
SWAPP_ID INTEGER,
notebook_ID INTEGER,
is_confirmed INTEGER DEFAULT 0
)`);
    await dbRun(
      `CREATE INDEX IF NOT EXISTS idx_manifest_swapp ON Transaction_Manifest(SWAPP_ID)`,
    );
    await dbRun(
      `CREATE INDEX IF NOT EXISTS idx_manifest_notebook ON Transaction_Manifest(notebook_ID)`,
    );
    // Backfill: SWAPPs made before the manifest existed unlocked every notebook
    // of both students, so their manifest lists all of them. That keeps the
    // access those students already had. New SWAPPs always have lines, so
    // this only ever touches old rows.
    if (!hasManifest) await dbRun(
      `INSERT INTO Transaction_Manifest (SWAPP_ID, notebook_ID, is_confirmed)
       SELECT Swapps.id, Notebooks.id,
              CASE WHEN Swapps.status = 'accepted' THEN 1 ELSE 0 END
       FROM Swapps
       JOIN Notebooks ON Notebooks.author_id IN (Swapps.sender_id, Swapps.receiver_id)
       WHERE NOT EXISTS (
         SELECT 1 FROM Transaction_Manifest t WHERE t.SWAPP_ID = Swapps.id
       )`,
    );
    await initializeIntegrity({ run: dbRun, all: dbAll });
    await loadCatalog();
    console.log("Database initialized.");
    return true;
  } catch (err) {
    console.error("Database initialization failed:", err.message);
    return false;
  }
}

app.post("/api/send-otp",
  requestLimit("send-otp-ip", 12, FIFTEEN_MINUTES),
  requestLimit("send-otp-email", 5, FIFTEEN_MINUTES, emailKey),
  async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!isValidSchoolEmail(email)) {
      return res.json({
        success: false,
        message: "Email must be in the format: numbers@usc.edu.ph",
      });
    }

    const invalidPassword = passwordError(req.body.password);
    if (invalidPassword) {
      return res.status(400).json({ success: false, message: invalidPassword, field: "password" });
    }

    const transporter = createMailTransport();
    if (!transporter || !mailFromAddress) {
      return res.status(500).json({
        success: false,
        message: "Email verification is temporarily unavailable.",
      });
    }

    let reservedHash;
    try {
      const existingUser = await dbGet("SELECT id FROM Users WHERE lower(trim(email)) = ?", [email]);

      const existingOtp = await dbGet(`SELECT * FROM EmailOtps WHERE email = ?`, [
        email,
      ]);
      const resendWaitSeconds = secondsUntilResend(existingOtp);
      if (resendWaitSeconds > 0) {
        return res.set("Retry-After", String(resendWaitSeconds)).status(429).json({
          success: false,
          message: `Please wait ${resendWaitSeconds}s before requesting another code.`,
          retryAfterSeconds: resendWaitSeconds,
        });
      }

      const otp = String(crypto.randomInt(100000, 1000000));
      const otpHash = await hashOtp(otp);
      const now = Date.now();
      const reservation = await dbRun(
        `INSERT INTO EmailOtps (email, otp, otpHash, expiresAt, verified, resendAvailableAt, attempts, createdAt, updatedAt)
         VALUES (?, '', ?, ?, 0, ?, 0, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           otp='',
           otpHash=excluded.otpHash,
           expiresAt=excluded.expiresAt,
           verified=0,
           verificationDigest=NULL,
           resendAvailableAt=excluded.resendAvailableAt,
           attempts=0,
           updatedAt=excluded.updatedAt
         WHERE EmailOtps.resendAvailableAt <= ?`,
        [
          email,
          otpHash,
          now + OTP_TTL_MS,
          now + OTP_RESEND_COOLDOWN_MS,
          now,
          now,
          now,
        ],
      );
      if (!reservation.changes) {
        return res.set("Retry-After", "60").status(429).json({
          success: false,
          message: "Wait before requesting another code.",
          retryAfterSeconds: 60,
        });
      }
      reservedHash = otpHash;

      // Reserve the same resend window for registered addresses, silently.
      if (existingUser) return res.json({ success: true });

      await transporter.sendMail({
        from: `"SWAPPR" <${mailFromAddress}>`,
        to: email,
        subject: "Your SWAPPR verification code",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f5f3ff;border-radius:12px;">
            <h2 style="color:#6d28d9;margin:0 0 8px;">SWAPPR</h2>
            <p style="color:#374151;margin:0 0 16px;">Your one-time verification code:</p>
            <div style="font-size:40px;font-weight:900;letter-spacing:10px;color:#4f46e5;margin:0 0 24px;">${otp}</div>
            <p style="color:#6b7280;font-size:13px;margin:0;">Valid for 10 minutes. Do not share this code with anyone.</p>
          </div>`,
      });

      if (OTP_DEV_MODE) {
        console.log(
          `\n[OTP][DEV MODE] No email was sent. Code for ${email}: ${otp}\n` +
            `                Expires in ${Math.round(OTP_TTL_MS / 60000)} minutes.\n`,
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[OTP] Email send failed:", err.message);
      if (reservedHash) {
        await dbRun("DELETE FROM EmailOtps WHERE email = ? AND otpHash = ?", [email, reservedHash])
          .catch(() => {});
      }
      res.json({
        success: false,
        message: "Could not send a verification code. Please try again later.",
      });
    }
  },
);

app.post("/api/verify-otp",
  requestLimit("verify-otp-ip", 50, FIFTEEN_MINUTES),
  requestLimit("verify-otp-email", 15, FIFTEEN_MINUTES, emailKey),
  async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();
    if (!isValidSchoolEmail(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Enter the school email and 6-digit code." });
    }

    try {
      const now = Date.now();
      const record = await dbGet(
        `UPDATE EmailOtps SET attempts = attempts + 1, updatedAt = ?
         WHERE email = ? AND expiresAt > ? AND otpHash IS NOT NULL AND attempts < ?
         RETURNING attempts, otpHash`,
        [now, email, now, OTP_MAX_ATTEMPTS],
      );
      if (!record) {
        const active = await dbGet("SELECT attempts FROM EmailOtps WHERE email = ? AND expiresAt > ?", [email, now]);
        if (active?.attempts >= OTP_MAX_ATTEMPTS) {
          return res.status(429).json({ success: false, message: "Too many incorrect attempts. Request a new code." });
        }
        return res.json({ success: false, message: "No active OTP found. Request a new one." });
      }

      if (!await verifyOtpHash(otp, record.otpHash)) {
        const remaining = OTP_MAX_ATTEMPTS - record.attempts;
        if (!remaining) {
          return res.status(429).json({ success: false, message: "Too many incorrect attempts. Request a new code." });
        }
        return res.json({ success: false, message: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} left.` });
      }

      const verificationToken = crypto.randomBytes(32).toString("hex");
      const verified = await dbRun(
        `UPDATE EmailOtps SET verified = 1, verificationDigest = ?, updatedAt = ?
         WHERE email = ? AND otpHash = ? AND expiresAt > ?`,
        [credentialDigest(verificationToken), Date.now(), email, record.otpHash, Date.now()],
      );
      if (!verified.changes) {
        return res.status(409).json({ success: false, message: "Request and verify a fresh code." });
      }
      res.set("Cache-Control", "no-store").json({ success: true, verificationToken });
    } catch (err) {
      console.error("[OTP] Verification lookup failed:", err.message);
      res.status(500).json({ success: false, message: "Database error." });
    }
  },
);

app.post("/api/register",
  requestLimit("register-ip", 20, FIFTEEN_MINUTES),
  requestLimit("register-email", 10, FIFTEEN_MINUTES, emailKey),
  async (req, res) => {
    const { password, verificationToken } = req.body;
    const name = textField(req.body.name, 100);
    const cleanUsername = textField(req.body.username, 40);
    const course = textField(req.body.course, 150);
    const cleanEmail = normalizeEmail(req.body.email);
    const [studentId] = cleanEmail.split("@");
    const mismatchedId = Object.hasOwn(req.body, "studentId") &&
      textField(req.body.studentId, 64) !== studentId;
    const yearLevel = textField(req.body.yearLevel, 30);

    if (!name || !USERNAME_PATTERN.test(cleanUsername)) {
      return res.status(400).json({ success: false, message: "Enter your name and a username using letters, digits, dots, underscores or hyphens." });
    }
    if (!isCourse(course)) {
      return res.status(400).json({ success: false, message: "Please select a course from the list." });
    }
    if (req.body.yearLevel != null && (typeof req.body.yearLevel !== "string" || req.body.yearLevel.length > 30)) {
      return res.status(400).json({ success: false, message: "Invalid year level." });
    }
    const invalidPassword = passwordError(password);
    if (invalidPassword) return res.status(400).json({ success: false, message: invalidPassword });
    if (!isValidSchoolEmail(cleanEmail) || mismatchedId) {
      return res.status(400).json({ success: false, message: "Student ID must match the number in your school email." });
    }

    try {
      if (typeof verificationToken !== "string" || !/^[a-f0-9]{64}$/.test(verificationToken)) {
        return res.status(400).json({
          success: false,
          message: "Email not verified. Complete OTP verification first.",
        });
      }
      const verificationDigest = credentialDigest(verificationToken);

      // Checked again here: the name may have been taken since Register.
      const [usernameTaken, existingEmail, verifiedOtp] = await Promise.all([
        isUsernameTaken(cleanUsername),
        dbGet("SELECT id FROM Users WHERE email = ?", [cleanEmail]),
        dbGet(
          "SELECT 1 FROM EmailOtps WHERE email = ? AND verificationDigest = ? AND verified = 1 AND expiresAt > ?",
          [cleanEmail, verificationDigest, Date.now()],
        ),
      ]);
      if (!verifiedOtp) {
        return res.status(400).json({ success: false, message: "Email not verified. Complete OTP verification first." });
      }

      if (usernameTaken) {
        return res
          .status(400)
          .json({ success: false, message: USERNAME_TAKEN_MESSAGE, field: "username" });
      }

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "That school email is already registered.",
        });
      }

      // LOG002: department isn't asked for; it comes from the course.
      const finalDept = COURSE_TO_DEPARTMENT[course];
      const hashedPassword = await hashPassword(password);

      const result = await dbRun(
        `INSERT INTO Users (name, username, password, course, department, yearLevel, email, studentId)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM EmailOtps
           WHERE email = ? AND verificationDigest = ? AND verified = 1 AND expiresAt > ?)`,
        [
          name,
          cleanUsername,
          hashedPassword,
          course,
          finalDept,
          yearLevel,
          cleanEmail,
          studentId,
          cleanEmail,
          verificationDigest,
          Date.now(),
        ],
      );

      if (!result.changes) {
        return res.status(400).json({ success: false, message: "Email verification expired. Request a new code." });
      }
      await dbRun("DELETE FROM EmailOtps WHERE email = ? AND verificationDigest = ?", [cleanEmail, verificationDigest]);
      await startSession(res, "student", result.lastID, hashedPassword);

      res.status(201).json({
        success: true,
        userId: result.lastID,
        user: publicUser({
          id: result.lastID,
          name,
          username: cleanUsername,
          course,
        }),
      });
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT") {
        return res.status(409).json({ success: false, message: "Username or school email is already registered." });
      }
      console.error("[REGISTER] Insert error:", err.message);
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  },
);

// One login form serves both roles: the username is looked up among students
// first, then administrators, and the response says which one matched.
app.post("/api/login",
  requestLimit("login-ip", 50, FIFTEEN_MINUTES),
  requestLimit("login-account", 10, FIFTEEN_MINUTES,
    (req) => typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : ""),
  async (req, res) => {
    const username = textField(req.body.username, 150);
    const password = req.body.password;
    if (!username || typeof password !== "string" || !password || password.length > 1024) {
      return res.status(400).json({ success: false, message: "Input required data." });
    }

    try {
      // Prefer exact existing names; accept a trimmed legacy name only if unique.
      const accounts = await dbAll(
        `SELECT id, username, name, course, password, account_status, NULL AS admin_ID
         FROM Users WHERE trim(username) = ?
         UNION ALL
         SELECT NULL, username, name, NULL, password, NULL, admin_ID
         FROM Admin WHERE trim(username) = ?`,
        [username, username],
      );
      const exact = accounts.filter((row) => row.username === username);
      const candidates = exact.length ? exact : accounts;
      const account = candidates.length === 1 ? candidates[0] : null;
      const matches = await verifyPassword(password, isHashed(account?.password) ? account.password : UNKNOWN_ACCOUNT_HASH);
      if (!account || !matches || (IS_PRODUCTION && ["admin123", "pass1234"].includes(password))) {
        return res.status(401).json({ success: false, message: INVALID_CREDENTIALS });
      }
      const admin = account.admin_ID !== null ? account : null;
      const user = admin ? null : account;
      await req.releaseLoginAttempt();
      if (user?.account_status && user.account_status !== "active") {
        return res.status(403).json({
          success: false,
          message: "This account is suspended. Please contact the administrator.",
        });
      }

      const role = user ? "student" : "admin";
      if (!await startSession(res, role, user ? user.id : admin.admin_ID, account.password)) {
        return res.status(401).json({ success: false, message: "Account changed. Please log in again." });
      }
      res.json({ success: true, role, user: user ? publicUser(user) : publicAdmin(admin) });
    } catch (err) {
      console.error("[LOGIN] error:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

app.get("/api/me", requireAnyAuth, (req, res) => {
  if (req.currentAdmin) {
    return res.json({ success: true, role: "admin", user: req.currentAdmin });
  }
  res.json({ success: true, role: "student", user: req.currentUser });
});

app.post("/api/logout", async (req, res) => {
  await clearSession(req, res);
  res.json({ success: true });
});

app.get("/api/profile/:username", requireAuth, (req, res) => {
  db.get(
    // completedSwapps: accepted SWAPPs whose chat has been ended
    // (FUNC-014 REQT-002, FUNC-011 REQT-011).
    `SELECT Users.*,
            (SELECT COUNT(*) FROM Swapps
             WHERE (Swapps.sender_id = Users.id OR Swapps.receiver_id = Users.id)
               AND Swapps.status = 'accepted'
               AND EXISTS (
                 SELECT 1 FROM Chats
                 WHERE Chats.swapp_id = Swapps.id AND Chats.status = 'archived'
               )) AS completedSwapps
     FROM Users WHERE username=?`,
    [req.params.username],
    (err, user) => {
      if (err) return internalError(res, err);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Authors still see their own notebooks while under review or after
      // removal; everyone else only sees active ones.
      const isOwner = user.id === req.currentUser.id;
      const viewerId = req.currentUser.id;
      db.all(
        `SELECT Notebooks.id, Notebooks.title, Notebooks.description,
              Notebooks.department, Notebooks.course_code, Notebooks.author_id,
              ${NB_FILE_URL_FOR_VIEWER} AS file_url,
              Notebooks.created_at, Notebooks.status, Notebooks.report_count,
              ${NB_COUNT_COLUMNS},
              COUNT(Likes.notebook_id) as likes
      FROM Notebooks LEFT JOIN Likes ON Notebooks.id = Likes.notebook_id
      WHERE author_id=? ${isOwner ? "" : "AND COALESCE(Notebooks.status, 'active') = 'active'"}
      GROUP BY Notebooks.id ORDER BY Notebooks.created_at DESC`,
        [viewerId, viewerId, viewerId, user.id],
        (notebookErr, notebooks) => {
          if (notebookErr) {
            return internalError(res, notebookErr);
          }

          // SWAPP partners with their trust score (FUNC-014 REQT-002). One row
          // per partner, even if they share several accepted SWAPPs.
          db.all(
            `SELECT partner.id AS id, partner.username AS username,
                    COALESCE(partner.trust_score, ${TRUST_SCORE_DEFAULT}) AS trustScore
            FROM Swapps
            JOIN Users partner ON partner.id =
              CASE WHEN Swapps.sender_id = ? THEN Swapps.receiver_id ELSE Swapps.sender_id END
            WHERE (Swapps.sender_id = ? OR Swapps.receiver_id = ?) AND Swapps.status = 'accepted'
            GROUP BY partner.id
            ORDER BY partner.username`,
            [user.id, user.id, user.id],
            (matchErr, matchRows) => {
              if (matchErr) {
                return internalError(res, matchErr);
              }

              // FUNC-014 REQT-003: trust score, warning count and account
              // status are shown on the profile (read-only, REQT-010).
              const profile = {
                id: user.id,
                name: user.name,
                username: user.username,
                bio: user.bio,
                course: user.course || user.department || "",
                department: user.department || user.course || "",
                yearLevel: user.yearLevel || "",
                // PRF001: the student ID is shown on your own profile only.
                studentId: isOwner ? user.studentId || "" : "",
                trustScore: user.trust_score ?? TRUST_SCORE_DEFAULT,
                warningCount: user.warning_count ?? 0,
                accountStatus: user.account_status || "active",
                completedSwapps: user.completedSwapps || 0,
                portfolios: notebooks,
                matches: matchRows || [],
              };

              res.json({
                success: true,
                profile,
              });
            },
          );
        },
      );
    },
  );
});

// Students can edit profile details without changing their credentials.
// A password change verifies the old credential and revokes every old session.
app.patch("/api/profile", requireAuth,
  requestLimit("profile-ip", 60, FIFTEEN_MINUTES),
  requestLimit("profile-account", 15, FIFTEEN_MINUTES, (req) => req.currentUser.id),
  async (req, res) => {
    const me = req.currentUser.id;
    const name = textField(req.body.name, 100);
    const username = textField(req.body.username, 40);
    const course = textField(req.body.course, 150);
    const { password, currentPassword } = req.body || {};
    const changingPassword = password !== undefined && password !== "";

    if (!name || !USERNAME_PATTERN.test(username)) {
      return res.status(400).json({ success: false, message: "Enter your name and a valid username." });
    }
    if (!isCourse(course)) {
      return res.status(400).json({ success: false, message: "Please select a degree program from the list.", field: "course" });
    }
    if (changingPassword) {
      if (typeof currentPassword !== "string" || !currentPassword) {
        return res.status(400).json({ success: false, message: "Enter your current password.", field: "currentPassword" });
      }
      const invalidPassword = passwordError(password);
      if (invalidPassword) return res.status(400).json({ success: false, message: invalidPassword, field: "password" });
    }

    try {
      const [taken, current] = await Promise.all([
        isUsernameTaken(username, me),
        dbGet("SELECT course, department, password FROM Users WHERE id = ?", [me]),
      ]);
      if (taken) {
        return res.status(400).json({ success: false, message: USERNAME_TAKEN_MESSAGE, field: "username" });
      }
      if (!current) return res.status(401).json({ success: false, message: "Login required" });
      if (changingPassword && !await verifyPassword(currentPassword, current.password)) {
        return res.status(403).json({ success: false, message: "Current password is incorrect.", field: "currentPassword" });
      }

      const department = course === current.course ? current.department : COURSE_TO_DEPARTMENT[course] || course;
      const newHash = changingPassword ? await hashPassword(password) : null;
      const result = await dbRun(
        `UPDATE Users SET name = ?, username = ?, course = ?, department = ?, password = COALESCE(?, password)
         WHERE id = ? AND password IS ? AND EXISTS
           (SELECT 1 FROM Sessions WHERE digest = ? AND expiresAt > ?)`,
        [name, username, course, department, newHash, me, current.password, req.sessionDigest, Date.now()],
      );
      if (!result.changes) {
        return res.status(401).json({ success: false, message: "Account changed. Please log in again." });
      }
      if (changingPassword && !await startSession(res, "student", me, newHash)) {
        return res.status(401).json({ success: false, message: "Account changed. Please log in again." });
      }

      res.json({ success: true, user: publicUser({ id: me, name, username, course }) });
    } catch (err) {
      if (String(err.message).includes("UNIQUE constraint failed: Users.username")) {
        return res.status(400).json({ success: false, message: USERNAME_TAKEN_MESSAGE, field: "username" });
      }
      console.error("Profile update failed:", err.message);
      res.status(500).json({ success: false, message: "Could not update profile." });
    }
  },
);

app.get("/api/departments", (req, res) => {
  const departments = cleanDepartments(courseCatalog.flatMap((row) => row.reservedUnits));
  res.json({ success: true, departments });
});

app.get("/api/subjects", async (req, res) => {
  const course = req.query.course || "";
  if (course && course !== "ALL" && !isCourse(course)) {
    return res.status(400).json({ success: false, message: "Unknown course." });
  }
  const subjects = course === "ALL"
    ? filterSubjects(courseCatalog, [])
    : subjectsForCourse(courseCatalog, course);
  const rows = await dbAll(`SELECT DISTINCT course_code FROM Notebooks
    WHERE course_code IS NOT NULL AND trim(course_code) != '' AND COALESCE(status, 'active') = 'active'`);
  const codesWithNotebooks = rows.map((row) => row.course_code.trim());
  res.json({ success: true, subjects, codesWithNotebooks });
});

// A notebook's file link is only sent to its author and to students who
// unlocked it through an accepted SWAPP (FUNC-011 REQT-006, REQT-010).
// Everyone else gets null, so locked notebooks can't be opened.
const NB_FILE_URL_FOR_VIEWER = `
      CASE WHEN Notebooks.author_id = ? OR EXISTS (
        SELECT 1 FROM Transaction_Manifest
        JOIN Swapps ON Swapps.id = Transaction_Manifest.SWAPP_ID
        WHERE Transaction_Manifest.notebook_ID = Notebooks.id
          AND Swapps.status = 'accepted'
          AND (Swapps.sender_id = ? OR Swapps.receiver_id = ?)
      ) THEN Notebooks.file_url ELSE NULL END`;

// Takes the viewer's user id three times (see NB_FILE_URL_FOR_VIEWER).
// Reads the optional word / page / diagram counts from a notebook form.
// Returns null when any of them isn't a whole number.
function readNotebookCounts(body) {
  const counts = {};
  for (const [key, digits] of Object.entries(COUNT_DIGITS)) {
    const parsed = parseCount(body[key], digits);
    if (!parsed.ok) return null;
    counts[key] = parsed.value;
  }
  return counts;
}

const NB_COUNT_COLUMNS = `Notebooks.word_count AS wordCount,
      Notebooks.page_count AS pageCount,
      Notebooks.diagram_count AS diagramCount`;

const NB_SELECT = `
      SELECT 
      Notebooks.id, 
      Notebooks.title, 
      Notebooks.description,
      Notebooks.department,
      Notebooks.course_code,
      Notebooks.program,
      ${NB_FILE_URL_FOR_VIEWER} AS file_url,
      Notebooks.created_at,
      ${NB_COUNT_COLUMNS},
      Users.username,
      COALESCE(Users.trust_score, ${TRUST_SCORE_DEFAULT}) AS trustScore,
      COUNT(Likes.notebook_id) AS likes
      FROM Notebooks
      LEFT JOIN Users ON Notebooks.author_id = Users.id
      LEFT JOIN Likes ON Notebooks.id = Likes.notebook_id
      WHERE COALESCE(Notebooks.status, 'active') = 'active'
      GROUP BY Notebooks.id
      `;

const viewerParams = (req) => [
  req.currentUser.id,
  req.currentUser.id,
  req.currentUser.id,
];

app.get("/api/portfolios", requireAuth, async (req, res) => {
  const { program, subject } = req.query;
  if (program !== undefined && !isCourse(program) ||
      subject !== undefined && !catalogByCode.has(subject)) {
    return res.status(400).json({ success: false, message: "Unknown course or subject." });
  }
  const portfolios = await dbAll(
    `SELECT * FROM (${NB_SELECT})
     WHERE (? IS NULL OR program = ?) AND (? IS NULL OR course_code = ?)
     ORDER BY created_at DESC`,
    [...viewerParams(req), program ?? null, program ?? null, subject ?? null, subject ?? null],
  );
  res.json({ portfolios });
});

app.get("/api/portfolios/top", requireAuth, (req, res) => {
  db.all(`${NB_SELECT} ORDER BY likes DESC LIMIT 5`, viewerParams(req), (err, rows) => {
    if (err) return internalError(res, err);
    res.json({ portfolios: rows || [] });
  });
});

app.get("/api/portfolios/recent", requireAuth, (req, res) => {
  db.all(
    `${NB_SELECT} ORDER BY Notebooks.created_at DESC LIMIT 5`,
    viewerParams(req),
    (err, rows) => {
      if (err) return internalError(res, err);
      res.json({ portfolios: rows || [] });
    },
  );
});

// FUNC-008 REQT-003 / REQT-004, FUNC-009 REQT-004: the title and a valid
// http(s) File URL are required. Returns the cleaned fields, or an error.
function validateNotebookInput(body) {
  const title = textField(body.title, 120);
  const fileUrl = textField(body.fileUrl, 2048);
  const description = textField(body.description, 3000);
  const courseCode = textField(body.courseCode, 40);
  const subject = catalogByCode.get(courseCode);
  if (body.description != null && (typeof body.description !== "string" || body.description.length > 3000)) {
    return { error: { message: "Description must be 3000 characters or fewer." } };
  }
  if (body.courseCode != null && body.courseCode !== "" && !subject) {
    return { error: { message: "Select a subject from the course catalog." } };
  }
  if (body.department != null && (typeof body.department !== "string" || body.department.length > 150)) {
    return { error: { message: "Invalid department." } };
  }
  if (!title) return { error: { message: "Missing input.", field: "title" } };
  if (!isHttpUrl(fileUrl)) return { error: { message: "Missing input.", field: "fileUrl" } };

  const counts = readNotebookCounts(body);
  if (!counts) return { error: { message: "Enter a whole number." } };

  return {
    notebook: {
      title,
      description: description || null,
      department: subject?.department || null,
      courseCode: subject?.course_code || null,
      fileUrl,
      ...counts,
    },
  };
}

// FUNC-008 REQT-006 to REQT-008: a flagged notebook gets one open automatic
// report (no reporter), which puts it in Flagged Notebooks (ADM001).
async function fileScreeningReport(notebookId, hits) {
  await dbRun(
    `INSERT INTO Reports (reporter_ID, notebook_ID, reason, complaint)
     SELECT NULL, ?, 'auto_screening', ?
     WHERE NOT EXISTS (SELECT 1 FROM Reports
       WHERE notebook_ID = ? AND reason = 'auto_screening' AND status = 'open')`,
    [notebookId, screeningComplaint(hits), notebookId],
  );
}

// FUNC-008: publish a notebook. Screening decides whether it goes live
// (active) or waits for an administrator (under_review).
app.post("/api/portfolios", requireAuth, async (req, res) => {
  const { notebook, error } = validateNotebookInput(req.body);
  if (error) return res.status(400).json({ success: false, ...error });

  const screening = screenNotebook(notebook);
  // Saved as under_review first, so a flagged notebook is never visible,
  // even for a moment, and stays hidden if the report can't be written.
  const status = screening.flagged ? "under_review" : "active";

  try {
    const result = await dbRun(
      `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url,
                              status, word_count, page_count, diagram_count, program)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        notebook.title,
        notebook.description,
        notebook.department,
        notebook.courseCode,
        req.currentUser.id,
        notebook.fileUrl,
        status,
        notebook.wordCount,
        notebook.pageCount,
        notebook.diagramCount,
        isCourse(req.currentUser.course) ? req.currentUser.course : null,
      ],
    );
    if (screening.flagged) await fileScreeningReport(result.lastID, screening.hits);
    res.json({ success: true, id: result.lastID, status });
  } catch (err) {
    console.error("[NOTEBOOKS] create failed:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not save the notebook. Please try again." });
  }
});

// FUNC-009: the author edits a notebook. Screening runs again; a clean edit
// leaves the status alone, since an administrator decides anything already
// under review.
app.put("/api/portfolios/:id", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "A notebook ID is required." });
  const { notebook, error } = validateNotebookInput(req.body);
  if (error) return res.status(400).json({ success: false, ...error });

  const screening = screenNotebook(notebook);
  try {
    const result = await dbRun(
      `UPDATE Notebooks SET title=?, description=?, department=?, course_code=?, file_url=?,
                            word_count=?, page_count=?, diagram_count=?,
                            status = CASE WHEN ? THEN 'under_review' ELSE status END
       WHERE id=? AND author_id=? AND COALESCE(status, 'active') != 'removed'`,
      [
        notebook.title,
        notebook.description,
        notebook.department,
        notebook.courseCode,
        notebook.fileUrl,
        notebook.wordCount,
        notebook.pageCount,
        notebook.diagramCount,
        screening.flagged ? 1 : 0,
        id,
        req.currentUser.id,
      ],
    );
    if (!result.changes) {
      return res.status(404).json({ success: false, message: "Notebook not found" });
    }
    if (screening.flagged) await fileScreeningReport(id, screening.hits);

    const saved = await dbGet(`SELECT status FROM Notebooks WHERE id = ?`, [id]);
    res.json({ success: true, status: saved?.status || "active" });
  } catch (err) {
    console.error("[NOTEBOOKS] update failed:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not save the notebook. Please try again." });
  }
});

app.post("/api/portfolios/delete", requireAuth, async (req, res) => {
  const id = parseId(req.body.id);
  if (!id) return res.status(400).json({ success: false, message: "A notebook ID is required." });

  try {
    const result = await dbRun("DELETE FROM Notebooks WHERE id = ? AND author_id = ?", [id, req.currentUser.id]);
    if (!result.changes) return res.status(404).json({ success: false, message: "Notebook not found" });
    res.json({ success: true });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT" && err.message.includes("notebook_in_open_swapp")) {
      return res.status(409).json({
        success: false,
        message: "This notebook is part of an active swap. It can be deleted after the swap ends.",
      });
    }
    internalError(res, err);
  }
});

app.post("/api/portfolios/like", requireAuth, async (req, res) => {
  const notebookId = parseId(req.body.notebookId);
  const userId = req.currentUser.id;
  if (!notebookId) return res.status(400).json({ success: false, message: "A notebook ID is required." });

  // Use the same access rules as the file link and apply them within the write.
  const result = await dbRun(
    `INSERT INTO Likes (user_id, notebook_id)
     SELECT ?, Notebooks.id FROM Notebooks
     WHERE Notebooks.id = ? AND COALESCE(Notebooks.status, 'active') = 'active'
       AND (${NB_FILE_URL_FOR_VIEWER}) IS NOT NULL
     ON CONFLICT(user_id, notebook_id) DO NOTHING`,
    [userId, notebookId, userId, userId, userId],
  );
  if (result.changes) return res.json({ success: true });

  const notebook = await dbGet(
    `SELECT (${NB_FILE_URL_FOR_VIEWER}) AS fileUrl FROM Notebooks
     WHERE id = ? AND COALESCE(status, 'active') = 'active'`,
    [userId, userId, userId, notebookId],
  );
  if (!notebook) return res.status(404).json({ success: false, message: "Notebook not found." });
  if (!notebook.fileUrl) return res.status(403).json({ success: false, message: "Unlock this notebook before liking it." });
  res.status(409).json({ success: false, message: "Already liked" });
});

const REPORT_REASONS = new Set([
  "inappropriate",
  "spam",
  "plagiarism",
  "harassment",
  "other",
]);
const REPORT_DETAILS_MAX_LENGTH = 500;

// FUNC-015: a student reports a notebook (and through it, its author). Enough
// reports move the notebook out of the public feed and into the admin's
// Flagged Notebooks queue.
// FUNC-015: report a notebook or another student's account. Exactly one of
// notebookId / reportedUserId names the target.
app.post("/api/reports", requireAuth,
  requestLimit("reports-account", 12, FIFTEEN_MINUTES, (req) => req.currentUser.id),
  async (req, res) => {
    const hasNotebook = req.body.notebookId !== undefined && req.body.notebookId !== null;
    const hasUser = req.body.reportedUserId !== undefined && req.body.reportedUserId !== null;
    const notebookId = parseId(req.body.notebookId);
    const reportedUserId = parseId(req.body.reportedUserId);
    const reason = textField(req.body.reason, 30);
    const details = textField(req.body.details, REPORT_DETAILS_MAX_LENGTH);

    const validTarget = hasNotebook !== hasUser &&
      Number.isInteger(hasNotebook ? notebookId : reportedUserId);
    if (!validTarget || !REPORT_REASONS.has(reason) || !details) {
      return res.status(400).json({ success: false, message: "Missing input." });
    }
    if (hasUser) return reportUser(req, res, reportedUserId, reason, details);

    try {
      const notebook = await dbGet(
        `SELECT id, author_id, COALESCE(status, 'active') AS status FROM Notebooks WHERE id = ?`,
        [notebookId],
      );
      if (!notebook || notebook.status === "removed") {
        return res
          .status(404)
          .json({ success: false, message: "Notebook not found." });
      }
      if (notebook.author_id === req.currentUser.id) {
        return res.status(400).json({
          success: false,
          message: "You can't report your own notebook.",
        });
      }

      const result = await dbRun(
        `INSERT INTO Reports (reporter_ID, notebook_ID, reason, complaint)
         SELECT ?, id, ?, ? FROM Notebooks WHERE id = ? AND COALESCE(status, 'active') != 'removed'
           AND NOT EXISTS (SELECT 1 FROM Reports WHERE reporter_ID = ? AND notebook_ID = ? AND status = 'open')`,
        [req.currentUser.id, reason, details, notebookId, req.currentUser.id, notebookId],
      );
      if (!result.changes) {
        return res.status(409).json({ success: false, message: "This notebook was already reported or is no longer available." });
      }

      res.status(201).json({ success: true, reportId: result.lastID });
    } catch (err) {
      console.error("[REPORTS] create failed:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
);

// A reported account stays active until an administrator acts on the report
// in ADM002 (UC-08).
async function reportUser(req, res, reportedUserId, reason, details) {
  try {
    const target = await dbGet(`SELECT id FROM Users WHERE id = ?`, [reportedUserId]);
    if (!target) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (target.id === req.currentUser.id) {
      return res
        .status(400)
        .json({ success: false, message: "You can't report your own account." });
    }
    const alreadyReported = await dbGet(
      `SELECT report_ID FROM Reports
       WHERE reporter_ID = ? AND reported_user_ID = ? AND status = 'open'`,
      [req.currentUser.id, target.id],
    );
    if (alreadyReported) {
      return res.status(409).json({
        success: false,
        message: "You already reported this account. An admin will review it.",
      });
    }
    const result = await dbRun(
      `INSERT INTO Reports (reporter_ID, reported_user_ID, reason, complaint) VALUES (?,?,?,?)`,
      [req.currentUser.id, target.id, reason, details],
    );
    res.status(201).json({ success: true, reportId: result.lastID });
  } catch (err) {
    console.error("[REPORTS] user report failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Applies a trust change (see lib/trustScore.js) in one statement, so two
// events at once can't overwrite each other. Same clamp as applyTrustChange.
function adjustTrustScore(userId, change, run = dbRun) {
  return run(
    `UPDATE Users
     SET trust_score = MAX(?, MIN(?, COALESCE(trust_score, ?) + ?))
     WHERE id = ?`,
    [TRUST_SCORE_MIN, TRUST_SCORE_MAX, TRUST_SCORE_DEFAULT, change, userId],
  );
}

// A student has access to a notebook once it is on the manifest of an
// accepted SWAPP they are part of (FUNC-011 REQT-006).
function findAccessSwapp(userId, notebookId) {
  return dbGet(
    `SELECT Swapps.id FROM Transaction_Manifest
     JOIN Swapps ON Swapps.id = Transaction_Manifest.SWAPP_ID
     WHERE Transaction_Manifest.notebook_ID = ?
       AND Swapps.status = 'accepted'
       AND (Swapps.sender_id = ? OR Swapps.receiver_id = ?)
     LIMIT 1`,
    [notebookId, userId, userId],
  );
}

// FUNC-010 (UC-04): request access to one notebook, offering one or more of
// your own in exchange. The receiver is the requested notebook's author.
app.post("/api/swapps", requireAuth, async (req, res) => {
  const senderId = req.currentUser.id;
  const notebookId = parseId(req.body.notebookId);
  const offered = req.body.offeredNotebookIds;
  if (!Array.isArray(offered) || offered.length > 100 || offered.some((id) => !parseId(id))) {
    return res.status(400).json({ success: false, message: "Select valid notebooks to offer." });
  }
  const offeredIds = [...new Set(offered.map(parseId))];

  if (!Number.isInteger(notebookId) || notebookId <= 0) {
    return res.status(404).json({ success: false, message: "Notebook not found." });
  }

  try {
    const notebook = await dbGet(
      `SELECT id, author_id, COALESCE(status, 'active') AS status
       FROM Notebooks WHERE id = ?`,
      [notebookId],
    );
    if (!notebook || notebook.status !== "active") {
      return res.status(404).json({ success: false, message: "Notebook not found." });
    }
    // REQT-009
    if (notebook.author_id === senderId) {
      return res.status(400).json({
        success: false,
        message: "You can't send a swap request for your own notebook.",
      });
    }
    if (await findAccessSwapp(senderId, notebookId)) {
      return res.status(409).json({
        success: false,
        message: "You already have access to this notebook.",
      });
    }
    // REQT-010: a rejected request doesn't count, so students can ask again.
    const duplicate = await dbGet(
      `SELECT Swapps.id FROM Swapps
       JOIN Transaction_Manifest ON Transaction_Manifest.SWAPP_ID = Swapps.id
       WHERE Swapps.sender_id = ? AND Swapps.status = 'pending'
         AND Transaction_Manifest.notebook_ID = ?
       LIMIT 1`,
      [senderId, notebookId],
    );
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "You already have a pending request for this notebook.",
      });
    }

    // REQT-002, REQT-008: notebooks under review or removed are hidden from
    // other students, so only active ones can be offered.
    const ownNotebooks = await dbAll(
      `SELECT id FROM Notebooks
       WHERE author_id = ? AND COALESCE(status, 'active') = 'active'`,
      [senderId],
    );
    if (!ownNotebooks.length) {
      return res.status(400).json({
        success: false,
        code: "NO_NOTEBOOKS",
        message: "Upload a notebook before sending a request.",
      });
    }
    // REQT-003 to REQT-005: at least one of your own notebooks is offered.
    if (!offeredIds.length) {
      return res.status(400).json({
        success: false,
        code: "NO_OFFER",
        message: "Select at least one notebook to offer.",
      });
    }
    const ownIds = new Set(ownNotebooks.map((row) => row.id));
    if (!offeredIds.every((id) => ownIds.has(id))) {
      return res.status(400).json({
        success: false,
        message: "You can only offer your own notebooks.",
      });
    }

    // REQT-006
    const result = await dbRun(
      `INSERT INTO Swapps (sender_id, receiver_id, status, date_created)
       VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`,
      [senderId, notebook.author_id],
    );
    const swappId = result.lastID;
    // REQT-005: one line for the requested notebook and one per offered
    // notebook, written in a single statement so the manifest is never partial.
    const lines = [notebookId, ...offeredIds];
    try {
      await dbRun(
        `INSERT INTO Transaction_Manifest (SWAPP_ID, notebook_ID, is_confirmed)
         VALUES ${lines.map(() => "(?, ?, 0)").join(", ")}`,
        lines.flatMap((id) => [swappId, id]),
      );
    } catch (manifestErr) {
      await dbRun(`DELETE FROM Swapps WHERE id = ?`, [swappId]).catch(() => {});
      throw manifestErr;
    }

    res.status(201).json({ success: true, swappId });
  } catch (err) {
    console.error("[SWAPPS] create failed:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not send the request. Please try again." });
  }
});

app.get("/api/swapps/:username", requireAuth, async (req, res) => {
  if (req.params.username !== req.currentUser.username) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const me = req.currentUser.id;

  try {
    // FUNC-011 REQT-003: newest first. Undated requests (made before dates
    // were recorded) sort last, by insertion order.
    const swapps = await dbAll(
      `SELECT Swapps.*, s.username AS sender, r.username AS receiver,
              COALESCE(s.trust_score, ${TRUST_SCORE_DEFAULT}) AS senderTrustScore,
              c.username AS cancelledBy,
              EXISTS (
                SELECT 1 FROM Chats
                WHERE Chats.swapp_id = Swapps.id AND Chats.status = 'archived'
              ) AS chatEnded
       FROM Swapps
       JOIN Users s ON Swapps.sender_id = s.id
       JOIN Users r ON Swapps.receiver_id = r.id
       LEFT JOIN Users c ON Swapps.cancelled_by = c.id
       WHERE sender_id = ? OR receiver_id = ?
       ORDER BY Swapps.date_created IS NULL, Swapps.date_created DESC, Swapps.id DESC`,
      [me, me],
    );

    // Attach each SWAPP's manifest: the notebook(s) requested from the
    // receiver and the notebook(s) the sender offered. Lines whose notebook
    // was since deleted are left out.
    const lines = swapps.length
      ? await dbAll(
          `SELECT Transaction_Manifest.SWAPP_ID AS swappId,
                  Transaction_Manifest.is_confirmed AS isConfirmed,
                  Notebooks.id, Notebooks.title, Notebooks.author_id AS authorId,
                  COALESCE(Notebooks.status, 'active') AS status
           FROM Transaction_Manifest
           JOIN Notebooks ON Notebooks.id = Transaction_Manifest.notebook_ID
           WHERE Transaction_Manifest.SWAPP_ID IN (${swapps.map(() => "?").join(", ")})
           ORDER BY Transaction_Manifest.Transaction_Manifest_ID`,
          swapps.map((swapp) => swapp.id),
        )
      : [];

    const bySwapp = new Map();
    for (const line of lines) {
      if (!bySwapp.has(line.swappId)) bySwapp.set(line.swappId, []);
      bySwapp.get(line.swappId).push(line);
    }
    const describe = ({ id, title, status, isConfirmed }) => ({
      id,
      title,
      status,
      isConfirmed: Boolean(isConfirmed),
    });

    res.json({
      swapps: swapps.map((swapp) => {
        const swappLines = bySwapp.get(swapp.id) || [];
        return {
          ...swapp,
          chatEnded: Boolean(swapp.chatEnded),
          requestedNotebooks: swappLines
            .filter((line) => line.authorId === swapp.receiver_id)
            .map(describe),
          offeredNotebooks: swappLines
            .filter((line) => line.authorId === swapp.sender_id)
            .map(describe),
        };
      }),
    });
  } catch (err) {
    console.error("[SWAPPS] list failed:", err.message);
    res.status(500).json({ success: false, message: "Could not load swaps." });
  }
});

// FUNC-011 (UC-05): the receiver accepts or declines a pending request.
app.put("/api/swapps/:id/respond", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const { status } = req.body;
  if (status !== "accepted" && status !== "rejected") {
    return res.status(400).json({ success: false, message: "Invalid response." });
  }

  try {
    const result = await withAccountTransaction(async ({ run, get }) => {
      const swapp = await get(
        `SELECT * FROM Swapps WHERE id=? AND receiver_id=?`,
        [id, req.currentUser.id],
      );
      if (!swapp) {
        return [404, "Swap not found"];
      }

      // Only a pending request can be answered, and only once.
      const update = await run(
        `UPDATE Swapps SET status=? WHERE id=? AND status='pending'`,
        [status, swapp.id],
      );
      if (!update.changes) {
        return [409, "This request has already been answered."];
      }

      if (status === "accepted") {
        // REQT-006: accepting confirms every line of the manifest.
        await run(
          `UPDATE Transaction_Manifest SET is_confirmed = 1 WHERE SWAPP_ID = ?`,
          [swapp.id],
        );
        const existing = await get(`SELECT id FROM Chats WHERE swapp_id=?`, [
          swapp.id,
        ]);
        if (!existing) {
          await run(
            `INSERT INTO Chats (swapp_id, user_a_id, user_b_id, expires_at)
             VALUES (?, ?, ?, datetime(CURRENT_TIMESTAMP, ${CHAT_EXPIRY_OFFSET}))`,
            [swapp.id, swapp.sender_id, swapp.receiver_id],
          );
          console.log(`[CHAT] Created chat for swapp ${swapp.id}`);
        }
      }
    });
    sendChangeResult(res, result);
  } catch (err) {
    console.error("[CHAT] respond failed:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

// FUNC-011 REQT-009, REQT-010 (UC-05 extension 3a): either student cancels an
// accepted SWAPP. Access to its notebooks ends, because access comes only from
// accepted SWAPPs, and its chat closes at once (FUNC-013 REQT-007). A SWAPP
// whose chat was already ended is complete and can no longer be cancelled.
app.post("/api/swapps/:id/cancel", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const me = req.currentUser.id;
  try {
    const result = await withAccountTransaction(async ({ run, get }) => {
      const swapp = await get(
        `SELECT * FROM Swapps WHERE id = ? AND (sender_id = ? OR receiver_id = ?)`,
        [id, me, me],
      );
      if (!swapp) {
        return [404, "Swap not found"];
      }
      if (swapp.status !== "accepted") {
        return [409, "Only an accepted swap can be cancelled."];
      }
      const ended = await get(
        `SELECT id FROM Chats WHERE swapp_id = ? AND status = 'archived'`,
        [swapp.id],
      );
      if (ended) {
        return [409, "This swap has already ended and can't be cancelled."];
      }

      const update = await run(
        `UPDATE Swapps
         SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP,
             cancel_notified = 0
         WHERE id = ? AND status = 'accepted'`,
        [me, swapp.id],
      );
      if (!update.changes) {
        return [409, "Only an accepted swap can be cancelled."];
      }
      await run(
        `UPDATE Chats SET status = 'archived', archived_at = CURRENT_TIMESTAMP,
                          archived_reason = 'swapp_cancelled'
         WHERE swapp_id = ? AND status = 'active'`,
        [swapp.id],
      );
      // FUNC-011 REQT-011: only the student who cancelled loses trust.
      await adjustTrustScore(me, TRUST_CHANGE.swappCancelled, run);
    });
    sendChangeResult(res, result);
  } catch (err) {
    console.error("[SWAPPS] cancel failed:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not cancel the swap. Please try again." });
  }
});

// The other student has seen the "cancelled" notice, so it isn't shown again.
app.post("/api/swapps/:id/cancel-seen", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const me = req.currentUser.id;
  try {
    await dbRun(
      `UPDATE Swapps SET cancel_notified = 1
       WHERE id = ? AND status = 'cancelled' AND cancelled_by != ?
         AND (sender_id = ? OR receiver_id = ?)`,
      [id, me, me, me],
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[SWAPPS] cancel-seen failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Chat routes. Every lookup checks (user_a_id=? OR user_b_id=?) so only the
// two participants of a chat can read it, post to it, or end it.
const CHAT_MESSAGE_MAX_LENGTH = 1000;

function findChatForUser(chatId, userId) {
  return dbGet(
    `SELECT * FROM Chats WHERE id=? AND (user_a_id=? OR user_b_id=?)`,
    [chatId, userId, userId],
  );
}

// Each participant has their own "last read message id" column on Chats.
function lastReadColumn(chat, userId) {
  return chat.user_a_id === userId ? "user_a_last_read" : "user_b_last_read";
}

// unreadCount / lastIncomingId only count messages from the other person;
// the frontend polls this list to drive the unread badges and the
// "New message from @x" popup.
app.get("/api/chats", requireAuth, async (req, res) => {
  const me = req.currentUser.id;
  try {
    await archiveExpiredChats();
    const chats = await dbAll(
      `SELECT Chats.*,
CASE WHEN user_a_id = ? THEN ub.username ELSE ua.username END AS otherUsername,
(SELECT COUNT(*) FROM ChatMessages m
 WHERE m.chat_id = Chats.id AND m.sender_id != ?
   AND m.id > COALESCE(CASE WHEN Chats.user_a_id = ? THEN Chats.user_a_last_read ELSE Chats.user_b_last_read END, 0)
) AS unreadCount,
(SELECT MAX(m.id) FROM ChatMessages m
 WHERE m.chat_id = Chats.id AND m.sender_id != ?) AS lastIncomingId
FROM Chats
JOIN Users ua ON Chats.user_a_id = ua.id
JOIN Users ub ON Chats.user_b_id = ub.id
WHERE user_a_id = ? OR user_b_id = ?
ORDER BY Chats.id DESC`,
      [me, me, me, me, me, me],
    );
    res.json({ chats });
  } catch (err) {
    console.error("[CHAT] list chats failed:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

app.get("/api/chats/:id/messages", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  try {
    await archiveExpiredChats();
    const chat = await findChatForUser(id, req.currentUser.id);
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }
    const other = await dbGet(`SELECT username FROM Users WHERE id=?`, [
      chat.user_a_id === req.currentUser.id ? chat.user_b_id : chat.user_a_id,
    ]);
    const messages = await dbAll(
      `SELECT ChatMessages.*, Users.username AS senderUsername
FROM ChatMessages
JOIN Users ON ChatMessages.sender_id = Users.id
WHERE chat_id=?
ORDER BY ChatMessages.id ASC`,
      [chat.id],
    );

    // Opening (or polling) a chat marks everything in it as read for this user.
    const newestId = messages.length ? messages[messages.length - 1].id : 0;
    const column = lastReadColumn(chat, req.currentUser.id);
    if (newestId > (chat[column] || 0)) {
      await dbRun(`UPDATE Chats SET ${column} = ? WHERE id = ?`, [
        newestId,
        chat.id,
      ]);
    }

    res.json({
      chat: { ...chat, otherUsername: other?.username || "" },
      messages,
    });
  } catch (err) {
    console.error("[CHAT] fetch messages failed:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

app.post("/api/chats/:id/messages", requireAuth,
  requestLimit("chat-account", 60, 60_000, (req) => req.currentUser.id),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
    try {
      await archiveExpiredChats();
      const chat = await findChatForUser(id, req.currentUser.id);
      if (!chat) {
        return res
          .status(404)
          .json({ success: false, message: "Chat not found" });
      }
      if (chat.status !== "active") {
        return res
          .status(403)
          .json({ success: false, message: "This chat has ended" });
      }
      const body = textField(req.body.body, 2000);
      if (!body) {
        return res
          .status(400)
          .json({ success: false, message: "Message cannot be empty" });
      }
      if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
        return res.status(400).json({
          success: false,
          message: `Message must be ${CHAT_MESSAGE_MAX_LENGTH} characters or fewer`,
        });
      }
      const result = await dbRun(
        `INSERT INTO ChatMessages (chat_id, sender_id, body) VALUES (?, ?, ?)`,
        [chat.id, req.currentUser.id, body],
      );
      console.log(`[CHAT] Message ${result.lastID} sent in chat ${chat.id}`);
      res.json({ success: true, id: result.lastID });
    } catch (err) {
      console.error("[CHAT] send message failed:", err.message);
      res.status(500).json({ success: false, message: "Server error. Please try again." });
    }
  },
);

app.post("/api/chats/:id/archive", requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  try {
    const chat = await findChatForUser(id, req.currentUser.id);
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }
    await dbRun(
      `UPDATE Chats SET status='archived', archived_at=CURRENT_TIMESTAMP, archived_reason='ended'
       WHERE id=? AND status='active'`,
      [chat.id],
    );

    console.log(
      `[CHAT] Chat ${chat.id} archived by user ${req.currentUser.id}`,
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[CHAT] archive failed:", err.message);
    res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

// FUNC-013 REQT-005 / REQT-006: archive every chat whose retention timestamp
// has passed. Runs from the background job and whenever a chat is read or
// written, so a chat closes on time rather than at the next hourly run.
async function archiveExpiredChats() {
  const expired = await dbAll(
    `SELECT id, swapp_id FROM Chats
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP`,
  );
  let closed = 0;
  for (const chat of expired) {
    const update = await dbRun(
      `UPDATE Chats SET status = 'archived', archived_at = CURRENT_TIMESTAMP,
                        archived_reason = 'expired'
       WHERE id = ? AND status = 'active'`,
      [chat.id],
    );
    closed += update.changes;
  }
  if (closed) console.log(`[CHAT] ${closed} expired chat(s) archived`);
}

// Background jobs: at start and then every hour (Software Architecture,
// "Background Jobs"). A failure is logged and retried next time.
async function runMaintenance() {
  try {
    const now = Date.now();
    await dbRun("DELETE FROM Sessions WHERE expiresAt <= ?", [now]);
    await dbRun("DELETE FROM RequestLimits WHERE expiresAt <= ?", [now]);
    await archiveExpiredChats();
    const purged = await dbRun("DELETE FROM EmailOtps WHERE expiresAt <= ?", [now]);
    if (purged.changes) console.log(`[OTP] ${purged.changes} expired code(s) purged`);
    await dbRun(`DELETE FROM ChatMessages WHERE chat_id IN (
      SELECT id FROM Chats WHERE status = 'archived'
        AND COALESCE(archived_at, expires_at, created_at) <= datetime('now', '-30 days')
    )`);
    await dbRun(`DELETE FROM Reports WHERE status != 'open'
      AND COALESCE(date_resolved, date_submitted) <= datetime('now', '-90 days')`);
  } catch (err) {
    console.error("[MAINTENANCE] failed:", err.message);
  }
}

// ── Admin panel (FUNC-016 to FUNC-018) ──────────────────────────────────────
// Report statuses: open → notebook_removed | user_suspended | disregarded.

function parseId(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function closeOpenReports(notebookId, status, adminId, run) {
  await run(
    `UPDATE Reports SET status = ?, resolved_by = ?, date_resolved = CURRENT_TIMESTAMP
     WHERE notebook_ID = ? AND status = 'open'`,
    [status, adminId, notebookId],
  );
}

async function removeNotebook(notebook, adminId, run) {
  // Only the first removal counts against the author.
  if (notebook.status !== "removed") {
    await run(`UPDATE Notebooks SET status = 'removed' WHERE id = ?`, [
      notebook.id,
    ]);
    await run(
      `UPDATE Users SET warning_count = COALESCE(warning_count, 0) + 1 WHERE id = ?`,
      [notebook.author_id],
    );
    // Platform conduct: each warning also lowers the author's trust.
    await adjustTrustScore(notebook.author_id, TRUST_CHANGE.warning, run);
  }
  await closeOpenReports(notebook.id, "notebook_removed", adminId, run);
}

function getNotebookForAdmin(id, get = dbGet) {
  return get(
    `SELECT Notebooks.*, COALESCE(Notebooks.status, 'active') AS status,
            COALESCE(Notebooks.report_count, 0) AS report_count
     FROM Notebooks WHERE id = ?`,
    [id],
  );
}

app.get("/api/admin/notebooks", requireAdminAuth, async (req, res) => {
  try {
    const notebooks = await dbAll(
      `SELECT Notebooks.id, Notebooks.title, Notebooks.department,
              Notebooks.created_at AS createdAt,
              COALESCE(Notebooks.report_count, 0) AS reportCount,
              COALESCE(Notebooks.status, 'active') AS status,
              Users.username AS author
       FROM Notebooks LEFT JOIN Users ON Users.id = Notebooks.author_id
       WHERE COALESCE(Notebooks.status, 'active') = 'under_review'
       ORDER BY Notebooks.created_at DESC`,
    );
    res.json({ success: true, notebooks });
  } catch (err) {
    console.error("[ADMIN] list notebooks failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/admin/notebooks/:id", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const notebook = await dbGet(
      `SELECT Notebooks.id, Notebooks.title, Notebooks.description,
              Notebooks.department, Notebooks.course_code AS courseCode,
              Notebooks.file_url AS fileUrl, Notebooks.created_at AS createdAt,
              COALESCE(Notebooks.report_count, 0) AS reportCount,
              COALESCE(Notebooks.status, 'active') AS status,
              Users.username AS author
       FROM Notebooks LEFT JOIN Users ON Users.id = Notebooks.author_id
       WHERE Notebooks.id = ?`,
      [id],
    );
    if (!notebook) {
      return res.status(404).json({ success: false, message: "Notebook not found" });
    }

    const reports = await dbAll(
      `SELECT Reports.report_ID AS id, Reports.reason, Reports.complaint,
              Reports.status, Reports.date_submitted AS dateSubmitted,
              Users.username AS reporter
       FROM Reports LEFT JOIN Users ON Users.id = Reports.reporter_ID
       WHERE Reports.notebook_ID = ?
       ORDER BY Reports.date_submitted DESC, Reports.report_ID DESC`,
      [id],
    );
    res.json({ success: true, notebook, reports });
  } catch (err) {
    console.error("[ADMIN] notebook detail failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/admin/notebooks/:id/mark-safe", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const result = await withAccountTransaction(async ({ run, get }) => {
      const notebook = await getNotebookForAdmin(id, get);
      if (!notebook) {
        return [404, "Notebook not found"];
      }
      if (notebook.status !== "under_review") {
        return [409, "This notebook is not under review."];
      }

      await run(`UPDATE Notebooks SET status = 'active' WHERE id = ?`, [id]);
      await closeOpenReports(id, "disregarded", req.currentAdmin.id, run);
    });
    sendChangeResult(res, result);
  } catch (err) {
    console.error("[ADMIN] mark safe failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/admin/notebooks/:id/mark-unsafe", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const result = await withAccountTransaction(async ({ run, get }) => {
      const notebook = await getNotebookForAdmin(id, get);
      if (!notebook) {
        return [404, "Notebook not found"];
      }
      if (notebook.status !== "under_review") {
        return [409, "This notebook is not under review."];
      }

      await removeNotebook(notebook, req.currentAdmin.id, run);
    });
    sendChangeResult(res, result);
  } catch (err) {
    console.error("[ADMIN] mark unsafe failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/admin/reports", requireAdminAuth, async (req, res) => {
  try {
    const reports = await dbAll(
      `SELECT Reports.report_ID AS id, Reports.reason, Reports.complaint,
              Reports.status, Reports.date_submitted AS dateSubmitted,
              Reports.notebook_ID AS notebookId,
              reporter.username AS reporter,
              Notebooks.title AS notebookTitle,
              Notebooks.description AS notebookDescription,
              Notebooks.file_url AS notebookFileUrl,
              COALESCE(Notebooks.status, 'active') AS notebookStatus,
              CASE WHEN Reports.reported_user_ID IS NOT NULL THEN 'user' ELSE 'notebook' END
                AS reportType,
              COALESCE(target.id, author.id) AS reportedUserId,
              COALESCE(target.username, author.username) AS reportedUser,
              COALESCE(target.account_status, author.account_status, 'active') AS reportedUserStatus,
              COALESCE(target.name, author.name) AS reportedUserName,
              COALESCE(target.course, author.course) AS reportedUserCourse,
              COALESCE(target.trust_score, author.trust_score, ${TRUST_SCORE_DEFAULT}) AS reportedUserTrust,
              COALESCE(target.warning_count, author.warning_count, 0) AS reportedUserWarnings,
              Admin.username AS resolvedBy
       FROM Reports
       LEFT JOIN Users reporter ON reporter.id = Reports.reporter_ID
       LEFT JOIN Notebooks ON Notebooks.id = Reports.notebook_ID
       LEFT JOIN Users author ON author.id = Notebooks.author_id
       LEFT JOIN Users target ON target.id = Reports.reported_user_ID
       LEFT JOIN Admin ON Admin.admin_ID = Reports.resolved_by
       ORDER BY Reports.date_submitted DESC, Reports.report_ID DESC`,
    );
    res.json({ success: true, reports });
  } catch (err) {
    console.error("[ADMIN] list reports failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/admin/reports/:id/resolve", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const { action } = req.body;
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  if (!["remove_notebook", "suspend_user", "disregard"].includes(action)) {
    return res.status(400).json({ success: false, message: "Invalid action" });
  }

  try {
    const result = await withAccountTransaction(async ({ run, get }) => {
      const report = await get(`SELECT * FROM Reports WHERE report_ID = ?`, [id]);
      if (!report) {
        return [404, "Report not found"];
      }
      if (report.status !== "open") {
        return [409, "This report is already resolved."];
      }

      const notebook = report.notebook_ID
        ? await getNotebookForAdmin(report.notebook_ID, get)
        : null;
      if (action === "remove_notebook" && !notebook) {
        return [409, report.reported_user_ID
            ? "Only a notebook report can remove a notebook."
            : "The reported notebook no longer exists."];
      }
      // Suspending hits the reported account, or the reported notebook's author.
      const suspendId = report.reported_user_ID || notebook?.author_id;
      if (action === "suspend_user" && !suspendId) {
        return [409, "The reported notebook no longer exists."];
      }
      const adminId = req.currentAdmin.id;

      if (action === "remove_notebook") {
        // Closes this report and every other open report on the notebook.
        await removeNotebook(notebook, adminId, run);
      } else if (action === "suspend_user") {
        await run(`UPDATE Users SET account_status = 'suspended' WHERE id = ?`, [
          suspendId,
        ]);
        await run(
          `UPDATE Reports SET status = 'user_suspended', resolved_by = ?, date_resolved = CURRENT_TIMESTAMP
           WHERE report_ID = ?`,
          [adminId, id],
        );
      } else {
        await run(
          `UPDATE Reports SET status = 'disregarded', resolved_by = ?, date_resolved = CURRENT_TIMESTAMP
           WHERE report_ID = ?`,
          [adminId, id],
        );

      }
    });
    sendChangeResult(res, result);
  } catch (err) {
    console.error("[ADMIN] resolve report failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const ADMIN_USER_COLUMNS = `Users.id, Users.username, Users.name, Users.course,
  COALESCE(Users.trust_score, ${TRUST_SCORE_DEFAULT}) AS trustScore,
  COALESCE(Users.warning_count, 0) AS warningCount,
  COALESCE(Users.account_status, 'active') AS accountStatus`;

function withWarningFlag(user) {
  return {
    ...user,
    highlightWarning: user.warningCount > WARNING_HIGHLIGHT_THRESHOLD,
  };
}

app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const users = await dbAll(
      `SELECT ${ADMIN_USER_COLUMNS} FROM Users ORDER BY Users.id ASC`,
    );
    res.json({
      success: true,
      warningThreshold: WARNING_HIGHLIGHT_THRESHOLD,
      users: users.map(withWarningFlag),
    });
  } catch (err) {
    console.error("[ADMIN] list users failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/admin/users/:id", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const user = await dbGet(
      `SELECT ${ADMIN_USER_COLUMNS}, Users.bio, Users.department, Users.email,
              Users.studentId
       FROM Users WHERE Users.id = ?`,
      [id],
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const [notebooks, swapps, reports, repeatPairs] = await Promise.all([
      dbAll(
        `SELECT id, title, course_code AS courseCode, created_at AS createdAt,
                COALESCE(status, 'active') AS status,
                COALESCE(report_count, 0) AS reportCount
         FROM Notebooks WHERE author_id = ? ORDER BY created_at DESC`,
        [id],
      ),
      dbAll(
        `SELECT Swapps.id, Swapps.status, Swapps.date_created AS dateCreated,
                CASE WHEN Swapps.sender_id = ? THEN 'sent' ELSE 'received' END AS direction,
                CASE WHEN Swapps.sender_id = ? THEN receiver.username ELSE sender.username END AS partner
         FROM Swapps
         LEFT JOIN Users sender ON sender.id = Swapps.sender_id
         LEFT JOIN Users receiver ON receiver.id = Swapps.receiver_id
         WHERE Swapps.sender_id = ? OR Swapps.receiver_id = ?
         ORDER BY Swapps.date_created IS NULL, Swapps.date_created DESC, Swapps.id DESC`,
        [id, id, id, id],
      ),
      dbAll(
        `SELECT Reports.report_ID AS id, Reports.reason, Reports.complaint,
                Reports.status, Reports.date_submitted AS dateSubmitted,
                Notebooks.title AS notebookTitle, reporter.username AS reporter
         FROM Reports
         LEFT JOIN Notebooks ON Notebooks.id = Reports.notebook_ID
         LEFT JOIN Users reporter ON reporter.id = Reports.reporter_ID
         WHERE Notebooks.author_id = ? OR Reports.reported_user_ID = ?
         ORDER BY Reports.date_submitted DESC, Reports.report_ID DESC`,
        [id, id],
      ),
      dbAll(
        `SELECT partner.username AS partner, count(DISTINCT s.id) AS exchanges
         FROM Swapps s JOIN Chats c ON c.swapp_id = s.id
         JOIN Users partner ON partner.id = CASE WHEN s.sender_id = ? THEN s.receiver_id ELSE s.sender_id END
         WHERE (s.sender_id = ? OR s.receiver_id = ?) AND s.status = 'accepted'
           AND c.status = 'archived' AND c.archived_at >= datetime('now', '-7 days')
         GROUP BY partner.id HAVING count(DISTINCT s.id) >= 3 ORDER BY exchanges DESC`,
        [id, id, id],
      ),
    ]);

    res.json({
      success: true,
      user: withWarningFlag(user),
      notebooks,
      swapps,
      reports,
      repeatPairs,
    });
  } catch (err) {
    console.error("[ADMIN] user detail failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.patch("/api/admin/users/:id/trust-score", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const trustScore = typeof req.body.trustScore === "number" ? req.body.trustScore : NaN;
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  if (!Number.isInteger(trustScore) || trustScore < 0 || trustScore > 100) {
    return res.status(400).json({
      success: false,
      message: "Trust score must be a whole number from 0 to 100.",
    });
  }

  try {
    const result = await dbRun(`UPDATE Users SET trust_score = ? WHERE id = ?`, [
      trustScore,
      id,
    ]);
    if (!result.changes) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, trustScore });
  } catch (err) {
    console.error("[ADMIN] trust score failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

async function setAccountStatus(req, res, status) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const result = await dbRun(`UPDATE Users SET account_status = ? WHERE id = ?`, [
      status,
      id,
    ]);
    if (!result.changes) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json({ success: true, accountStatus: status });
  } catch (err) {
    console.error(`[ADMIN] set status ${status} failed:`, err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

app.post("/api/admin/users/:id/suspend", requireAdminAuth, (req, res) =>
  setAccountStatus(req, res, "suspended"),
);

app.post("/api/admin/users/:id/reinstate", requireAdminAuth, (req, res) =>
  setAccountStatus(req, res, "active"),
);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status >= 400 && err.status < 500) {
    const message = err.status === 413 ? "Request body is too large." : "Invalid request.";
    return res.status(err.status).json({ success: false, message });
  }
  internalError(res, err);
});

initializeDatabase().then(async (success) => {
  if (success) {
    await runMaintenance();
    setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS).unref();
    app.listen(PORT, HOST, () => {
      console.log(`SWAPPR running on http://${HOST}:${PORT}`);
      console.log(`This is also localhost:3000 if you are running it locally.`);
      if (OTP_DEV_MODE) {
        console.log(
          "[mail] OTP_DEV_MODE is on - verification codes are printed here, not emailed.",
        );
      } else if (createMailTransport()) {
        console.log(`[mail] Sending verification codes as ${mailFromAddress}`);
      } else {
        console.warn(
          "[mail] No email transport configured - registration will fail. " +
            "Set SMTP_* / GMAIL_* vars, or OTP_DEV_MODE=true for local dev.",
        );
      }
    });
  } else {
    console.error("Failed to initialize database. Exiting.");
    process.exit(1);
  }
});
