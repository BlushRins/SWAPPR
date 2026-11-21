const scrypt = require("./scrypt");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_HASH_PREFIX = "otp-scrypt";
const OTP_RECORD = scrypt.recordPattern(OTP_HASH_PREFIX);

function hashOtp(otp) {
  return scrypt.hash(String(otp), OTP_HASH_PREFIX);
}

function verifyOtpHash(otp, storedHash) {
  return scrypt.verify(String(otp), storedHash, OTP_RECORD);
}

function secondsUntilResend(record, now = Date.now()) {
  if (!record?.resendAvailableAt) return 0;
  return Math.max(0, Math.ceil((record.resendAvailableAt - now) / 1000));
}

module.exports = {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  hashOtp,
  secondsUntilResend,
  verifyOtpHash,
};
