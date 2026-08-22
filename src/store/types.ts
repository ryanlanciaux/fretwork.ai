export type ClientStatus = "prospect" | "lead" | "client" | "archived";

export interface Client {
  id: string;
  slug: string;
  name: string;
  email: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  status: ClientStatus;
  defaultRate: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  promotedAt: number | null;
  archivedAt: number | null;
}

export interface NewClientInput {
  name: string;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  status?: ClientStatus;
  defaultRate?: number | null;
  notes?: string | null;
}

export interface UpdateClientInput {
  name?: string;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  defaultRate?: number | null;
  notes?: string | null;
}

export interface TimeEntry {
  id: string;
  clientSlug: string;
  project: string | null;
  date: string; // YYYY-MM-DD
  hours: number;
  rate: number | null;
  description: string;
  billed: boolean;
  invoiceNumber: string | null;
  createdAt: number;
}

export interface LogTimeInput {
  client: string; // slug or name
  date?: string;
  hours: number;
  rate?: number | null;
  project?: string | null;
  description?: string;
}

export interface UpdateTimeEntryInput {
  client?: string;
  date?: string;
  hours?: number;
  rate?: number | null;
  project?: string | null;
  description?: string;
}

export interface ListTimeFilter {
  client?: string;
  from?: string;
  to?: string;
  unbilled?: boolean;
  project?: string;
}

export interface TimeSummaryRow {
  client: string;
  hours: number;
  unbilledHours: number;
  entries: number;
  revenue: number;
}

export interface ActiveTimer {
  id: string;
  clientSlug: string | null;
  project: string | null;
  description: string | null;
  rate: number | null;
  startedAt: number; // ms epoch
}

export interface StartTimerInput {
  client?: string;
  project?: string | null;
  description?: string | null;
  rate?: number | null;
}

export interface StopTimerInput {
  client?: string;
  project?: string | null;
  description?: string | null;
  rate?: number | null;
}

export interface UpdateActiveTimerInput {
  client?: string | null; // pass null to clear
  project?: string | null;
  description?: string | null;
  rate?: number | null;
}

export interface TimerStopResult {
  timer: ActiveTimer;
  entry: TimeEntry;
  elapsedMs: number;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  clientSlug: string | null;
  category: string | null;
  description: string;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  unit: string | null;
  billable: boolean;
  billed: boolean;
  invoiceNumber: string | null;
  createdAt: number;
}

export interface AddExpenseInput {
  description: string;
  date?: string;
  client?: string | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  quantity?: number | null;
  unit?: string | null;
  billable?: boolean;
}

export interface UpdateExpenseInput {
  description?: string;
  date?: string;
  client?: string | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  quantity?: number | null;
  unit?: string | null;
  billable?: boolean;
}

export interface ListExpensesFilter {
  client?: string;
  from?: string;
  to?: string;
  category?: string;
  unbilled?: boolean;
  billable?: boolean;
  // When true, return only rows with a non-null amount (filters out
  // pure-activity records like mileage logs). When false, return only
  // rows with null amount.
  hasAmount?: boolean;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export type InvoiceLineItemKind =
  | "hours"
  | "weekly"
  | "flat"
  | "expense"
  | "subscription";

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  unitLabel: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder: number;
  // Drives per-line dot color + sub-line in the invoice template. Optional —
  // renderer infers from unitLabel when null.
  kind: InvoiceLineItemKind | null;
}

export interface Invoice {
  id: string;
  number: string;
  clientSlug: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueAt: string;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  sentAt: number | null;
  paidAt: number | null;
  createdAt: number;
  updatedAt: number;
  // Derived from the payments table (not stored on the invoice row).
  // amountPaid is the sum of recorded payments; balanceDue is total - amountPaid
  // (never negative). A partial payment is 0 < amountPaid < total.
  amountPaid: number;
  balanceDue: number;
}

export interface InvoiceDetail extends Invoice {
  lineItems: InvoiceLineItem[];
  payments: Payment[];
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string; // YYYY-MM-DD
  amount: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  createdAt: number;
}

export interface RecordPaymentInput {
  invoice: string; // invoice number or id
  amount: number;
  date?: string; // YYYY-MM-DD, default today
  method?: string | null;
  reference?: string | null;
  note?: string | null;
}

