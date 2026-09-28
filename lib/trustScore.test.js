// Run: node lib/trustScore.test.js
const assert = require("assert");
const {
  TRUST_CHANGE,
  TRUST_SCORE_DEFAULT,
  applyTrustChange,
  clampTrustScore,
} = require("./trustScore");

assert.strictEqual(TRUST_SCORE_DEFAULT, 100, "new accounts start at 100%");
assert.deepStrictEqual(
  TRUST_CHANGE,
  { swappCompleted: 2, swappCancelled: -10, warning: -15 },
  "the agreed trust rules stay explicit",
);

// One cancellation, two, then recovery through completed SWAPPs.
assert.strictEqual(applyTrustChange(100, TRUST_CHANGE.swappCancelled), 90);
assert.strictEqual(applyTrustChange(90, TRUST_CHANGE.swappCancelled), 80);
let score = 90;
for (let i = 0; i < 5; i++) score = applyTrustChange(score, TRUST_CHANGE.swappCompleted);
assert.strictEqual(score, 100, "five completed SWAPPs earn back one cancellation");

// A warning.
assert.strictEqual(applyTrustChange(100, TRUST_CHANGE.warning), 85);

// Always between 0 and 100.
assert.strictEqual(applyTrustChange(100, TRUST_CHANGE.swappCompleted), 100, "never above 100");
assert.strictEqual(applyTrustChange(5, TRUST_CHANGE.warning), 0, "never below 0");

// A missing score counts as the default.
assert.strictEqual(applyTrustChange(null, TRUST_CHANGE.swappCancelled), 90);
assert.strictEqual(applyTrustChange(undefined, TRUST_CHANGE.warning), 85);

// Clamping rounds and fixes bad input.
assert.strictEqual(clampTrustScore(150), 100);
assert.strictEqual(clampTrustScore(-3), 0);
assert.strictEqual(clampTrustScore(84.6), 85);
assert.strictEqual(clampTrustScore("abc"), 100);

console.log("trustScore.test.js OK");
