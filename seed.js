const sqlite3 = require("sqlite3").verbose();
const { COURSE_TO_DEPARTMENT } = require("./lib/constants");
const { hashPassword } = require("./lib/passwordHash");

let db;

// Demo administrator. Admins live in their own table and log in through the
// same form as students; the password is hashed before it is stored.
const ADMIN = {
  username: "admin",
  name: "SWAPPR Admin",
  password: "admin123",
};

const USERS = [
  {
    name: "Ana Reyes",
    username: "ana_reyes",
    password: "pass1234",
    course: "Bachelor of Science in Computer Science",
    studentId: "2021100001",
    yearLevel: "3rd Year",
  },
  {
    name: "Marco Santos",
    username: "marco_s",
    password: "pass1234",
    course: "Bachelor of Science in Information Technology",
    studentId: "2021100002",
    yearLevel: "3rd Year",
  },
  {
    name: "Lia Cruz",
    username: "lia_cruz",
    password: "pass1234",
    course: "Bachelor of Science in Electrical Engineering",
    studentId: "2020100003",
    yearLevel: "4th Year",
  },
  {
    name: "Josh Mendoza",
    username: "josh_m",
    password: "pass1234",
    course: "Bachelor of Secondary Education major in Mathematics",
    studentId: "2022100004",
    yearLevel: "2nd Year",
  },
  {
    name: "Camille Tan",
    username: "cami_tan",
    password: "pass1234",
    course: "Bachelor of Science in Psychology",
    studentId: "2021100005",
    yearLevel: "3rd Year",
  },
  {
    name: "Renz Villanueva",
    username: "renz_v",
    password: "pass1234",
    course: "Bachelor of Science in Computer Science",
    studentId: "2023100006",
    yearLevel: "1st Year",
  },
  {
    name: "Sofia dela Cruz",
    username: "sofia_dc",
    password: "pass1234",
    course: "Bachelor of Science in Nursing",
    studentId: "2020100007",
    yearLevel: "4th Year",
  },
];

const NOTEBOOKS = [
  {
    author: "ana_reyes",
    title: "Data Structures & Algorithms",
    description: "Complete notes with examples in Python.",
    course: "Bachelor of Science in Computer Science",
    course_code: "CIS 2101",
    file_url: "https://drive.google.com/example/ana-dsa",
    // Optional counts an author enters in MOD001 (FUNC-007 REQT-002).
    word_count: 9400,
    page_count: 64,
    diagram_count: 22,
  },
  {
    author: "ana_reyes",
    title: "Object-Oriented Programming",
    description: "OOP principles with Java walkthroughs.",
    course: "Bachelor of Science in Computer Science",
    course_code: "CIS 2103",
    file_url: "https://drive.google.com/example/ana-oop",
    word_count: 6200,
    page_count: 41,
    diagram_count: 12,
  },
  {
    author: "marco_s",
    title: "Web Development Fundamentals",
    description: "HTML, CSS, and vanilla JS basics.",
    course: "Bachelor of Science in Information Technology",
    course_code: "CIS 1202",
    file_url: "https://drive.google.com/example/marco-webdev",
    word_count: 3400,
    page_count: 24,
    diagram_count: 9,
  },
  {
    author: "marco_s",
    title: "Database Management Systems",
    description: "SQL queries, normalization, and ER diagrams.",
    course: "Bachelor of Science in Information Technology",
    course_code: "CIS 1204",
    file_url: "https://drive.google.com/example/marco-dbms",
    word_count: 7100,
    page_count: 48,
    diagram_count: 15,
  },
  {
    author: "lia_cruz",
    title: "Circuit Analysis Notes",
    description: "KVL, KCL, Thevenin/Norton theorems.",
    course: "Bachelor of Science in Electrical Engineering",
    course_code: "EE 2101",
    file_url: "https://drive.google.com/example/lia-circuits",
    word_count: 5300,
    page_count: 36,
    diagram_count: 28,
  },
  {
    author: "josh_m",
    title: "Calculus I — Limits & Derivatives",
    description: "Detailed walkthrough of limits and differentiation.",
    course: "Bachelor of Secondary Education major in Mathematics",
    course_code: "MAT 3101",
    file_url: "https://drive.google.com/example/josh-calc1",
    word_count: 8600,
    page_count: 58,
    diagram_count: 19,
  },
  {
    author: "josh_m",
    title: "Plane and Solid Geometry",
    description: "Theorems, proofs, and 3D solid figures.",
    course: "Bachelor of Secondary Education major in Mathematics",
    course_code: "MATHED 1202",
    file_url: "https://drive.google.com/example/josh-linalg",
    word_count: 2800,
    page_count: 18,
    diagram_count: 31,
  },
  {
    author: "cami_tan",
    title: "Abnormal Psychology",
    description: "DSM-5 overview and case studies.",
    course: "Bachelor of Science in Psychology",
    course_code: "PSY 3216",
    file_url: "https://drive.google.com/example/cami-abpsych",
    word_count: 4700,
    page_count: 33,
    diagram_count: 6,
  },
  {
    author: "renz_v",
    title: "Operating Systems",
    description: "Process scheduling and memory management.",
    course: "Bachelor of Science in Computer Science",
    course_code: "CS 3104N",
    file_url: "https://drive.google.com/example/renz-os",
    word_count: 10200,
    page_count: 72,
    diagram_count: 18,
  },
  {
    author: "sofia_dc",
    title: "Fundamentals of Nursing",
    description: "Care planning and patient assessment.",
    course: "Bachelor of Science in Nursing",
    course_code: "NCM 1203",
    file_url: "https://drive.google.com/example/sofia-nursing",
    word_count: 3900,
    page_count: 27,
    diagram_count: 11,
  },
];