export interface CreateInvoiceInput {
  client: string;
  number?: string;
  issuedAt?: string;
  dueAt?: string;
  taxRate?: number;
  currency?: string;
  notes?: string;
  fromTimeRange?: { from: string; to: string };
  lineItems?: Array<{
    description: string;
    unitLabel?: string;
    quantity: number;
    rate: number;
    kind?: InvoiceLineItemKind;
  }>;
}

export interface UpdateInvoiceInput {
  notes?: string | null;
  dueAt?: string;
  issuedAt?: string;
  taxRate?: number;
  currency?: string;
}

export interface CrmNote {
  id: string;
  clientSlug: string;
  date: string;
  body: string;
  followupAt: string | null;
  createdAt: number;
}

export interface AddCrmNoteInput {
  client: string;
  body: string;
  date?: string;
  followupAt?: string | null;
}

export interface UpdateCrmNoteInput {
  client?: string;
  body?: string;
  date?: string;
  followupAt?: string | null;
}

export interface ListCrmFilter {
  client?: string;
  from?: string;
  to?: string;
}

export interface Followup {
  client: Client;
  lastContactAt: string | null;
  daysSinceContact: number | null;
}

export interface Config {
  businessName: string;
  businessEmail: string;
  businessAddress: string | null;
  businessCity: string | null;
  businessPhone: string | null;
  businessLogo: string | null;
  businessTagline: string | null;
  businessSite: string | null;
  accentColor: string | null;
  customInstructions: string | null;
  defaultRate: number;
  taxRate: number;
  currency: string;
  dueDays: number;
  paymentTerms: string | null;
  invoiceTemplate: string | null;
  updatedAt: number;
}

export interface UpdateConfigInput {
  businessName?: string;
  businessEmail?: string;
  businessAddress?: string | null;
  businessCity?: string | null;
  businessPhone?: string | null;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessSite?: string | null;
  accentColor?: string | null;
  customInstructions?: string | null;
  defaultRate?: number;
  taxRate?: number;
  currency?: string;
  dueDays?: number;
  paymentTerms?: string | null;
  invoiceTemplate?: string | null;
}

export type RecurringCadence = "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringInvoiceTemplate {
  lineItems: Array<{
    description: string;
    unitLabel?: string;
    quantity: number;
    rate: number;
    kind?: InvoiceLineItemKind;
  }>;
  taxRate?: number;
  currency?: string;
  dueDays?: number;
  notes?: string;
}

export interface RecurringInvoice {
  id: string;
  clientSlug: string;
  cadence: RecurringCadence;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  autoSend: boolean;
  template: RecurringInvoiceTemplate;
  lastGeneratedAt: string | null;
  lastInvoiceNumber: string | null;
  nextIssueAt: string;
  createdAt: number;
  updatedAt: number;
}

export interface AddRecurringInvoiceInput {
  client: string;
  cadence: RecurringCadence;
  startDate: string;
  dayOfMonth?: number;
  dayOfWeek?: number;
  endDate?: string | null;
  active?: boolean;
  autoSend?: boolean;
  template: RecurringInvoiceTemplate;
}

export interface UpdateRecurringInvoiceInput {
  cadence?: RecurringCadence;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  startDate?: string;
  endDate?: string | null;
  active?: boolean;
  autoSend?: boolean;
  template?: RecurringInvoiceTemplate;
  nextIssueAt?: string;
}

export interface ListRecurringFilter {
  client?: string;
  active?: boolean;
}

export interface RecurringRunResult {
  generated: Array<{
    recurringId: string;
    invoiceNumber: string;
    clientSlug: string;
    issuedAt: string;
    total: number;
  }>;
  skipped: Array<{ recurringId: string; reason: string }>;
  asOf: string;
}

export interface UpcomingRecurringRow {
  recurring: RecurringInvoice;
  upcoming: string[]; // ISO dates
}

export interface OverdueInvoice extends Invoice {
  daysOverdue: number;
}

export interface ReconcileOverdueResult {
  updated: Invoice[];
  alreadyOverdue: Invoice[];
}

export interface FinancialReport {
  range: { from: string | null; to: string | null };
  totals: { draft: number; sent: number; paid: number; overdue: number; void: number };
  // Sum of remaining balances (total - amountPaid) across sent + overdue
  // invoices — partial payments reduce this.
  outstanding: number;
  // Sum of fully-paid invoice totals (status === "paid").
  paid: number;
  // Cash actually received: sum of all recorded payments in range, including
  // partial payments against still-open invoices.
  collected: number;
  byClient: Array<{ client: string; revenue: number; outstanding: number }>;
}
