// Run: node lib/otpPolicy.test.js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  hashOtp,
  secondsUntilResend,
  verifyOtpHash,
} = require("./otpPolicy");

test("OTP uses an asynchronous scrypt hash", async () => {
  const otp = "123456";
  const hash = await hashOtp(otp);
  assert.notEqual(hash, otp, "OTP hash must not store the raw code");
  assert.ok(await verifyOtpHash(otp, hash), "correct OTP verifies against hash");
  assert.ok(!await verifyOtpHash("654321", hash), "wrong OTP fails against hash");
  assert.ok(!await verifyOtpHash(otp, hash.slice(0, -2)), "malformed hash fails verification");
});

const now = 1_000_000;
assert.strictEqual(
  secondsUntilResend(null, now),
  0,
  "missing OTP record has no resend wait",
);
assert.strictEqual(
  secondsUntilResend({ resendAvailableAt: now + OTP_RESEND_COOLDOWN_MS }, now),
  60,
  "active cooldown reports whole seconds remaining",
);
assert.strictEqual(
  secondsUntilResend({ resendAvailableAt: now - 1 }, now),
  0,
  "expired cooldown allows resend",
);

assert.strictEqual(OTP_MAX_ATTEMPTS, 5, "OTP attempt limit stays explicit");

console.log("otpPolicy.test.js OK");
