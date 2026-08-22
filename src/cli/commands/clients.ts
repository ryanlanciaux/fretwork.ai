import {
  addClient,
  archiveClient,
  deleteClient,
  getClient,
  listClients,
  promoteClient,
  updateClient,
  type ClientStatus,
} from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";

interface ListOpts {
  status?: string;
  json?: boolean;
}

export function runClientsList(opts: ListOpts): void {
  const status = parseStatusFilter(opts.status);
  const rows = tryRun(() => listClients({ status }), opts.json);
  if (opts.json) return emitJson(rows);
  emitTable(
    rows.map((c) => ({
      slug: c.slug,
      name: c.name,
      status: c.status,
      email: c.email,
      rate: c.defaultRate,
    })),
    ["slug", "name", "status", "email", "rate"],
  );
}

function parseStatusFilter(s: string | undefined): ClientStatus | ClientStatus[] | undefined {
  if (!s) return undefined;
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean) as ClientStatus[];
  const valid: ClientStatus[] = ["prospect", "lead", "client", "archived"];
  for (const p of parts) {
    if (!valid.includes(p)) fail(`Invalid status '${p}'. Use one of: ${valid.join(", ")}`);
  }
  return parts.length === 1 ? parts[0]! : parts;
}

interface AddOpts {
  email?: string;
  address?: string;
  city?: string;
  phone?: string;
  rate?: string;
  status?: string;
  notes?: string;
  json?: boolean;
}

export function runClientsAdd(name: string, opts: AddOpts): void {
  if (!name) fail("client name is required");
  const status = (opts.status as ClientStatus | undefined) ?? "prospect";
  const validStatuses: ClientStatus[] = ["prospect", "lead", "client", "archived"];
  if (!validStatuses.includes(status)) fail(`Invalid status '${status}'.`);
  const c = tryRun(
    () =>
      addClient({
        name,
        email: opts.email ?? null,
        address: opts.address ?? null,
        city: opts.city ?? null,
        phone: opts.phone ?? null,
        defaultRate: opts.rate ? Number(opts.rate) : null,
        notes: opts.notes ?? null,
        status,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(c);
  emitOk(`Added client ${c.name} (slug: ${c.slug})`);
}

interface GetOpts { json?: boolean }
export function runClientsGet(slug: string, opts: GetOpts): void {
  const c = getClient(slug);
  if (!c) fail(`Client not found: ${slug}`);
  if (opts.json) return emitJson(c);
  process.stdout.write(JSON.stringify(c, null, 2) + "\n");
}

interface UpdateOpts {
  name?: string;
  email?: string;
  address?: string;
  city?: string;
  phone?: string;
  rate?: string;
  notes?: string;
  json?: boolean;
}

export function runClientsUpdate(slug: string, opts: UpdateOpts): void {
  const c = tryRun(
    () =>
      updateClient(slug, {
        name: opts.name,
        email: opts.email,
        address: opts.address,
        city: opts.city,
        phone: opts.phone,
        defaultRate: opts.rate === undefined ? undefined : Number(opts.rate),
        notes: opts.notes,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(c);
  emitOk(`Updated ${c.slug}`);
}

interface PromoteOpts { to?: string; json?: boolean }
export function runClientsPromote(slug: string, opts: PromoteOpts): void {
  const target = opts.to as ClientStatus | undefined;
  const c = tryRun(() => promoteClient(slug, target), opts.json);
  if (opts.json) return emitJson(c);
  emitOk(`${c.slug} → ${c.status}`);
}

interface ArchiveOpts { json?: boolean }
export function runClientsArchive(slug: string, opts: ArchiveOpts): void {
  const c = tryRun(() => archiveClient(slug), opts.json);
  if (opts.json) return emitJson(c);
  emitOk(`Archived ${c.slug}`);
}

interface DeleteOpts { json?: boolean }
export function runClientsDelete(slug: string, opts: DeleteOpts): void {
  const c = tryRun(() => deleteClient(slug), opts.json);
  if (opts.json) return emitJson({ deleted: c });
  emitOk(`Deleted ${c.slug}.`);
}
