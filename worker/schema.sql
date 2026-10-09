CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  bags_remaining INTEGER NOT NULL DEFAULT 6,
  waiting_until TEXT,
  notes TEXT,
  removed_at TEXT,
  removal_reason TEXT,
  awaiting_reply INTEGER NOT NULL DEFAULT 0,
  whatsapp_contacted_at TEXT,
  last_whatsapp_at TEXT,
  wait_note TEXT,
  renewal_waiting_until TEXT,
  renewal_wait_note TEXT,
  awaiting_reply_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  taken_at TEXT NOT NULL,
  bags INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_customer ON withdrawals(customer_id, taken_at);

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
