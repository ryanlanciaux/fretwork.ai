#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runInit } from "./cli/commands/init.js";
import {
  runClientsAdd,
  runClientsArchive,
  runClientsDelete,
  runClientsGet,
  runClientsList,
  runClientsPromote,
  runClientsUpdate,
} from "./cli/commands/clients.js";
import {
  runTimeCancel,
  runTimeDelete,
  runTimeGet,
  runTimeList,
  runTimeLog,
  runTimeStart,
  runTimeStatus,
  runTimeStop,
  runTimeSummary,
  runTimeUpdate,
  runTimerUpdate,
} from "./cli/commands/time.js";
import {
  runInvoicesCreate,
  runInvoicesDelete,
  runInvoicesGet,
  runInvoicesList,
  runInvoicesOverdue,
  runInvoicesPay,
  runInvoicesPdf,
  runInvoicesRender,
  runInvoicesStatus,
  runPaymentsDelete,
  runPaymentsList,
} from "./cli/commands/invoices.js";
import {
  runCrmFollowups,
  runCrmNote,
  runCrmNoteDelete,
  runCrmNoteGet,
  runCrmNoteUpdate,
  runCrmNotes,
} from "./cli/commands/crm.js";
import {
  runExpensesAdd,
  runExpensesDelete,
  runExpensesGet,
  runExpensesList,
  runExpensesUpdate,
} from "./cli/commands/expenses.js";
import {
  runRecurringAdd,
  runRecurringDelete,
  runRecurringGet,
  runRecurringList,
  runRecurringRun,
  runRecurringUpcoming,
  runRecurringUpdate,
} from "./cli/commands/recurring.js";
import { runExport, runImport } from "./cli/commands/data.js";
import { runConfigSet, runConfigShow } from "./cli/commands/config.js";
import { runReportFinancial } from "./cli/commands/report.js";
import {
  runTemplatePath,
  runTemplatePrint,
  runTemplateReset,
  runTemplateShowDefault,
  runTemplateWrite,
} from "./cli/commands/template.js";
import { runInstallWizard } from "./cli/install/wizard.js";
import { findSkillSource } from "./cli/install/hosts.js";
// Resolve the CLI version from package.json so `fretwork --version` reflects
// what's actually installed. In the bundled install, package.json sits next
// to cli.js; in dev (tsx packages/cli/src/index.ts), it's one level up.
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

const program = new Command();
program
  .name("fretwork")
  .description("Local-first time tracking, invoicing, expenses and CRM for your AI agent")
  .version(resolveVersion());

// ───── install / setup ─────
program
  .command("install")
  .alias("setup")
  .description(
    "Wire the fretwork MCP server + skill into your AI agent (Claude Code, Claude Desktop, Cursor, OpenCode, Codex, Hermes, OpenClaw, Grok Build)",
  )
  .option("--non-interactive", "Skip prompts; print manual configs and exit")
  .option("--skip-banner", "Suppress the intro banner")
  .option("--name <name>", "Server name to register with hosts (default: fretwork)")
  .option(
    "--host <ids>",
    "Wire these hosts without prompting (comma-separated: claude, claude-desktop, cursor, opencode, codex, hermes, openclaw, grok). Repeatable.",
    (v: string, prev: string[] = []) => [...prev, v],
  )
  .option("-y, --yes", "No prompts; wire --host (or every detected host) and install skills")
  .action(async (opts) => {
    const code = await runInstallWizard({
      nonInteractive: opts.nonInteractive,
      skipBanner: opts.skipBanner,
      name: opts.name,
      hosts: opts.host,
      yes: opts.yes,
    });
    process.exit(code);
  });

