import pc from "picocolors";
export function emitJson(data) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}
export function emitTable(rows, columns) {
    if (rows.length === 0) {
        process.stdout.write(pc.dim("(no rows)\n"));
        return;
    }
    const cols = columns ?? Object.keys(rows[0]);
    const stringRows = rows.map((r) => {
        const out = {};
        for (const c of cols) {
            const v = r[c];
            out[c] = v === null || v === undefined ? "" : String(v);
        }
        return out;
    });
    const widths = cols.map((c) => Math.max(c.length, ...stringRows.map((r) => (r[c] ?? "").length)));
    const fmt = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
    process.stdout.write(pc.bold(fmt(cols)) + "\n");
    for (const row of stringRows) {
        process.stdout.write(fmt(cols.map((c) => row[c] ?? "")) + "\n");
    }
}
export function emitOk(msg) {
    process.stderr.write(pc.green("✓ ") + msg + "\n");
}
export function fail(msg, code = 1) {
    process.stderr.write(pc.red(msg) + "\n");
    process.exit(code);
}
export function tryRun(fn, json = false) {
    try {
        return fn();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (json) {
            process.stdout.write(JSON.stringify({ error: msg }) + "\n");
            process.exit(1);
        }
        fail(msg);
    }
}
export async function tryRunAsync(fn, json = false) {
    try {
        return await fn();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (json) {
            process.stdout.write(JSON.stringify({ error: msg }) + "\n");
            process.exit(1);
        }
        fail(msg);
    }
}
