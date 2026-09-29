// Run: node lib/contentScreening.test.js
const assert = require("assert");
const {
  FILE_URL_MAX_LENGTH,
  isHttpUrl,
  screenNotebook,
  screeningComplaint,
} = require("./contentScreening");

const clean = {
  title: "Data Structures & Algorithms",
  description: "Complete notes with examples in Python. A classic reviewer.",
  fileUrl: "https://drive.google.com/file/d/abc123/view",
};

// FUNC-008 REQT-004: only http(s) links.
assert.strictEqual(isHttpUrl(clean.fileUrl), true);
assert.strictEqual(isHttpUrl("http://notion.so/page"), true);
assert.strictEqual(isHttpUrl("  https://example.com  "), true, "surrounding spaces are fine");
for (const bad of [
  "",
  null,
  undefined,
  "drive.google.com/file",
  "ftp://example.com/file",
  "javascript:alert(1)",
  "https://",
  "not a url",
  `https://example.com/${"a".repeat(FILE_URL_MAX_LENGTH)}`,
]) {
  assert.strictEqual(isHttpUrl(bad), false, `${String(bad).slice(0, 30)} is refused`);
}

// A clean notebook passes.
assert.deepStrictEqual(screenNotebook(clean), { flagged: false, hits: [] });

// Each field is screened, case-insensitively.
assert.deepStrictEqual(screenNotebook({ ...clean, title: "Free PORN notes" }).hits, [
  { field: "title", term: "porn" },
]);
assert.deepStrictEqual(screenNotebook({ ...clean, description: "gago ka" }).hits, [
  { field: "description", term: "gago" },
]);
assert.deepStrictEqual(
  screenNotebook({ ...clean, fileUrl: "https://example.com/nsfw/notes" }).hits,
  [{ field: "fileUrl", term: "nsfw" }],
);

// Phrases match across spaces or punctuation.
assert.strictEqual(screenNotebook({ ...clean, title: "Midterm exam  leak" }).flagged, true);
assert.strictEqual(screenNotebook({ ...clean, title: "answer-key-leak.pdf" }).flagged, true);

// Whole words only: no substring false positives.
for (const safe of ["Scunthorpe history", "Classic literature", "Passive voice", "Shitake recipes", "Kyst notes"]) {
  assert.strictEqual(screenNotebook({ ...clean, title: safe }).flagged, false, `${safe} is clean`);
}

// Every hit is reported, and the complaint names term and field.
const hits = screenNotebook({ ...clean, title: "porn", description: "keygen inside" }).hits;
assert.strictEqual(hits.length, 2);
assert.strictEqual(
  screeningComplaint(hits),
  'Blocked term "porn" in the title. Blocked term "keygen" in the description.',
);
assert.ok(screeningComplaint(Array(40).fill({ field: "title", term: "porn" })).length <= 500);

console.log("contentScreening.test.js OK");
