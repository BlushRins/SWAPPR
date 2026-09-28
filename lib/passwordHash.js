const crypto = require("crypto");

const HASH_PREFIX = "scrypt";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;
  if (!storedPassword.startsWith(`${HASH_PREFIX}$`)) {
    return storedPassword === password;
  }

  const [, salt, expectedHash] = storedPassword.split("$");
  if (!salt || !expectedHash) return false;

  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expectedHash, "hex"),
    Buffer.from(actualHash, "hex"),
  );
}

function isHashed(storedPassword) {
  return String(storedPassword || "").startsWith(`${HASH_PREFIX}$`);
}

module.exports = {
  HASH_PREFIX,
  hashPassword,
  isHashed,
  verifyPassword,
};
