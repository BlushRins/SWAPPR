require("dotenv").config();

const path = require("node:path");
const sqlite3 = require("sqlite3");
const { hashPassword, passwordError } = require("../lib/passwordHash");

const [role, username, ...extra] = process.argv.slice(2);
const credentials = {
  student: "UPDATE Users SET password = ? WHERE username = ?",
  admin: "UPDATE Admin SET password = ? WHERE username = ?",
};

async function resetPassword() {
  if (!Object.hasOwn(credentials, role) || !username || extra.length) {
    throw new Error("Usage: node scripts/reset-password.js student|admin USERNAME");
  }
  const password = process.env.RESET_PASSWORD;
  const error = passwordError(password, role === "admin" ? 16 : undefined);
  if (error) throw new Error(`RESET_PASSWORD: ${error}`);

  const directory = process.env.SWAPPR_SQL_DIR || path.join(__dirname, "..", "sql");
  const hashedPassword = await hashPassword(password);
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(path.join(directory, "swappr.db"), sqlite3.OPEN_READWRITE,
      (err) => err ? reject(err) : resolve(connection));
  });
  try {
    const changes = await new Promise((resolve, reject) => {
      db.run(credentials[role], [hashedPassword, username], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
    if (!changes) throw new Error("Account not found.");
    console.log("Password reset.");
  } finally {
    await new Promise((resolve, reject) => db.close((err) => err ? reject(err) : resolve()));
  }
}

resetPassword().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