// ───── upgrade ─────
program
  .command("upgrade")
  .description("Upgrade to the latest Fretwork from GitHub (npm install -g github:ryanlanciaux/fretwork.ai)")
  .option("--source <spec>", "npm package spec to install", "github:ryanlanciaux/fretwork.ai")
  .action((opts: { source: string }) => {
    const before = resolveVersion();
    process.stderr.write(`Upgrading fretwork ${before} from ${opts.source}…\n`);
    const r = spawnSync("npm", ["install", "-g", opts.source, "--no-audit", "--no-fund", "--loglevel=error"], {
      stdio: "inherit",
    });
    if (r.status !== 0) {
      process.stderr.write("Upgrade failed. Run the npm command above by hand to see the error.\n");
      process.exit(r.status ?? 1);
    }
    const after = spawnSync("fretwork", ["--version"], { encoding: "utf-8" }).stdout?.trim() || "unknown";
    process.stderr.write(
      `✓ fretwork ${before} → ${after}. Your data in ~/.fretwork is untouched. ` +
        `Restart any agent (or reload its MCP servers) to pick up the new server.\n`,
    );
  });

// ───── skill (SKILL.md / HELP.md shipped with the package) ─────
const skill = program
  .command("skill")
  .description("Locate or print the bundled agent skill (SKILL.md / HELP.md)");
skill
  .command("path")
  .description("Print the directory containing SKILL.md and HELP.md")
  .action(() => {
    const src = findSkillSource();
    if (!src) {
      process.stderr.write("SKILL.md not found next to this install.\n");
      process.exit(1);
    }
    process.stdout.write(dirname(src) + "\n");
  });
skill
  .command("print [file]")
  .description("Print SKILL.md (default) or HELP.md to stdout")
  .action((file?: string) => {
    const src = findSkillSource();
    if (!src) {
      process.stderr.write("SKILL.md not found next to this install.\n");
      process.exit(1);
    }
    const name = (file ?? "SKILL.md").toUpperCase() === "HELP.MD" ? "HELP.md" : "SKILL.md";
    process.stdout.write(readFileSync(join(dirname(src), name), "utf-8"));
  });

// ───── local: init ─────
program
  .command("init")
  .description("Bootstrap the local config (business info, rates, currency)")
  .option("--name <name>", "Business name")
  .option("--email <email>", "Business email")
  .option("--address <address>", "Business address")
  .option("--city <city>", "Business city")
  .option("--phone <phone>", "Business phone")
  .option("--logo <path>", "Logo image file (copied into ~/.fretwork)")
  .option("--rate <rate>", "Default hourly rate (default 100)")
  .option("--currency <code>", "Currency (e.g. USD)")
  .option("--tax-rate <pct>", "Tax rate added to invoices, as a percent (default 0)")
  .option("--due-days <days>", "Payment terms: days until an invoice is due, e.g. 14 or 30 (default 14)")
  .option("--payment-terms <text>", "Payment instructions printed on invoices, e.g. bank details (optional)")
  .option("--yes", "Use defaults / passed flags without prompting")
  .option("--json", "Emit JSON")
  .action(async (opts) => {
    const code = await runInit(opts);
    process.exit(code);
  });

// ───── local: clients ─────
const clients = program.command("clients").description("Manage clients");
clients
  .command("list")
  .description("List clients")
  .option("--status <status>", "Filter by status (comma-separated for multiple)")
  .option("--json", "Emit JSON")
  .action((opts) => runClientsList(opts));
clients
  .command("add <name>")
  .description("Add a client")
  .option("--email <email>", "Email")
  .option("--address <address>", "Street address")
  .option("--city <city>", "City")
  .option("--phone <phone>", "Phone")
  .option("--rate <rate>", "Default hourly rate (default 100)")
  .option("--status <status>", "prospect|lead|client|archived (default: prospect)")
  .option("--notes <text>", "Free-form notes")
  .option("--json", "Emit JSON")
  .action((name, opts) => runClientsAdd(name, opts));
clients
  .command("get <slug>")
  .description("Show one client")
  .option("--json", "Emit JSON")
  .action((slug, opts) => runClientsGet(slug, opts));
