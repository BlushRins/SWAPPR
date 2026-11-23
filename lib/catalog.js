const scheduleReservations = require("./catalog-reservations.json");
const { cleanDepartmentName, cleanDepartments } = require("./cleanDepartments");
const { codePrefix } = require("./subjects");

const GLOBAL_DEPARTMENT = "General Education & Electives";
const GLOBAL_PREFIXES = new Set(["GE", "NSTP", "TPE"]);
const GLOBAL_MISSION_CODES = new Set(["EDM 1", "EDM 2"]);

const normalizeText = (value = "") => (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const exactSubjectKey = (code, description) => JSON.stringify([normalizeText(code), normalizeText(description)]);
const officialBySubject = new Map(scheduleReservations.map(({ code, description, units }) => [
  exactSubjectKey(code, description), cleanDepartments(units),
]));

function subjectKey(row) {
  return JSON.stringify([
    row.course_code.trim().replace(/([0-9])[A-Za-z]+$/, "$1"),
    row.course_description?.trim().toUpperCase(),
  ]);
}

// Preserve the source catalog. Missing values are filled at read/import time
// from reviewed schedule reservations, matching variants or consistent prefixes.
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
    const official = !raw && officialBySubject.get(exactSubjectKey(code, row.course_description));
    if (official?.length) {
      return {
        ...row,
        course_code: code,
        department: official.length === 1 ? official[0] : "",
        reservedUnits: [...official],
      };
    }
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
    const reservedUnits = cleanDepartments([raw || department]);
    return { ...row, course_code: code, department, reservedUnits };
  });
}

module.exports = { normalizeCatalog };
