import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { timeEntries as timeTable } from "./db/schema.js";
import { openDb } from "./db/client.js";
import { requireClient } from "./clients.js";
import { getConfig } from "./config.js";
import { isIsoDate, newId, round2, todayIso } from "./util.js";
function rowToTime(row) {
    return {
        id: row.id,
        clientSlug: row.clientSlug,
        project: row.project,
        date: row.date,
        hours: row.hours,
        rate: row.rate,
        description: row.description,
        billed: row.billed,
        invoiceNumber: row.invoiceNumber,
        createdAt: row.createdAt,
    };
}
export function logTime(input) {
    if (input.hours <= 0)
        throw new Error("hours must be > 0");
    const date = input.date ?? todayIso();
    if (!isIsoDate(date))
        throw new Error(`date must be YYYY-MM-DD (got: ${date})`);
    const client = requireClient(input.client);
    const db = openDb();
    const now = Date.now();
    const id = newId();
    db.insert(timeTable)
        .values({
        id,
        clientSlug: client.slug,
        project: input.project ?? null,
        date,
        hours: round2(input.hours),
        rate: input.rate ?? client.defaultRate ?? null,
        description: input.description ?? "",
        billed: false,
        invoiceNumber: null,
        createdAt: now,
    })
        .run();
    const row = db.select().from(timeTable).where(eq(timeTable.id, id)).all()[0];
    return rowToTime(row);
}
export function listTimeEntries(filter = {}) {
    const db = openDb();
    const conditions = [];
    if (filter.client) {
        const c = requireClient(filter.client);
        conditions.push(eq(timeTable.clientSlug, c.slug));
    }
    if (filter.from) {
        if (!isIsoDate(filter.from))
            throw new Error(`from must be YYYY-MM-DD (got: ${filter.from})`);
        conditions.push(gte(timeTable.date, filter.from));
    }
    if (filter.to) {
        if (!isIsoDate(filter.to))
            throw new Error(`to must be YYYY-MM-DD (got: ${filter.to})`);
        conditions.push(lte(timeTable.date, filter.to));
    }
    if (filter.unbilled) {
        conditions.push(eq(timeTable.billed, false));
    }
    if (filter.project) {
        conditions.push(eq(timeTable.project, filter.project));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = (where ? db.select().from(timeTable).where(where) : db.select().from(timeTable))
        .orderBy(desc(timeTable.date), asc(timeTable.createdAt))
        .all();
    return rows.map(rowToTime);
}
export function summariseTime(filter = {}) {
    const entries = listTimeEntries(filter);
    const cfg = getConfig();
    const map = new Map();
    for (const e of entries) {
        const cur = map.get(e.clientSlug) ?? {
            client: e.clientSlug,
            hours: 0,
            unbilledHours: 0,
            entries: 0,
            revenue: 0,
        };
        cur.hours = round2(cur.hours + e.hours);
        if (!e.billed)
            cur.unbilledHours = round2(cur.unbilledHours + e.hours);
        cur.entries += 1;
        cur.revenue = round2(cur.revenue + e.hours * (e.rate ?? cfg.defaultRate));
        map.set(e.clientSlug, cur);
    }
    return [...map.values()].sort((a, b) => b.hours - a.hours);
}
export function getTimeEntry(id) {
    const db = openDb();
    const row = db.select().from(timeTable).where(eq(timeTable.id, id)).all()[0];
    return row ? rowToTime(row) : null;
}
export function requireTimeEntry(id) {
    const e = getTimeEntry(id);
    if (!e)
        throw new Error(`Time entry not found: ${id}`);
    return e;
}
// Edit a single time entry. Refuses to touch entries that are already on an
// invoice — the user must delete the invoice (which releases its entries
// back to unbilled) before editing. This keeps invoice totals consistent
// without us having to recalculate them on every edit.
export function updateTimeEntry(id, patch) {
    const cur = requireTimeEntry(id);
    if (cur.billed) {
        throw new Error(`Time entry ${id} is on invoice ${cur.invoiceNumber}. Delete that invoice ` +
            `first if you need to edit this entry (delete releases entries back to unbilled).`);
    }
    if (patch.hours !== undefined && (!Number.isFinite(patch.hours) || patch.hours <= 0)) {
        throw new Error("hours must be > 0");
    }
    if (patch.date !== undefined && !isIsoDate(patch.date)) {
        throw new Error(`date must be YYYY-MM-DD (got: ${patch.date})`);
    }
    const clientSlug = patch.client === undefined ? cur.clientSlug : requireClient(patch.client).slug;
    const db = openDb();
    db.update(timeTable)
        .set({
        clientSlug,
        date: patch.date ?? cur.date,
        hours: patch.hours === undefined ? cur.hours : round2(patch.hours),
        rate: patch.rate === undefined ? cur.rate : patch.rate,
        project: patch.project === undefined ? cur.project : patch.project,
        description: patch.description === undefined ? cur.description : patch.description,
    })
        .where(eq(timeTable.id, id))
        .run();
    return requireTimeEntry(id);
}
export function deleteTimeEntry(id) {
    const cur = requireTimeEntry(id);
    if (cur.billed) {
        throw new Error(`Time entry ${id} is on invoice ${cur.invoiceNumber}. Delete the invoice ` +
            `first — that releases its entries back to unbilled and lets you delete this one.`);
    }
    const db = openDb();
    db.delete(timeTable).where(eq(timeTable.id, id)).run();
    return cur;
}
// Internal: used by invoice creation when binding entries to an invoice.
export function markEntriesBilled(entryIds, invoiceNumber) {
    if (entryIds.length === 0)
        return;
    const db = openDb();
    const stmt = db
        .update(timeTable)
        .set({ billed: true, invoiceNumber })
        .where(eq(timeTable.id, "__placeholder__"));
    // Run individually to avoid a dynamic IN clause; volume is small per invoice.
    for (const id of entryIds) {
        db.update(timeTable)
            .set({ billed: true, invoiceNumber })
            .where(eq(timeTable.id, id))
            .run();
    }
    void stmt;
}
// Internal: used by invoice deletion to release entries.
export function unmarkEntriesByInvoice(invoiceNumber) {
    const db = openDb();
    db.update(timeTable)
        .set({ billed: false, invoiceNumber: null })
        .where(eq(timeTable.invoiceNumber, invoiceNumber))
        .run();
}
