import { addRecurringInvoice, deleteRecurringInvoice, getRecurringInvoice, listRecurringInvoices, runRecurringInvoices, updateRecurringInvoice, upcomingRecurringInvoices, } from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";
const CADENCES = ["weekly", "monthly", "quarterly", "yearly"];
function parseLineItemFlag(s) {
    const parts = s.split("|");
    if (parts.length < 3) {
        fail(`--item must be 'description|quantity|rate[|unit[|kind]]', got: ${s}`);
    }
    const [description, qStr, rStr, unitLabel, kind] = parts;
    const quantity = Number(qStr);
    const rate = Number(rStr);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate)) {
        fail(`--item quantity/rate must be numeric, got: ${s}`);
    }
    return {
        description,
        quantity,
        rate,
        unitLabel: unitLabel || undefined,
        kind: kind || undefined,
    };
}
function parseCadence(s) {
    if (!s || !CADENCES.includes(s)) {
        fail(`--cadence must be one of: ${CADENCES.join(", ")}`);
    }
    return s;
}
function parseIntFlag(label, val) {
    if (val === undefined)
        return undefined;
    const n = parseInt(val, 10);
    if (!Number.isFinite(n))
        fail(`${label} must be an integer (got: ${val})`);
    return n;
}
export function runRecurringAdd(opts) {
    if (!opts.client)
        fail("--client is required");
    if (!opts.start)
        fail("--start is required");
    if (!opts.item)
        fail("at least one --item is required");
    const items = Array.isArray(opts.item) ? opts.item : [opts.item];
    const template = {
        lineItems: items.map(parseLineItemFlag),
        taxRate: opts.taxRate ? Number(opts.taxRate) : undefined,
        currency: opts.currency,
        dueDays: parseIntFlag("--due-days", opts.dueDays),
        notes: opts.notes,
    };
    const r = tryRun(() => addRecurringInvoice({
        client: opts.client,
        cadence: parseCadence(opts.cadence),
        startDate: opts.start,
        endDate: opts.end ?? null,
        dayOfMonth: parseIntFlag("--day", opts.day),
        dayOfWeek: parseIntFlag("--dow", opts.dow),
        active: !opts.paused,
        autoSend: opts.autoSend ?? false,
        template,
    }), opts.json);
    if (opts.json)
        return emitJson(r);
    emitOk(`Created recurring ${r.id} for ${r.clientSlug} (${r.cadence}). ` +
        `Next issue: ${r.nextIssueAt}${r.endDate ? ` (ends ${r.endDate})` : ""}.`);
}
export function runRecurringList(opts) {
    const active = opts.paused ? false : opts.active ? true : undefined;
    const rows = tryRun(() => listRecurringInvoices({ client: opts.client, active }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((r) => ({
        id: r.id.slice(0, 8),
        client: r.clientSlug,
        cadence: r.cadence,
        next: r.nextIssueAt,
        end: r.endDate ?? "—",
        active: r.active ? "yes" : "paused",
        autoSend: r.autoSend ? "yes" : "—",
        lastInvoice: r.lastInvoiceNumber ?? "—",
        items: r.template.lineItems.length,
    })), ["id", "client", "cadence", "next", "end", "active", "autoSend", "lastInvoice", "items"]);
}
export function runRecurringGet(id, opts) {
    const r = tryRun(() => getRecurringInvoice(id), opts.json);
    if (!r)
        fail(`not found: ${id}`);
    if (opts.json)
        return emitJson(r);
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
}
export function runRecurringUpdate(id, opts) {
    const patch = {};
    if (opts.cadence)
        patch.cadence = parseCadence(opts.cadence);
    if (opts.start)
        patch.startDate = opts.start;
    if (opts.end !== undefined)
        patch.endDate = opts.end === "" ? null : opts.end;
    if (opts.day !== undefined)
        patch.dayOfMonth = parseIntFlag("--day", opts.day) ?? null;
    if (opts.dow !== undefined)
        patch.dayOfWeek = parseIntFlag("--dow", opts.dow) ?? null;
    if (opts.pause)
        patch.active = false;
    else if (opts.resume)
        patch.active = true;
    if (opts.autoSend)
        patch.autoSend = true;
    else if (opts.noAutoSend)
        patch.autoSend = false;
    if (opts.nextIssue)
        patch.nextIssueAt = opts.nextIssue;
    const r = tryRun(() => updateRecurringInvoice(id, patch), opts.json);
    if (opts.json)
        return emitJson(r);
    emitOk(`Updated recurring ${r.id}.`);
}
export function runRecurringDelete(id, opts) {
    const r = tryRun(() => deleteRecurringInvoice(id), opts.json);
    if (opts.json)
        return emitJson({ deleted: r });
    emitOk(`Deleted recurring ${r.id}.`);
}
export function runRecurringRun(opts) {
    const result = tryRun(() => runRecurringInvoices({ asOf: opts.asOf }), opts.json);
    if (opts.json)
        return emitJson(result);
    if (result.generated.length === 0 && result.skipped.length === 0) {
        process.stdout.write(`No recurring invoices due (as of ${result.asOf}).\n`);
        return;
    }
    if (result.generated.length > 0) {
        emitOk(`Generated ${result.generated.length} invoice(s) as of ${result.asOf}:`);
        emitTable(result.generated.map((g) => ({
            invoice: g.invoiceNumber,
            client: g.clientSlug,
            issued: g.issuedAt,
            total: g.total.toFixed(2),
        })), ["invoice", "client", "issued", "total"]);
    }
    if (result.skipped.length > 0) {
        process.stdout.write(`Skipped ${result.skipped.length}:\n`);
        for (const s of result.skipped) {
            process.stdout.write(`  ${s.recurringId.slice(0, 8)} — ${s.reason}\n`);
        }
    }
}
export function runRecurringUpcoming(opts) {
    const count = parseIntFlag("--count", opts.count) ?? 3;
    const rows = tryRun(() => upcomingRecurringInvoices({ count, client: opts.client }), opts.json);
    if (opts.json)
        return emitJson(rows);
    if (rows.length === 0) {
        process.stdout.write("No active recurring invoices.\n");
        return;
    }
    emitTable(rows.map((row) => ({
        id: row.recurring.id.slice(0, 8),
        client: row.recurring.clientSlug,
        cadence: row.recurring.cadence,
        upcoming: row.upcoming.join(", "),
    })), ["id", "client", "cadence", "upcoming"]);
}
