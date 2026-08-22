import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    email: text("email"),
    address: text("address"),
    city: text("city"),
    phone: text("phone"),
    status: text("status").notNull().default("prospect"),
    defaultRate: real("default_rate"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    promotedAt: integer("promoted_at"),
    archivedAt: integer("archived_at"),
  },
  (t) => ({
    statusIdx: index("clients_status_idx").on(t.status),
  }),
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: text("id").primaryKey(),
    clientSlug: text("client_slug")
      .notNull()
      .references(() => clients.slug, { onUpdate: "cascade" }),
    project: text("project"),
    date: text("date").notNull(),
    hours: real("hours").notNull(),
    rate: real("rate"),
    description: text("description").notNull().default(""),
    billed: integer("billed", { mode: "boolean" }).notNull().default(false),
    invoiceNumber: text("invoice_number"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    clientIdx: index("time_entries_client_idx").on(t.clientSlug),
    dateIdx: index("time_entries_date_idx").on(t.date),
    billedIdx: index("time_entries_billed_idx").on(t.billed),
  }),
);

// Single-row table — at most one active timer per machine. The `id` is
// always the literal "active" so a unique constraint enforces the
// singleton invariant. `stopTimer` deletes the row and creates a regular
// `time_entries` row in its place.
export const activeTimer = sqliteTable("active_timer", {
  id: text("id").primaryKey(),
  clientSlug: text("client_slug").references(() => clients.slug, {
    onUpdate: "cascade",
  }),
  project: text("project"),
  description: text("description"),
  rate: real("rate"),
  startedAt: integer("started_at").notNull(),
});

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull().unique(),
    clientSlug: text("client_slug")
      .notNull()
      .references(() => clients.slug, { onUpdate: "cascade" }),
    status: text("status").notNull().default("draft"),
    issuedAt: text("issued_at").notNull(),
    dueAt: text("due_at").notNull(),
    subtotal: real("subtotal").notNull(),
    taxRate: real("tax_rate").notNull().default(0),
    tax: real("tax").notNull().default(0),
    total: real("total").notNull(),
    currency: text("currency").notNull(),
    notes: text("notes"),
    sentAt: integer("sent_at"),
    paidAt: integer("paid_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    clientIdx: index("invoices_client_idx").on(t.clientSlug),
    statusIdx: index("invoices_status_idx").on(t.status),
  }),
);

export const invoiceLineItems = sqliteTable(
  "invoice_line_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    unitLabel: text("unit_label"),
    quantity: real("quantity").notNull(),
    rate: real("rate").notNull(),
    amount: real("amount").notNull(),
    sortOrder: integer("sort_order").notNull(),
    // Drives the per-line dot color + sub-line in the invoice template:
    // "hours" | "weekly" | "flat" | "expense" | "subscription". Optional —
    // when null, renderer infers from unitLabel.
    kind: text("kind"),
  },
  (t) => ({
    invoiceIdx: index("line_items_invoice_idx").on(t.invoiceId),
  }),
);

// General-purpose ledger: expenses with $ amounts (lunch, software,
// reimbursable client costs) AND activity records without $ (mileage,
// meetings, anything you want a dated note for). `amount` and
// `clientSlug` are both nullable so "drove 50 miles" with `quantity=50,
// unit='miles', amount=null` sits next to a $42 lunch with
// `amount=42, currency='USD'`.
export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(),
    clientSlug: text("client_slug").references(() => clients.slug, {
      onUpdate: "cascade",
    }),
    category: text("category"),
    description: text("description").notNull().default(""),
    amount: real("amount"),
    currency: text("currency"),
    quantity: real("quantity"),
    unit: text("unit"),
    billable: integer("billable", { mode: "boolean" }).notNull().default(false),
    billed: integer("billed", { mode: "boolean" }).notNull().default(false),
    invoiceNumber: text("invoice_number"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    clientIdx: index("expenses_client_idx").on(t.clientSlug),
    dateIdx: index("expenses_date_idx").on(t.date),
    billedIdx: index("expenses_billed_idx").on(t.billed),
  }),
);

// Recurring invoice templates. `runRecurring` walks rows where
// `active=1 AND nextIssueAt <= today`, creates a real invoice from the
// stored template, then advances `nextIssueAt` by the cadence. The
// `template` column is JSON: { lineItems[], taxRate?, currency?,
// dueDays?, notes? }. End-of-month dates clamp via addMonthsIso.
export const recurringInvoices = sqliteTable(
  "recurring_invoices",
  {
    id: text("id").primaryKey(),
    clientSlug: text("client_slug")
      .notNull()
      .references(() => clients.slug, { onUpdate: "cascade" }),
    cadence: text("cadence").notNull(),
    dayOfMonth: integer("day_of_month"),
    dayOfWeek: integer("day_of_week"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    autoSend: integer("auto_send", { mode: "boolean" }).notNull().default(false),
    template: text("template").notNull(),
    lastGeneratedAt: text("last_generated_at"),
    lastInvoiceNumber: text("last_invoice_number"),
    nextIssueAt: text("next_issue_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    clientIdx: index("recurring_client_idx").on(t.clientSlug),
    nextIdx: index("recurring_next_idx").on(t.nextIssueAt),
    activeIdx: index("recurring_active_idx").on(t.active),
  }),
);

// Payments recorded against an invoice. An invoice can have many payments
// (deposit, milestone, balance), so partial payment is just "payments that
// sum to less than invoice.total". `amountPaid`/`balanceDue` on InvoiceDetail
// are derived from these rows; when they cover the total, recordPayment flips
// the invoice to status="paid".
export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    invoiceNumber: text("invoice_number").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    amount: real("amount").notNull(),
    method: text("method"), // e.g. "bank transfer", "card", "check", "cash"
    reference: text("reference"), // payer's reference / txn id / check number
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    invoiceIdx: index("payments_invoice_idx").on(t.invoiceId),
    dateIdx: index("payments_date_idx").on(t.date),
  }),
);

export const crmNotes = sqliteTable(
  "crm_notes",
  {
    id: text("id").primaryKey(),
    clientSlug: text("client_slug")
      .notNull()
      .references(() => clients.slug, { onUpdate: "cascade" }),
    date: text("date").notNull(),
    body: text("body").notNull(),
    followupAt: text("followup_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    clientIdx: index("crm_notes_client_idx").on(t.clientSlug),
    dateIdx: index("crm_notes_date_idx").on(t.date),
  }),
);

export const config = sqliteTable("config", {
  id: integer("id").primaryKey(),
  businessName: text("business_name").notNull(),
  businessEmail: text("business_email").notNull(),
  businessAddress: text("business_address"),
  businessCity: text("business_city"),
  businessPhone: text("business_phone"),
  businessLogo: text("business_logo"),
  // Used in the invoice header under the business name.
  businessTagline: text("business_tagline"),
  // Used in the invoice footer (left side, before "Questions? ...").
  businessSite: text("business_site"),
  // CSS color for the --accent custom property in the invoice template
  // (drives PAID stamp, dot tags, and totals highlight). Default in
  // bootstrapConfig if empty.
  accentColor: text("accent_color"),
  // Free-form note from the user about how their invoice should look.
  // Rendered as an HTML comment at the top of the output so a future LLM
  // editing the template can see and preserve prior intent.
  customInstructions: text("custom_instructions"),
  defaultRate: real("default_rate").notNull().default(100),
  taxRate: real("tax_rate").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  dueDays: integer("due_days").notNull().default(14),
  paymentTerms: text("payment_terms"),
  invoiceTemplate: text("invoice_template"),
  updatedAt: integer("updated_at").notNull(),
});
