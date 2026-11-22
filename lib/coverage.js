// Run: node lib/coverage.js
// Reports subject counts per program and orphan prefixes (claimed by nobody).
const sqlite3 = require("sqlite3").verbose();
const { courseMap, subjectPrefixesFor } = require("./course_mapper");
const { codePrefix, subjectsForCourse } = require("./subjects");
const { normalizeCatalog } = require("./catalog");

const db = new sqlite3.Database("./sql/courses.db", sqlite3.OPEN_READONLY);

db.all(`SELECT course_code, course_description, department_reserved FROM courses`, [], (err, rows) => {
  if (err) {
    console.error("DB error:", err.message);
    process.exit(1);
  }

  const catalog = normalizeCatalog(rows);
  console.log("=== Subjects matched per program ===");
  for (const program of Object.keys(courseMap)) {
    const prefixes = subjectPrefixesFor(program);
    if (prefixes.length === 0) {
      console.log(`  [no own/shared prefixes] ${program}`);
      continue;
    }
    const n = subjectsForCourse(catalog, program).length;
    console.log(`  ${String(n).padStart(4)}  ${program}  (${prefixes.join(",")})`);
  }

  // Which prefixes in the DB are claimed by at least one program?
  const claimed = new Set();
  for (const program of Object.keys(courseMap)) {
    for (const p of subjectPrefixesFor(program)) claimed.add(p);
  }
  const counts = {};
  for (const r of rows) {
    const p = codePrefix(r.course_code) || "(none)";
    counts[p] = (counts[p] || 0) + 1;
  }
  const orphans = Object.entries(counts)
    .filter(([p]) => !claimed.has(p) && p !== "(none)")
    .sort((a, b) => b[1] - a[1]);

  console.log("\n=== Orphan prefixes (no program claims them) ===");
  console.log(orphans.map(([p, c]) => `${p}:${c}`).join("  "));
  console.log(`\nTotal subjects: ${rows.length}`);
  console.log(`Unassigned departments: ${catalog.filter((row) => !row.department).length}`);
  db.close();
});
