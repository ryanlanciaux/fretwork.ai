import { createInvoice, deleteInvoice, deletePayment, generateInvoicePdf, getInvoice, listInvoices, listOverdueInvoices, listPayments, reconcileOverdueInvoices, recordPayment, renderInvoiceHtml, setInvoiceStatus, } from "../../store/index.js";
import { writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { emitJson, emitOk, emitTable, fail, tryRun, tryRunAsync } from "../output.js";
const VALID_STATUSES = ["draft", "sent", "paid", "overdue", "void"];
export function runInvoicesList(opts) {
    const status = opts.status
        ? opts.status.split(",").map((s) => s.trim())
        : undefined;
    if (status) {
        for (const s of status) {
            if (!VALID_STATUSES.includes(s))
                fail(`Invalid status '${s}'.`);
        }
    }
    const rows = tryRun(() => listInvoices({ client: opts.client, status: status?.length === 1 ? status[0] : status }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((i) => ({
        number: i.number,
        client: i.clientSlug,
        status: i.status,
        issued: i.issuedAt,
        due: i.dueAt,
        total: `${i.currency} ${i.total.toFixed(2)}`,
    })), ["number", "client", "status", "issued", "due", "total"]);
}
export function runInvoicesGet(numberOrId, opts) {
    const inv = getInvoice(numberOrId);
    if (!inv)
        fail(`Invoice not found: ${numberOrId}`);
    if (opts.json)
        return emitJson(inv);
    process.stdout.write(JSON.stringify(inv, null, 2) + "\n");
}
function parseLineItemFlag(s) {
    // Format: "Description|qty|rate" or "Description|qty|rate|unit"
    const parts = s.split("|");
    if (parts.length < 3) {
        fail(`--item must be 'description|quantity|rate[|unit]', got: ${s}`);
    }
    const [description, qStr, rStr, unit] = parts;
    const quantity = Number(qStr);
    const rate = Number(rStr);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate)) {
        fail(`--item quantity/rate must be numeric, got: ${s}`);
    }
    return { description, quantity, rate, unitLabel: unit };
}
export function runInvoicesCreate(opts) {
    if (!opts.client)
        fail("--client is required");
    const items = (() => {
        if (!opts.item)
            return undefined;
        const arr = Array.isArray(opts.item) ? opts.item : [opts.item];
        return arr.map(parseLineItemFlag);
    })();
    const fromTimeRange = (opts.from || opts.to) ? { from: opts.from ?? "0000-01-01", to: opts.to ?? "9999-12-31" } : undefined;
    const inv = tryRun(() => createInvoice({
        client: opts.client,
        number: opts.number,
        issuedAt: opts.issued,
        dueAt: opts.due,
        taxRate: opts.taxRate ? Number(opts.taxRate) : undefined,
        currency: opts.currency,
        notes: opts.notes,
        fromTimeRange,
        lineItems: items,
    }), opts.json);
    if (opts.json)
        return emitJson(inv);
    emitOk(`Created ${inv.number} for ${inv.clientSlug}: ${inv.currency} ${inv.total.toFixed(2)} (${inv.lineItems.length} line items)`);
}
export function runInvoicesRender(numberOrId, opts) {
    const html = tryRun(() => renderInvoiceHtml(numberOrId), opts.json);
    if (opts.output) {
        const out = isAbsolute(opts.output) ? opts.output : join(process.cwd(), opts.output);
        writeFileSync(out, html, "utf8");
        if (opts.json)
            return emitJson({ path: out });
        emitOk(`Wrote ${out}`);
        return;
    }
    process.stdout.write(html);
}
export async function runInvoicesPdf(numberOrId, opts) {
    const path = await tryRunAsync(() => generateInvoicePdf(numberOrId, { output: opts.output, format: opts.format, overwrite: opts.overwrite }), opts.json);
    if (opts.json)
        return emitJson({ path });
    emitOk(`Wrote ${path}`);
}
export function runInvoicesStatus(numberOrId, status, opts) {
    if (!VALID_STATUSES.includes(status)) {
        fail(`Invalid status '${status}'. Use one of: ${VALID_STATUSES.join(", ")}`);
    }
    const inv = tryRun(() => setInvoiceStatus(numberOrId, status), opts.json);
    if (opts.json)
        return emitJson(inv);
    emitOk(`${inv.number} → ${inv.status}`);
}
export function runInvoicesOverdue(opts) {
    if (opts.mark) {
        const result = tryRun(() => reconcileOverdueInvoices({ asOf: opts.asOf }), opts.json);
        if (opts.json)
            return emitJson(result);
        if (result.updated.length === 0 && result.alreadyOverdue.length === 0) {
            process.stdout.write("No overdue invoices.\n");
            return;
        }
        if (result.updated.length > 0) {
            emitOk(`Marked ${result.updated.length} invoice(s) overdue: ${result.updated.map((i) => i.number).join(", ")}`);
        }
        if (result.alreadyOverdue.length > 0) {
            process.stdout.write(`(${result.alreadyOverdue.length} already overdue: ${result.alreadyOverdue.map((i) => i.number).join(", ")})\n`);
        }
        return;
    }
    const rows = tryRun(() => listOverdueInvoices({ asOf: opts.asOf }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((i) => ({
        number: i.number,
        client: i.clientSlug,
        status: i.status,
        due: i.dueAt,
        daysOverdue: i.daysOverdue,
        total: `${i.currency} ${i.total.toFixed(2)}`,
    })), ["number", "client", "status", "due", "daysOverdue", "total"]);
}
export function runInvoicesDelete(numberOrId, opts) {
    tryRun(() => deleteInvoice(numberOrId), opts.json);
    if (opts.json)
        return emitJson({ deleted: numberOrId });
    emitOk(`Deleted ${numberOrId}`);
}
export function runInvoicesPay(numberOrId, opts) {
    const amount = Number(opts.amount);
    if (!Number.isFinite(amount))
        fail(`--amount must be numeric, got: ${opts.amount}`);
    const result = tryRun(() => recordPayment({
        invoice: numberOrId,
        amount,
        date: opts.date,
        method: opts.method ?? null,
        reference: opts.reference ?? null,
        note: opts.note ?? null,
    }), opts.json);
    if (opts.json)
        return emitJson(result);
    const tail = result.fullyPaid
        ? "paid in full"
        : `balance due ${result.balanceDue.toFixed(2)}`;
    emitOk(`Recorded ${amount.toFixed(2)} against ${result.invoiceNumber} → ${result.status} (${tail})`);
}
export function runPaymentsList(opts) {
    const rows = tryRun(() => listPayments(opts.invoice), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((p) => ({
        id: p.id,
        invoice: p.invoiceNumber,
        date: p.date,
        amount: p.amount.toFixed(2),
        method: p.method ?? "",
        reference: p.reference ?? "",
    })), ["id", "invoice", "date", "amount", "method", "reference"]);
}
export function runPaymentsDelete(id, opts) {
    const result = tryRun(() => deletePayment(id), opts.json);
    if (opts.json)
        return emitJson(result);
    emitOk(`Deleted payment ${id}; ${result.invoiceNumber} → ${result.status} ` +
        `(balance due ${result.balanceDue.toFixed(2)})`);
}