clients
  .command("update <slug>")
  .description("Update a client")
  .option("--name <name>", "Rename")
  .option("--email <email>", "Email")
  .option("--address <address>", "Address")
  .option("--city <city>", "City")
  .option("--phone <phone>", "Phone")
  .option("--rate <rate>", "Default hourly rate (default 100)")
  .option("--notes <text>", "Notes")
  .option("--json", "Emit JSON")
  .action((slug, opts) => runClientsUpdate(slug, opts));
clients
  .command("promote <slug>")
  .description("Advance status (prospect → lead → client) or set --to")
  .option("--to <status>", "Explicit target status")
  .option("--json", "Emit JSON")
  .action((slug, opts) => runClientsPromote(slug, opts));
clients
  .command("archive <slug>")
  .description("Archive a client")
  .option("--json", "Emit JSON")
  .action((slug, opts) => runClientsArchive(slug, opts));
clients
  .command("delete <slug>")
  .description("Hard-delete a client. Refuses if any time/expense/invoice/CRM/recurring/timer rows reference it.")
  .option("--json", "Emit JSON")
  .action((slug, opts) => runClientsDelete(slug, opts));

// ───── local: time ─────
const time = program.command("time").description("Track and summarise billable time");
time
  .command("log")
  .description("Log time against a client")
  .requiredOption("--client <slug>", "Client slug")
  .requiredOption("--hours <n>", "Hours worked")
  .option("--date <YYYY-MM-DD>", "Date (default: today)")
  .option("--rate <rate>", "Override rate for this entry")
  .option("--project <name>", "Project label")
  .option("--description <text>", "Description")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeLog(opts));
time
  .command("list")
  .description("List time entries")
  .option("--client <slug>", "Filter by client")
  .option("--from <YYYY-MM-DD>", "From date")
  .option("--to <YYYY-MM-DD>", "To date")
  .option("--unbilled", "Only unbilled entries")
  .option("--project <name>", "Filter by project label")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeList(opts));
time
  .command("start")
  .description("Start a timer. Fails if one is already running.")
  .option("--client <slug>", "Client slug (optional; can be set at stop)")
  .option("--project <name>", "Project label")
  .option("--description <text>", "Description")
  .option("--rate <rate>", "Override rate")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeStart(opts));
time
  .command("stop")
  .description("Stop the active timer and log the elapsed time")
  .option("--client <slug>", "Client slug (required if timer was started without one)")
  .option("--project <name>", "Project label (overrides timer's)")
  .option("--description <text>", "Description (overrides timer's)")
  .option("--rate <rate>", "Override rate")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeStop(opts));
time
  .command("status")
  .description("Show the active timer, if any")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeStatus(opts));
time
  .command("cancel")
  .description("Discard the active timer without logging")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeCancel(opts));
time
  .command("get <id>")
  .description("Show one time entry by id")
  .option("--json", "Emit JSON")
  .action((id, opts) => runTimeGet(id, opts));
time
  .command("update <id>")
  .description("Edit a time entry (refuses if entry is already on an invoice)")
  .option("--client <slug>", "Move to another client")
  .option("--date <YYYY-MM-DD>", "Date")
  .option("--hours <n>", "Hours")
  .option("--rate <rate>", "Rate")
  .option("--clear-rate", "Clear the rate override (falls back to client/config default)")
  .option("--project <name>", "Project label (empty string clears)")
  .option("--description <text>", "Description")
  .option("--json", "Emit JSON")
  .action((id, opts) => runTimeUpdate(id, opts));
time
  .command("delete <id>")
  .description("Delete a time entry (refuses if billed — delete the invoice first)")
  .option("--json", "Emit JSON")
  .action((id, opts) => runTimeDelete(id, opts));
time
  .command("timer-update")
  .description("Edit the active timer's client / project / description / rate while it runs")
  .option("--client <slug>", "Set the timer's client")
  .option("--clear-client", "Detach the timer from its current client")
  .option("--project <name>", "Project label (empty string clears)")
  .option("--description <text>", "Description (empty string clears)")
  .option("--rate <rate>", "Rate")
  .option("--json", "Emit JSON")
  .action((opts) => runTimerUpdate(opts));
