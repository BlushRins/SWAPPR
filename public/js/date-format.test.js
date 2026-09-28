// Run: node public/js/date-format.test.js
// Pin the timezone so the expected local times hold on any machine.
process.env.TZ = "Asia/Manila";

const assert = require("assert");
const { parseDbDate, formatDate, formatDateTime } = require("./date-format");

// SQLite timestamps are UTC: 16:19 UTC is 00:19 the next day in Manila.
assert.strictEqual(
  parseDbDate("2026-09-28 16:19:12").toISOString(),
  "2026-09-28T16:19:12.000Z",
  "SQLite timestamps are read as UTC",
);
assert.strictEqual(formatDate("2026-09-28 16:19:12"), "9/29/2026");
assert.strictEqual(formatDateTime("2026-09-28 16:19:12"), "9/29/2026 12:19 AM");
assert.strictEqual(formatDateTime("2026-09-29 04:05:00"), "9/29/2026 12:05 PM");
assert.strictEqual(formatDateTime("2026-09-29 06:30:00"), "9/29/2026 2:30 PM");

assert.strictEqual(
  parseDbDate("2026-09-28T16:19:12Z").toISOString(),
  "2026-09-28T16:19:12.000Z",
  "ISO strings with a zone are kept as-is",
);

for (const missing of [null, undefined, "", "not a date"]) {
  assert.strictEqual(parseDbDate(missing), null, `${missing} has no date`);
  assert.strictEqual(formatDate(missing), "", `${missing} formats as empty`);
  assert.strictEqual(formatDateTime(missing), "", `${missing} formats as empty`);
}

console.log("date-format.test.js OK");
