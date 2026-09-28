require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const nodemailer = require("nodemailer");
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
const { hashPassword, isHashed, verifyPassword } = require("./lib/passwordHash");
const {
  REPORT_UNDER_REVIEW_THRESHOLD,
  WARNING_HIGHLIGHT_THRESHOLD,
} = require("./lib/constants");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
// Dev-only escape hatch: print OTPs to the server console instead of emailing
// them, so registration works locally without SMTP credentials. Never active
// when NODE_ENV=production, regardless of what .env says.
const OTP_DEV_MODE =
  process.env.OTP_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
const SESSION_COOKIE = "swappr_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidSchoolEmail(email) {
  return /^\d+@usc\.edu\.ph$/i.test(email);
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

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

function setSessionCookie(res, token, maxAgeMs = SESSION_TTL_MS) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeMs,
    path: "/",
  });
}

// A session belongs to either a student ({ role: "student", user }) or an
// administrator ({ role: "admin", admin }). Students and admins live in
// separate tables, so their ids can collide and must never be mixed up.
function startSession(res, account) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    ...account,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(res, token);
}

function startStudentSession(res, user) {
  startSession(res, { role: "student", user: publicUser(user) });
}

function startAdminSession(res, admin) {
  startSession(res, { role: "admin", admin: publicAdmin(admin) });
}

// Ends every session a user holds, so a suspension takes effect immediately
// rather than when their cookie expires.
function endSessionsForUser(userId) {
  for (const [token, session] of sessions) {
    if (session.role === "student" && session.user?.id === userId) {
      sessions.delete(token);
    }
  }
}

function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function sessionMiddleware(req, res, next) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const session = token && sessions.get(token);

  if (session && session.expiresAt > Date.now()) {
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    if (session.role === "admin") req.currentAdmin = session.admin;
    else req.currentUser = session.user;
    setSessionCookie(res, token);
  } else if (token) {
    sessions.delete(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  next();
}

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

app.use(express.json());
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

const db = new sqlite3.Database("./sql/swappr.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to SQLite database.");
});

const coursesDb = new sqlite3.Database("./sql/courses.db", (err) => {
  if (err) return console.error(err.message);
  console.log("Connected to Courses database.");
});

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

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

