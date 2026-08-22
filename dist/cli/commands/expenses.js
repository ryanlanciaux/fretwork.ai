import { addExpense, deleteExpense, getExpense, listExpenses, updateExpense, } from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";
function parseNum(label, val) {
    if (val === undefined)
        return undefined;
    const n = Number(val);
    if (!Number.isFinite(n))
        fail(`${label} must be a number (got: ${val})`);
    return n;
}
function fmtAmount(amount, currency) {
    if (amount == null)
        return "—";
    const cur = currency ?? "USD";
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(amount);
    }
    catch {
        return `${cur} ${amount.toFixed(2)}`;
    }
}
export function runExpensesAdd(description, opts) {
    const desc = description ?? opts.description;
    if (!desc)
        fail("description is required (pass it as the positional arg)");
    const e = tryRun(() => addExpense({
        description: desc,
        date: opts.date,
        client: opts.client ?? null,
        category: opts.category ?? null,
        amount: parseNum("--amount", opts.amount) ?? null,
        currency: opts.currency ?? null,
        quantity: parseNum("--quantity", opts.quantity) ?? null,
        unit: opts.unit ?? null,
        billable: opts.billable ?? false,
    }), opts.json);
    if (opts.json)
        return emitJson(e);
    const amount = fmtAmount(e.amount, e.currency);
    const target = e.clientSlug ?? "(unassigned)";
    emitOk(`Logged expense ${e.id} on ${e.date} for ${target}: ${amount} — ${e.description}`);
}
export function runExpensesList(opts) {
    const hasAmount = opts.withAmount ? true : opts.activityOnly ? false : undefined;
    const rows = tryRun(() => listExpenses({
        client: opts.client,
        from: opts.from,
        to: opts.to,
        category: opts.category,
        unbilled: opts.unbilled,
        billable: opts.billable,
        hasAmount,
    }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((e) => ({
        id: e.id.slice(0, 8),
        date: e.date,
        client: e.clientSlug ?? "—",
        category: e.category ?? "—",
        qty: e.quantity ?? "",
        unit: e.unit ?? "",
        amount: fmtAmount(e.amount, e.currency),
        billable: e.billable ? "yes" : "—",
        billed: e.billed ? e.invoiceNumber ?? "yes" : "—",
        description: (e.description ?? "").slice(0, 50),
    })), [
        "id",
        "date",
        "client",
        "category",
        "qty",
        "unit",
        "amount",
        "billable",
        "billed",
        "description",
    ]);
}
export function runExpensesGet(id, opts) {
    const e = tryRun(() => getExpense(id), opts.json);
    if (!e) {
        if (opts.json)
            return emitJson(null);
        fail(`not found: ${id}`);
    }
    if (opts.json)
        return emitJson(e);
    process.stdout.write(JSON.stringify(e, null, 2) + "\n");
}
export function runExpensesUpdate(id, opts) {
    const patch = {};
    if (opts.description !== undefined)
        patch.description = opts.description;
    if (opts.date !== undefined)
        patch.date = opts.date;
    if (opts.client !== undefined)
        patch.client = opts.client === "" ? null : opts.client;
    if (opts.category !== undefined)
        patch.category = opts.category === "" ? null : opts.category;
    if (opts.clearAmount)
        patch.amount = null;
    else if (opts.amount !== undefined)
        patch.amount = parseNum("--amount", opts.amount) ?? null;
    if (opts.currency !== undefined)
        patch.currency = opts.currency === "" ? null : opts.currency;
    if (opts.quantity !== undefined)
        patch.quantity = parseNum("--quantity", opts.quantity) ?? null;
    if (opts.unit !== undefined)
        patch.unit = opts.unit === "" ? null : opts.unit;
    if (opts.billable)
        patch.billable = true;
    else if (opts.notBillable)
        patch.billable = false;
    const e = tryRun(() => updateExpense(id, patch), opts.json);
    if (opts.json)
        return emitJson(e);
    emitOk(`Updated expense ${e.id}.`);
}
export function runExpensesDelete(id, opts) {
    const e = tryRun(() => deleteExpense(id), opts.json);
    if (opts.json)
        return emitJson({ deleted: e });
    emitOk(`Deleted expense ${e.id}.`);
}