time
  .command("summary")
  .description("Roll up hours by client")
  .option("--client <slug>", "Filter by client")
  .option("--from <YYYY-MM-DD>", "From date")
  .option("--to <YYYY-MM-DD>", "To date")
  .option("--json", "Emit JSON")
  .action((opts) => runTimeSummary(opts));

// ───── local: invoices ─────
const invoices = program.command("invoices").description("Create and manage invoices");
invoices
  .command("list")
  .description("List invoices")
  .option("--client <slug>", "Filter by client")
  .option("--status <status>", "Filter by status (comma-separated)")
  .option("--json", "Emit JSON")
  .action((opts) => runInvoicesList(opts));
invoices
  .command("get <number>")
  .description("Show invoice + line items")
  .option("--json", "Emit JSON")
  .action((number, opts) => runInvoicesGet(number, opts));
invoices
  .command("create")
  .description("Create an invoice from a time range or explicit line items")
  .requiredOption("--client <slug>", "Client slug")
  .option("--from <YYYY-MM-DD>", "Time range start (auto-bills matching unbilled entries)")
  .option("--to <YYYY-MM-DD>", "Time range end")
  .option("--number <n>", "Override generated invoice number")
  .option("--issued <YYYY-MM-DD>", "Issue date (default: today)")
  .option("--due <YYYY-MM-DD>", "Due date (default: issued + dueDays)")
  .option("--tax-rate <pct>", "Tax rate as percent")
  .option("--currency <code>", "Currency override")
  .option("--notes <text>", "Free-form notes")
  .option("--item <desc|qty|rate[|unit]>", "Add an explicit line item; repeat as needed", (val: string, prev: string[] = []) => [...prev, val])
  .option("--json", "Emit JSON")
  .action((opts) => runInvoicesCreate(opts));
invoices
  .command("render <number>")
  .description("Render invoice HTML to stdout (or --output)")
  .option("--output <path>", "Write HTML to a file instead of stdout")
  .option("--json", "Emit JSON")
  .action((number, opts) => runInvoicesRender(number, opts));
invoices
  .command("pdf <number>")
  .description("Generate invoice PDF (Puppeteer)")
  .option("--output <path>", "Output path (default: ~/.fretwork/invoices/<number>/invoice.pdf)")
  .option("--format <Letter|A4|Legal>", "Page format", "Letter")
  .option("--json", "Emit JSON")
    .option("--overwrite", "Replace an existing file at --output")
.action(async (number, opts) => runInvoicesPdf(number, opts));
invoices
  .command("status <number> <status>")
  .description("Set invoice status (draft|sent|paid|overdue|void)")
  .option("--json", "Emit JSON")
  .action((number, status, opts) => runInvoicesStatus(number, status, opts));
invoices
  .command("overdue")
  .description("List invoices past their due date and not yet paid")
  .option("--as-of <YYYY-MM-DD>", "Treat this date as 'today' (default: today)")
  .option("--mark", "Promote sent invoices that are past due to status=overdue")
  .option("--json", "Emit JSON")
  .action((opts) => runInvoicesOverdue(opts));
invoices
  .command("delete <number>")
  .description("Delete an invoice (releases its time entries)")
  .option("--json", "Emit JSON")
  .action((number, opts) => runInvoicesDelete(number, opts));
invoices
  .command("pay <number>")
  .description("Record a (possibly partial) payment against an invoice")
  .requiredOption("--amount <n>", "Payment amount")
  .option("--date <YYYY-MM-DD>", "Payment date (default: today)")
  .option("--method <text>", "Payment method (bank transfer, card, check, cash, …)")
  .option("--reference <text>", "Payer reference / txn id / check number")
  .option("--note <text>", "Free-form note")
  .option("--json", "Emit JSON")
  .action((number, opts) => runInvoicesPay(number, opts));
