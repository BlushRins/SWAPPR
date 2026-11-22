/**
 * Pure subject-filtering helpers. No DB access - operates on plain row objects
 * shaped { course_code, course_description }.
 */
const { subjectPrefixesFor } = require("./course_mapper");
const { cleanDepartmentName } = require("./cleanDepartments");

/** Leading letters of a course code, upper-cased. "" for empty/missing. */
function codePrefix(courseCode) {
  const m = String(courseCode || "").trim().match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : "";
}

/**
 * Filter rows to those whose code prefix is in `prefixes` (empty `prefixes`
 * keeps everything), de-duplicate N-suffix variants, and return
 * { code, description } sorted by code.
 */
function filterSubjects(rows, prefixes) {
  const want = new Set(prefixes);
  const keep = (r) => want.size === 0 || want.has(codePrefix(r.course_code));

  // Dedupe key = numeric stem (trailing letters after the number stripped)
  // + description. Two rows collide only when they are the same subject with
  // and without a trailing letter (e.g. "CS 3106" vs "CS 3106N").
  const byKey = new Map();
  for (const r of rows) {
    if (!keep(r)) continue;
    const code = String(r.course_code || "").trim();
    const stem = code.replace(/[A-Za-z]+$/, "").trim(); // drop trailing letters
    const key = stem + "|" + String(r.course_description || "").trim().toUpperCase();
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, r);
      continue;
    }
    const existingHasSuffix = /[A-Za-z]$/.test(String(existing.course_code || "").trim());
    const currentHasSuffix = /[A-Za-z]$/.test(code);
    if (currentHasSuffix && !existingHasSuffix) byKey.set(key, r);
  }

  return [...byKey.values()]
    .map((r) => ({
      code: String(r.course_code || "").trim(),
      description: String(r.course_description || "").trim(),
      department: r.department ?? cleanDepartmentName(r.department_reserved),
      ...(r.reservedUnits?.length ? { reservedUnits: r.reservedUnits } : {}),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function subjectsForCourse(rows, course) {
  const prefixes = subjectPrefixesFor(course);
  if (prefixes.length === 0) return [];
  const undergraduate = rows.filter((row) => {
    const department = row.department ?? cleanDepartmentName(row.department_reserved);
    const prefix = codePrefix(row.course_code);
    if (department.startsWith("Basic Education") || department === "Department of Graduate Business") return false;
    if (prefix === "AA" && department && department !== "Department of Accountancy") return false;
    if (prefix === "SCED" && /^SCED [2-4][0-9]{2}[A-Z]*$/i.test(row.course_code)) return false;
    if (prefix === "EDM" && /^EDM [67][0-9]{3}/i.test(row.course_code)) return false;
    return true;
  });
  return filterSubjects(undergraduate, prefixes);
}

module.exports = {
  codePrefix,
  filterSubjects,
  subjectsForCourse,
  cleanDepartmentName,
};
