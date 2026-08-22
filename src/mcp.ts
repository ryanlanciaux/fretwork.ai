#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  addClient,
  addCrmNote,
  addExpense,
  addRecurringInvoice,
  archiveClient,
  bootstrapConfig,
  cancelTimer,
  deleteClient,
  deleteCrmNote,
  deleteExpense,
  deleteRecurringInvoice,
  deleteTimeEntry,
  exportSnapshot,
  importSnapshot,
  createInvoice,
  deleteInvoice,
  financialReport,
  generateInvoicePdf,
  getActiveTimer,
  listOverdueInvoices,
  reconcileOverdueInvoices,
  getClient,
  getConfig,
  getCrmNote,
  getExpense,
  getInvoice,
  getRecurringInvoice,
  getTimeEntry,
  listExpenses,
  listRecurringInvoices,
  listClients,
  listCrmNotes,
  listFollowups,
  listInvoices,
  listTimeEntries,
  logTime,
  promoteClient,
  recordPayment,
  listPayments,
  deletePayment,
  renderInvoiceHtml,
  runRecurringInvoices,
  setInvoiceStatus,
  startTimer,
  stopTimer,
  summariseTime,
  updateActiveTimer,
  updateClient,
  updateConfig,
  updateCrmNote,
  updateExpense,
  updateInvoice,
  updateRecurringInvoice,
  updateTimeEntry,
  upcomingRecurringInvoices,
  type ClientStatus,
  type InvoiceStatus,
  type RecurringCadence,
  type RecurringInvoiceTemplate,
  type Snapshot,
} from "./store/index.js";
import {
  readBundledTemplate,
  readUserTemplate,
  userTemplatePath,
  writeUserTemplate,
} from "./store/render/index.js";

// Resolve the MCP server version from package.json so it matches what the
// CLI reports. Bundled install: package.json sibling of mcp.js. Dev (tsx
// packages/mcp-server/src/index.ts): one level up.
function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [join(here, "package.json"), join(here, "..", "package.json")]) {
      if (!existsSync(candidate)) continue;
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version) return pkg.version;
    }
  } catch {
    // fall through
  }
  return "unknown";
}

const server = new Server(
  { name: "fretwork-mcp", version: resolveVersion() },
  { capabilities: { tools: {}, resources: {} } },
);

