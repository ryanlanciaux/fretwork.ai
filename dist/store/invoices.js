import { and, asc, desc, eq, inArray, like } from "drizzle-orm";
import { invoices as invoicesTable, invoiceLineItems as lineItemsTable, } from "./db/schema.js";
import { openDb, rawSqlite } from "./db/client.js";
import { requireClient } from "./clients.js";
import { getConfig } from "./config.js";
import { listTimeEntries, markEntriesBilled, unmarkEntriesByInvoice } from "./time.js";
import { listPayments, paymentsTotalFor, paymentTotalsByInvoiceId } from "./payments.js";
import { addDaysIso, diffDaysIso, isIsoDate, newId, round2, todayIso } from "./util.js";
function rowToInvoice(row, amountPaid = 0) {
    const paid = round2(amountPaid);
    return {
        id: row.id,
        number: row.number,
        clientSlug: row.clientSlug,
        status: row.status,
        issuedAt: row.issuedAt,
        dueAt: row.dueAt,
        subtotal: row.subtotal,
        taxRate: row.taxRate,
        tax: row.tax,
        total: row.total,
        currency: row.currency,
        notes: row.notes,
        sentAt: row.sentAt,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        amountPaid: paid,
        balanceDue: round2(Math.max(0, row.total - paid)),
    };
}
function rowToLineItem(row) {
    return {
        id: row.id,
        invoiceId: row.invoiceId,
        description: row.description,
        unitLabel: row.unitLabel,
        quantity: row.quantity,
        rate: row.rate,
        amount: row.amount,
        sortOrder: row.sortOrder,
        kind: normalizeLineItemKind(row.kind),
    };
}
function normalizeLineItemKind(raw) {
    if (raw === "hours" || raw === "weekly" || raw === "flat" || raw === "expense" || raw === "subscription") {
        return raw;
    }
    return null;
}
export function generateInvoiceNumber(year = new Date().getUTCFullYear()) {
    const db = openDb();
    const prefix = `INV-${year}-`;
    const rows = db
        .select({ number: invoicesTable.number })
        .from(invoicesTable)
        .where(like(invoicesTable.number, `${prefix}%`))
        .all();
    let max = 0;
    for (const r of rows) {
        const n = parseInt(r.number.slice(prefix.length), 10);
        if (!Number.isNaN(n) && n > max)
            max = n;
    }
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
}
export function listInvoices(opts = {}) {
    const db = openDb();
    const conds = [];
    if (opts.client) {
        const c = requireClient(opts.client);
        conds.push(eq(invoicesTable.clientSlug, c.slug));
    }
    if (opts.status) {
        const list = Array.isArray(opts.status) ? opts.status : [opts.status];
        if (list.length === 1) {
            conds.push(eq(invoicesTable.status, list[0]));
        }
        else {
            conds.push(inArray(invoicesTable.status, list));
        }
    }
    const rows = (conds.length > 0 ? db.select().from(invoicesTable).where(and(...conds)) : db.select().from(invoicesTable))
        .orderBy(desc(invoicesTable.issuedAt), desc(invoicesTable.createdAt))
        .all();
    const paidByInvoice = paymentTotalsByInvoiceId();
    return rows.map((r) => rowToInvoice(r, paidByInvoice.get(r.id) ?? 0));
}
export function getInvoice(numberOrId) {
    const db = openDb();
    const byNumber = db.select().from(invoicesTable).where(eq(invoicesTable.number, numberOrId)).all();
    const row = byNumber[0] ?? db.select().from(invoicesTable).where(eq(invoicesTable.id, numberOrId)).all()[0];
    if (!row)
        return null;
    const items = db
        .select()
        .from(lineItemsTable)
        .where(eq(lineItemsTable.invoiceId, row.id))
        .orderBy(asc(lineItemsTable.sortOrder))
        .all();
    return {
        ...rowToInvoice(row, paymentsTotalFor(row.id)),
        lineItems: items.map(rowToLineItem),
        payments: listPayments(row.number),
    };
}
export function requireInvoice(numberOrId) {
    const inv = getInvoice(numberOrId);
    if (!inv)
        throw new Error(`Invoice not found: ${numberOrId}`);
    return inv;
}
export function createInvoice(input) {
    const cfg = getConfig();
    const client = requireClient(input.client);
    const issuedAt = input.issuedAt ?? todayIso();
    if (!isIsoDate(issuedAt))
        throw new Error(`issuedAt must be YYYY-MM-DD`);
    const dueAt = input.dueAt ?? addDaysIso(issuedAt, cfg.dueDays);
    if (!isIsoDate(dueAt))
        throw new Error(`dueAt must be YYYY-MM-DD`);
    const taxRate = input.taxRate ?? cfg.taxRate;
    const currency = input.currency ?? cfg.currency;
    const number = input.number ?? generateInvoiceNumber();
    // Build line items: from explicit list AND/OR from a time range.
    const items = [];
    const billedEntryIds = [];
    if (input.fromTimeRange) {
        const entries = listTimeEntries({
            client: client.slug,
            from: input.fromTimeRange.from,
            to: input.fromTimeRange.to,
            unbilled: true,
        });
        for (const e of entries) {
            const rate = e.rate ?? client.defaultRate ?? cfg.defaultRate;
            const desc = (e.description?.split("\n")[0]?.trim() || "") ||
                (e.project ? `${e.project} — ${e.date}` : `Work on ${e.date}`);
            items.push({
                description: desc,
                unitLabel: "hours",
                quantity: round2(e.hours),
                rate: round2(rate),
                amount: round2(e.hours * rate),
                kind: "hours",
            });
            billedEntryIds.push(e.id);
        }
    }
    if (input.lineItems) {
        for (const li of input.lineItems) {
            items.push({
                description: li.description,
                unitLabel: li.unitLabel ?? null,
                quantity: round2(li.quantity),
                rate: round2(li.rate),
                amount: round2(li.quantity * li.rate),
                kind: li.kind ?? null,
            });
        }
    }
    if (items.length === 0) {
        throw new Error("Cannot create an invoice with no line items. Pass fromTimeRange or lineItems.");
    }
    const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
    const tax = round2(subtotal * (taxRate / 100));
    const total = round2(subtotal + tax);
    const db = openDb();
    const sqlite = rawSqlite();
    const now = Date.now();
    const id = newId();
    const tx = sqlite.transaction(() => {
        db.insert(invoicesTable)
            .values({
            id,
            number,
            clientSlug: client.slug,
            status: "draft",
            issuedAt,
            dueAt,
            subtotal,
            taxRate,
            tax,
            total,
            currency,
            notes: input.notes ?? null,
            sentAt: null,
            paidAt: null,
            createdAt: now,
            updatedAt: now,
        })
            .run();
        items.forEach((it, idx) => {
            db.insert(lineItemsTable)
                .values({
                id: newId(),
                invoiceId: id,
                description: it.description,
                unitLabel: it.unitLabel,
                quantity: it.quantity,
                rate: it.rate,
                amount: it.amount,
                sortOrder: idx,
                kind: it.kind,
            })
                .run();
        });
        if (billedEntryIds.length > 0)
            markEntriesBilled(billedEntryIds, number);
    });
    tx();
    return requireInvoice(number);
}
export function updateInvoice(numberOrId, patch) {
    const cur = requireInvoice(numberOrId);
    if (cur.status === "paid" || cur.status === "void") {
        throw new Error(`Cannot edit an invoice in status '${cur.status}'.`);
    }
    const db = openDb();
    const nextTaxRate = patch.taxRate ?? cur.taxRate;
    const nextTax = round2(cur.subtotal * (nextTaxRate / 100));
    const nextTotal = round2(cur.subtotal + nextTax);
    const now = Date.now();
    db.update(invoicesTable)
        .set({
        issuedAt: patch.issuedAt ?? cur.issuedAt,
        dueAt: patch.dueAt ?? cur.dueAt,
        taxRate: nextTaxRate,
        tax: nextTax,
        total: nextTotal,
        currency: patch.currency ?? cur.currency,
        notes: patch.notes === undefined ? cur.notes : patch.notes,
        updatedAt: now,
    })
        .where(eq(invoicesTable.id, cur.id))
        .run();
    return requireInvoice(cur.number);
}
export function setInvoiceStatus(numberOrId, status) {
    const cur = requireInvoice(numberOrId);
    const db = openDb();
    const now = Date.now();
    const sentAt = status === "sent" && !cur.sentAt ? now : cur.sentAt;
    const paidAt = status === "paid" ? now : status === "draft" || status === "void" ? null : cur.paidAt;
    db.update(invoicesTable)
        .set({ status, sentAt, paidAt, updatedAt: now })
        .where(eq(invoicesTable.id, cur.id))
        .run();
    return requireInvoice(cur.number);
}
// Returns invoices that are past their dueAt and not yet paid/void/draft.
// Includes both `sent` invoices (which haven't been reconciled yet) and
// invoices already flagged `overdue`. Sorted by daysOverdue desc.
export function listOverdueInvoices(opts = {}) {
    const asOf = opts.asOf ?? todayIso();
    if (!isIsoDate(asOf))
        throw new Error(`asOf must be YYYY-MM-DD (got: ${asOf})`);
    const candidates = listInvoices({ status: ["sent", "overdue"] });
    const out = [];
    for (const inv of candidates) {
        if (inv.paidAt)
            continue;
        if (inv.dueAt >= asOf)
            continue;
        out.push({ ...inv, daysOverdue: diffDaysIso(inv.dueAt, asOf) });
    }
    out.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return out;
}
// Promote `sent` invoices past their due date to `overdue`. Returns the
// set that was updated plus those already in overdue (so callers can
// quote a single summary). Safe to call repeatedly.
export function reconcileOverdueInvoices(opts = {}) {
    const asOf = opts.asOf ?? todayIso();
    const due = listOverdueInvoices({ asOf });
    const updated = [];
    const alreadyOverdue = [];
    for (const inv of due) {
        if (inv.status === "overdue") {
            alreadyOverdue.push(inv);
            continue;
        }
        const next = setInvoiceStatus(inv.number, "overdue");
        updated.push(next);
    }
    return { updated, alreadyOverdue };
}
export function deleteInvoice(numberOrId) {
    const cur = requireInvoice(numberOrId);
    const sqlite = rawSqlite();
    const tx = sqlite.transaction(() => {
        unmarkEntriesByInvoice(cur.number);
        const db = openDb();
        // Cascade handles line items via FK ON DELETE CASCADE.
        db.delete(invoicesTable).where(eq(invoicesTable.id, cur.id)).run();
    });
    tx();
}
