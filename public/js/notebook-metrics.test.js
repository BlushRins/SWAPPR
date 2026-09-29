// Run: node public/js/notebook-metrics.test.js
const assert = require("assert");
const { COUNT_DIGITS, parseCount, readingMinutes, sizeLabel } = require("./notebook-metrics");

// IDX002: below 4,000 Quick Review; 4,000 to 7,999 Standard; 8,000+ Comprehensive.
assert.strictEqual(sizeLabel(3999), "QUICK REVIEW");
assert.strictEqual(sizeLabel(4000), "STANDARD");
assert.strictEqual(sizeLabel(7999), "STANDARD");
assert.strictEqual(sizeLabel(8000), "COMPREHENSIVE");
assert.strictEqual(sizeLabel(0), "QUICK REVIEW");
assert.strictEqual(sizeLabel(null), null, "no word count, no label");
assert.strictEqual(sizeLabel(undefined), null);

// Reading time = ceil(words / 200).
assert.strictEqual(readingMinutes(6200), 31);
assert.strictEqual(readingMinutes(201), 2);
assert.strictEqual(readingMinutes(200), 1);
assert.strictEqual(readingMinutes(null), null);

assert.deepStrictEqual(parseCount("", 5), { ok: true, value: null });
assert.deepStrictEqual(parseCount(null, 5), { ok: true, value: null });
assert.deepStrictEqual(parseCount("  40 ", 5), { ok: true, value: 40 });
assert.deepStrictEqual(parseCount(12, 5), { ok: true, value: 12 });
assert.deepStrictEqual(parseCount("0", 5), { ok: true, value: 0 });
for (const bad of ["abc", "1.5", "-3", "1e3", "123456", "4 0"]) {
  assert.strictEqual(parseCount(bad, 5).ok, false, `${bad} is rejected`);
}
assert.strictEqual(parseCount("1234567", COUNT_DIGITS.wordCount).ok, true);
assert.strictEqual(parseCount("12345678", COUNT_DIGITS.wordCount).ok, false);

console.log("notebook-metrics.test.js OK");
