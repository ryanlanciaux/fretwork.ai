import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { crmNotes as crmTable } from "./db/schema.js";
import { openDb } from "./db/client.js";
import { listClients, requireClient } from "./clients.js";
import { diffDaysIso, isIsoDate, newId, todayIso } from "./util.js";
import type {
  AddCrmNoteInput,
  CrmNote,
  Followup,
  ListCrmFilter,
  UpdateCrmNoteInput,
} from "./types.js";

function rowToNote(row: typeof crmTable.$inferSelect): CrmNote {
  return {
    id: row.id,
    clientSlug: row.clientSlug,
    date: row.date,
    body: row.body,
    followupAt: row.followupAt,
    createdAt: row.createdAt,
  };
}

export function addCrmNote(input: AddCrmNoteInput): CrmNote {
  const client = requireClient(input.client);
  const date = input.date ?? todayIso();
  if (!isIsoDate(date)) throw new Error(`date must be YYYY-MM-DD`);
  if (input.followupAt && !isIsoDate(input.followupAt)) {
    throw new Error(`followupAt must be YYYY-MM-DD`);
  }
  const db = openDb();
  const id = newId();
  db.insert(crmTable)
    .values({
      id,
      clientSlug: client.slug,
      date,
      body: input.body,
      followupAt: input.followupAt ?? null,
      createdAt: Date.now(),
    })
    .run();
  return rowToNote(db.select().from(crmTable).where(eq(crmTable.id, id)).all()[0]!);
}

export function listCrmNotes(filter: ListCrmFilter = {}): CrmNote[] {
  const db = openDb();
  const conds = [];
  if (filter.client) {
    const c = requireClient(filter.client);
    conds.push(eq(crmTable.clientSlug, c.slug));
  }
  if (filter.from) {
    if (!isIsoDate(filter.from)) throw new Error("from must be YYYY-MM-DD");
    conds.push(gte(crmTable.date, filter.from));
  }
  if (filter.to) {
    if (!isIsoDate(filter.to)) throw new Error("to must be YYYY-MM-DD");
    conds.push(lte(crmTable.date, filter.to));
  }
  const rows = (conds.length > 0 ? db.select().from(crmTable).where(and(...conds)) : db.select().from(crmTable))
    .orderBy(desc(crmTable.date), desc(crmTable.createdAt))
    .all();
  return rows.map(rowToNote);
}

export function getCrmNote(id: string): CrmNote | null {
  const db = openDb();
  const row = db.select().from(crmTable).where(eq(crmTable.id, id)).all()[0];
  return row ? rowToNote(row) : null;
}

export function requireCrmNote(id: string): CrmNote {
  const n = getCrmNote(id);
  if (!n) throw new Error(`CRM note not found: ${id}`);
  return n;
}

export function updateCrmNote(id: string, patch: UpdateCrmNoteInput): CrmNote {
  const cur = requireCrmNote(id);
  if (patch.date !== undefined && !isIsoDate(patch.date)) {
    throw new Error(`date must be YYYY-MM-DD (got: ${patch.date})`);
  }
  if (patch.followupAt && !isIsoDate(patch.followupAt)) {
    throw new Error(`followupAt must be YYYY-MM-DD (got: ${patch.followupAt})`);
  }
  const clientSlug =
    patch.client === undefined ? cur.clientSlug : requireClient(patch.client).slug;
  const db = openDb();
  db.update(crmTable)
    .set({
      clientSlug,
      date: patch.date ?? cur.date,
      body: patch.body ?? cur.body,
      followupAt: patch.followupAt === undefined ? cur.followupAt : patch.followupAt,
    })
    .where(eq(crmTable.id, id))
    .run();
  return requireCrmNote(id);
}

export function deleteCrmNote(id: string): CrmNote {
  const cur = requireCrmNote(id);
  const db = openDb();
  db.delete(crmTable).where(eq(crmTable.id, id)).run();
  return cur;
}

export function listFollowups(opts: { stalenessDays?: number; dueBy?: string } = {}): Followup[] {
  const stalenessDays = opts.stalenessDays ?? 14;
  const today = todayIso();
  const active = listClients({ status: ["prospect", "lead", "client"] });
  const followups: Followup[] = [];
  for (const c of active) {
    const notes = listCrmNotes({ client: c.slug });
    const last = notes[0]?.date ?? null;
    const days = last ? diffDaysIso(last, today) : null;
    const meetsStaleness = days === null || days >= stalenessDays;
    const explicitDue = notes.find(
      (n) => n.followupAt && (!opts.dueBy || n.followupAt <= opts.dueBy) && n.followupAt <= today,
    );
    if (meetsStaleness || explicitDue) {
      followups.push({ client: c, lastContactAt: last, daysSinceContact: days });
    }
  }
  return followups.sort((a, b) => {
    if (a.daysSinceContact === null && b.daysSinceContact === null) return 0;
    if (a.daysSinceContact === null) return -1;
    if (b.daysSinceContact === null) return 1;
    return b.daysSinceContact - a.daysSinceContact;
  });
}