const LIKES = [
  { liker: "marco_s", notebookIdx: 0 },
  { liker: "renz_v", notebookIdx: 0 },
  { liker: "josh_m", notebookIdx: 0 },
  { liker: "cami_tan", notebookIdx: 0 },
  { liker: "ana_reyes", notebookIdx: 2 },
  { liker: "lia_cruz", notebookIdx: 2 },
  { liker: "sofia_dc", notebookIdx: 2 },
  { liker: "ana_reyes", notebookIdx: 5 },
  { liker: "marco_s", notebookIdx: 5 },
  { liker: "ana_reyes", notebookIdx: 8 },
  { liker: "marco_s", notebookIdx: 8 },
];

// `requested` is the NOTEBOOKS index of the receiver's notebook being asked
// for; `offered` lists the sender's notebooks offered in exchange. Together
// they become the SWAPP's Transaction_Manifest lines.
const SWAPPS = [
  { from: "ana_reyes", to: "marco_s", status: "accepted", requested: 2, offered: [0] },
  { from: "josh_m", to: "lia_cruz", status: "accepted", requested: 4, offered: [5] },
  { from: "renz_v", to: "ana_reyes", status: "pending", requested: 0, offered: [8] },
  { from: "cami_tan", to: "sofia_dc", status: "pending", requested: 9, offered: [7] },
];

function assertKnownCourses() {
  const courses = new Set([
    ...USERS.map((user) => user.course),
    ...NOTEBOOKS.map((notebook) => notebook.course),
  ]);
  const unknownCourses = [...courses].filter(
    (course) => !COURSE_TO_DEPARTMENT[course],
  );

  if (unknownCourses.length > 0) {
    throw new Error(
      `Seed data contains unknown course(s): ${unknownCourses.join(", ")}`,
    );
  }
}

const run = (sql, params = []) =>
  new Promise((res, rej) =>
    db.run(sql, params, function (err) {
      err ? rej(err) : res(this);
    }),
  );
const get = (sql, params = []) =>
  new Promise((res, rej) =>
    db.get(sql, params, (err, row) => {
      err ? rej(err) : res(row);
    }),
  );

