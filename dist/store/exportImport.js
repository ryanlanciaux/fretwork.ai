import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clients as clientsTable, config as configTable, crmNotes as crmNotesTable, expenses as expensesTable, invoices as invoicesTable, invoiceLineItems as lineItemsTable, payments as paymentsTable, recurringInvoices as recurringTable, timeEntries as timeEntriesTable, } from "./db/schema.js";
import { fretworkHome, openDb, rawSqlite } from "./db/client.js";
// Bump this when the snapshot shape changes in a non-backwards-compatible
// way. importSnapshot() refuses unknown major versions.
export const SNAPSHOT_VERSION = 1;
export function exportSnapshot() {
    const db = openDb();
    return {
        version: SNAPSHOT_VERSION,
        exportedAt: new Date().toISOString(),
        config: db.select().from(configTable).all(),
        clients: db.select().from(clientsTable).all(),
        timeEntries: db.select().from(timeEntriesTable).all(),
        expenses: db.select().from(expensesTable).all(),
        invoices: db.select().from(invoicesTable).all(),
        invoiceLineItems: db.select().from(lineItemsTable).all(),
        payments: db.select().from(paymentsTable).all(),
        recurringInvoices: db.select().from(recurringTable).all(),
        crmNotes: db.select().from(crmNotesTable).all(),
    };
}
// Replace: wipe every table then re-insert everything in the snapshot.
// Merge: insert rows whose primary key doesn't already exist; skip the rest.
// FK order matters — clients before time/expenses/invoices/crm/recurring,
// invoices before line items.
const ORDER = [
    { name: "clients", table: clientsTable, pk: "id" },
    { name: "config", table: configTable, pk: "id" },
    { name: "timeEntries", table: timeEntriesTable, pk: "id" },
    { name: "expenses", table: expensesTable, pk: "id" },
    { name: "invoices", table: invoicesTable, pk: "id" },
    { name: "invoiceLineItems", table: lineItemsTable, pk: "id" },
    { name: "payments", table: paymentsTable, pk: "id" },
    { name: "recurringInvoices", table: recurringTable, pk: "id" },
    { name: "crmNotes", table: crmNotesTable, pk: "id" },
];
const TABLE_NAMES_SQL = {
    clients: "clients",
    config: "config",
    timeEntries: "time_entries",
    expenses: "expenses",
    invoices: "invoices",
    invoiceLineItems: "invoice_line_items",
    payments: "payments",
    recurringInvoices: "recurring_invoices",
    crmNotes: "crm_notes",
    // active_timer is excluded — it's ephemeral runtime state.
};
export function importSnapshot(snapshot, opts = {}) {
    const mode = opts.mode ?? "merge";
    if (!snapshot || typeof snapshot !== "object") {
        throw new Error("snapshot must be an object");
    }
    if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error(`Snapshot version ${snapshot.version} cannot be imported by this version ` +
            `(expected ${SNAPSHOT_VERSION}).`);
    }
    const db = openDb();
    const sqlite = rawSqlite();
    const inserted = {};
    const skipped = {};
    const errors = [];
    // A replace is the one operation that can destroy everything in a single
    // call, so always snapshot first — regardless of what the caller was told.
    let backupPath = null;
    if (mode === "replace") {
        const dir = join(fretworkHome(), "backups");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        backupPath = join(dir, `pre-replace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        writeFileSync(backupPath, JSON.stringify(exportSnapshot(), null, 2), { mode: 0o600 });
    }
    const tx = sqlite.transaction(() => {
        if (mode === "replace") {
            // Wipe in reverse FK order. active_timer also cleared to avoid
            // dangling client references.
            sqlite.exec("DELETE FROM active_timer");
            for (let i = ORDER.length - 1; i >= 0; i--) {
                sqlite.exec(`DELETE FROM ${TABLE_NAMES_SQL[ORDER[i].name]}`);
            }
        }
        for (const { name, table, pk } of ORDER) {
            const rows = snapshot[name] ?? [];
            let ins = 0;
            let skip = 0;
            for (const row of rows) {
                try {
                    if (mode === "merge") {
                        const id = row[pk];
                        const sqlName = TABLE_NAMES_SQL[name];
                        const existing = sqlite
                            .prepare(`SELECT 1 FROM ${sqlName} WHERE ${pk} = ?`)
                            .get(id);
                        if (existing) {
                            skip += 1;
                            continue;
                        }
                    }
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    db.insert(table).values(row).run();
                    ins += 1;
                }
                catch (e) {
                    errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
            inserted[name] = ins;
            skipped[name] = skip;
        }
    });
    tx();
    return { mode, backupPath, inserted, skipped, errors };
}
// CSV writer. Best-effort — quotes fields containing commas/quotes/newlines.
// One file per table; caller passes a directory.
export function snapshotToCsvFiles(snapshot) {
    const files = {};
    for (const { name } of ORDER) {
        const rows = snapshot[name] ?? [];
        files[`${TABLE_NAMES_SQL[name]}.csv`] = rowsToCsv(rows);
    }
    return files;
}
function rowsToCsv(rows) {
    if (rows.length === 0)
        return "";
    const cols = Object.keys(rows[0]);
    const escape = (v) => {
        if (v == null)
            return "";
        const s = String(v);
        if (/[",\n\r]/.test(s))
            return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [cols.join(",")];
    for (const r of rows)
        lines.push(cols.map((c) => escape(r[c])).join(","));
    return lines.join("\n") + "\n";
}
