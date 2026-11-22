const { REPORT_UNDER_REVIEW_THRESHOLD } = require("./constants");
const { TRUST_CHANGE, TRUST_SCORE_DEFAULT, TRUST_SCORE_MAX } = require("./trustScore");

async function initializeIntegrity({ run, all }) {
  await run("PRAGMA foreign_keys = ON");
  await run("BEGIN IMMEDIATE");
  try {
    const likesForeignKeys = await all("PRAGMA foreign_key_list(Likes)");
    if (!likesForeignKeys.length) {
      await run(`CREATE TABLE Likes_migrating (
        user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,
        notebook_id INTEGER NOT NULL REFERENCES Notebooks(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, notebook_id)
      )`);
      await run(`INSERT INTO Likes_migrating SELECT Likes.user_id, Likes.notebook_id FROM Likes
        JOIN Users ON Users.id = Likes.user_id JOIN Notebooks ON Notebooks.id = Likes.notebook_id`);
      await run("DROP TABLE Likes");
      await run("ALTER TABLE Likes_migrating RENAME TO Likes");
    }

    const reportsForeignKeys = await all("PRAGMA foreign_key_list(Reports)");
    if (!reportsForeignKeys.length) {
      // Preserve open and resolved reports if a notebook or account disappears.
      await run(`CREATE TABLE Reports_migrating (
        report_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_ID INTEGER REFERENCES Users(id) ON DELETE SET NULL,
        notebook_ID INTEGER REFERENCES Notebooks(id) ON DELETE SET NULL,
        resolved_by INTEGER REFERENCES Admin(admin_ID) ON DELETE SET NULL,
        reason TEXT, complaint TEXT, status TEXT DEFAULT 'open', date_submitted DATETIME DEFAULT CURRENT_TIMESTAMP,
        reported_user_ID INTEGER REFERENCES Users(id) ON DELETE SET NULL, date_resolved DATETIME
      )`);
      await run(`INSERT INTO Reports_migrating
        (report_ID, reporter_ID, notebook_ID, resolved_by, reason, complaint, status, date_submitted,
         reported_user_ID, date_resolved)
        SELECT r.report_ID, reporter.id, n.id, a.admin_ID, r.reason, r.complaint, r.status,
               r.date_submitted, target.id, r.date_resolved
        FROM Reports r LEFT JOIN Users reporter ON reporter.id = r.reporter_ID
        LEFT JOIN Users target ON target.id = r.reported_user_ID
        LEFT JOIN Notebooks n ON n.id = r.notebook_ID LEFT JOIN Admin a ON a.admin_ID = r.resolved_by`);
      await run("DROP TABLE Reports");
      await run("ALTER TABLE Reports_migrating RENAME TO Reports");
    }

    const manifestForeignKeys = await all("PRAGMA foreign_key_list(Transaction_Manifest)");
    if (!manifestForeignKeys.length) {
      await run(`CREATE TABLE Transaction_Manifest_migrating (
        Transaction_Manifest_ID INTEGER PRIMARY KEY AUTOINCREMENT,
        SWAPP_ID INTEGER NOT NULL REFERENCES Swapps(id) ON DELETE CASCADE,
        notebook_ID INTEGER NOT NULL REFERENCES Notebooks(id) ON DELETE CASCADE,
        is_confirmed INTEGER DEFAULT 0
      )`);
      await run(`INSERT INTO Transaction_Manifest_migrating
        SELECT m.Transaction_Manifest_ID, m.SWAPP_ID, m.notebook_ID, m.is_confirmed
        FROM Transaction_Manifest m JOIN Swapps s ON s.id = m.SWAPP_ID
        JOIN Notebooks n ON n.id = m.notebook_ID`);
      await run("DROP TABLE Transaction_Manifest");
      await run("ALTER TABLE Transaction_Manifest_migrating RENAME TO Transaction_Manifest");
    }

    await run("CREATE INDEX IF NOT EXISTS idx_manifest_swapp ON Transaction_Manifest(SWAPP_ID)");
    await run("CREATE INDEX IF NOT EXISTS idx_manifest_notebook ON Transaction_Manifest(notebook_ID)");
    await run("CREATE INDEX IF NOT EXISTS idx_likes_notebook ON Likes(notebook_id)");
    await run("CREATE INDEX IF NOT EXISTS idx_reports_notebook_status ON Reports(notebook_ID, status)");
    await run("CREATE INDEX IF NOT EXISTS idx_reports_retention ON Reports(status, date_resolved)");
    await run("CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON ChatMessages(chat_id, sender_id)");

    await run(`CREATE TRIGGER IF NOT EXISTS protect_notebook_in_open_swapp BEFORE DELETE ON Notebooks
      WHEN EXISTS (
        SELECT 1 FROM Transaction_Manifest m JOIN Swapps s ON s.id = m.SWAPP_ID
        WHERE m.notebook_ID = OLD.id AND (s.status = 'pending' OR
          (s.status = 'accepted' AND NOT EXISTS (
            SELECT 1 FROM Chats c WHERE c.swapp_id = s.id AND c.status = 'archived'
          )))
      )
      BEGIN SELECT RAISE(ABORT, 'notebook_in_open_swapp'); END`);

    const reportState = `report_count = (
        SELECT count(*) FROM Reports WHERE notebook_ID = Notebooks.id AND status = 'open'
      ), status = CASE
        WHEN status = 'removed' THEN status
        WHEN EXISTS (SELECT 1 FROM Reports
          WHERE notebook_ID = Notebooks.id AND status = 'open' AND reason = 'auto_screening')
          OR (SELECT count(DISTINCT reporter_ID) FROM Reports WHERE notebook_ID = Notebooks.id AND status = 'open')
            >= ${REPORT_UNDER_REVIEW_THRESHOLD} THEN 'under_review'
        ELSE 'active' END`;
    for (const [event, row, key] of [
      ["INSERT", "NEW", "insert"], ["UPDATE OF status", "NEW", "resolve"], ["DELETE", "OLD", "delete"],
    ]) {
      await run(`CREATE TRIGGER IF NOT EXISTS notebook_reports_${key} AFTER ${event} ON Reports
        WHEN ${row}.notebook_ID IS NOT NULL
        BEGIN UPDATE Notebooks SET ${reportState} WHERE id = ${row}.notebook_ID; END`);
    }
    if (!reportsForeignKeys.length) await run(`UPDATE Notebooks SET ${reportState}`);

    await run(`CREATE TABLE IF NOT EXISTS TrustAwards (
      swapp_id INTEGER PRIMARY KEY REFERENCES Swapps(id) ON DELETE CASCADE,
      member_a INTEGER NOT NULL, member_b INTEGER NOT NULL,
      earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run("CREATE INDEX IF NOT EXISTS idx_trust_awards_pair ON TrustAwards(member_a, member_b, earned_at)");
    await run(`CREATE TRIGGER IF NOT EXISTS credit_swapp_trust AFTER INSERT ON TrustAwards
      BEGIN
        UPDATE Users SET trust_score = min(${TRUST_SCORE_MAX},
          COALESCE(trust_score, ${TRUST_SCORE_DEFAULT}) + ${TRUST_CHANGE.swappCompleted})
        WHERE id IN (NEW.member_a, NEW.member_b);
      END`);
    await run(`CREATE TRIGGER IF NOT EXISTS award_conversation_trust AFTER UPDATE OF status ON Chats
      WHEN OLD.status = 'active' AND NEW.status = 'archived' AND NEW.archived_reason IN ('ended', 'expired')
      BEGIN
        INSERT INTO TrustAwards (swapp_id, member_a, member_b)
        SELECT s.id, min(s.sender_id, s.receiver_id), max(s.sender_id, s.receiver_id)
        FROM Swapps s WHERE s.id = NEW.swapp_id AND s.status = 'accepted'
          AND NEW.created_at <= datetime(CURRENT_TIMESTAMP, '-10 minutes')
          AND EXISTS (SELECT 1 FROM ChatMessages WHERE chat_id = NEW.id AND sender_id = s.sender_id)
          AND EXISTS (SELECT 1 FROM ChatMessages WHERE chat_id = NEW.id AND sender_id = s.receiver_id)
          AND NOT EXISTS (SELECT 1 FROM TrustAwards a WHERE a.member_a = min(s.sender_id, s.receiver_id)
            AND a.member_b = max(s.sender_id, s.receiver_id) AND a.earned_at > datetime(CURRENT_TIMESTAMP, '-7 days'))
        ON CONFLICT(swapp_id) DO NOTHING;
      END`);
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }
}

module.exports = { initializeIntegrity };
