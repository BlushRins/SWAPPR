const { cleanDepartmentName, cleanDepartments } = require("./cleanDepartments");
const { codePrefix } = require("./subjects");

const GLOBAL_DEPARTMENT = "General Education & Electives";
const GLOBAL_PREFIXES = new Set(["GE", "NSTP", "TPE"]);
const GLOBAL_MISSION_CODES = new Set(["EDM 1", "EDM 2"]);

function subjectKey(row) {
  return JSON.stringify([
    row.course_code.trim().replace(/([0-9])[A-Za-z]+$/, "$1"),
    row.course_description?.trim().toUpperCase(),
  ]);
}

// Preserve the source catalog. Missing values are filled at read/import time
// only when there is evidence from a matching variant or a consistent prefix.
function normalizeCatalog(rows) {
  const bySubject = new Map();
  const byPrefix = new Map();
  const candidates = rows.filter((row) => row.course_code?.trim());
  for (const row of candidates) {
    const departments = cleanDepartments([row.department_reserved]);
    if (!departments.length) continue;
    const key = subjectKey(row);
    const prefix = codePrefix(row.course_code);
    if (!bySubject.has(key)) bySubject.set(key, new Set());
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, { departments: new Set(), count: 0 });
    const evidence = byPrefix.get(prefix);
    evidence.count++;
    for (const department of departments) {
      bySubject.get(key).add(department);
      evidence.departments.add(department);
    }
  }

  return candidates.map((row) => {
    const code = row.course_code.trim();
    const raw = row.department_reserved?.trim();
    const prefix = codePrefix(code);
    const sameSubject = bySubject.get(subjectKey(row));
    const samePrefix = byPrefix.get(prefix);
    let department = cleanDepartmentName(raw);
    if (!department && sameSubject?.size === 1) department = [...sameSubject][0];
    if (!department && (GLOBAL_PREFIXES.has(prefix) || GLOBAL_MISSION_CODES.has(code))) {
      department = GLOBAL_DEPARTMENT;
    }
    if (!department && samePrefix?.count >= 2 && samePrefix.departments.size === 1) {
      department = [...samePrefix.departments][0];
    }
    return { ...row, course_code: code, department, department_reserved: raw || department || null };
  });
}

module.exports = { normalizeCatalog };
