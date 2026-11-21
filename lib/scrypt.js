const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

function recordPattern(prefix) {
  return new RegExp(`^${prefix}\\$([a-f0-9]{32})\\$([a-f0-9]{128})$`);
}

async function hash(value, prefix) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(value, salt, 64);
  return `${prefix}$${salt}$${key.toString("hex")}`;
}

async function verify(value, stored, pattern) {
  if (typeof value !== "string" || typeof stored !== "string") return false;
  const match = pattern.exec(stored);
  if (!match) return false;
  const [, salt, key] = match;
  return crypto.timingSafeEqual(await scrypt(value, salt, 64), Buffer.from(key, "hex"));
}

module.exports = { hash, recordPattern, verify };
