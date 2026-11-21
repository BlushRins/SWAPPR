const assert = require("node:assert/strict");
const { test } = require("node:test");
const { hashPassword, isHashed, passwordError, verifyPassword } = require("./passwordHash");

test("passwords use a fresh salt and reject plaintext or malformed hashes", async () => {
  const password = "a long and unique password";
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.ok(isHashed(hash));
  assert.ok(await verifyPassword(password, hash));
  assert.ok(!await verifyPassword("wrong password", hash));
  assert.notEqual(await hashPassword(password), hash);
  assert.ok(!isHashed(password));
  assert.ok(!await verifyPassword(password, password));
  assert.ok(!await verifyPassword(password, ""));
  assert.ok(!await verifyPassword(password, hash.slice(0, -2)));
});

test("new passwords must meet length and common-password rules", () => {
  assert.match(passwordError("short"), /at least 8/);
  assert.match(passwordError(" Password123 "), /less common/);
  assert.match(passwordError("x".repeat(129)), /at most 128/);
  assert.equal(passwordError(" a long and unique password "), null);
});
