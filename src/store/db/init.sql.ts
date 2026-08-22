// DDL kept in sync with schema.ts. Run on first DB open.
export const INIT_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'prospect',
  default_rate REAL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  promoted_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  client_slug TEXT NOT NULL REFERENCES clients(slug) ON UPDATE CASCADE,
  project TEXT,
  date TEXT NOT NULL,
  hours REAL NOT NULL,
  rate REAL,
  description TEXT NOT NULL DEFAULT '',
  billed INTEGER NOT NULL DEFAULT 0,
  invoice_number TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS time_entries_client_idx ON time_entries(client_slug);
CREATE INDEX IF NOT EXISTS time_entries_date_idx ON time_entries(date);
CREATE INDEX IF NOT EXISTS time_entries_billed_idx ON time_entries(billed);

CREATE TABLE IF NOT EXISTS active_timer (
  id TEXT PRIMARY KEY,
  client_slug TEXT REFERENCES clients(slug) ON UPDATE CASCADE,
  project TEXT,
  description TEXT,
  rate REAL,
  started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_slug TEXT NOT NULL REFERENCES clients(slug) ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  subtotal REAL NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  currency TEXT NOT NULL,
  notes TEXT,
  sent_at INTEGER,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_client_idx ON invoices(client_slug);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  unit_label TEXT,
  quantity REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  kind TEXT
);
CREATE INDEX IF NOT EXISTS line_items_invoice_idx ON invoice_line_items(invoice_id);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  client_slug TEXT REFERENCES clients(slug) ON UPDATE CASCADE,
  category TEXT,
  description TEXT NOT NULL DEFAULT '',
  amount REAL,
  currency TEXT,
  quantity REAL,
  unit TEXT,
  billable INTEGER NOT NULL DEFAULT 0,
  billed INTEGER NOT NULL DEFAULT 0,
  invoice_number TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_client_idx ON expenses(client_slug);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);
CREATE INDEX IF NOT EXISTS expenses_billed_idx ON expenses(billed);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  client_slug TEXT NOT NULL REFERENCES clients(slug) ON UPDATE CASCADE,
  cadence TEXT NOT NULL,
  day_of_month INTEGER,
  day_of_week INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  auto_send INTEGER NOT NULL DEFAULT 0,
  template TEXT NOT NULL,
  last_generated_at TEXT,
  last_invoice_number TEXT,
  next_issue_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recurring_client_idx ON recurring_invoices(client_slug);
CREATE INDEX IF NOT EXISTS recurring_next_idx ON recurring_invoices(next_issue_at);
CREATE INDEX IF NOT EXISTS recurring_active_idx ON recurring_invoices(active);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  reference TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS payments_date_idx ON payments(date);

CREATE TABLE IF NOT EXISTS crm_notes (
  id TEXT PRIMARY KEY,
  client_slug TEXT NOT NULL REFERENCES clients(slug) ON UPDATE CASCADE,
  date TEXT NOT NULL,
  body TEXT NOT NULL,
  followup_at TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_notes_client_idx ON crm_notes(client_slug);
CREATE INDEX IF NOT EXISTS crm_notes_date_idx ON crm_notes(date);

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL,
  business_email TEXT NOT NULL,
  business_address TEXT,
  business_city TEXT,
  business_phone TEXT,
  business_logo TEXT,
  business_tagline TEXT,
  business_site TEXT,
  accent_color TEXT,
  custom_instructions TEXT,
  default_rate REAL NOT NULL DEFAULT 100,
  tax_rate REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_days INTEGER NOT NULL DEFAULT 14,
  payment_terms TEXT,
  invoice_template TEXT,
  updated_at INTEGER NOT NULL
);
`;

// Idempotent column additions for DBs that pre-date these fields. SQLite
// has no `ADD COLUMN IF NOT EXISTS`, so we probe table_info first. Called
// from openDb() after INIT_SQL runs.
export const COLUMN_ADDITIONS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  { table: "config", column: "business_tagline", ddl: "TEXT" },
  { table: "config", column: "business_site", ddl: "TEXT" },
  { table: "config", column: "accent_color", ddl: "TEXT" },
  { table: "config", column: "custom_instructions", ddl: "TEXT" },
  { table: "invoice_line_items", column: "kind", ddl: "TEXT" },
];
