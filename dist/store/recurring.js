import { and, asc, eq, lte } from "drizzle-orm";
import { recurringInvoices as recurringTable } from "./db/schema.js";
import { openDb, rawSqlite } from "./db/client.js";
import { requireClient } from "./clients.js";
import { createInvoice, setInvoiceStatus } from "./invoices.js";
import { addDaysIso, addMonthsIso, isIsoDate, newId, todayIso } from "./util.js";
const CADENCES = ["weekly", "monthly", "quarterly", "yearly"];
function isCadence(s) {
    return CADENCES.includes(s);
}
function parseTemplate(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Recurring template is not valid JSON: ${raw.slice(0, 80)}`);
    }
    if (!parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.lineItems)) {
        throw new Error("Recurring template must have a lineItems array");
    }
    return parsed;
}
function rowToRecurring(row) {
    return {
        id: row.id,
        clientSlug: row.clientSlug,
        cadence: row.cadence,
        dayOfMonth: row.dayOfMonth,
        dayOfWeek: row.dayOfWeek,
        startDate: row.startDate,
        endDate: row.endDate,
        active: row.active,
        autoSend: row.autoSend,
        template: parseTemplate(row.template),
        lastGeneratedAt: row.lastGeneratedAt,
        lastInvoiceNumber: row.lastInvoiceNumber,
        nextIssueAt: row.nextIssueAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
// Advance a date by one cadence cycle, preserving the canonical
// day-of-month for monthly/quarterly/yearly (so an "always on the 31st"
// recurring lands on Feb 28, not March 3).
export function advanceCadence(iso, cadence, dayOfMonth) {
    if (cadence === "weekly")
        return addDaysIso(iso, 7);
    const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
    const baseDay = dayOfMonth ?? Number(iso.slice(8, 10));
    // Walk forward one cadence-step from the current date, then realign to
    // the canonical dayOfMonth (clamped to the new month's length).
    const advanced = addMonthsIso(iso, months);
    const year = Number(advanced.slice(0, 4));
    const month = Number(advanced.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(baseDay, lastDay);
    return `${advanced.slice(0, 7)}-${String(day).padStart(2, "0")}`;
}
function validateRecurring(input) {
    if (!isCadence(input.cadence)) {
        throw new Error(`Invalid cadence: ${input.cadence}. Use one of ${CADENCES.join(", ")}`);
    }
    if (!isIsoDate(input.startDate)) {
        throw new Error(`startDate must be YYYY-MM-DD (got: ${input.startDate})`);
    }
    if (input.endDate && !isIsoDate(input.endDate)) {
        throw new Error(`endDate must be YYYY-MM-DD (got: ${input.endDate})`);
    }
    if (input.endDate && input.endDate < input.startDate) {
        throw new Error("endDate must be >= startDate");
    }
    if (input.cadence === "weekly") {
        if (input.dayOfWeek != null && (input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
            throw new Error("dayOfWeek must be 0-6 (0=Sunday)");
        }
    }
    else {
        if (input.dayOfMonth != null && (input.dayOfMonth < 1 || input.dayOfMonth > 31)) {
            throw new Error("dayOfMonth must be 1-31");
        }
    }
}
export function addRecurringInvoice(input) {
    validateRecurring(input);
    const client = requireClient(input.client);
    if (!input.template || !Array.isArray(input.template.lineItems) || input.template.lineItems.length === 0) {
        throw new Error("template.lineItems must be a non-empty array");
    }
    const dayOfMonth = input.cadence === "weekly"
        ? null
        : input.dayOfMonth ?? Number(input.startDate.slice(8, 10));
    const dayOfWeek = input.cadence === "weekly"
        ? input.dayOfWeek ?? new Date(input.startDate + "T00:00:00Z").getUTCDay()
        : null;
    const db = openDb();
    const now = Date.now();
    const id = newId();
    db.insert(recurringTable)
        .values({
        id,
        clientSlug: client.slug,
        cadence: input.cadence,
        dayOfMonth,
        dayOfWeek,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        active: input.active ?? true,
        autoSend: input.autoSend ?? false,
        template: JSON.stringify(input.template),
        lastGeneratedAt: null,
        lastInvoiceNumber: null,
        nextIssueAt: input.startDate,
        createdAt: now,
        updatedAt: now,
    })
        .run();
    return requireRecurringInvoice(id);
}
export function getRecurringInvoice(id) {
    const db = openDb();
    const row = db.select().from(recurringTable).where(eq(recurringTable.id, id)).all()[0];
    return row ? rowToRecurring(row) : null;
}
export function requireRecurringInvoice(id) {
    const r = getRecurringInvoice(id);
    if (!r)
        throw new Error(`Recurring invoice not found: ${id}`);
    return r;
}
export function listRecurringInvoices(filter = {}) {
    const db = openDb();
    const conds = [];
    if (filter.client) {
        const c = requireClient(filter.client);
        conds.push(eq(recurringTable.clientSlug, c.slug));
    }
    if (filter.active !== undefined) {
        conds.push(eq(recurringTable.active, filter.active));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = (where ? db.select().from(recurringTable).where(where) : db.select().from(recurringTable))
        .orderBy(asc(recurringTable.nextIssueAt))
        .all();
    return rows.map(rowToRecurring);
}
export function updateRecurringInvoice(id, patch) {
    const cur = requireRecurringInvoice(id);
    validateRecurring({
        cadence: patch.cadence ?? cur.cadence,
        startDate: patch.startDate ?? cur.startDate,
        endDate: patch.endDate === undefined ? cur.endDate : patch.endDate,
        dayOfMonth: patch.dayOfMonth === undefined ? cur.dayOfMonth : patch.dayOfMonth,
        dayOfWeek: patch.dayOfWeek === undefined ? cur.dayOfWeek : patch.dayOfWeek,
    });
    if (patch.template && (!Array.isArray(patch.template.lineItems) || patch.template.lineItems.length === 0)) {
        throw new Error("template.lineItems must be a non-empty array");
    }
    if (patch.nextIssueAt && !isIsoDate(patch.nextIssueAt)) {
        throw new Error(`nextIssueAt must be YYYY-MM-DD (got: ${patch.nextIssueAt})`);
    }
    const db = openDb();
    const now = Date.now();
    db.update(recurringTable)
        .set({
        cadence: patch.cadence ?? cur.cadence,
        dayOfMonth: patch.dayOfMonth === undefined ? cur.dayOfMonth : patch.dayOfMonth,
        dayOfWeek: patch.dayOfWeek === undefined ? cur.dayOfWeek : patch.dayOfWeek,
        startDate: patch.startDate ?? cur.startDate,
        endDate: patch.endDate === undefined ? cur.endDate : patch.endDate,
        active: patch.active === undefined ? cur.active : patch.active,
        autoSend: patch.autoSend === undefined ? cur.autoSend : patch.autoSend,
        template: JSON.stringify(patch.template ?? cur.template),
        nextIssueAt: patch.nextIssueAt ?? cur.nextIssueAt,
        updatedAt: now,
    })
        .where(eq(recurringTable.id, id))
        .run();
    return requireRecurringInvoice(id);
}
export function deleteRecurringInvoice(id) {
    const existing = requireRecurringInvoice(id);
    const db = openDb();
    db.delete(recurringTable).where(eq(recurringTable.id, id)).run();
    return existing;
}
// Materialize every active recurring whose nextIssueAt is at or before
// `asOf`. Idempotent: each generation advances nextIssueAt by one cadence
// step, so calling run() again the same day finds nothing new. When a
// row has multiple cycles behind (e.g. user hasn't run for 3 months),
// only ONE invoice is generated per call — caller should re-run until
// generated is empty if they want full catch-up. (Keeps each run bounded
// and lets the user inspect between batches.)
export function runRecurringInvoices(opts = {}) {
    const asOf = opts.asOf ?? todayIso();
    if (!isIsoDate(asOf))
        throw new Error(`asOf must be YYYY-MM-DD (got: ${asOf})`);
    const db = openDb();
    const sqlite = rawSqlite();
    const dueRows = db
        .select()
        .from(recurringTable)
        .where(and(eq(recurringTable.active, true), lte(recurringTable.nextIssueAt, asOf)))
        .all();
    const generated = [];
    const skipped = [];
    for (const row of dueRows) {
        const r = rowToRecurring(row);
        if (r.endDate && r.nextIssueAt > r.endDate) {
            skipped.push({ recurringId: r.id, reason: `past endDate ${r.endDate}` });
            continue;
        }
        try {
            const tx = sqlite.transaction(() => {
                const inv = createInvoice({
                    client: r.clientSlug,
                    issuedAt: r.nextIssueAt,
                    taxRate: r.template.taxRate,
                    currency: r.template.currency,
                    notes: r.template.notes,
                    ...(r.template.dueDays !== undefined
                        ? { dueAt: addDaysIso(r.nextIssueAt, r.template.dueDays) }
                        : {}),
                    lineItems: r.template.lineItems,
                });
                if (r.autoSend)
                    setInvoiceStatus(inv.number, "sent");
                const next = advanceCadence(r.nextIssueAt, r.cadence, r.dayOfMonth);
                db.update(recurringTable)
                    .set({
                    lastGeneratedAt: r.nextIssueAt,
                    lastInvoiceNumber: inv.number,
                    nextIssueAt: next,
                    active: r.endDate && next > r.endDate ? false : r.active,
                    updatedAt: Date.now(),
                })
                    .where(eq(recurringTable.id, r.id))
                    .run();
                return inv;
            });
            const inv = tx();
            generated.push({
                recurringId: r.id,
                invoiceNumber: inv.number,
                clientSlug: inv.clientSlug,
                issuedAt: inv.issuedAt,
                total: inv.total,
            });
        }
        catch (e) {
            skipped.push({
                recurringId: r.id,
                reason: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return { generated, skipped, asOf };
}
// Project the next N issuances for every active recurring (or just the
// listed ids). Read-only — doesn't mutate state.
export function upcomingRecurringInvoices(opts = {}) {
    const count = opts.count ?? 3;
    const rows = listRecurringInvoices({ client: opts.client, active: true });
    return rows.map((r) => {
        const upcoming = [];
        let cursor = r.nextIssueAt;
        for (let i = 0; i < count; i++) {
            if (r.endDate && cursor > r.endDate)
                break;
            upcoming.push(cursor);
            cursor = advanceCadence(cursor, r.cadence, r.dayOfMonth);
        }
        return { recurring: r, upcoming };
    });
}
