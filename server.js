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

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
// Dev-only escape hatch: print OTPs to the server console instead of emailing
// them, so registration works locally without SMTP credentials. Never active
// when NODE_ENV=production, regardless of what .env says.
const OTP_DEV_MODE =
  process.env.OTP_DEV_MODE === "true" && process.env.NODE_ENV !== "production";
const HASH_PREFIX = "scrypt";
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;
  if (!storedPassword.startsWith(`${HASH_PREFIX}$`)) {
    return storedPassword === password;
  }

  const [, salt, expectedHash] = storedPassword.split("$");
  if (!salt || !expectedHash) return false;

  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expectedHash, "hex"),
    Buffer.from(actualHash, "hex"),
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    course: user.course || "",
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

function startSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    user: publicUser(user),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(res, token);
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
    req.currentUser = session.user;
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
  if (!req.currentUser) return res.redirect("/login.html");
  next();
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

app.get("/login.html", (req, res) => {
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
archived_at DATETIME
)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS ChatMessages (
id INTEGER PRIMARY KEY AUTOINCREMENT,
chat_id INTEGER,
sender_id INTEGER,
body TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    const [existingUsername, existingEmail] = await Promise.all([
      dbGet(`SELECT id FROM Users WHERE username = ?`, [username]),
      dbGet(`SELECT id FROM Users WHERE email = ?`, [cleanEmail]),
    ]);

    if (existingUsername) {
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

    startSession(res, {
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

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  db.get(`SELECT * FROM Users WHERE username = ?`, [username], (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Server error" });
    }
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found" });
    }
    if (!verifyPassword(password, user.password)) {
      return res
        .status(401)
        .json({ success: false, message: "Incorrect password" });
    }

    if (!String(user.password || "").startsWith(`${HASH_PREFIX}$`)) {
      const upgradedPassword = hashPassword(password);
      db.run(
        `UPDATE Users SET password = ? WHERE id = ?`,
        [upgradedPassword, user.id],
        () => {},
      );
    }

    startSession(res, user);

    res.json({
      success: true,
      user: publicUser(user),
    });
  });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.currentUser });
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

      db.all(
        `SELECT Notebooks.*, COUNT(Likes.notebook_id) as likes
      FROM Notebooks LEFT JOIN Likes ON Notebooks.id = Likes.notebook_id
      WHERE author_id=? GROUP BY Notebooks.id ORDER BY created_at DESC`,
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
        `SELECT DISTINCT course_code FROM Notebooks WHERE course_code IS NOT NULL AND TRIM(course_code) != ''`,
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

app.post("/api/swapps", requireAuth, (req, res) => {
  const { to } = req.body;
  db.get(
    `SELECT id FROM Users WHERE username=?`,
    [req.currentUser.username],
    (err, sender) => {
      db.get(
        `SELECT id FROM Users WHERE username=?`,
        [to],
        (receiverErr, receiver) => {
          if (!sender || !receiver) return res.json({ success: false });
          db.run(
            `INSERT INTO Swapps (sender_id, receiver_id, status) VALUES (?,?,'pending')`,
            [sender.id, receiver.id],
            () => res.json({ success: true }),
          );
        },
      );
    },
  );
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

app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    const chats = await dbAll(
      `SELECT Chats.*,
CASE WHEN user_a_id = ? THEN ub.username ELSE ua.username END AS otherUsername
FROM Chats
JOIN Users ua ON Chats.user_a_id = ua.id
JOIN Users ub ON Chats.user_b_id = ub.id
WHERE user_a_id = ? OR user_b_id = ?
ORDER BY Chats.id DESC`,
      [req.currentUser.id, req.currentUser.id, req.currentUser.id],
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
