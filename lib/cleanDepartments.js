// Cleans dirty department_reserved values scraped (uncleaned) into courses.db:
// splits compound "(N)"-joined rows, maps known abbreviations, Title Cases,
// dedupes case-insensitively, and sorts.

const SMALL_WORDS = new Set([
  "of", "and", "the", "in", "for", "to", "a", "an", "or",
]);

const ABBREVIATIONS = {
  // "DCISM - ..." is the same unit as the full department name below.
  DCISM: "Department of Computer, Information Sciences and Mathematics",
  DHT: "Department of Hospitality and Tourism",
  DTE: "Department of Teacher Education",
  DSAH: "Department of Sociology, Anthropology and History",
  DMSE: "Department of Science and Mathematics Education",
};

function titleCaseDept(value) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

// Normalize ONE dirty department value to its canonical display name.
// "" for empty/missing. Splits on the first "(N)" part only (single-value use
// rarely has compounds, but stay consistent with the batch cleaner).
function cleanDepartmentName(raw) {
  if (!raw) return "";
  const trimmed = String(raw).split(/\s*\(\d+\)\s*/)[0].trim();
  if (!trimmed) return "";
  const abbrevKey = trimmed.split(/[\s-]+/)[0].toUpperCase();
  return ABBREVIATIONS[abbrevKey] || titleCaseDept(trimmed);
}

function cleanDepartments(rawValues) {
  const seen = new Map(); // lowercase key -> display name
  for (const raw of rawValues) {
    if (!raw) continue;
    for (const part of raw.split(/\s*\(\d+\)\s*/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const name = cleanDepartmentName(trimmed);
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

module.exports = { cleanDepartments, cleanDepartmentName };
