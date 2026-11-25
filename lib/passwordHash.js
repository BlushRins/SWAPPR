const { passwordError } = require("../public/js/password-policy");
const scrypt = require("./scrypt");

const HASH_PREFIX = "scrypt";
const PASSWORD_RECORD = scrypt.recordPattern(HASH_PREFIX);
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