async function initializeDatabase() {
  try {
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
    await dbRun(`DELETE FROM EmailOtps WHERE expiresAt <= ?`, [Date.now()]);
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
    await dbRun(`CREATE TABLE IF NOT EXISTS Likes (
user_id INTEGER,
notebook_id INTEGER,
PRIMARY KEY (user_id, notebook_id)
)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS Swapps (
id INTEGER PRIMARY KEY AUTOINCREMENT,
sender_id INTEGER,
receiver_id INTEGER,
status TEXT
)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS Chats (
id INTEGER PRIMARY KEY AUTOINCREMENT,
swapp_id INTEGER,
user_a_id INTEGER,
user_b_id INTEGER,
status TEXT DEFAULT 'active',
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
archived_at DATETIME,
user_a_last_read INTEGER DEFAULT 0,
user_b_last_read INTEGER DEFAULT 0
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
    await dbRun(`CREATE TABLE IF NOT EXISTS ChatMessages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id INTEGER,
sender_id INTEGER,
body TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
    // Moderation (FUNC-015 to FUNC-018): account standing, notebook review
    // state, administrators, and the reports students file.
    await addColumnIfMissing("Users", "trust_score INTEGER DEFAULT 100");
    await addColumnIfMissing("Users", "warning_count INTEGER DEFAULT 0");
    await addColumnIfMissing("Users", "account_status TEXT DEFAULT 'active'");
    await addColumnIfMissing("Notebooks", "status TEXT DEFAULT 'active'");
    await addColumnIfMissing("Notebooks", "report_count INTEGER DEFAULT 0");
    await dbRun(`CREATE TABLE IF NOT EXISTS Admin (
admin_ID INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE,
name TEXT,
password TEXT
)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS Reports (
report_ID INTEGER PRIMARY KEY AUTOINCREMENT,
reporter_ID INTEGER,
notebook_ID INTEGER,
resolved_by INTEGER,
reason TEXT,
complaint TEXT,
status TEXT DEFAULT 'open',
date_submitted DATETIME DEFAULT CURRENT_TIMESTAMP
)`);
    // Backfill: swapps accepted before chats existed get their chat now.
    await dbRun(
      `INSERT INTO Chats (swapp_id, user_a_id, user_b_id)
       SELECT id, sender_id, receiver_id FROM Swapps
       WHERE status = 'accepted'
         AND id NOT IN (SELECT swapp_id FROM Chats WHERE swapp_id IS NOT NULL)`,
    );
    console.log("Database initialized.");
    return true;
  } catch (err) {
    console.error("Database initialization failed:", err.message);
    return false;
  }
}

app.post("/api/send-otp", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidSchoolEmail(email)) {
    return res.json({
      success: false,
      message: "Email must be in the format: numbers@usc.edu.ph",
    });
  }

  const transporter = createMailTransport();
  if (!transporter || !mailFromAddress) {
    return res.status(500).json({
      success: false,
      message: "Email verification is not configured on this server yet.",
    });
  }

  try {
    const existingUser = await dbGet(`SELECT id FROM Users WHERE email = ?`, [
      email,
    ]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "That school email is already registered.",
      });
    }

    const existingOtp = await dbGet(`SELECT * FROM EmailOtps WHERE email = ?`, [
      email,
    ]);
    const resendWaitSeconds = secondsUntilResend(existingOtp);
    if (resendWaitSeconds > 0) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${resendWaitSeconds}s before requesting another code.`,
        retryAfterSeconds: resendWaitSeconds,
      });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const now = Date.now();
    await dbRun(
      `INSERT INTO EmailOtps (email, otp, otpHash, expiresAt, verified, resendAvailableAt, attempts, createdAt, updatedAt)
       VALUES (?, '', ?, ?, 0, ?, 0, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         otp='',
         otpHash=excluded.otpHash,
         expiresAt=excluded.expiresAt,
         verified=0,
         resendAvailableAt=excluded.resendAvailableAt,
         attempts=0,
         updatedAt=excluded.updatedAt`,
      [
        email,
        hashOtp(otp),
        now + OTP_TTL_MS,
        now + OTP_RESEND_COOLDOWN_MS,
        now,
        now,
      ],
    );

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
    } else {
      console.log(`[OTP] Sent to ${email}`);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[OTP] Email send failed:", err.message);
    await dbRun(`DELETE FROM EmailOtps WHERE email = ?`, [email]).catch(
      () => {},
    );
    res.json({
      success: false,
      message: "Failed to send email. Check server email config.",
    });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();

  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Enter the 6-digit verification code.",
    });
  }

  try {
    const record = await dbGet(`SELECT * FROM EmailOtps WHERE email = ?`, [
      email,
    ]);
    if (!record) {
      return res.json({
        success: false,
        message: "No OTP found. Request a new one.",
      });
    }
    if (Date.now() > record.expiresAt) {
      await dbRun(`DELETE FROM EmailOtps WHERE email = ?`, [email]).catch(
        () => {},
      );
      return res.json({
        success: false,
        message: "OTP expired. Request a new one.",
      });
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Too many incorrect attempts. Request a new code.",
      });
    }

    if (!verifyOtpHash(otp, record.otpHash)) {
      const attempts = record.attempts + 1;
      await dbRun(
        `UPDATE EmailOtps SET attempts = ?, updatedAt = ? WHERE email = ?`,
        [attempts, Date.now(), email],
      );

      if (attempts >= OTP_MAX_ATTEMPTS) {
        return res.status(429).json({
          success: false,
          message: "Too many incorrect attempts. Request a new code.",
        });
      }

      const remainingAttempts = OTP_MAX_ATTEMPTS - attempts;
      return res.json({
        success: false,
        message: `Incorrect code. ${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} left.`,
      });
    }

    await dbRun(
      `UPDATE EmailOtps SET verified = 1, attempts = 0, updatedAt = ? WHERE email = ?`,
      [Date.now(), email],
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[OTP] Verification lookup failed:", err.message);
    res.status(500).json({ success: false, message: "Database error." });
  }
});

app.post("/api/register", async (req, res) => {
  console.log("[REGISTER] Request received:", req.body);

  const {
    name,
    username,
    password,
    course,
    department,
    yearLevel,
    studentId,
    email,
  } = req.body;
  const cleanEmail = normalizeEmail(email);

  if (!name || !username || !password || !studentId) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields",
    });
  }

  if (!/^[0-9]+$/.test(studentId)) {
    return res.status(400).json({
      success: false,
      message: "Student ID must contain numbers only.",
    });
  }

  if (!isValidSchoolEmail(cleanEmail)) {
    return res.status(400).json({
      success: false,
      message: "Email must be in the format: numbers@usc.edu.ph",
    });
  }

  try {
    const otpRecord = await dbGet(`SELECT * FROM EmailOtps WHERE email = ?`, [
      cleanEmail,
    ]);
    if (!otpRecord || !otpRecord.verified || Date.now() > otpRecord.expiresAt) {
      return res.status(400).json({
        success: false,
        message: "Email not verified. Complete OTP verification first.",
      });
    }

    // Admin usernames count as taken: login checks students first, so a
    // student with an admin's username would lock that admin out.
    const [existingUsername, existingAdmin, existingEmail] = await Promise.all([
      dbGet(`SELECT id FROM Users WHERE username = ?`, [username]),
      dbGet(`SELECT admin_ID FROM Admin WHERE username = ?`, [username]),
      dbGet(`SELECT id FROM Users WHERE email = ?`, [cleanEmail]),
    ]);

    if (existingUsername || existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Username already taken",
      });
    }

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "That school email is already registered.",
      });
    }

    const finalDept = department || course || "";
    const finalCourse = course || "";
    const finalYear = yearLevel || "";
    const hashedPassword = hashPassword(password);

    const result = await dbRun(
      `INSERT INTO Users (name, username, password, course, department, yearLevel, email, studentId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        username,
        hashedPassword,
        finalCourse,
        finalDept,
        finalYear,
        cleanEmail,
        studentId,
      ],
    );

    await dbRun(`DELETE FROM EmailOtps WHERE email = ?`, [cleanEmail]).catch(
      () => {},
    );

    startStudentSession(res, {
      id: result.lastID,
      username,
      name,
      course: finalCourse,
    });

    res.status(201).json({
      success: true,
      userId: result.lastID,
      user: publicUser({
        id: result.lastID,
        name,
        username,
        course: finalCourse,
      }),
    });
  } catch (err) {
    console.error("[REGISTER] Insert error:", err);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});