invoices
  .command("payments")
  .description("List recorded payments (optionally for one invoice)")
  .option("--invoice <number>", "Filter to one invoice")
  .option("--json", "Emit JSON")
  .action((opts) => runPaymentsList(opts));
invoices
  .command("payment-delete <id>")
  .description("Delete a recorded payment by id (reopens the invoice if needed)")
  .option("--json", "Emit JSON")
  .action((id, opts) => runPaymentsDelete(id, opts));

// ───── local: expenses ─────
const expenses = program
  .command("expenses")
  .description("Track expenses and activity records (mileage, meetings, receipts)");
expenses
  .command("add [description]")
  .description("Log an expense or activity record. Amount/client/quantity are all optional.")
  .option("--date <YYYY-MM-DD>", "Date (default: today)")
  .option("--client <slug>", "Associate with a client (optional)")
  .option("--category <name>", "Category (e.g. mileage, meal, travel, meeting, software)")
  .option("--amount <n>", "Dollar amount")
  .option("--currency <code>", "Currency (defaults to config)")
  .option("--quantity <n>", "Quantity (e.g. miles driven)")
  .option("--unit <label>", "Unit label (miles, meals, etc.)")
  .option("--billable", "Flag to include on a future invoice")
  .option("--json", "Emit JSON")
  .action((description, opts) => runExpensesAdd(description, opts));
expenses
  .command("list")
  .description("List expenses + activity records")
  .option("--client <slug>", "Filter by client")
  .option("--from <YYYY-MM-DD>", "From date")
  .option("--to <YYYY-MM-DD>", "To date")
  .option("--category <name>", "Filter by category")
  .option("--unbilled", "Only unbilled rows")
  .option("--billable", "Only billable rows")
  .option("--with-amount", "Only rows with a dollar amount (expenses)")
  .option("--activity-only", "Only rows without a dollar amount (activity records)")
  .option("--json", "Emit JSON")
  .action((opts) => runExpensesList(opts));
expenses
  .command("get <id>")
  .description("Show one expense by id")
  .option("--json", "Emit JSON")
  .action((id, opts) => runExpensesGet(id, opts));
expenses
  .command("update <id>")
  .description("Update an expense")
  .option("--description <text>", "Description")
  .option("--date <YYYY-MM-DD>", "Date")
  .option("--client <slug>", "Reassign client (pass empty string to clear)")
  .option("--category <name>", "Category (pass empty string to clear)")
  .option("--amount <n>", "Dollar amount")
  .option("--clear-amount", "Drop the dollar amount (turn into pure activity record)")
  .option("--currency <code>", "Currency")
  .option("--quantity <n>", "Quantity")
  .option("--unit <label>", "Unit label")
  .option("--billable", "Mark billable")
  .option("--not-billable", "Mark not billable")
  .option("--json", "Emit JSON")
  .action((id, opts) => runExpensesUpdate(id, opts));
expenses
  .command("delete <id>")
  .description("Delete an expense")
  .option("--json", "Emit JSON")
  .action((id, opts) => runExpensesDelete(id, opts));

// ───── local: recurring invoices ─────
const recurring = program
  .command("recurring")
  .description("Recurring invoice templates (retainers, monthly subscriptions)");
recurring
  .command("add")
  .description("Create a recurring invoice template")
  .requiredOption("--client <slug>", "Client slug")
  .requiredOption("--cadence <name>", "weekly | monthly | quarterly | yearly")
  .requiredOption("--start <YYYY-MM-DD>", "First issue date")
  .option("--end <YYYY-MM-DD>", "Stop generating after this date")
  .option("--day <1-31>", "Day of month (for monthly/quarterly/yearly; defaults to start's day)")
  .option("--dow <0-6>", "Day of week 0=Sun (for weekly; defaults to start's weekday)")
  .option("--item <desc|qty|rate[|unit[|kind]]>", "Add a line item; repeat as needed", (val: string, prev: string[] = []) => [...prev, val])
  .option("--tax-rate <pct>", "Tax rate override")
  .option("--currency <code>", "Currency override")
  .option("--due-days <days>", "Days from issue to due")
  .option("--notes <text>", "Invoice notes")
  .option("--auto-send", "Mark generated invoices 'sent' immediately")
  .option("--paused", "Create in paused state (won't generate until resumed)")
  .option("--json", "Emit JSON")
  .action((opts) => runRecurringAdd(opts));
