CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_state TEXT,
  created_withdrawal_ids TEXT,
  hard_delete INTEGER NOT NULL DEFAULT 0,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

ALTER TABLE customers ADD COLUMN awaiting_reply_at TEXT;
