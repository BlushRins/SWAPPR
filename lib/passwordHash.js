const { PASSWORD_MIN_LENGTH } = require("./constants");
const scrypt = require("./scrypt");

const HASH_PREFIX = "scrypt";
const PASSWORD_RECORD = scrypt.recordPattern(HASH_PREFIX);
const COMMON_PASSWORDS = new Set([
  "00000000", "11111111", "12345678", "123456789", "1234567890", "12345678910",
  "87654321", "abcdefgh", "abc12345", "admin123", "changeme", "correcthorsebatterystaple",
  "football", "iloveyou", "letmein123", "monkey123", "pass1234", "password",
  "password1", "password123", "password1234", "p@ssw0rd", "qwerty123",
  "qwertyuiop", "qwerty12345", "welcome1",
]);

function passwordError(password, minimum = PASSWORD_MIN_LENGTH) {
  if (typeof password !== "string" || password.trim().length < minimum) {
    return `Password must be at least ${minimum} characters.`;
  }
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    return "Choose a less common password.";
  }
  return null;
}

function hashPassword(password) {
  return scrypt.hash(password, HASH_PREFIX);
}

function verifyPassword(password, storedPassword) {
  return scrypt.verify(password, storedPassword, PASSWORD_RECORD);
}

function isHashed(storedPassword) {
  return typeof storedPassword === "string" && PASSWORD_RECORD.test(storedPassword);
}

module.exports = { hashPassword, isHashed, passwordError, verifyPassword };