recurring
  .command("list")
  .description("List recurring invoice templates")
  .option("--client <slug>", "Filter by client")
  .option("--paused", "Only paused rows")
  .option("--active", "Only active rows")
  .option("--json", "Emit JSON")
  .action((opts) => runRecurringList(opts));
recurring
  .command("get <id>")
  .description("Show one recurring invoice template")
  .option("--json", "Emit JSON")
  .action((id, opts) => runRecurringGet(id, opts));
recurring
  .command("update <id>")
  .description("Update a recurring invoice template")
  .option("--cadence <name>", "weekly | monthly | quarterly | yearly")
  .option("--start <YYYY-MM-DD>", "Start date")
  .option("--end <YYYY-MM-DD>", "End date (pass empty string to clear)")
  .option("--day <1-31>", "Day of month")
  .option("--dow <0-6>", "Day of week")
  .option("--pause", "Pause this recurring")
  .option("--resume", "Resume this recurring")
  .option("--auto-send", "Mark generated invoices 'sent' immediately")
  .option("--no-auto-send", "Generate as draft (default)")
  .option("--next-issue <YYYY-MM-DD>", "Override the next issue date")
  .option("--json", "Emit JSON")
  .action((id, opts) => runRecurringUpdate(id, opts));
recurring
  .command("delete <id>")
  .description("Delete a recurring invoice template")
  .option("--json", "Emit JSON")
  .action((id, opts) => runRecurringDelete(id, opts));
recurring
  .command("run")
  .description("Materialize any recurring invoices whose next-issue date has passed")
  .option("--as-of <YYYY-MM-DD>", "Treat this date as 'today' (default: today)")
  .option("--json", "Emit JSON")
  .action((opts) => runRecurringRun(opts));
recurring
  .command("upcoming")
  .description("Preview the next N upcoming issuances")
  .option("--count <n>", "How many cycles forward to project", "3")
  .option("--client <slug>", "Filter by client")
  .option("--json", "Emit JSON")
  .action((opts) => runRecurringUpcoming(opts));

// ───── local: crm ─────
const crm = program.command("crm").description("Lightweight CRM — touchpoint notes and follow-ups");
crm
  .command("note")
  .description("Add a CRM note")
  .requiredOption("--client <slug>", "Client slug")
  .requiredOption("--body <text>", "Note body")
  .option("--date <YYYY-MM-DD>", "Date (default: today)")
  .option("--followup <YYYY-MM-DD>", "Followup date")
  .option("--json", "Emit JSON")
  .action((opts) => runCrmNote(opts));
crm
  .command("note-get <id>")
  .description("Show one CRM note by id")
  .option("--json", "Emit JSON")
  .action((id, opts) => runCrmNoteGet(id, opts));
crm
  .command("note-update <id>")
  .description("Edit a CRM note")
  .option("--client <slug>", "Reassign to another client")
  .option("--body <text>", "Body")
  .option("--date <YYYY-MM-DD>", "Date")
  .option("--followup <YYYY-MM-DD>", "Followup date")
  .option("--clear-followup", "Clear the followup date")
  .option("--json", "Emit JSON")
  .action((id, opts) => runCrmNoteUpdate(id, opts));
crm
  .command("note-delete <id>")
  .description("Delete a CRM note")
  .option("--json", "Emit JSON")
  .action((id, opts) => runCrmNoteDelete(id, opts));
crm
  .command("notes")
  .description("List CRM notes")
  .option("--client <slug>", "Filter by client")
  .option("--from <YYYY-MM-DD>", "From date")
  .option("--to <YYYY-MM-DD>", "To date")
  .option("--json", "Emit JSON")
  .action((opts) => runCrmNotes(opts));
