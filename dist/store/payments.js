import { asc, desc, eq, sql } from "drizzle-orm";
import { invoices as invoicesTable, payments as paymentsTable } from "./db/schema.js";
import { openDb, rawSqlite } from "./db/client.js";
import { isIsoDate, newId, round2, todayIso } from "./util.js";
// This module is intentionally free of any import from ./invoices so the two
// stay acyclic: invoices.ts imports the balance helpers from here. Payment
// recording does its own (small) invoice-row lookup and status flip directly.
function rowToPayment(row) {
    return {
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        date: row.date,
        amount: row.amount,
        method: row.method,
        reference: row.reference,
        note: row.note,
        createdAt: row.createdAt,
    };
}
// Total payments per invoice id, for batch attachment in listInvoices.
export function paymentTotalsByInvoiceId() {
    const db = openDb();
    const rows = db
        .select({
        invoiceId: paymentsTable.invoiceId,
        total: sql `coalesce(sum(${paymentsTable.amount}), 0)`,
    })
        .from(paymentsTable)
        .groupBy(paymentsTable.invoiceId)
        .all();
    const out = new Map();
    for (const r of rows)
        out.set(r.invoiceId, round2(r.total));
    return out;
}
export function paymentsTotalFor(invoiceId) {
    const db = openDb();
    const row = db
        .select({ total: sql `coalesce(sum(${paymentsTable.amount}), 0)` })
        .from(paymentsTable)
        .where(eq(paymentsTable.invoiceId, invoiceId))
        .all()[0];
    return round2(row?.total ?? 0);
}
export function listPayments(invoiceNumberOrId) {
    const db = openDb();
    if (!invoiceNumberOrId) {
        return db
            .select()
            .from(paymentsTable)
            .orderBy(desc(paymentsTable.date), desc(paymentsTable.createdAt))
            .all()
            .map(rowToPayment);
    }
    const inv = findInvoiceRow(invoiceNumberOrId);
    if (!inv)
        throw new Error(`Invoice not found: ${invoiceNumberOrId}`);
    return db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.invoiceId, inv.id))
        .orderBy(asc(paymentsTable.date), asc(paymentsTable.createdAt))
        .all()
        .map(rowToPayment);
}
export function getPayment(id) {
    const db = openDb();
    const row = db.select().from(paymentsTable).where(eq(paymentsTable.id, id)).all()[0];
    return row ? rowToPayment(row) : null;
}
export function requirePayment(id) {
    const p = getPayment(id);
    if (!p)
        throw new Error(`Payment not found: ${id}`);
    return p;
}
export function recordPayment(input) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new Error("Payment amount must be a positive number.");
    }
    const date = input.date ?? todayIso();
    if (!isIsoDate(date))
        throw new Error("date must be YYYY-MM-DD");
    const inv = findInvoiceRow(input.invoice);
    if (!inv)
        throw new Error(`Invoice not found: ${input.invoice}`);
    if (inv.status === "void") {
        throw new Error(`Cannot record a payment against a void invoice (${inv.number}).`);
    }
    const amount = round2(input.amount);
    const db = openDb();
    const sqlite = rawSqlite();
    const now = Date.now();
    const payment = {
        id: newId(),
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        date,
        amount,
        method: input.method ?? null,
        reference: input.reference ?? null,
        note: input.note ?? null,
        createdAt: now,
    };
    let amountPaid = 0;
    const tx = sqlite.transaction(() => {
        db.insert(paymentsTable).values(payment).run();
        amountPaid = paymentsTotalFor(inv.id);
        // Flip to paid once payments cover the total (small epsilon for float
        // rounding). Leave any other status alone — a partially-paid invoice
        // stays sent/overdue so it still shows up in overdue reconciliation.
        if (amountPaid + 0.005 >= inv.total && inv.status !== "paid") {
            db.update(invoicesTable)
                .set({ status: "paid", paidAt: now, updatedAt: now })
                .where(eq(invoicesTable.id, inv.id))
                .run();
        }
        else {
            db.update(invoicesTable).set({ updatedAt: now }).where(eq(invoicesTable.id, inv.id)).run();
        }
    });
    tx();
    const fullyPaid = amountPaid + 0.005 >= inv.total;
    return {
        payment,
        invoiceNumber: inv.number,
        status: fullyPaid ? "paid" : inv.status,
        total: inv.total,
        amountPaid,
        balanceDue: round2(Math.max(0, inv.total - amountPaid)),
        fullyPaid,
    };
}
export function deletePayment(id) {
    const payment = requirePayment(id);
    const inv = findInvoiceRowById(payment.invoiceId);
    if (!inv)
        throw new Error(`Invoice not found for payment ${id}`);
    const db = openDb();
    const sqlite = rawSqlite();
    const now = Date.now();
    let amountPaid = 0;
    const tx = sqlite.transaction(() => {
        db.delete(paymentsTable).where(eq(paymentsTable.id, id)).run();
        amountPaid = paymentsTotalFor(inv.id);
        // If removing this payment drops a "paid" invoice below its total, reopen
        // it to "sent" and clear paidAt so it re-enters the open/overdue flow.
        if (inv.status === "paid" && amountPaid + 0.005 < inv.total) {
            db.update(invoicesTable)
                .set({ status: "sent", paidAt: null, updatedAt: now })
                .where(eq(invoicesTable.id, inv.id))
                .run();
        }
        else {
            db.update(invoicesTable).set({ updatedAt: now }).where(eq(invoicesTable.id, inv.id)).run();
        }
    });
    tx();
    const reopened = inv.status === "paid" && amountPaid + 0.005 < inv.total;
    return {
        payment,
        invoiceNumber: inv.number,
        status: reopened ? "sent" : inv.status,
        total: inv.total,
        amountPaid,
        balanceDue: round2(Math.max(0, inv.total - amountPaid)),
        fullyPaid: amountPaid + 0.005 >= inv.total,
    };
}
function findInvoiceRow(numberOrId) {
    const db = openDb();
    const byNumber = db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.number, numberOrId))
        .all()[0];
    if (byNumber)
        return byNumber;
    return (db.select().from(invoicesTable).where(eq(invoicesTable.id, numberOrId)).all()[0] ?? null);
}
function findInvoiceRowById(id) {
    const db = openDb();
    return db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).all()[0] ?? null;
}