const tools = [
  // ───── clients (local) ─────
  {
    name: "list_clients",
    description: "List clients. Optional status filter (string or array).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          oneOf: [
            { type: "string", enum: ["prospect", "lead", "client", "archived"] },
            { type: "array", items: { type: "string", enum: ["prospect", "lead", "client", "archived"] } },
          ],
        },
      },
      required: [],
    },
  },
  {
    name: "get_client",
    description: "Get a client by slug or id.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "add_client",
    description: "Create a new client. Slug is auto-generated from the name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        phone: { type: "string" },
        defaultRate: { type: "number" },
        notes: { type: "string" },
        status: { type: "string", enum: ["prospect", "lead", "client", "archived"] },
      },
      required: ["name"],
    },
  },
  {
    name: "update_client",
    description: "Update a client by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        phone: { type: "string" },
        defaultRate: { type: "number" },
        notes: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "promote_client",
    description: "Advance status (prospect→lead→client) or set --to explicitly.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        to: { type: "string", enum: ["prospect", "lead", "client", "archived"] },
      },
      required: ["slug"],
    },
  },
  {
    name: "archive_client",
    description: "Archive a client.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "delete_client",
    description:
      "Hard-delete a client. Refuses if anything still references it " +
      "(time entries, expenses, invoices, CRM notes, recurring invoices, " +
      "or the active timer). Use archive_client to soft-delete with history.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  // ───── time ─────
  {
    name: "log_time",
    description: "Log time against a client.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", description: "client slug" },
        hours: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD; default today" },
        rate: { type: "number" },
        project: { type: "string" },
        description: { type: "string" },
      },
      required: ["client", "hours"],
    },
  },
  {
    name: "list_time_entries",
    description: "List time entries with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        unbilled: { type: "boolean" },
        project: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "start_timer",
    description:
      "Start a running timer. Fails if one is already active. Client is optional at start — " +
      "it can be supplied at stop_timer instead. Use get_active_timer to check before starting.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", description: "client slug (optional)" },
        project: { type: "string" },
        description: { type: "string" },
        rate: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "stop_timer",
    description:
      "Stop the active timer and log a time entry for the elapsed duration (rounded to 2 " +
      "decimal hours, floored at 0.01h). Optional fields override values captured at start.",
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: "string",
          description: "Required only if the timer was started without one",
        },
        project: { type: "string" },
        description: { type: "string" },
        rate: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "get_active_timer",
    description:
      "Return the active timer (or null). Includes startedAt so callers can compute elapsed.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "cancel_timer",
    description: "Discard the active timer without logging a time entry.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_active_timer",
    description:
      "Edit the running timer's metadata in-place (client, project, description, rate) " +
      "without restarting it — startedAt is preserved. Pass null on a field to clear it " +
      "(e.g. detach the client). Use this when the user wants to 'attach a note' to a " +
      "timer that's already running, rather than stopping and restarting.",
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: ["string", "null"],
          description: "client slug, or null to detach",
        },
        project: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        rate: { type: ["number", "null"] },
      },
      required: [],
    },
  },
  {
    name: "get_time_entry",
    description: "Get one time entry by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_time_entry",
    description:
      "Edit a time entry by id. Refuses if the entry is on an invoice — delete the " +
      "invoice first (delete_invoice releases its entries back to unbilled).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        client: { type: "string", description: "client slug to move it to" },
        date: { type: "string" },
        hours: { type: "number" },
        rate: { type: ["number", "null"] },
        project: { type: ["string", "null"] },
        description: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_time_entry",
    description:
      "Delete a time entry by id. Refuses if the entry is on an invoice — delete the " +
      "invoice first.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "summarise_time",
    description: "Roll up hours by client across a date range.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: [],
    },
  },
  // ───── expenses / activity records ─────
  {
    name: "add_expense",
    description:
      "Log an expense or activity record. Use for any dated entry that isn't billable time: " +
      "lunch receipts (amount + currency), mileage (quantity + unit, amount optional), or " +
      "pure activity notes ('met with John', no amount). Required: description. Optional: " +
      "client, date (default today), category, amount, currency, quantity, unit, billable.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD; default today" },
        client: { type: "string", description: "client slug; omit if unassigned" },
        category: {
          type: "string",
          description: "e.g. mileage, meal, travel, software, meeting",
        },
        amount: { type: "number", description: "Dollar amount; omit for activity-only records" },
        currency: { type: "string" },
        quantity: { type: "number", description: "e.g. 50 (miles)" },
        unit: { type: "string", description: "e.g. miles, meals" },
        billable: { type: "boolean", description: "Flag for invoice inclusion" },
      },
      required: ["description"],
    },
  },
  {
    name: "list_expenses",
    description: "List expenses + activity records with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        category: { type: "string" },
        unbilled: { type: "boolean" },
        billable: { type: "boolean" },
        hasAmount: {
          type: "boolean",
          description:
            "true = only rows with a $ amount; false = only rows without; omit = all",
        },
      },
      required: [],
    },
  },
  {
    name: "get_expense",
    description: "Get one expense by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_expense",
    description:
      "Patch fields on an expense. Pass `clearAmount: true` to drop a dollar amount (turn the " +
      "row into a pure activity record). Pass an empty string to clear client/category/etc.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        date: { type: "string" },
        client: { type: "string" },
        category: { type: "string" },
        amount: { type: "number" },
        clearAmount: { type: "boolean" },
        currency: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string" },
        billable: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_expense",
    description: "Delete an expense by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  // ───── invoices ─────
  {
    name: "list_invoices",
    description: "List invoices with optional client/status filter.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        status: {
          oneOf: [
            { type: "string", enum: ["draft", "sent", "paid", "overdue", "void"] },
            { type: "array", items: { type: "string", enum: ["draft", "sent", "paid", "overdue", "void"] } },
          ],
        },
      },
      required: [],
    },
  },
  {
    name: "get_invoice",
    description: "Get one invoice by number, including line items.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
  },
  {
    name: "create_invoice",
    description:
      "Create an invoice. Provide fromTimeRange (auto-bills matching unbilled time) and/or lineItems. " +
      "Issued/due/currency/taxRate fall back to config defaults.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        number: { type: "string" },
        issuedAt: { type: "string" },
        dueAt: { type: "string" },
        taxRate: { type: "number" },
        currency: { type: "string" },
        notes: { type: "string" },
        fromTimeRange: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } },
          required: ["from", "to"],
        },
        lineItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              unitLabel: { type: "string" },
              quantity: { type: "number" },
              rate: { type: "number" },
            },
            required: ["description", "quantity", "rate"],
          },
        },
      },
      required: ["client"],
    },
  },
  {
    name: "update_invoice",
    description: "Update non-line-item fields on an invoice (notes, due/issued, taxRate, currency).",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "string" },
        notes: { type: "string" },
        dueAt: { type: "string" },
        issuedAt: { type: "string" },
        taxRate: { type: "number" },
        currency: { type: "string" },
      },
      required: ["number"],
    },
  },
  {
    name: "set_invoice_status",
    description: "Change invoice status (draft|sent|paid|overdue|void). Sets sentAt/paidAt automatically.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "string" },
        status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "void"] },
      },
      required: ["number", "status"],
    },
  },
  {
    name: "record_payment",
    description:
      "Record a payment received against an invoice. Supports partial payments — an " +
      "invoice can have many payments (deposit, milestone, balance). When recorded " +
      "payments cover the invoice total it is automatically marked paid; otherwise it " +
      "stays open with a reduced balance. Returns the payment plus amountPaid/balanceDue.",
    inputSchema: {
      type: "object",
      properties: {
        invoice: { type: "string", description: "Invoice number or id" },
        amount: { type: "number", description: "Payment amount (must be positive)" },
        date: { type: "string", description: "YYYY-MM-DD; defaults to today" },
        method: { type: "string", description: "e.g. bank transfer, card, check, cash" },
        reference: { type: "string", description: "Payer reference / txn id / check number" },
        note: { type: "string" },
      },
      required: ["invoice", "amount"],
    },
  },
  {
    name: "list_payments",
    description:
      "List recorded payments. Pass `invoice` (number or id) to list payments for one " +
      "invoice; omit it to list all payments across invoices, newest first.",
    inputSchema: {
      type: "object",
      properties: { invoice: { type: "string" } },
      required: [],
    },
  },
  {
    name: "delete_payment",
    description:
      "Delete a recorded payment by its id. If removing it drops a paid invoice below " +
      "its total, the invoice is reopened to status 'sent'. Returns the updated balance.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Payment id" } },
      required: ["id"],
    },
  },
  {
    name: "list_overdue_invoices",
    description:
      "List invoices past dueAt and not yet paid (status sent or overdue). Each row " +
      "includes daysOverdue. Sorted by daysOverdue desc. Optional asOf overrides today.",
    inputSchema: {
      type: "object",
      properties: { asOf: { type: "string" } },
      required: [],
    },
  },
  {
    name: "reconcile_overdue_invoices",
    description:
      "Promote any 'sent' invoice that is past dueAt to status 'overdue'. Returns the " +
      "updated set and the set already in overdue. Safe to call repeatedly.",
    inputSchema: {
      type: "object",
      properties: { asOf: { type: "string" } },
      required: [],
    },
  },
  {
    name: "delete_invoice",
    description: "Delete an invoice; releases its time entries back to unbilled.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
  },
  {
    name: "render_invoice_html",
    description: "Return the HTML representation of an invoice.",
    inputSchema: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
  },
  {
    name: "generate_invoice_pdf",
    description: "Render an invoice to PDF via Puppeteer; returns the absolute output path.",
    inputSchema: {
      type: "object",
      properties: {
        number: { type: "string" },
        output: { type: "string", description: "Absolute or cwd-relative *.pdf path. Default: ~/.fretwork/invoices/<number>/invoice.pdf" },
        format: { type: "string", enum: ["Letter", "A4", "Legal"] },
        overwrite: { type: "boolean", description: "Replace an existing file at `output` (confirm with the user first)." },
      },
      required: ["number"],
    },
  },
  // ───── recurring invoices ─────
  {
    name: "add_recurring_invoice",
    description:
      "Create a recurring invoice template (retainer, monthly subscription, etc.). " +
      "Required: client, cadence (weekly|monthly|quarterly|yearly), startDate, template " +
      "with lineItems. Day-of-month for monthly/quarterly/yearly defaults to startDate's " +
      "day; day-of-week for weekly defaults to startDate's weekday. End-of-month dates " +
      "clamp safely (31 -> 28/29 in Feb).",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        cadence: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
        startDate: { type: "string" },
        endDate: { type: "string" },
        dayOfMonth: { type: "number" },
        dayOfWeek: { type: "number", description: "0=Sunday..6=Saturday" },
        active: { type: "boolean" },
        autoSend: {
          type: "boolean",
          description: "If true, generated invoices are marked 'sent' immediately",
        },
        template: {
          type: "object",
          properties: {
            lineItems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  description: { type: "string" },
                  unitLabel: { type: "string" },
                  quantity: { type: "number" },
                  rate: { type: "number" },
                  kind: { type: "string" },
                },
                required: ["description", "quantity", "rate"],
              },
            },
            taxRate: { type: "number" },
            currency: { type: "string" },
            dueDays: { type: "number" },
            notes: { type: "string" },
          },
          required: ["lineItems"],
        },
      },
      required: ["client", "cadence", "startDate", "template"],
    },
  },
  {
    name: "list_recurring_invoices",
    description: "List recurring invoice templates with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        active: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "get_recurring_invoice",
    description: "Get one recurring invoice template by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_recurring_invoice",
    description: "Update a recurring invoice template (pause/resume, edit cadence, replace template).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        cadence: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
        startDate: { type: "string" },
        endDate: { type: "string" },
        dayOfMonth: { type: "number" },
        dayOfWeek: { type: "number" },
        active: { type: "boolean" },
        autoSend: { type: "boolean" },
        nextIssueAt: { type: "string" },
        template: {
          type: "object",
          properties: {
            lineItems: { type: "array" },
            taxRate: { type: "number" },
            currency: { type: "string" },
            dueDays: { type: "number" },
            notes: { type: "string" },
          },
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_recurring_invoice",
    description: "Delete a recurring invoice template.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "run_recurring_invoices",
    description:
      "Materialize any recurring invoices whose nextIssueAt is at or before asOf (default " +
      "today). Idempotent. One cycle per template per call; re-run for catch-up. Returns " +
      "the generated invoices + any skipped (with reason).",
    inputSchema: {
      type: "object",
      properties: { asOf: { type: "string" } },
      required: [],
    },
  },
  {
    name: "upcoming_recurring_invoices",
    description: "Read-only projection of the next N issuances for each active recurring.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Default 3" },
        client: { type: "string" },
      },
      required: [],
    },
  },
  // ───── crm ─────
  {
    name: "add_crm_note",
    description: "Add a CRM note for a client.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        body: { type: "string" },
        date: { type: "string" },
        followupAt: { type: "string" },
      },
      required: ["client", "body"],
    },
  },
  {
    name: "list_crm_notes",
    description: "List CRM notes with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "get_crm_note",
    description: "Get one CRM note by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "update_crm_note",
    description: "Edit a CRM note's body / date / followup / client.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        client: { type: "string" },
        body: { type: "string" },
        date: { type: "string" },
        followupAt: { type: ["string", "null"] },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_crm_note",
    description: "Delete a CRM note by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "list_followups",
    description: "List clients due for follow-up. Default staleness: 14 days.",
    inputSchema: {
      type: "object",
      properties: {
        stalenessDays: { type: "number" },
        dueBy: { type: "string" },
      },
      required: [],
    },
  },
  // ───── config / report ─────
  {
    name: "get_config",
    description: "Return current local config (business info, defaults).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_config",
    description: "Patch one or more config fields.",
    inputSchema: {
      type: "object",
      properties: {
        businessName: { type: "string" },
        businessEmail: { type: "string" },
        businessAddress: { type: "string" },
        businessCity: { type: "string" },
        businessPhone: { type: "string" },
        businessLogo: { type: "string" },
        defaultRate: { type: "number" },
        taxRate: { type: "number" },
        currency: { type: "string" },
        dueDays: { type: "number" },
        paymentTerms: { type: "string" },
        invoiceTemplate: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "init_config",
    description: "First-run config bootstrap (requires businessName + businessEmail).",
    inputSchema: {
      type: "object",
      properties: {
        businessName: { type: "string" },
        businessEmail: { type: "string" },
        defaultRate: { type: "number" },
        taxRate: { type: "number" },
        currency: { type: "string" },
        dueDays: { type: "number" },
        paymentTerms: { type: "string" },
      },
      required: ["businessName", "businessEmail"],
    },
  },
  {
    name: "export_data",
    description:
      "Return a versioned JSON snapshot of every local table (clients, time entries, " +
      "expenses, invoices, line items, recurring templates, CRM notes, config). The MCP " +
      "host can save this for backup/migration. Excludes ephemeral active_timer state.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "import_data",
    description:
      "Restore from a snapshot produced by export_data. `mode: 'merge'` (default) inserts " +
      "only rows whose primary key isn't already present. `mode: 'replace'` wipes every " +
      "table first — destructive, and requires `confirm: \"replace\"` (ask the user first). " +
      "Returns counts inserted/skipped per table.",
    inputSchema: {
      type: "object",
      properties: {
        snapshot: { type: "object", description: "The snapshot payload" },
        mode: { type: "string", enum: ["merge", "replace"] },
        confirm: {
          type: "string",
          description: "Must be the literal string \"replace\" when mode is \"replace\".",
        },
      },
      required: ["snapshot"],
    },
  },
  {
    name: "financial_report",
    description: "Totals by status + revenue/outstanding by client.",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: [],
    },
  },
  // ───── invoice template (local) ─────
  {
    name: "print_invoice_template",
    description:
      "Return the current invoice template HTML (user copy at ~/.fretwork/templates/invoice.html, " +
      "or bundled default if no user copy yet). Use BEFORE write_invoice_template to read the " +
      "current state.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "write_invoice_template",
    description:
      "Replace the user invoice template at ~/.fretwork/templates/invoice.html with the supplied " +
      "HTML. Validates with Mustache.parse + a smoke render before writing; on validation failure " +
      "the on-disk template is unchanged and the tool returns an error message.",
    inputSchema: {
      type: "object",
      properties: { html: { type: "string", description: "Full invoice template HTML" } },
      required: ["html"],
    },
  },
  {
    name: "reset_invoice_template",
    description:
      "Restore the user invoice template at ~/.fretwork/templates/invoice.html to the bundled " +
      "default. Use when the user asks to 'go back to the default invoice' or after a broken edit.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

function resultJson(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function resultText(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;

  try {
    // ───── clients ─────
    if (name === "list_clients") {
      return resultJson(listClients({ status: args.status as ClientStatus | ClientStatus[] | undefined }));
    }
    if (name === "get_client") {
      const c = getClient(String(args.slug));
      return c ? resultJson(c) : resultText(`not found: ${args.slug}`, true);
    }
    if (name === "add_client") {
      return resultJson(
        addClient({
          name: String(args.name),
          email: (args.email as string | undefined) ?? null,
          address: (args.address as string | undefined) ?? null,
          city: (args.city as string | undefined) ?? null,
          phone: (args.phone as string | undefined) ?? null,
          defaultRate: (args.defaultRate as number | undefined) ?? null,
          notes: (args.notes as string | undefined) ?? null,
          status: args.status as ClientStatus | undefined,
        }),
      );
    }
    if (name === "update_client") {
      return resultJson(
        updateClient(String(args.slug), {
          name: args.name as string | undefined,
          email: args.email as string | undefined,
          address: args.address as string | undefined,
          city: args.city as string | undefined,
          phone: args.phone as string | undefined,
          defaultRate: args.defaultRate as number | undefined,
          notes: args.notes as string | undefined,
        }),
      );
    }
    if (name === "promote_client") {
      return resultJson(promoteClient(String(args.slug), args.to as ClientStatus | undefined));
    }
    if (name === "archive_client") {
      return resultJson(archiveClient(String(args.slug)));
    }
    if (name === "delete_client") {
      return resultJson({ deleted: deleteClient(String(args.slug)) });
    }

    // ───── time ─────
    if (name === "log_time") {
      return resultJson(
        logTime({
          client: String(args.client),
          hours: Number(args.hours),
          date: args.date as string | undefined,
          rate: (args.rate as number | undefined) ?? null,
          project: (args.project as string | undefined) ?? null,
          description: (args.description as string | undefined) ?? "",
        }),
      );
    }
    if (name === "list_time_entries") {
      return resultJson(
        listTimeEntries({
          client: args.client as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          unbilled: args.unbilled as boolean | undefined,
          project: args.project as string | undefined,
        }),
      );
    }
    if (name === "start_timer") {
      return resultJson(
        startTimer({
          client: args.client as string | undefined,
          project: (args.project as string | undefined) ?? null,
          description: (args.description as string | undefined) ?? null,
          rate: (args.rate as number | undefined) ?? null,
        }),
      );
    }
    if (name === "stop_timer") {
      return resultJson(
        stopTimer({
          client: args.client as string | undefined,
          project: (args.project as string | undefined) ?? null,
          description: (args.description as string | undefined) ?? null,
          rate: (args.rate as number | undefined) ?? null,
        }),
      );
    }
    if (name === "get_active_timer") {
      return resultJson(getActiveTimer());
    }
    if (name === "cancel_timer") {
      return resultJson({ cancelled: cancelTimer() });
    }
    if (name === "update_active_timer") {
      const patch: Parameters<typeof updateActiveTimer>[0] = {};
      if (args.client !== undefined)
        patch.client = args.client === null ? null : String(args.client);
      if (args.project !== undefined)
        patch.project = args.project === null ? null : String(args.project);
      if (args.description !== undefined)
        patch.description = args.description === null ? null : String(args.description);
      if (args.rate !== undefined)
        patch.rate = args.rate === null ? null : Number(args.rate);
      return resultJson(updateActiveTimer(patch));
    }
    if (name === "get_time_entry") {
      const e = getTimeEntry(String(args.id));
      return e ? resultJson(e) : resultText(`not found: ${args.id}`, true);
    }
    if (name === "update_time_entry") {
      const patch: Parameters<typeof updateTimeEntry>[1] = {};
      if (args.client !== undefined) patch.client = String(args.client);
      if (args.date !== undefined) patch.date = String(args.date);
      if (args.hours !== undefined) patch.hours = Number(args.hours);
      if (args.rate !== undefined)
        patch.rate = args.rate === null ? null : Number(args.rate);
      if (args.project !== undefined)
        patch.project = args.project === null ? null : String(args.project);
      if (args.description !== undefined) patch.description = String(args.description);
      return resultJson(updateTimeEntry(String(args.id), patch));
    }
    if (name === "delete_time_entry") {
      return resultJson({ deleted: deleteTimeEntry(String(args.id)) });
    }
    if (name === "summarise_time") {
      return resultJson(
        summariseTime({
          client: args.client as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
        }),
      );
    }

    // ───── expenses ─────
    if (name === "add_expense") {
      return resultJson(
        addExpense({
          description: String(args.description),
          date: args.date as string | undefined,
          client: (args.client as string | undefined) ?? null,
          category: (args.category as string | undefined) ?? null,
          amount: (args.amount as number | undefined) ?? null,
          currency: (args.currency as string | undefined) ?? null,
          quantity: (args.quantity as number | undefined) ?? null,
          unit: (args.unit as string | undefined) ?? null,
          billable: (args.billable as boolean | undefined) ?? false,
        }),
      );
    }
    if (name === "list_expenses") {
      return resultJson(
        listExpenses({
          client: args.client as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
          category: args.category as string | undefined,
          unbilled: args.unbilled as boolean | undefined,
          billable: args.billable as boolean | undefined,
          hasAmount: args.hasAmount as boolean | undefined,
        }),
      );
    }
    if (name === "get_expense") {
      const e = getExpense(String(args.id));
      return e ? resultJson(e) : resultText(`not found: ${args.id}`, true);
    }
    if (name === "update_expense") {
      const patch: Parameters<typeof updateExpense>[1] = {};
      if (args.description !== undefined) patch.description = String(args.description);
      if (args.date !== undefined) patch.date = String(args.date);
      if (args.client !== undefined) {
        const v = String(args.client);
        patch.client = v === "" ? null : v;
      }
      if (args.category !== undefined) {
        const v = String(args.category);
        patch.category = v === "" ? null : v;
      }
      if (args.clearAmount) patch.amount = null;
      else if (args.amount !== undefined) patch.amount = Number(args.amount);
      if (args.currency !== undefined) {
        const v = String(args.currency);
        patch.currency = v === "" ? null : v;
      }
      if (args.quantity !== undefined) patch.quantity = Number(args.quantity);
      if (args.unit !== undefined) {
        const v = String(args.unit);
        patch.unit = v === "" ? null : v;
      }
      if (args.billable !== undefined) patch.billable = Boolean(args.billable);
      return resultJson(updateExpense(String(args.id), patch));
    }
    if (name === "delete_expense") {
      return resultJson({ deleted: deleteExpense(String(args.id)) });
    }

    // ───── invoices ─────
    if (name === "list_invoices") {
      return resultJson(
        listInvoices({
          client: args.client as string | undefined,
          status: args.status as InvoiceStatus | InvoiceStatus[] | undefined,
        }),
      );
    }
    if (name === "get_invoice") {
      const inv = getInvoice(String(args.number));
      return inv ? resultJson(inv) : resultText(`not found: ${args.number}`, true);
    }
    if (name === "create_invoice") {
      return resultJson(
        createInvoice({
          client: String(args.client),
          number: args.number as string | undefined,
          issuedAt: args.issuedAt as string | undefined,
          dueAt: args.dueAt as string | undefined,
          taxRate: args.taxRate as number | undefined,
          currency: args.currency as string | undefined,
          notes: args.notes as string | undefined,
          fromTimeRange: args.fromTimeRange as { from: string; to: string } | undefined,
          lineItems: args.lineItems as
            | Array<{ description: string; unitLabel?: string; quantity: number; rate: number }>
            | undefined,
        }),
      );
    }
    if (name === "update_invoice") {
      return resultJson(
        updateInvoice(String(args.number), {
          notes: args.notes as string | undefined,
          dueAt: args.dueAt as string | undefined,
          issuedAt: args.issuedAt as string | undefined,
          taxRate: args.taxRate as number | undefined,
          currency: args.currency as string | undefined,
        }),
      );
    }
    if (name === "set_invoice_status") {
      return resultJson(
        setInvoiceStatus(String(args.number), args.status as InvoiceStatus),
      );
    }
    if (name === "record_payment") {
      return resultJson(
        recordPayment({
          invoice: String(args.invoice),
          amount: args.amount as number,
          date: args.date as string | undefined,
          method: (args.method as string | undefined) ?? null,
          reference: (args.reference as string | undefined) ?? null,
          note: (args.note as string | undefined) ?? null,
        }),
      );
    }
    if (name === "list_payments") {
      return resultJson(listPayments(args.invoice as string | undefined));
    }
    if (name === "delete_payment") {
      return resultJson(deletePayment(String(args.id)));
    }
    if (name === "list_overdue_invoices") {
      return resultJson(listOverdueInvoices({ asOf: args.asOf as string | undefined }));
    }
    if (name === "reconcile_overdue_invoices") {
      return resultJson(
        reconcileOverdueInvoices({ asOf: args.asOf as string | undefined }),
      );
    }
    if (name === "delete_invoice") {
      deleteInvoice(String(args.number));
      return resultJson({ deleted: args.number });
    }
    if (name === "render_invoice_html") {
      return resultText(renderInvoiceHtml(String(args.number)));
    }
    if (name === "generate_invoice_pdf") {
      const path = await generateInvoicePdf(String(args.number), {
        output: args.output as string | undefined,
        format: args.format as "Letter" | "A4" | "Legal" | undefined,
        overwrite: args.overwrite === true,
      });
      return resultJson({ path });
    }

    // ───── recurring invoices ─────
    if (name === "add_recurring_invoice") {
      return resultJson(
        addRecurringInvoice({
          client: String(args.client),
          cadence: args.cadence as RecurringCadence,
          startDate: String(args.startDate),
          endDate: (args.endDate as string | undefined) ?? null,
          dayOfMonth: args.dayOfMonth as number | undefined,
          dayOfWeek: args.dayOfWeek as number | undefined,
          active: args.active as boolean | undefined,
          autoSend: args.autoSend as boolean | undefined,
          template: args.template as RecurringInvoiceTemplate,
        }),
      );
    }
    if (name === "list_recurring_invoices") {
      return resultJson(
        listRecurringInvoices({
          client: args.client as string | undefined,
          active: args.active as boolean | undefined,
        }),
      );
    }
    if (name === "get_recurring_invoice") {
      const r = getRecurringInvoice(String(args.id));
      return r ? resultJson(r) : resultText(`not found: ${args.id}`, true);
    }
    if (name === "update_recurring_invoice") {
      return resultJson(
        updateRecurringInvoice(String(args.id), {
          cadence: args.cadence as RecurringCadence | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate === undefined ? undefined : (args.endDate as string | null),
          dayOfMonth: args.dayOfMonth as number | undefined,
          dayOfWeek: args.dayOfWeek as number | undefined,
          active: args.active as boolean | undefined,
          autoSend: args.autoSend as boolean | undefined,
          nextIssueAt: args.nextIssueAt as string | undefined,
          template: args.template as RecurringInvoiceTemplate | undefined,
        }),
      );
    }
    if (name === "delete_recurring_invoice") {
      return resultJson({ deleted: deleteRecurringInvoice(String(args.id)) });
    }
    if (name === "run_recurring_invoices") {
      return resultJson(runRecurringInvoices({ asOf: args.asOf as string | undefined }));
    }
    if (name === "upcoming_recurring_invoices") {
      return resultJson(
        upcomingRecurringInvoices({
          count: args.count as number | undefined,
          client: args.client as string | undefined,
        }),
      );
    }

    // ───── crm ─────
    if (name === "add_crm_note") {
      return resultJson(
        addCrmNote({
          client: String(args.client),
          body: String(args.body),
          date: args.date as string | undefined,
          followupAt: (args.followupAt as string | undefined) ?? null,
        }),
      );
    }
    if (name === "list_crm_notes") {
      return resultJson(
        listCrmNotes({
          client: args.client as string | undefined,
          from: args.from as string | undefined,
          to: args.to as string | undefined,
        }),
      );
    }
    if (name === "get_crm_note") {
      const n = getCrmNote(String(args.id));
      return n ? resultJson(n) : resultText(`not found: ${args.id}`, true);
    }
    if (name === "update_crm_note") {
      const patch: Parameters<typeof updateCrmNote>[1] = {};
      if (args.client !== undefined) patch.client = String(args.client);
      if (args.body !== undefined) patch.body = String(args.body);
      if (args.date !== undefined) patch.date = String(args.date);
      if (args.followupAt !== undefined)
        patch.followupAt = args.followupAt === null ? null : String(args.followupAt);
      return resultJson(updateCrmNote(String(args.id), patch));
    }
    if (name === "delete_crm_note") {
      return resultJson({ deleted: deleteCrmNote(String(args.id)) });
    }
    if (name === "list_followups") {
      return resultJson(
        listFollowups({
          stalenessDays: args.stalenessDays as number | undefined,
          dueBy: args.dueBy as string | undefined,
        }),
      );
    }

    // ───── config / report ─────
    if (name === "get_config") {
      return resultJson(getConfig());
    }
    if (name === "update_config") {
      return resultJson(
        updateConfig({
          businessName: args.businessName as string | undefined,
          businessEmail: args.businessEmail as string | undefined,
          businessAddress: args.businessAddress as string | undefined,
          businessCity: args.businessCity as string | undefined,
          businessPhone: args.businessPhone as string | undefined,
          businessLogo: args.businessLogo as string | undefined,
          businessTagline: args.businessTagline as string | undefined,
          businessSite: args.businessSite as string | undefined,
          accentColor: args.accentColor as string | undefined,
          customInstructions: args.customInstructions as string | undefined,
          defaultRate: args.defaultRate as number | undefined,
          taxRate: args.taxRate as number | undefined,
          currency: args.currency as string | undefined,
          dueDays: args.dueDays as number | undefined,
          paymentTerms: args.paymentTerms as string | undefined,
          invoiceTemplate: args.invoiceTemplate as string | undefined,
        }),
      );
    }
    if (name === "print_invoice_template") {
      const { html, fromUserCopy } = readUserTemplate();
      return resultJson({ html, fromUserCopy, path: userTemplatePath() });
    }
    if (name === "write_invoice_template") {
      const html = String(args.html ?? "");
      try {
        const result = writeUserTemplate(html);
        return resultJson({ ok: true, ...result });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return resultJson({ ok: false, error: msg }, true);
      }
    }
    if (name === "reset_invoice_template") {
      // Always overwrite from the bundled default. The MCP tool surface is
      // gated by entitlement + has no out-of-band "are you sure" prompt, so
      // the LLM should call this only when the user explicitly asks to
      // restore the default.
      const bundled = readBundledTemplate();
      const result = writeUserTemplate(bundled);
      return resultJson({ ok: true, ...result });
    }
    if (name === "init_config") {
      return resultJson(
        bootstrapConfig({
          businessName: String(args.businessName),
          businessEmail: String(args.businessEmail),
          defaultRate: args.defaultRate as number | undefined,
          taxRate: args.taxRate as number | undefined,
          currency: args.currency as string | undefined,
          dueDays: args.dueDays as number | undefined,
          paymentTerms: args.paymentTerms as string | undefined,
        }),
      );
    }
    if (name === "export_data") {
      return resultJson(exportSnapshot());
    }
    if (name === "import_data") {
      const snapshot = args.snapshot as Snapshot;
      const mode = (args.mode as "merge" | "replace" | undefined) ?? "merge";
      if (mode === "replace" && args.confirm !== "replace") {
        return resultText(
          'import_data with mode "replace" wipes every table. Confirm with the user, then call again with confirm: "replace".',
          true,
        );
      }
      return resultJson(importSnapshot(snapshot, { mode }));
    }
    if (name === "financial_report") {
      return resultJson(
        financialReport({
          from: args.from as string | undefined,
          to: args.to as string | undefined,
        }),
      );
    }

    return resultText(`unknown tool: ${name}`, true);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return resultText(msg, true);
  }
});

// ───── resources ─────
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const clients = listClients();
  const invoices = listInvoices();
  return {
    resources: [
      ...clients.map((c) => ({
        uri: `client://${c.slug}`,
        name: c.name,
        description: `Client ${c.slug} (${c.status})`,
        mimeType: "application/json",
      })),
      ...invoices.map((i) => ({
        uri: `invoice://${i.number}`,
        name: i.number,
        description: `Invoice ${i.number} for ${i.clientSlug} (${i.status})`,
        mimeType: "application/json",
      })),
    ],
  };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "client://{slug}",
      name: "Client",
      description: "Client record by slug.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "invoice://{number}",
      name: "Invoice",
      description: "Invoice with line items by number.",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  if (uri.startsWith("client://")) {
    const slug = uri.slice("client://".length);
    const c = getClient(slug);
    if (!c) throw new Error(`client not found: ${slug}`);
    return {
      contents: [
        { uri, mimeType: "application/json", text: JSON.stringify(c, null, 2) },
      ],
    };
  }
  if (uri.startsWith("invoice://")) {
    const number = uri.slice("invoice://".length);
    const inv = getInvoice(number);
    if (!inv) throw new Error(`invoice not found: ${number}`);
    return {
      contents: [
        { uri, mimeType: "application/json", text: JSON.stringify(inv, null, 2) },
      ],
    };
  }
  throw new Error(`unknown resource uri: ${uri}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
