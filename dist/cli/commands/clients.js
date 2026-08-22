import { addClient, archiveClient, deleteClient, getClient, listClients, promoteClient, updateClient, } from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";
export function runClientsList(opts) {
    const status = parseStatusFilter(opts.status);
    const rows = tryRun(() => listClients({ status }), opts.json);
    if (opts.json)
        return emitJson(rows);
    emitTable(rows.map((c) => ({
        slug: c.slug,
        name: c.name,
        status: c.status,
        email: c.email,
        rate: c.defaultRate,
    })), ["slug", "name", "status", "email", "rate"]);
}
function parseStatusFilter(s) {
    if (!s)
        return undefined;
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    const valid = ["prospect", "lead", "client", "archived"];
    for (const p of parts) {
        if (!valid.includes(p))
            fail(`Invalid status '${p}'. Use one of: ${valid.join(", ")}`);
    }
    return parts.length === 1 ? parts[0] : parts;
}
export function runClientsAdd(name, opts) {
    if (!name)
        fail("client name is required");
    const status = opts.status ?? "prospect";
    const validStatuses = ["prospect", "lead", "client", "archived"];
    if (!validStatuses.includes(status))
        fail(`Invalid status '${status}'.`);
    const c = tryRun(() => addClient({
        name,
        email: opts.email ?? null,
        address: opts.address ?? null,
        city: opts.city ?? null,
        phone: opts.phone ?? null,
        defaultRate: opts.rate ? Number(opts.rate) : null,
        notes: opts.notes ?? null,
        status,
    }), opts.json);
    if (opts.json)
        return emitJson(c);
    emitOk(`Added client ${c.name} (slug: ${c.slug})`);
}
export function runClientsGet(slug, opts) {
    const c = getClient(slug);
    if (!c)
        fail(`Client not found: ${slug}`);
    if (opts.json)
        return emitJson(c);
    process.stdout.write(JSON.stringify(c, null, 2) + "\n");
}
export function runClientsUpdate(slug, opts) {
    const c = tryRun(() => updateClient(slug, {
        name: opts.name,
        email: opts.email,
        address: opts.address,
        city: opts.city,
        phone: opts.phone,
        defaultRate: opts.rate === undefined ? undefined : Number(opts.rate),
        notes: opts.notes,
    }), opts.json);
    if (opts.json)
        return emitJson(c);
    emitOk(`Updated ${c.slug}`);
}
export function runClientsPromote(slug, opts) {
    const target = opts.to;
    const c = tryRun(() => promoteClient(slug, target), opts.json);
    if (opts.json)
        return emitJson(c);
    emitOk(`${c.slug} → ${c.status}`);
}
export function runClientsArchive(slug, opts) {
    const c = tryRun(() => archiveClient(slug), opts.json);
    if (opts.json)
        return emitJson(c);
    emitOk(`Archived ${c.slug}`);
}
export function runClientsDelete(slug, opts) {
    const c = tryRun(() => deleteClient(slug), opts.json);
    if (opts.json)
        return emitJson({ deleted: c });
    emitOk(`Deleted ${c.slug}.`);
}
