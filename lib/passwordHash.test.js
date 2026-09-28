// Run: node lib/passwordHash.test.js
const assert = require("assert");
const { hashPassword, isHashed, verifyPassword } = require("./passwordHash");

const hash = hashPassword("admin123");

assert.notStrictEqual(hash, "admin123", "password hash must not store plaintext");
assert.ok(isHashed(hash), "hashed password carries the scrypt prefix");
assert.ok(verifyPassword("admin123", hash), "correct password verifies");
assert.ok(!verifyPassword("admin1234", hash), "wrong password fails");
assert.notStrictEqual(
  hashPassword("admin123"),
  hash,
  "each hash uses a fresh salt",
);

assert.ok(!isHashed("pass1234"), "plaintext is not treated as hashed");
assert.ok(
  verifyPassword("pass1234", "pass1234"),
  "legacy plaintext rows still verify until upgraded",
);
assert.ok(!verifyPassword("pass1234", ""), "empty stored password never verifies");
assert.ok(!verifyPassword("x", "scrypt$broken"), "malformed hash never verifies");

console.log("passwordHash.test.js OK");