// Bulk-generate notebooks from real courses.db rows, all in one transaction.
// ponytail: single transaction = one fsync; ~100k inserts/sec. PRAGMA
// synchronous=OFF only if this is ever measurably slow (it won't be at 10k-50k).
async function seedBulkNotebooks(count, userIds) {
  const userIdList = Object.values(userIds);
  const coursesDb = new sqlite3.Database("./sql/courses.db");
  const courseRows = await new Promise((res, rej) =>
    coursesDb.all(
      `SELECT course_code, course_description, department_reserved FROM courses WHERE course_code IS NOT NULL`,
      [],
      (err, rows) => (err ? rej(err) : res(rows)),
    ),
  );
  coursesDb.close();

  // courses.db descriptions are ALL CAPS; title-case them so notebooks read real.
  const titleCase = (s) =>
    s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
  const TITLE_SHAPES = [
    (subj) => `${subj}`,
    (subj) => `${subj} — Midterm Reviewer`,
    (subj) => `${subj} Lecture Notes`,
    (subj) => `${subj}: Finals Cheat Sheet`,
    (subj) => `Complete ${subj} Summary`,
    (subj) => `${subj} Problem Sets w/ Solutions`,
  ];
  const DESC_SHAPES = [
    (subj) => `Handwritten ${subj} notes from the whole semester.`,
    (subj) => `Condensed ${subj} reviewer covering the key topics.`,
    (subj) => `Annotated slides and worked examples for ${subj}.`,
    (subj) => `My personal ${subj} study guide — shared for swaps.`,
  ];

  await run("BEGIN");
  const stmt = db.prepare(
    `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url, word_count, page_count, diagram_count) VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < count; i++) {
    const c = courseRows[i % courseRows.length];
    const subj = titleCase(c.course_description);
    stmt.run(
      TITLE_SHAPES[i % TITLE_SHAPES.length](subj),
      DESC_SHAPES[i % DESC_SHAPES.length](subj),
      titleCase(c.department_reserved || ""),
      c.course_code,
      userIdList[i % userIdList.length],
      `https://drive.google.com/example/nb-${i}`,
      // Varied but repeatable counts, so every size label appears.
      2000 + ((i * 1370) % 9000),
      10 + ((i * 7) % 60),
      (i * 3) % 25,
    );
  }
  await new Promise((res, rej) =>
    stmt.finalize((e) => (e ? rej(e) : res())),
  );
  await run("COMMIT");
}

// Creates the demo admin if it doesn't exist yet. Never overwrites an
// existing admin, so it is safe to run against a database with real data.
async function seedAdmin() {
  await run(
    `CREATE TABLE IF NOT EXISTS Admin (admin_ID INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, name TEXT, password TEXT)`,
  );
  const existingStudent = await get(`SELECT id FROM Users WHERE username = ?`, [
    ADMIN.username,
  ]).catch(() => null);
  if (existingStudent) {
    throw new Error(
      `A student already uses the username "${ADMIN.username}", so the admin could never log in.`,
    );
  }

  const inserted = await run(
    `INSERT OR IGNORE INTO Admin (username, name, password) VALUES (?,?,?)`,
    [ADMIN.username, ADMIN.name, hashPassword(ADMIN.password)],
  );
  console.log(
    inserted.changes
      ? `🔑 Admin created → ${ADMIN.username} / ${ADMIN.password}`
      : `🔑 Admin already exists → ${ADMIN.username}`,
  );
}

