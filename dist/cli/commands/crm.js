import { addCrmNote, deleteCrmNote, getCrmNote, listCrmNotes, listFollowups, updateCrmNote, } from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";
export function runCrmNote(opts) {
    if (!opts.client)
        fail("--client is required");
    if (!opts.body)
        fail("--body is required");
    const n = tryRun(() => addCrmNote({
        client: opts.client,
        body: opts.body,
        date: opts.date,
        followupAt: opts.followup ?? null,
    }), opts.json);
    if (opts.json)
        return emitJson(n);
    emitOk(`Added CRM note for ${n.clientSlug} on ${n.date}`);
}
export function runCrmNotes(opts) {
    const rows = tryRun(() => listCrmNotes({
        client: opts.client,
        from: opts.from,
        to: opts.to,
    }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((n) => ({
        date: n.date,
        client: n.clientSlug,
        followup: n.followupAt,
        body: n.body.slice(0, 80),
    })), ["date", "client", "followup", "body"]);
}
export function runCrmNoteGet(id, opts) {
    const n = tryRun(() => getCrmNote(id), opts.json);
    if (!n)
        fail(`not found: ${id}`);
    if (opts.json)
        return emitJson(n);
    process.stdout.write(JSON.stringify(n, null, 2) + "\n");
}
export function runCrmNoteUpdate(id, opts) {
    const patch = {};
    if (opts.client !== undefined)
        patch.client = opts.client;
    if (opts.body !== undefined)
        patch.body = opts.body;
    if (opts.date !== undefined)
        patch.date = opts.date;
    if (opts.clearFollowup)
        patch.followupAt = null;
    else if (opts.followup !== undefined)
        patch.followupAt = opts.followup;
    const n = tryRun(() => updateCrmNote(id, patch), opts.json);
    if (opts.json)
        return emitJson(n);
    emitOk(`Updated CRM note ${n.id}.`);
}
export function runCrmNoteDelete(id, opts) {
    const n = tryRun(() => deleteCrmNote(id), opts.json);
    if (opts.json)
        return emitJson({ deleted: n });
    emitOk(`Deleted CRM note ${n.id}.`);
}
export function runCrmFollowups(opts) {
    const stalenessDays = opts.staleness ? Number(opts.staleness) : undefined;
    if (stalenessDays !== undefined && !Number.isFinite(stalenessDays)) {
        fail("--staleness must be numeric");
    }
    const rows = tryRun(() => listFollowups({ stalenessDays, dueBy: opts.dueBy }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((f) => ({
        slug: f.client.slug,
        name: f.client.name,
        status: f.client.status,
        lastContact: f.lastContactAt ?? "(never)",
        daysSince: f.daysSinceContact ?? "—",
    })), ["slug", "name", "status", "lastContact", "daysSince"]);
}