// One login form serves both roles: the username is looked up among students
// first, then administrators, and the response says which one matched.
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await dbGet(`SELECT * FROM Users WHERE username = ?`, [
      username,
    ]);
    if (user) {
      if (!verifyPassword(password, user.password)) {
        return res
          .status(401)
          .json({ success: false, message: "Incorrect password" });
      }
      if (user.account_status && user.account_status !== "active") {
        return res.status(403).json({
          success: false,
          message:
            "This account is suspended. Please contact the administrator.",
        });
      }
      if (!isHashed(user.password)) {
        await dbRun(`UPDATE Users SET password = ? WHERE id = ?`, [
          hashPassword(password),
          user.id,
        ]).catch(() => {});
      }

      startStudentSession(res, user);
      return res.json({ success: true, role: "student", user: publicUser(user) });
    }

    const admin = await dbGet(`SELECT * FROM Admin WHERE username = ?`, [
      username,
    ]);
    if (admin) {
      if (!verifyPassword(password, admin.password)) {
        return res
          .status(401)
          .json({ success: false, message: "Incorrect password" });
      }
      if (!isHashed(admin.password)) {
        await dbRun(`UPDATE Admin SET password = ? WHERE admin_ID = ?`, [
          hashPassword(password),
          admin.admin_ID,
        ]).catch(() => {});
      }

      startAdminSession(res, admin);
      return res.json({ success: true, role: "admin", user: publicAdmin(admin) });
    }

    res.status(401).json({ success: false, message: "User not found" });
  } catch (err) {
    console.error("[LOGIN] error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/me", requireAnyAuth, (req, res) => {
  if (req.currentAdmin) {
    return res.json({ success: true, role: "admin", user: req.currentAdmin });
  }
  res.json({ success: true, role: "student", user: req.currentUser });
});

app.post("/api/logout", (req, res) => {
  clearSession(req, res);
  res.json({ success: true });
});

app.get("/api/profile/:username", requireAuth, (req, res) => {
  db.get(
    `SELECT * FROM Users WHERE username=?`,
    [req.params.username],
    (err, user) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Authors still see their own notebooks while under review or after
      // removal; everyone else only sees active ones.
      const isOwner = user.id === req.currentUser.id;
      db.all(
        `SELECT Notebooks.*, COUNT(Likes.notebook_id) as likes
      FROM Notebooks LEFT JOIN Likes ON Notebooks.id = Likes.notebook_id
      WHERE author_id=? ${isOwner ? "" : "AND COALESCE(Notebooks.status, 'active') = 'active'"}
      GROUP BY Notebooks.id ORDER BY created_at DESC`,
        [user.id],
        (notebookErr, notebooks) => {
          if (notebookErr) {
            return res.json({ success: false, message: notebookErr.message });
          }

          db.all(
            `SELECT CASE WHEN sender_id=? THEN r.username ELSE s.username END AS matched_user
            FROM Swapps
            JOIN Users s ON Swapps.sender_id = s.id
            JOIN Users r ON Swapps.receiver_id = r.id
            WHERE (sender_id=? OR receiver_id=?) AND status='accepted'`,
            [user.id, user.id, user.id],
            (matchErr, matchRows) => {
              if (matchErr) {
                return res.json({ success: false, message: matchErr.message });
              }

              const matches = (matchRows || []).map((row) => row.matched_user);
              const profile = {
                id: user.id,
                name: user.name,
                username: user.username,
                bio: user.bio,
                course: user.course || user.department || "",
                department: user.department || user.course || "",
                yearLevel: user.yearLevel || "",
                studentId: user.studentId || "",
                portfolios: notebooks,
                matches,
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

app.patch("/api/profile", requireAuth, (req, res) => {
  const { name, bio, course, department, yearLevel } = req.body;
  const dept = department || course || "";
  const crs = course || department || "";
  db.run(
    `UPDATE Users SET name=?, bio=?, course=?, department=?, yearLevel=? WHERE username=?`,
    [name, bio, crs, dept, yearLevel, req.currentUser.username],
    function onUpdate(err) {
      if (err) return res.json({ success: false, message: err.message });
      req.currentUser.name = name;
      req.currentUser.course = crs;
      res.json({
        success: true,
        user: { name, bio, course: crs, department: dept, yearLevel },
      });
    },
  );
});

app.get("/api/departments", (req, res) => {
  coursesDb.all(
    `SELECT DISTINCT department_reserved FROM courses WHERE department_reserved IS NOT NULL ORDER BY department_reserved`,
    [],
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      const departments = cleanDepartments(
        rows.map((row) => row.department_reserved),
      );
      res.json({ success: true, departments });
    },
  );
});

app.get("/api/subjects", (req, res) => {
  const course = req.query.course || "";
  coursesDb.all(
    `SELECT course_code, course_description, department_reserved FROM courses`,
    [],
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      const subjects =
        course === "ALL"
          ? filterSubjects(rows || [], [])
          : subjectsForCourse(rows || [], course);

      db.all(
        `SELECT DISTINCT course_code FROM Notebooks WHERE course_code IS NOT NULL AND TRIM(course_code) != '' AND COALESCE(status, 'active') = 'active'`,
        [],
        (nbErr, nbRows) => {
          if (nbErr)
            return res.json({ success: false, message: nbErr.message });
          const codesWithNotebooks = (nbRows || []).map((row) =>
            String(row.course_code).trim(),
          );
          res.json({ success: true, subjects, codesWithNotebooks });
        },
      );
    },
  );
});

const NB_SELECT = `
      SELECT 
      Notebooks.id, 
      Notebooks.title, 
      Notebooks.description,
      Notebooks.department,
      Notebooks.course_code,
      Notebooks.file_url,
      Notebooks.created_at,
      Users.username, 
      COUNT(Likes.notebook_id) AS likes
      FROM Notebooks
      LEFT JOIN Users ON Notebooks.author_id = Users.id
      LEFT JOIN Likes ON Notebooks.id = Likes.notebook_id
      WHERE COALESCE(Notebooks.status, 'active') = 'active'
      GROUP BY Notebooks.id
      `;

app.get("/api/portfolios", requireAuth, (req, res) => {
  db.all(`${NB_SELECT} ORDER BY Notebooks.created_at DESC`, [], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ portfolios: rows || [] });
  });
});

app.get("/api/portfolios/top", requireAuth, (req, res) => {
  db.all(`${NB_SELECT} ORDER BY likes DESC LIMIT 5`, [], (err, rows) => {
    if (err) return res.json({ success: false, message: err.message });
    res.json({ portfolios: rows || [] });
  });
});

app.get("/api/portfolios/recent", requireAuth, (req, res) => {
  db.all(
    `${NB_SELECT} ORDER BY Notebooks.created_at DESC LIMIT 5`,
    [],
    (err, rows) => {
      if (err) return res.json({ success: false, message: err.message });
      res.json({ portfolios: rows || [] });
    },
  );
});

app.post("/api/portfolios", requireAuth, (req, res) => {
  console.log("[CREATE NOTEBOOK]", req.body);

  const {
    title,
    description,
    department,
    courseCode,
    fileUrl,
  } = req.body;
  const actualAuthor = req.currentUser.username;

  if (!title || !actualAuthor) {
    return res.status(400).json({
      success: false,
      message: "Title and author are required",
    });
  }

  db.get(
    `SELECT id FROM Users WHERE username=?`,
    [actualAuthor],
    (err, user) => {
      if (err) {
        console.error("DB error:", err);
        return res
          .status(500)
          .json({ success: false, message: "Database error" });
      }

      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      db.run(
        `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url)
       VALUES (?,?,?,?,?,?)`,
        [
          title,
          description || null,
          department || null,
          courseCode || null,
          user.id,
          fileUrl || null,
        ],
        function onInsert(insertErr) {
          if (insertErr) {
            console.error("Insert error:", insertErr);
            return res
              .status(500)
              .json({ success: false, message: insertErr.message });
          }

          res.json({ success: true, id: this.lastID });
        },
      );
    },
  );
});

app.put("/api/portfolios/:id", requireAuth, (req, res) => {
  const { title, description, department, courseCode, fileUrl } = req.body;
  db.run(
    `UPDATE Notebooks SET title=?, description=?, department=?, course_code=?, file_url=?
     WHERE id=? AND author_id=?`,
    [
      title,
      description || null,
      department || null,
      courseCode || null,
      fileUrl || null,
      req.params.id,
      req.currentUser.id,
    ],
    function onUpdate(err) {
      if (err) return res.json({ success: false, message: err.message });
      if (!this.changes) {
        return res
          .status(404)
          .json({ success: false, message: "Notebook not found" });
      }
      res.json({ success: true });
    },
  );
});

app.post("/api/portfolios/delete", requireAuth, (req, res) => {
  const { id, title } = req.body;
  if (id) {
    db.run(
      `DELETE FROM Notebooks WHERE id=? AND author_id=?`,
      [id, req.currentUser.id],
      function onDelete(err) {
        if (err) return res.json({ success: false, message: err.message });
        if (!this.changes) {
          return res
            .status(404)
            .json({ success: false, message: "Notebook not found" });
        }
        res.json({ success: true });
      },
    );
  } else if (title) {
    db.get(
      `SELECT Notebooks.id FROM Notebooks JOIN Users ON Notebooks.author_id=Users.id
WHERE Notebooks.title=? AND Users.username=?`,
      [title, req.currentUser.username],
      (err, row) => {
        if (err || !row) {
          return res.json({ success: false, message: "Notebook not found" });
        }
        db.run(`DELETE FROM Notebooks WHERE id=?`, [row.id], (deleteErr) => {
          if (deleteErr) {
            return res.json({ success: false, message: deleteErr.message });
          }
          res.json({ success: true });
        });
      },
    );
  } else {
    res.json({ success: false, message: "Provide id or title+author" });
  }
});

app.post("/api/portfolios/like", requireAuth, (req, res) => {
  const { notebookId } = req.body;
  db.run(
    `INSERT INTO Likes (user_id, notebook_id) VALUES (?,?)`,
    [req.currentUser.id, notebookId],
    (likeErr) => {
      if (likeErr) {
        return res.json({ success: false, message: "Already liked" });
      }
      res.json({ success: true });
    },
  );
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
app.post("/api/reports", requireAuth, async (req, res) => {
  const notebookId = Number(req.body.notebookId);
  const reason = String(req.body.reason || "");
  const details = String(req.body.details || "").trim();

  if (!Number.isInteger(notebookId) || !REPORT_REASONS.has(reason) || !details) {
    return res.status(400).json({ success: false, message: "Missing input." });
  }
  if (details.length > REPORT_DETAILS_MAX_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Details must be ${REPORT_DETAILS_MAX_LENGTH} characters or fewer.`,
    });
  }

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

    const alreadyReported = await dbGet(
      `SELECT report_ID FROM Reports WHERE reporter_ID = ? AND notebook_ID = ? AND status = 'open'`,
      [req.currentUser.id, notebookId],
    );
    if (alreadyReported) {
      return res.status(409).json({
        success: false,
        message: "You already reported this notebook. An admin will review it.",
      });
    }

    const result = await dbRun(
      `INSERT INTO Reports (reporter_ID, notebook_ID, reason, complaint) VALUES (?,?,?,?)`,
      [req.currentUser.id, notebookId, reason, details],
    );
    await dbRun(
      `UPDATE Notebooks
       SET report_count = COALESCE(report_count, 0) + 1,
           status = CASE
             WHEN COALESCE(report_count, 0) + 1 >= ? THEN 'under_review'
             ELSE COALESCE(status, 'active')
           END
       WHERE id = ?`,
      [REPORT_UNDER_REVIEW_THRESHOLD, notebookId],
    );

    res.status(201).json({ success: true, reportId: result.lastID });
  } catch (err) {
    console.error("[REPORTS] create failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// FUNC-010: the sender always comes from the session, never the request body.
app.post("/api/swapps", requireAuth, async (req, res) => {
  const to = String(req.body.to || "").trim();
  const senderId = req.currentUser.id;

  try {
    const receiver = await dbGet(`SELECT id FROM Users WHERE username = ?`, [to]);
    if (!receiver) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (receiver.id === senderId) {
      return res.status(400).json({
        success: false,
        message: "You can't send a SWAPP request to yourself.",
      });
    }

    // A pending or accepted SWAPP in either direction blocks a new one.
    // A rejected request doesn't, so students can ask again later.
    const existing = await dbGet(
      `SELECT sender_id, status FROM Swapps
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
         AND status IN ('pending', 'accepted')
       ORDER BY status = 'accepted' DESC
       LIMIT 1`,
      [senderId, receiver.id, receiver.id, senderId],
    );
    if (existing) {
      let message = "You already have a pending request for this notebook.";
      if (existing.status === "accepted") {
        message = `You already have an active SWAPP with @${to}.`;
      } else if (existing.sender_id === receiver.id) {
        message = `@${to} already sent you a request. Check your Requests page to respond.`;
      }
      return res.status(409).json({ success: false, message });
    }

    const result = await dbRun(
      `INSERT INTO Swapps (sender_id, receiver_id, status) VALUES (?, ?, 'pending')`,
      [senderId, receiver.id],
    );
    res.status(201).json({ success: true, swappId: result.lastID });
  } catch (err) {
    console.error("[SWAPPS] create failed:", err.message);
    res
      .status(500)
      .json({ success: false, message: "Could not send the request. Please try again." });
  }
});

app.get("/api/swapps/:username", requireAuth, (req, res) => {
  if (req.params.username !== req.currentUser.username) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  db.get(
    `SELECT id FROM Users WHERE username=?`,
    [req.params.username],
    (err, user) => {
      if (!user) return res.json({ swapps: [] });
      db.all(
        `SELECT Swapps.*, s.username AS sender, r.username AS receiver
FROM Swapps
JOIN Users s ON Swapps.sender_id = s.id
JOIN Users r ON Swapps.receiver_id = r.id
WHERE sender_id=? OR receiver_id=?`,
        [user.id, user.id],
        (swappErr, swapps) => {
          if (swappErr) {
            return res.json({ success: false, message: swappErr.message });
          }
          res.json({ swapps: swapps || [] });
        },
      );
    },
  );
});

app.put("/api/swapps/:id/respond", requireAuth, async (req, res) => {
  try {
    const swapp = await dbGet(
      `SELECT * FROM Swapps WHERE id=? AND receiver_id=?`,
      [req.params.id, req.currentUser.id],
    );
    if (!swapp) {
      return res
        .status(404)
        .json({ success: false, message: "SWAPP not found" });
    }

    await dbRun(`UPDATE Swapps SET status=? WHERE id=?`, [
      req.body.status,
      swapp.id,
    ]);

    if (req.body.status === "accepted") {
      const existing = await dbGet(`SELECT id FROM Chats WHERE swapp_id=?`, [
        swapp.id,
      ]);
      if (!existing) {
        await dbRun(
          `INSERT INTO Chats (swapp_id, user_a_id, user_b_id) VALUES (?, ?, ?)`,
          [swapp.id, swapp.sender_id, swapp.receiver_id],
        );
        console.log(`[CHAT] Created chat for swapp ${swapp.id}`);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[CHAT] respond failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
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
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/chats/:id/messages", requireAuth, async (req, res) => {
  try {
    const chat = await findChatForUser(req.params.id, req.currentUser.id);
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
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/chats/:id/messages", requireAuth, async (req, res) => {
  try {
    const chat = await findChatForUser(req.params.id, req.currentUser.id);
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
    const body = String(req.body.body || "").trim();
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
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/chats/:id/archive", requireAuth, async (req, res) => {
  try {
    const chat = await findChatForUser(req.params.id, req.currentUser.id);
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }
    await dbRun(
      `UPDATE Chats SET status='archived', archived_at=CURRENT_TIMESTAMP WHERE id=?`,
      [chat.id],
    );
    console.log(
      `[CHAT] Chat ${chat.id} archived by user ${req.currentUser.id}`,
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[CHAT] archive failed:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin panel (FUNC-016 to FUNC-018) ──────────────────────────────────────
// Report statuses: open → notebook_removed | user_suspended | disregarded.

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function closeOpenReports(notebookId, status, adminId) {
  await dbRun(
    `UPDATE Reports SET status = ?, resolved_by = ?
     WHERE notebook_ID = ? AND status = 'open'`,
    [status, adminId, notebookId],
  );
}

async function removeNotebook(notebook, adminId) {
  // Only the first removal counts against the author.
  if (notebook.status !== "removed") {
    await dbRun(`UPDATE Notebooks SET status = 'removed' WHERE id = ?`, [
      notebook.id,
    ]);
    await dbRun(
      `UPDATE Users SET warning_count = COALESCE(warning_count, 0) + 1 WHERE id = ?`,
      [notebook.author_id],
    );
  }
  await closeOpenReports(notebook.id, "notebook_removed", adminId);
}

function getNotebookForAdmin(id) {
  return dbGet(
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
    const notebook = await getNotebookForAdmin(id);
    if (!notebook) {
      return res.status(404).json({ success: false, message: "Notebook not found" });
    }
    if (notebook.status !== "under_review") {
      return res
        .status(409)
        .json({ success: false, message: "This notebook is not under review." });
    }

    await dbRun(`UPDATE Notebooks SET status = 'active' WHERE id = ?`, [id]);
    await closeOpenReports(id, "disregarded", req.currentAdmin.id);
    res.json({ success: true });
  } catch (err) {
    console.error("[ADMIN] mark safe failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/admin/notebooks/:id/mark-unsafe", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const notebook = await getNotebookForAdmin(id);
    if (!notebook) {
      return res.status(404).json({ success: false, message: "Notebook not found" });
    }
    if (notebook.status !== "under_review") {
      return res
        .status(409)
        .json({ success: false, message: "This notebook is not under review." });
    }

    await removeNotebook(notebook, req.currentAdmin.id);
    res.json({ success: true });
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
              author.username AS reportedUser,
              COALESCE(author.account_status, 'active') AS reportedUserStatus,
              Admin.username AS resolvedBy
       FROM Reports
       LEFT JOIN Users reporter ON reporter.id = Reports.reporter_ID
       LEFT JOIN Notebooks ON Notebooks.id = Reports.notebook_ID
       LEFT JOIN Users author ON author.id = Notebooks.author_id
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
    const report = await dbGet(`SELECT * FROM Reports WHERE report_ID = ?`, [id]);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    if (report.status !== "open") {
      return res
        .status(409)
        .json({ success: false, message: "This report is already resolved." });
    }

    const notebook = report.notebook_ID
      ? await getNotebookForAdmin(report.notebook_ID)
      : null;
    if (action !== "disregard" && !notebook) {
      return res.status(409).json({
        success: false,
        message: "The reported notebook no longer exists.",
      });
    }
    const adminId = req.currentAdmin.id;

    if (action === "remove_notebook") {
      // Closes this report and every other open report on the notebook.
      await removeNotebook(notebook, adminId);
    } else if (action === "suspend_user") {
      await dbRun(`UPDATE Users SET account_status = 'suspended' WHERE id = ?`, [
        notebook.author_id,
      ]);
      endSessionsForUser(notebook.author_id);
      await dbRun(
        `UPDATE Reports SET status = 'user_suspended', resolved_by = ? WHERE report_ID = ?`,
        [adminId, id],
      );
    } else {
      await dbRun(
        `UPDATE Reports SET status = 'disregarded', resolved_by = ? WHERE report_ID = ?`,
        [adminId, id],
      );
      // With no complaints left, a notebook under review goes back to the feed.
      if (notebook && notebook.status === "under_review") {
        const stillOpen = await dbGet(
          `SELECT report_ID FROM Reports WHERE notebook_ID = ? AND status = 'open'`,
          [notebook.id],
        );
        if (!stillOpen) {
          await dbRun(`UPDATE Notebooks SET status = 'active' WHERE id = ?`, [
            notebook.id,
          ]);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[ADMIN] resolve report failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

const ADMIN_USER_COLUMNS = `Users.id, Users.username, Users.name, Users.course,
  COALESCE(Users.trust_score, 100) AS trustScore,
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

    const [notebooks, swapps, reports] = await Promise.all([
      dbAll(
        `SELECT id, title, course_code AS courseCode, created_at AS createdAt,
                COALESCE(status, 'active') AS status,
                COALESCE(report_count, 0) AS reportCount
         FROM Notebooks WHERE author_id = ? ORDER BY created_at DESC`,
        [id],
      ),
      dbAll(
        `SELECT Swapps.id, Swapps.status,
                CASE WHEN Swapps.sender_id = ? THEN 'sent' ELSE 'received' END AS direction,
                CASE WHEN Swapps.sender_id = ? THEN receiver.username ELSE sender.username END AS partner
         FROM Swapps
         LEFT JOIN Users sender ON sender.id = Swapps.sender_id
         LEFT JOIN Users receiver ON receiver.id = Swapps.receiver_id
         WHERE Swapps.sender_id = ? OR Swapps.receiver_id = ?
         ORDER BY Swapps.id DESC`,
        [id, id, id, id],
      ),
      dbAll(
        `SELECT Reports.report_ID AS id, Reports.reason, Reports.complaint,
                Reports.status, Reports.date_submitted AS dateSubmitted,
                Notebooks.title AS notebookTitle, reporter.username AS reporter
         FROM Reports
         JOIN Notebooks ON Notebooks.id = Reports.notebook_ID
         LEFT JOIN Users reporter ON reporter.id = Reports.reporter_ID
         WHERE Notebooks.author_id = ?
         ORDER BY Reports.date_submitted DESC, Reports.report_ID DESC`,
        [id],
      ),
    ]);

    res.json({
      success: true,
      user: withWarningFlag(user),
      notebooks,
      swapps,
      reports,
    });
  } catch (err) {
    console.error("[ADMIN] user detail failed:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.patch("/api/admin/users/:id/trust-score", requireAdminAuth, async (req, res) => {
  const id = parseId(req.params.id);
  const trustScore = Number(req.body.trustScore);
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
    if (status === "suspended") endSessionsForUser(id);
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

initializeDatabase().then((success) => {
  if (success) {
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
