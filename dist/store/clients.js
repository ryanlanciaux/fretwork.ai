import { eq, inArray, asc } from "drizzle-orm";
import { activeTimer as activeTimerTable, clients as clientsTable, crmNotes as crmNotesTable, expenses as expensesTable, invoices as invoicesTable, recurringInvoices as recurringTable, timeEntries as timeEntriesTable, } from "./db/schema.js";
import { openDb } from "./db/client.js";
import { newId, slugify } from "./util.js";
function rowToClient(row) {
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        email: row.email,
        address: row.address,
        city: row.city,
        phone: row.phone,
        status: row.status,
        defaultRate: row.defaultRate,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        promotedAt: row.promotedAt,
        archivedAt: row.archivedAt,
    };
}
function uniqueSlug(base) {
    const db = openDb();
    let slug = base;
    let n = 2;
    while (db.select().from(clientsTable).where(eq(clientsTable.slug, slug)).all().length > 0) {
        slug = `${base}-${n++}`;
    }
    return slug;
}
export function listClients(opts = {}) {
    const db = openDb();
    const rows = (() => {
        if (!opts.status)
            return db.select().from(clientsTable).orderBy(asc(clientsTable.name)).all();
        const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
        return db
            .select()
            .from(clientsTable)
            .where(inArray(clientsTable.status, statuses))
            .orderBy(asc(clientsTable.name))
            .all();
    })();
    return rows.map(rowToClient);
}
export function getClient(slugOrId) {
    const db = openDb();
    const bySlug = db.select().from(clientsTable).where(eq(clientsTable.slug, slugOrId)).all();
    if (bySlug[0])
        return rowToClient(bySlug[0]);
    const byId = db.select().from(clientsTable).where(eq(clientsTable.id, slugOrId)).all();
    return byId[0] ? rowToClient(byId[0]) : null;
}
export function requireClient(slugOrId) {
    const c = getClient(slugOrId);
    if (!c)
        throw new Error(`Client not found: ${slugOrId}`);
    return c;
}
export function addClient(input) {
    const db = openDb();
    const now = Date.now();
    const slug = uniqueSlug(slugify(input.name));
    const id = newId();
    const status = input.status ?? "prospect";
    db.insert(clientsTable)
        .values({
        id,
        slug,
        name: input.name,
        email: input.email ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        phone: input.phone ?? null,
        status,
        defaultRate: input.defaultRate ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
        promotedAt: status === "client" ? now : null,
        archivedAt: null,
    })
        .run();
    return requireClient(slug);
}
export function updateClient(slugOrId, patch) {
    const current = requireClient(slugOrId);
    const db = openDb();
    const now = Date.now();
    db.update(clientsTable)
        .set({
        name: patch.name ?? current.name,
        email: patch.email === undefined ? current.email : patch.email,
        address: patch.address === undefined ? current.address : patch.address,
        city: patch.city === undefined ? current.city : patch.city,
        phone: patch.phone === undefined ? current.phone : patch.phone,
        defaultRate: patch.defaultRate === undefined ? current.defaultRate : patch.defaultRate,
        notes: patch.notes === undefined ? current.notes : patch.notes,
        updatedAt: now,
    })
        .where(eq(clientsTable.id, current.id))
        .run();
    return requireClient(current.slug);
}
const PROMOTION_ORDER = ["prospect", "lead", "client"];
export function promoteClient(slugOrId, to) {
    const current = requireClient(slugOrId);
    const target = (() => {
        if (to)
            return to;
        const idx = PROMOTION_ORDER.indexOf(current.status);
        if (idx === -1 || idx === PROMOTION_ORDER.length - 1) {
            throw new Error(`Cannot auto-promote from status '${current.status}'. Pass an explicit target.`);
        }
        return PROMOTION_ORDER[idx + 1];
    })();
    const db = openDb();
    const now = Date.now();
    db.update(clientsTable)
        .set({
        status: target,
        promotedAt: target === "client" ? now : current.promotedAt,
        archivedAt: target === "archived" ? now : null,
        updatedAt: now,
    })
        .where(eq(clientsTable.id, current.id))
        .run();
    return requireClient(current.slug);
}
export function archiveClient(slugOrId) {
    return promoteClient(slugOrId, "archived");
}
function countClientReferences(slug) {
    const db = openDb();
    return {
        timeEntries: db
            .select({ id: timeEntriesTable.id })
            .from(timeEntriesTable)
            .where(eq(timeEntriesTable.clientSlug, slug))
            .all().length,
        expenses: db
            .select({ id: expensesTable.id })
            .from(expensesTable)
            .where(eq(expensesTable.clientSlug, slug))
            .all().length,
        invoices: db
            .select({ id: invoicesTable.id })
            .from(invoicesTable)
            .where(eq(invoicesTable.clientSlug, slug))
            .all().length,
        crmNotes: db
            .select({ id: crmNotesTable.id })
            .from(crmNotesTable)
            .where(eq(crmNotesTable.clientSlug, slug))
            .all().length,
        recurringInvoices: db
            .select({ id: recurringTable.id })
            .from(recurringTable)
            .where(eq(recurringTable.clientSlug, slug))
            .all().length,
        activeTimer: db
            .select({ id: activeTimerTable.id })
            .from(activeTimerTable)
            .where(eq(activeTimerTable.clientSlug, slug))
            .all().length,
    };
}
// Hard-delete a client row. Refuses if anything still references it —
// the user should `archive` for soft-delete or delete the referencing
// rows (or invoices, which release their entries) first. This is
// intentionally strict: time/invoice history is the user's source of
// truth and deleting a referenced client would orphan it.
export function deleteClient(slugOrId) {
    const current = requireClient(slugOrId);
    const refs = countClientReferences(current.slug);
    const total = refs.timeEntries +
        refs.expenses +
        refs.invoices +
        refs.crmNotes +
        refs.recurringInvoices +
        refs.activeTimer;
    if (total > 0) {
        const parts = [];
        if (refs.timeEntries)
            parts.push(`${refs.timeEntries} time entries`);
        if (refs.expenses)
            parts.push(`${refs.expenses} expenses`);
        if (refs.invoices)
            parts.push(`${refs.invoices} invoices`);
        if (refs.crmNotes)
            parts.push(`${refs.crmNotes} CRM notes`);
        if (refs.recurringInvoices)
            parts.push(`${refs.recurringInvoices} recurring invoices`);
        if (refs.activeTimer)
            parts.push(`an active timer`);
        throw new Error(`Cannot delete ${current.slug}: still referenced by ${parts.join(", ")}. ` +
            `Use archiveClient to keep history, or delete the referencing rows first.`);
    }
    const db = openDb();
    db.delete(clientsTable).where(eq(clientsTable.id, current.id)).run();
    return current;
}
