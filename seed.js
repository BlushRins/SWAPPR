const sqlite3 = require("sqlite3").verbose();
const { COURSE_TO_DEPARTMENT } = require("./lib/constants");

let db;

const USERS = [
  {
    name: "Ana Reyes",
    username: "ana_reyes",
    password: "pass1234",
    course: "Bachelor of Science in Computer Science",
    studentId: "2021100001",
  },
  {
    name: "Marco Santos",
    username: "marco_s",
    password: "pass1234",
    course: "Bachelor of Science in Information Technology",
    studentId: "2021100002",
  },
  {
    name: "Lia Cruz",
    username: "lia_cruz",
    password: "pass1234",
    course: "Bachelor of Science in Electrical Engineering",
    studentId: "2020100003",
  },
  {
    name: "Josh Mendoza",
    username: "josh_m",
    password: "pass1234",
    course: "Bachelor of Secondary Education major in Mathematics",
    studentId: "2022100004",
  },
  {
    name: "Camille Tan",
    username: "cami_tan",
    password: "pass1234",
    course: "Bachelor of Science in Psychology",
    studentId: "2021100005",
  },
  {
    name: "Renz Villanueva",
    username: "renz_v",
    password: "pass1234",
    course: "Bachelor of Science in Computer Science",
    studentId: "2023100006",
  },
  {
    name: "Sofia dela Cruz",
    username: "sofia_dc",
    password: "pass1234",
    course: "Bachelor of Science in Nursing",
    studentId: "2020100007",
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
  },
  {
    author: "ana_reyes",
    title: "Object-Oriented Programming",
    description: "OOP principles with Java walkthroughs.",
    course: "Bachelor of Science in Computer Science",
    course_code: "CIS 2103",
    file_url: "https://drive.google.com/example/ana-oop",
  },
  {
    author: "marco_s",
    title: "Web Development Fundamentals",
    description: "HTML, CSS, and vanilla JS basics.",
    course: "Bachelor of Science in Information Technology",
    course_code: "CIS 1202",
    file_url: "https://drive.google.com/example/marco-webdev",
  },
  {
    author: "marco_s",
    title: "Database Management Systems",
    description: "SQL queries, normalization, and ER diagrams.",
    course: "Bachelor of Science in Information Technology",
    course_code: "CIS 1204",
    file_url: "https://drive.google.com/example/marco-dbms",
  },
  {
    author: "lia_cruz",
    title: "Circuit Analysis Notes",
    description: "KVL, KCL, Thevenin/Norton theorems.",
    course: "Bachelor of Science in Electrical Engineering",
    course_code: "EE 2101",
    file_url: "https://drive.google.com/example/lia-circuits",
  },
  {
    author: "josh_m",
    title: "Calculus I — Limits & Derivatives",
    description: "Detailed walkthrough of limits and differentiation.",
    course: "Bachelor of Secondary Education major in Mathematics",
    course_code: "MAT 3101",
    file_url: "https://drive.google.com/example/josh-calc1",
  },
  {
    author: "josh_m",
    title: "Plane and Solid Geometry",
    description: "Theorems, proofs, and 3D solid figures.",
    course: "Bachelor of Secondary Education major in Mathematics",
    course_code: "MATHED 1202",
    file_url: "https://drive.google.com/example/josh-linalg",
  },
  {
    author: "cami_tan",
    title: "Abnormal Psychology",
    description: "DSM-5 overview and case studies.",
    course: "Bachelor of Science in Psychology",
    course_code: "PSY 3216",
    file_url: "https://drive.google.com/example/cami-abpsych",
  },
  {
    author: "renz_v",
    title: "Operating Systems",
    description: "Process scheduling and memory management.",
    course: "Bachelor of Science in Computer Science",
    course_code: "CS 3104N",
    file_url: "https://drive.google.com/example/renz-os",
  },
  {
    author: "sofia_dc",
    title: "Fundamentals of Nursing",
    description: "Care planning and patient assessment.",
    course: "Bachelor of Science in Nursing",
    course_code: "NCM 1203",
    file_url: "https://drive.google.com/example/sofia-nursing",
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

const SWAPPS = [
  { from: "ana_reyes", to: "marco_s", status: "accepted" },
  { from: "josh_m", to: "lia_cruz", status: "accepted" },
  { from: "renz_v", to: "ana_reyes", status: "pending" },
  { from: "cami_tan", to: "sofia_dc", status: "pending" },
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
    `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url) VALUES (?,?,?,?,?,?)`,
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
    );
  }
  await new Promise((res, rej) =>
    stmt.finalize((e) => (e ? rej(e) : res())),
  );
  await run("COMMIT");
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

  await run(
    `CREATE TABLE Users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, username TEXT UNIQUE, password TEXT, bio TEXT, course TEXT, department TEXT, yearLevel TEXT)`,
  );
  await run(
    `CREATE TABLE Notebooks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, department TEXT, course_code TEXT, author_id INTEGER, file_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
  );
  await run(
    `CREATE TABLE Likes (user_id INTEGER, notebook_id INTEGER, PRIMARY KEY (user_id, notebook_id))`,
  );
  await run(
    `CREATE TABLE Swapps (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, status TEXT)`,
  );

  const userIds = {};
  for (const u of USERS) {
    const department = COURSE_TO_DEPARTMENT[u.course] || u.course;
    const res = await run(
      `INSERT INTO Users (name, username, password, course, department, yearLevel) VALUES (?,?,?,?,?,?)`,
      [u.name, u.username, u.password, u.course, department, u.studentId],
    );
    userIds[u.username] = res.lastID;
  }
  console.log("👤 Users seeded.");

  const notebookIds = [];
  for (const nb of NOTEBOOKS) {
    const mappedDepartment = COURSE_TO_DEPARTMENT[nb.course] || nb.course;
    const res = await run(
      `INSERT INTO Notebooks (title, description, department, course_code, author_id, file_url) VALUES (?,?,?,?,?,?)`,
      [
        nb.title,
        nb.description,
        mappedDepartment,
        nb.course_code,
        userIds[nb.author],
        nb.file_url,
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

  for (const s of SWAPPS) {
    await run(
      `INSERT INTO Swapps (sender_id, receiver_id, status) VALUES (?,?,?)`,
      [userIds[s.from], userIds[s.to], s.status],
    );
  }
  console.log("⇄ Swapps seeded.\n✅ All set!");
  db.close();
}

module.exports = {
  USERS,
  NOTEBOOKS,
  LIKES,
  SWAPPS,
  assertKnownCourses,
  seed,
};

if (require.main === module) {
  seed().catch((err) => {
    console.error("❌ Error:", err.message);
    if (db) db.close();
  });
}