crm
  .command("followups")
  .description("List clients due for follow-up")
  .option("--staleness <days>", "Days since last contact considered stale (default: 14)")
  .option("--due-by <YYYY-MM-DD>", "Include explicit followup_at <= this date")
  .option("--json", "Emit JSON")
  .action((opts) => runCrmFollowups(opts));

// ───── local: config ─────
const config = program.command("config").description("View and update local config");
config
  .command("show")
  .description("Print current config")
  .option("--json", "Emit JSON")
  .action((opts) => runConfigShow(opts));
config
  .command("set")
  .description("Update individual config fields")
  .option("--name <name>", "Business name")
  .option("--email <email>", "Business email")
  .option("--address <address>", "Address (pass empty string to clear)")
  .option("--city <city>", "City")
  .option("--phone <phone>", "Phone")
  .option("--logo <path>", "Logo path, data URI, or URL")
  .option("--tagline <text>", "Tagline shown next to business name on invoices")
  .option("--site <url>", "Website shown in the invoice footer")
  .option("--accent-color <css-color>", "Accent CSS color (e.g. 'oklch(0.55 0.13 175)')")
  .option(
    "--custom-instructions <text>",
    "Free-form invoice design notes (rendered as a comment in the output)",
  )
  .option("--rate <rate>", "Default hourly rate (default 100)")
  .option("--tax-rate <pct>", "Tax rate as percent")
  .option("--currency <code>", "Currency")
  .option("--due-days <days>", "Payment terms: days until an invoice is due, e.g. 14 or 30 (default 14)")
  .option("--payment-terms <text>", "Payment terms")
  .option("--invoice-template <path>", "Custom invoice template path")
  .option("--json", "Emit JSON")
  .action((opts) => runConfigSet(opts));

// ───── local: template ─────
const template = program.command("template").description("Manage the invoice template");
template
  .command("path")
  .description("Print the path to your user invoice template")
  .option("--json", "Emit JSON")
  .action((opts) => runTemplatePath(opts));
template
  .command("print")
  .description("Write the current user invoice template to stdout (bundled default if no user copy)")
  .option("--json", "Emit JSON")
  .action((opts) => runTemplatePrint(opts));
template
  .command("write")
  .description("Read new template HTML from stdin, validate, and replace the user copy atomically")
  .option("--json", "Emit JSON")
  .action((opts) => runTemplateWrite(opts));
template
  .command("reset")
  .description("Restore the user invoice template to the bundled default")
  .option("--force", "Overwrite an existing user copy without prompting")
  .option("--json", "Emit JSON")
  .action((opts) => runTemplateReset(opts));
template
  .command("show-default")
  .description("Print the bundled default invoice template to stdout")
  .action(() => runTemplateShowDefault());

// ───── local: report ─────
const report = program.command("report").description("Reports");
report
  .command("financial")
  .description("Financial summary (totals by status, revenue/outstanding by client)")
  .option("--from <YYYY-MM-DD>", "From date")
  .option("--to <YYYY-MM-DD>", "To date")
  .option("--json", "Emit JSON")
  .action((opts) => runReportFinancial(opts));

// ───── local: export / import ─────
program
  .command("export")
  .description("Export the local store to JSON (default) or CSV files")
  .option("--csv", "Write one CSV per table to a directory (no import support)")
  .option("--output <path>", "Output file (JSON) or directory (CSV)")
  .option("--json", "Emit JSON to stdout instead of a status line")
  .action((opts) => runExport(opts));

program
  .command("import <file>")
  .description("Restore from a JSON snapshot. Default mode: merge.")
  .option("--mode <mode>", "merge (insert new rows only) | replace (wipe first)", "merge")
  .option("--force", "Required with --mode replace; wipes ALL existing data first")
  .option("--json", "Emit JSON")
  .action((file, opts) => runImport(file, opts));

await program.parseAsync(process.argv);
