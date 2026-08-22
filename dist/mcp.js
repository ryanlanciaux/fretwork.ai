#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { addClient, addCrmNote, addExpense, addRecurringInvoice, archiveClient, bootstrapConfig, cancelTimer, deleteClient, deleteCrmNote, deleteExpense, deleteRecurringInvoice, deleteTimeEntry, exportSnapshot, importSnapshot, createInvoice, deleteInvoice, financialReport, generateInvoicePdf, getActiveTimer, listOverdueInvoices, reconcileOverdueInvoices, getClient, getConfig, getCrmNote, getExpense, getInvoice, getRecurringInvoice, getTimeEntry, listExpenses, listRecurringInvoices, listClients, listCrmNotes, listFollowups, listInvoices, listTimeEntries, logTime, promoteClient, recordPayment, listPayments, deletePayment, renderInvoiceHtml, runRecurringInvoices, setInvoiceStatus, startTimer, stopTimer, summariseTime, updateActiveTimer, updateClient, updateConfig, updateCrmNote, updateExpense, updateInvoice, updateRecurringInvoice, updateTimeEntry, upcomingRecurringInvoices, } from "./store/index.js";
import { readBundledTemplate, readUserTemplate, userTemplatePath, writeUserTemplate, } from "./store/render/index.js";
// Resolve the MCP server version from package.json so it matches what the
// CLI reports. Bundled install: package.json sibling of mcp.js. Dev (tsx
// packages/mcp-server/src/index.ts): one level up.
function resolveVersion() {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        for (const candidate of [join(here, "package.json"), join(here, "..", "package.json")]) {
            if (!existsSync(candidate))
                continue;
            const pkg = JSON.parse(readFileSync(candidate, "utf-8"));
            if (typeof pkg.version === "string" && pkg.version)
                return pkg.version;
        }
    }
    catch {
        // fall through
    }
    return "unknown";
}
const server = new Server({ name: "fretwork-mcp", version: resolveVersion() }, { capabilities: { tools: {}, resources: {} } });
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
        description: "Hard-delete a client. Refuses if anything still references it " +
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
        description: "Start a running timer. Fails if one is already active. Client is optional at start — " +
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
        description: "Stop the active timer and log a time entry for the elapsed duration (rounded to 2 " +
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
        description: "Return the active timer (or null). Includes startedAt so callers can compute elapsed.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "cancel_timer",
        description: "Discard the active timer without logging a time entry.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "update_active_timer",
        description: "Edit the running timer's metadata in-place (client, project, description, rate) " +
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
        description: "Edit a time entry by id. Refuses if the entry is on an invoice — delete the " +
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
        description: "Delete a time entry by id. Refuses if the entry is on an invoice — delete the " +
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
        description: "Log an expense or activity record. Use for any dated entry that isn't billable time: " +
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
                    description: "true = only rows with a $ amount; false = only rows without; omit = all",
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
        description: "Patch fields on an expense. Pass `clearAmount: true` to drop a dollar amount (turn the " +
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
        description: "Create an invoice. Provide fromTimeRange (auto-bills matching unbilled time) and/or lineItems. " +
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
        description: "Record a payment received against an invoice. Supports partial payments — an " +
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
        description: "List recorded payments. Pass `invoice` (number or id) to list payments for one " +
            "invoice; omit it to list all payments across invoices, newest first.",
        inputSchema: {
            type: "object",
            properties: { invoice: { type: "string" } },
            required: [],
        },
    },
    {
        name: "delete_payment",
        description: "Delete a recorded payment by its id. If removing it drops a paid invoice below " +
            "its total, the invoice is reopened to status 'sent'. Returns the updated balance.",
        inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Payment id" } },
            required: ["id"],
        },
    },
    {
        name: "list_overdue_invoices",
        description: "List invoices past dueAt and not yet paid (status sent or overdue). Each row " +
            "includes daysOverdue. Sorted by daysOverdue desc. Optional asOf overrides today.",
        inputSchema: {
            type: "object",
            properties: { asOf: { type: "string" } },
            required: [],
        },
    },
    {
        name: "reconcile_overdue_invoices",
        description: "Promote any 'sent' invoice that is past dueAt to status 'overdue'. Returns the " +
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
        description: "Create a recurring invoice template (retainer, monthly subscription, etc.). " +
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
        description: "Materialize any recurring invoices whose nextIssueAt is at or before asOf (default " +
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
        description: "Return a versioned JSON snapshot of every local table (clients, time entries, " +
            "expenses, invoices, line items, recurring templates, CRM notes, config). The MCP " +
            "host can save this for backup/migration. Excludes ephemeral active_timer state.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "import_data",
        description: "Restore from a snapshot produced by export_data. `mode: 'merge'` (default) inserts " +
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
        description: "Return the current invoice template HTML (user copy at ~/.fretwork/templates/invoice.html, " +
            "or bundled default if no user copy yet). Use BEFORE write_invoice_template to read the " +
            "current state.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "write_invoice_template",
        description: "Replace the user invoice template at ~/.fretwork/templates/invoice.html with the supplied " +
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
        description: "Restore the user invoice template at ~/.fretwork/templates/invoice.html to the bundled " +
            "default. Use when the user asks to 'go back to the default invoice' or after a broken edit.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
function resultJson(value, isError = false) {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        ...(isError ? { isError: true } : {}),
    };
}
function resultText(text, isError = false) {
    return {
        content: [{ type: "text", text }],
        ...(isError ? { isError: true } : {}),
    };
}
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {});
    try {
        // ───── clients ─────
        if (name === "list_clients") {
            return resultJson(listClients({ status: args.status }));
        }
        if (name === "get_client") {
            const c = getClient(String(args.slug));
            return c ? resultJson(c) : resultText(`not found: ${args.slug}`, true);
        }
        if (name === "add_client") {
            return resultJson(addClient({
                name: String(args.name),
                email: args.email ?? null,
                address: args.address ?? null,
                city: args.city ?? null,
                phone: args.phone ?? null,
                defaultRate: args.defaultRate ?? null,
                notes: args.notes ?? null,
                status: args.status,
            }));
        }
        if (name === "update_client") {
            return resultJson(updateClient(String(args.slug), {
                name: args.name,
                email: args.email,
                address: args.address,
                city: args.city,
                phone: args.phone,
                defaultRate: args.defaultRate,
                notes: args.notes,
            }));
        }
        if (name === "promote_client") {
            return resultJson(promoteClient(String(args.slug), args.to));
        }
        if (name === "archive_client") {
            return resultJson(archiveClient(String(args.slug)));
        }
        if (name === "delete_client") {
            return resultJson({ deleted: deleteClient(String(args.slug)) });
        }
        // ───── time ─────
        if (name === "log_time") {
            return resultJson(logTime({
                client: String(args.client),
                hours: Number(args.hours),
                date: args.date,
                rate: args.rate ?? null,
                project: args.project ?? null,
                description: args.description ?? "",
            }));
        }
        if (name === "list_time_entries") {
            return resultJson(listTimeEntries({
                client: args.client,
                from: args.from,
                to: args.to,
                unbilled: args.unbilled,
                project: args.project,
            }));
        }
        if (name === "start_timer") {
            return resultJson(startTimer({
                client: args.client,
                project: args.project ?? null,
                description: args.description ?? null,
                rate: args.rate ?? null,
            }));
        }
        if (name === "stop_timer") {
            return resultJson(stopTimer({
                client: args.client,
                project: args.project ?? null,
                description: args.description ?? null,
                rate: args.rate ?? null,
            }));
        }
        if (name === "get_active_timer") {
            return resultJson(getActiveTimer());
        }
        if (name === "cancel_timer") {
            return resultJson({ cancelled: cancelTimer() });
        }
        if (name === "update_active_timer") {
            const patch = {};
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
            const patch = {};
            if (args.client !== undefined)
                patch.client = String(args.client);
            if (args.date !== undefined)
                patch.date = String(args.date);
            if (args.hours !== undefined)
                patch.hours = Number(args.hours);
            if (args.rate !== undefined)
                patch.rate = args.rate === null ? null : Number(args.rate);
            if (args.project !== undefined)
                patch.project = args.project === null ? null : String(args.project);
            if (args.description !== undefined)
                patch.description = String(args.description);
            return resultJson(updateTimeEntry(String(args.id), patch));
        }
        if (name === "delete_time_entry") {
            return resultJson({ deleted: deleteTimeEntry(String(args.id)) });
        }
        if (name === "summarise_time") {
            return resultJson(summariseTime({
                client: args.client,
                from: args.from,
                to: args.to,
            }));
        }
        // ───── expenses ─────
        if (name === "add_expense") {
            return resultJson(addExpense({
                description: String(args.description),
                date: args.date,
                client: args.client ?? null,
                category: args.category ?? null,
                amount: args.amount ?? null,
                currency: args.currency ?? null,
                quantity: args.quantity ?? null,
                unit: args.unit ?? null,
                billable: args.billable ?? false,
            }));
        }
        if (name === "list_expenses") {
            return resultJson(listExpenses({
                client: args.client,
                from: args.from,
                to: args.to,
                category: args.category,
                unbilled: args.unbilled,
                billable: args.billable,
                hasAmount: args.hasAmount,
            }));
        }
        if (name === "get_expense") {
            const e = getExpense(String(args.id));
            return e ? resultJson(e) : resultText(`not found: ${args.id}`, true);
        }
        if (name === "update_expense") {
            const patch = {};
            if (args.description !== undefined)
                patch.description = String(args.description);
            if (args.date !== undefined)
                patch.date = String(args.date);
            if (args.client !== undefined) {
                const v = String(args.client);
                patch.client = v === "" ? null : v;
            }
            if (args.category !== undefined) {
                const v = String(args.category);
                patch.category = v === "" ? null : v;
            }
            if (args.clearAmount)
                patch.amount = null;
            else if (args.amount !== undefined)
                patch.amount = Number(args.amount);
            if (args.currency !== undefined) {
                const v = String(args.currency);
                patch.currency = v === "" ? null : v;
            }
            if (args.quantity !== undefined)
                patch.quantity = Number(args.quantity);
            if (args.unit !== undefined) {
                const v = String(args.unit);
                patch.unit = v === "" ? null : v;
            }
            if (args.billable !== undefined)
                patch.billable = Boolean(args.billable);
            return resultJson(updateExpense(String(args.id), patch));
        }
        if (name === "delete_expense") {
            return resultJson({ deleted: deleteExpense(String(args.id)) });
        }
        // ───── invoices ─────
        if (name === "list_invoices") {
            return resultJson(listInvoices({
                client: args.client,
                status: args.status,
            }));
        }
        if (name === "get_invoice") {
            const inv = getInvoice(String(args.number));
            return inv ? resultJson(inv) : resultText(`not found: ${args.number}`, true);
        }
        if (name === "create_invoice") {
            return resultJson(createInvoice({
                client: String(args.client),
                number: args.number,
                issuedAt: args.issuedAt,
                dueAt: args.dueAt,
                taxRate: args.taxRate,
                currency: args.currency,
                notes: args.notes,
                fromTimeRange: args.fromTimeRange,
                lineItems: args.lineItems,
            }));
        }
        if (name === "update_invoice") {
            return resultJson(updateInvoice(String(args.number), {
                notes: args.notes,
                dueAt: args.dueAt,
                issuedAt: args.issuedAt,
                taxRate: args.taxRate,
                currency: args.currency,
            }));
        }
        if (name === "set_invoice_status") {
            return resultJson(setInvoiceStatus(String(args.number), args.status));
        }
        if (name === "record_payment") {
            return resultJson(recordPayment({
                invoice: String(args.invoice),
                amount: args.amount,
                date: args.date,
                method: args.method ?? null,
                reference: args.reference ?? null,
                note: args.note ?? null,
            }));
        }
        if (name === "list_payments") {
            return resultJson(listPayments(args.invoice));
        }
        if (name === "delete_payment") {
            return resultJson(deletePayment(String(args.id)));
        }
        if (name === "list_overdue_invoices") {
            return resultJson(listOverdueInvoices({ asOf: args.asOf }));
        }
        if (name === "reconcile_overdue_invoices") {
            return resultJson(reconcileOverdueInvoices({ asOf: args.asOf }));
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
                output: args.output,
                format: args.format,
                overwrite: args.overwrite === true,
            });
            return resultJson({ path });
        }
        // ───── recurring invoices ─────
        if (name === "add_recurring_invoice") {
            return resultJson(addRecurringInvoice({
                client: String(args.client),
                cadence: args.cadence,
                startDate: String(args.startDate),
                endDate: args.endDate ?? null,
                dayOfMonth: args.dayOfMonth,
                dayOfWeek: args.dayOfWeek,
                active: args.active,
                autoSend: args.autoSend,
                template: args.template,
            }));
        }
        if (name === "list_recurring_invoices") {
            return resultJson(listRecurringInvoices({
                client: args.client,
                active: args.active,
            }));
        }
        if (name === "get_recurring_invoice") {
            const r = getRecurringInvoice(String(args.id));
            return r ? resultJson(r) : resultText(`not found: ${args.id}`, true);
        }
        if (name === "update_recurring_invoice") {
            return resultJson(updateRecurringInvoice(String(args.id), {
                cadence: args.cadence,
                startDate: args.startDate,
                endDate: args.endDate === undefined ? undefined : args.endDate,
                dayOfMonth: args.dayOfMonth,
                dayOfWeek: args.dayOfWeek,
                active: args.active,
                autoSend: args.autoSend,
                nextIssueAt: args.nextIssueAt,
                template: args.template,
            }));
        }
        if (name === "delete_recurring_invoice") {
            return resultJson({ deleted: deleteRecurringInvoice(String(args.id)) });
        }
        if (name === "run_recurring_invoices") {
            return resultJson(runRecurringInvoices({ asOf: args.asOf }));
        }
        if (name === "upcoming_recurring_invoices") {
            return resultJson(upcomingRecurringInvoices({
                count: args.count,
                client: args.client,
            }));
        }
        // ───── crm ─────
        if (name === "add_crm_note") {
            return resultJson(addCrmNote({
                client: String(args.client),
                body: String(args.body),
                date: args.date,
                followupAt: args.followupAt ?? null,
            }));
        }
        if (name === "list_crm_notes") {
            return resultJson(listCrmNotes({
                client: args.client,
                from: args.from,
                to: args.to,
            }));
        }
        if (name === "get_crm_note") {
            const n = getCrmNote(String(args.id));
            return n ? resultJson(n) : resultText(`not found: ${args.id}`, true);
        }
        if (name === "update_crm_note") {
            const patch = {};
            if (args.client !== undefined)
                patch.client = String(args.client);
            if (args.body !== undefined)
                patch.body = String(args.body);
            if (args.date !== undefined)
                patch.date = String(args.date);
            if (args.followupAt !== undefined)
                patch.followupAt = args.followupAt === null ? null : String(args.followupAt);
            return resultJson(updateCrmNote(String(args.id), patch));
        }
        if (name === "delete_crm_note") {
            return resultJson({ deleted: deleteCrmNote(String(args.id)) });
        }
        if (name === "list_followups") {
            return resultJson(listFollowups({
                stalenessDays: args.stalenessDays,
                dueBy: args.dueBy,
            }));
        }
        // ───── config / report ─────
        if (name === "get_config") {
            return resultJson(getConfig());
        }
        if (name === "update_config") {
            return resultJson(updateConfig({
                businessName: args.businessName,
                businessEmail: args.businessEmail,
                businessAddress: args.businessAddress,
                businessCity: args.businessCity,
                businessPhone: args.businessPhone,
                businessLogo: args.businessLogo,
                businessTagline: args.businessTagline,
                businessSite: args.businessSite,
                accentColor: args.accentColor,
                customInstructions: args.customInstructions,
                defaultRate: args.defaultRate,
                taxRate: args.taxRate,
                currency: args.currency,
                dueDays: args.dueDays,
                paymentTerms: args.paymentTerms,
                invoiceTemplate: args.invoiceTemplate,
            }));
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
            }
            catch (e) {
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
            return resultJson(bootstrapConfig({
                businessName: String(args.businessName),
                businessEmail: String(args.businessEmail),
                defaultRate: args.defaultRate,
                taxRate: args.taxRate,
                currency: args.currency,
                dueDays: args.dueDays,
                paymentTerms: args.paymentTerms,
            }));
        }
        if (name === "export_data") {
            return resultJson(exportSnapshot());
        }
        if (name === "import_data") {
            const snapshot = args.snapshot;
            const mode = args.mode ?? "merge";
            if (mode === "replace" && args.confirm !== "replace") {
                return resultText('import_data with mode "replace" wipes every table. Confirm with the user, then call again with confirm: "replace".', true);
            }
            return resultJson(importSnapshot(snapshot, { mode }));
        }
        if (name === "financial_report") {
            return resultJson(financialReport({
                from: args.from,
                to: args.to,
            }));
        }
        return resultText(`unknown tool: ${name}`, true);
    }
    catch (e) {
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
        if (!c)
            throw new Error(`client not found: ${slug}`);
        return {
            contents: [
                { uri, mimeType: "application/json", text: JSON.stringify(c, null, 2) },
            ],
        };
    }
    if (uri.startsWith("invoice://")) {
        const number = uri.slice("invoice://".length);
        const inv = getInvoice(number);
        if (!inv)
            throw new Error(`invoice not found: ${number}`);
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
