const assert = require("node:assert/strict");
const { test } = require("node:test");
const sqlite3 = require("sqlite3");
const { initializeIntegrity } = require("../lib/storeIntegrity");

test("legacy notebook references migrate and moderation and trust rules stay atomic", async (t) => {
  const db = new sqlite3.Database(":memory:");
  t.after(() => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve())));
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (error) => error ? reject(error) : resolve());
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
  const first = async (sql) => (await all(sql))[0];

  for (const sql of [
    "CREATE TABLE Users(id INTEGER PRIMARY KEY, trust_score INTEGER)",
    "CREATE TABLE Admin(admin_ID INTEGER PRIMARY KEY)",
    "CREATE TABLE Notebooks(id INTEGER PRIMARY KEY, status TEXT, report_count INTEGER)",
    "CREATE TABLE Likes(user_id INTEGER, notebook_id INTEGER, PRIMARY KEY (user_id, notebook_id))",
    "CREATE TABLE Swapps(id INTEGER PRIMARY KEY, sender_id INTEGER, receiver_id INTEGER, status TEXT)",
    "CREATE TABLE Chats(id INTEGER PRIMARY KEY, swapp_id INTEGER, created_at TEXT, archived_reason TEXT, status TEXT)",
    "CREATE TABLE ChatMessages(chat_id INTEGER, sender_id INTEGER)",
    `CREATE TABLE Reports(report_ID INTEGER PRIMARY KEY, reporter_ID INTEGER, notebook_ID INTEGER,
      resolved_by INTEGER, reason TEXT, complaint TEXT, status TEXT DEFAULT 'open', date_submitted TEXT,
      reported_user_ID INTEGER, date_resolved TEXT)`,
    `CREATE TABLE Transaction_Manifest(Transaction_Manifest_ID INTEGER PRIMARY KEY, SWAPP_ID INTEGER,
      notebook_ID INTEGER, is_confirmed INTEGER)`,
    "INSERT INTO Users VALUES (1, 50),(2, 50),(3, 50),(4, 50)",
    "INSERT INTO Notebooks VALUES (1,'under_review',1),(2,'active',0)",
    "INSERT INTO Likes VALUES (1,1),(1,999)",
    "INSERT INTO Reports (report_ID,reporter_ID,notebook_ID,status) VALUES (1,1,1,'open'),(2,1,999,'open')",
    "INSERT INTO Swapps VALUES (1,1,2,'pending'),(2,1,2,'accepted'),(3,2,1,'accepted'),(4,1,3,'accepted')",
    "INSERT INTO Transaction_Manifest VALUES (1,1,1,0),(2,1,999,0)",
  ]) await run(sql);

  await initializeIntegrity({ run, all });
  await initializeIntegrity({ run, all });
  assert.deepEqual(await all("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await all("SELECT notebook_id FROM Likes"), [{ notebook_id: 1 }]);
  assert.equal((await first("SELECT notebook_ID FROM Reports WHERE report_ID=2")).notebook_ID, null);
  assert.equal((await first("SELECT status FROM Notebooks WHERE id=1")).status, "active");
  await assert.rejects(run("INSERT INTO Likes VALUES (2,999)"), /FOREIGN KEY/);
  await assert.rejects(run("DELETE FROM Notebooks WHERE id=1"), /notebook_in_open_swapp/);

  await run("INSERT INTO Reports (reporter_ID,notebook_ID) VALUES (1,1),(2,1)");
  assert.equal((await first("SELECT status FROM Notebooks WHERE id=1")).status, "active");
  await run("INSERT INTO Reports (reporter_ID,notebook_ID) VALUES (3,1)");
  assert.equal((await first("SELECT status FROM Notebooks WHERE id=1")).status, "under_review");
  await run("UPDATE Reports SET status='disregarded' WHERE reporter_ID=3");
  assert.equal((await first("SELECT status FROM Notebooks WHERE id=1")).status, "active");
  await run("INSERT INTO Reports (notebook_ID,reason) VALUES (2,'auto_screening')");
  assert.equal((await first("SELECT status FROM Notebooks WHERE id=2")).status, "under_review");

  await run("UPDATE Swapps SET status='cancelled' WHERE id=1");
  await run("DELETE FROM Notebooks WHERE id=1");
  assert.deepEqual(await all("SELECT notebook_id FROM Likes"), []);
  assert.deepEqual(await all("SELECT notebook_ID FROM Transaction_Manifest"), []);
  assert.equal((await first("SELECT notebook_ID FROM Reports WHERE report_ID=1")).notebook_ID, null);

  await run(`INSERT INTO Chats VALUES
    (1,2,datetime('now','-15 minutes'),NULL,'active'),
    (2,3,datetime('now','-15 minutes'),NULL,'active'),
    (3,4,datetime('now','-1 minute'),NULL,'active')`);
  await run("INSERT INTO ChatMessages VALUES (1,1),(1,2),(2,2),(2,1),(3,1),(3,3)");
  await run("UPDATE Chats SET archived_reason='ended', status='archived'");
  assert.deepEqual(await all("SELECT swapp_id FROM TrustAwards ORDER BY swapp_id"), [{ swapp_id: 2 }]);
  assert.deepEqual(await all("SELECT trust_score FROM Users ORDER BY id"),
    [{ trust_score: 52 }, { trust_score: 52 }, { trust_score: 50 }, { trust_score: 50 }]);
});
