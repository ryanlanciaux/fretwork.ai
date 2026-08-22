import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { exportSnapshot, importSnapshot, snapshotToCsvFiles, } from "../../store/index.js";
import { emitJson, emitOk, fail, tryRun } from "../output.js";
function resolveOutput(out, fallback) {
    if (!out)
        return fallback;
    return isAbsolute(out) ? out : resolve(process.cwd(), out);
}
function fretworkHomePath(...parts) {
    const home = process.env.FRETWORK_HOME ?? join(homedir(), ".fretwork");
    return join(home, ...parts);
}
export function runExport(opts) {
    const snapshot = tryRun(() => exportSnapshot(), opts.json);
    if (opts.csv) {
        const dir = resolveOutput(opts.output, fretworkHomePath("exports", `csv-${new Date().toISOString().slice(0, 10)}`));
        mkdirSync(dir, { recursive: true });
        const files = snapshotToCsvFiles(snapshot);
        let bytes = 0;
        for (const [name, content] of Object.entries(files)) {
            const path = join(dir, name);
            writeFileSync(path, content, "utf8");
            bytes += Buffer.byteLength(content, "utf8");
        }
        if (opts.json)
            return emitJson({ dir, files: Object.keys(files), bytes });
        emitOk(`Wrote ${Object.keys(files).length} CSV file(s) to ${dir} (${bytes} bytes).`);
        return;
    }
    const path = resolveOutput(opts.output, fretworkHomePath("exports", `fretwork-${new Date().toISOString().slice(0, 10)}.json`));
    mkdirSync(dirname(path), { recursive: true });
    const payload = JSON.stringify(snapshot, null, 2);
    writeFileSync(path, payload, "utf8");
    if (opts.json)
        return emitJson({ path, bytes: payload.length });
    const counts = Object.entries(snapshot)
        .filter(([k]) => k !== "version" && k !== "exportedAt")
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`)
        .join(", ");
    emitOk(`Wrote snapshot to ${path} (${counts}).`);
}
export function runImport(file, opts) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path))
        fail(`File not found: ${path}`);
    const mode = (opts.mode ?? "merge");
    if (mode !== "merge" && mode !== "replace")
        fail(`--mode must be 'merge' or 'replace'`);
    if (mode === "replace" && !opts.force) {
        fail(`--mode replace will wipe ALL existing data. Re-run with --force to confirm.`);
    }
    const raw = readFileSync(path, "utf8");
    let snapshot;
    try {
        snapshot = JSON.parse(raw);
    }
    catch (e) {
        fail(`Could not parse JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const summary = tryRun(() => importSnapshot(snapshot, { mode }), opts.json);
    if (opts.json)
        return emitJson(summary);
    const total = Object.values(summary.inserted).reduce((s, n) => s + n, 0);
    const skipped = Object.values(summary.skipped).reduce((s, n) => s + n, 0);
    emitOk(`Imported ${total} rows (${summary.mode}). Skipped ${skipped}. Errors: ${summary.errors.length}.`);
    for (const err of summary.errors)
        process.stdout.write(`  ! ${err}\n`);
}