async function seed() {
  assertKnownCourses();
  console.log("🌱 Starting fresh seed...");
  db = new sqlite3.Database("./sql/swappr.db");

  await run(`DROP TABLE IF EXISTS Users`);
  await run(`DROP TABLE IF EXISTS Notebooks`);
  await run(`DROP TABLE IF EXISTS Likes`);
  await run(`DROP TABLE IF EXISTS Swapps`);
  // Chats point at Swapps/Users ids, so they can't survive a reseed. server.js
  // recreates both tables on its next boot and back-fills chats for the
  // seeded accepted swapps.
  await run(`DROP TABLE IF EXISTS ChatMessages`);
  await run(`DROP TABLE IF EXISTS Chats`);
  // Reports and manifest lines point at Users/Notebooks/Swapps ids too. The
  // Admin table is left alone: it holds operator accounts, not demo content.
  await run(`DROP TABLE IF EXISTS Reports`);
  await run(`DROP TABLE IF EXISTS Transaction_Manifest`);

  await run(
    `CREATE TABLE Users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, username TEXT UNIQUE, password TEXT, bio TEXT, course TEXT, department TEXT, yearLevel TEXT, email TEXT, studentId TEXT, trust_score INTEGER DEFAULT 100, warning_count INTEGER DEFAULT 0, account_status TEXT DEFAULT 'active')`,
  );
  await run(
    `CREATE TABLE Notebooks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, department TEXT, course_code TEXT, author_id INTEGER, file_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'active', report_count INTEGER DEFAULT 0, word_count INTEGER, page_count INTEGER, diagram_count INTEGER)`,
  );
  await run(
    `CREATE TABLE Reports (report_ID INTEGER PRIMARY KEY AUTOINCREMENT, reporter_ID INTEGER, notebook_ID INTEGER, resolved_by INTEGER, reason TEXT, complaint TEXT, status TEXT DEFAULT 'open', date_submitted DATETIME DEFAULT CURRENT_TIMESTAMP, reported_user_ID INTEGER, date_resolved DATETIME)`,
  );
  await run(
    `CREATE TABLE Likes (user_id INTEGER, notebook_id INTEGER, PRIMARY KEY (user_id, notebook_id))`,
  );
  await run(
    `CREATE TABLE Swapps (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, status TEXT, date_created DATETIME DEFAULT CURRENT_TIMESTAMP, cancelled_by INTEGER, cancelled_at DATETIME, cancel_notified INTEGER DEFAULT 0)`,
  );
  await run(
    `CREATE TABLE Transaction_Manifest (Transaction_Manifest_ID INTEGER PRIMARY KEY AUTOINCREMENT, SWAPP_ID INTEGER, notebook_ID INTEGER, is_confirmed INTEGER DEFAULT 0)`,
  );

  const userIds = {};
  for (const u of USERS) {
    const department = COURSE_TO_DEPARTMENT[u.course] || u.course;
    const res = await run(
      `INSERT INTO Users (name, username, password, course, department, yearLevel, studentId) VALUES (?,?,?,?,?,?,?)`,
      [u.name, u.username, u.password, u.course, department, u.yearLevel, u.studentId],
    );
    userIds[u.username] = res.lastID;
  }
  console.log("👤 Users seeded.");

  await seedAdmin();

  const notebookIds = [];
  for (const nb of NOTEBOOKS) {
    const mappedDepartment = COURSE_TO_DEPARTMENT[nb.course] || nb.course;
    const res = await run(
      `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url, word_count, page_count, diagram_count) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        nb.title,
        nb.description,
        mappedDepartment,
        nb.course_code,
        userIds[nb.author],
        nb.file_url,
        nb.word_count,
        nb.page_count,
        nb.diagram_count,
      ],
    );
    notebookIds.push(res.lastID);
  }
  console.log("📓 Notebooks seeded.");

  const bulkCount = Number(process.argv[2]) || 0;
  if (bulkCount > 0) {
    await seedBulkNotebooks(bulkCount, userIds);
    console.log(`📚 ${bulkCount} bulk notebooks seeded.`);
  }

  for (const l of LIKES) {
    await run(
      `INSERT OR IGNORE INTO Likes (user_id, notebook_id) VALUES (?,?)`,
      [userIds[l.liker], notebookIds[l.notebookIdx]],
    );
  }
  console.log("❤️ Likes seeded.");

  // Space the requests an hour apart, oldest first, so the Requests page has
  // a real newest-first order to show.
  for (const [index, s] of SWAPPS.entries()) {
    const hoursAgo = SWAPPS.length - index;
    const swapp = await run(
      `INSERT INTO Swapps (sender_id, receiver_id, status, date_created) VALUES (?,?,?, datetime('now', ?))`,
      [userIds[s.from], userIds[s.to], s.status, `-${hoursAgo} hours`],
    );
    const confirmed = s.status === "accepted" ? 1 : 0;
    for (const notebookIdx of [s.requested, ...s.offered]) {
      await run(
        `INSERT INTO Transaction_Manifest (SWAPP_ID, notebook_ID, is_confirmed) VALUES (?,?,?)`,
        [swapp.lastID, notebookIds[notebookIdx], confirmed],
      );
    }
  }
  console.log("⇄ Swapps seeded.\n✅ All set!");
  db.close();
}

module.exports = {
  ADMIN,
  USERS,
  NOTEBOOKS,
  LIKES,
  SWAPPS,
  assertKnownCourses,
  seed,
};

if (require.main === module) {
  // `node seed.js --admin-only` adds the admin without wiping any data.
  const task = process.argv.includes("--admin-only")
    ? async () => {
        db = new sqlite3.Database("./sql/swappr.db");
        await seedAdmin();
        db.close();
      }
    : seed;

  task().catch((err) => {
    console.error("❌ Error:", err.message);
    if (db) db.close();
  });
}
