import {
  cancelTimer,
  deleteTimeEntry,
  getActiveTimer,
  getTimeEntry,
  listTimeEntries,
  logTime,
  startTimer,
  stopTimer,
  summariseTime,
  updateActiveTimer,
  updateTimeEntry,
} from "../../store/index.js";
import { emitJson, emitOk, emitTable, fail, tryRun } from "../output.js";

function fmtElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

interface LogOpts {
  client: string;
  date?: string;
  hours: string;
  rate?: string;
  project?: string;
  description?: string;
  json?: boolean;
}

export function runTimeLog(opts: LogOpts): void {
  if (!opts.client) fail("--client is required");
  if (opts.hours === undefined) fail("--hours is required");
  const hours = Number(opts.hours);
  if (!Number.isFinite(hours) || hours <= 0) fail("--hours must be > 0");
  const e = tryRun(
    () =>
      logTime({
        client: opts.client,
        date: opts.date,
        hours,
        rate: opts.rate ? Number(opts.rate) : null,
        project: opts.project ?? null,
        description: opts.description ?? "",
      }),
    opts.json,
  );
  if (opts.json) return emitJson(e);
  emitOk(`Logged ${e.hours}h to ${e.clientSlug} on ${e.date}`);
}

interface ListOpts {
  client?: string;
  from?: string;
  to?: string;
  unbilled?: boolean;
  project?: string;
  json?: boolean;
}

export function runTimeList(opts: ListOpts): void {
  const rows = tryRun(
    () =>
      listTimeEntries({
        client: opts.client,
        from: opts.from,
        to: opts.to,
        unbilled: opts.unbilled,
        project: opts.project,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(rows);
  emitTable(
    rows.map((e) => ({
      date: e.date,
      client: e.clientSlug,
      project: e.project,
      hours: e.hours,
      rate: e.rate,
      billed: e.billed ? e.invoiceNumber ?? "yes" : "—",
      description: (e.description ?? "").slice(0, 50),
    })),
    ["date", "client", "project", "hours", "rate", "billed", "description"],
  );
}

interface SummaryOpts {
  client?: string;
  from?: string;
  to?: string;
  json?: boolean;
}

interface StartOpts {
  client?: string;
  project?: string;
  description?: string;
  rate?: string;
  json?: boolean;
}

export function runTimeStart(opts: StartOpts): void {
  const timer = tryRun(
    () =>
      startTimer({
        client: opts.client,
        project: opts.project ?? null,
        description: opts.description ?? null,
        rate: opts.rate ? Number(opts.rate) : null,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(timer);
  const target = timer.clientSlug ?? "(no client)";
  emitOk(`Timer started for ${target}.`);
}

interface StopOpts {
  client?: string;
  project?: string;
  description?: string;
  rate?: string;
  json?: boolean;
}

export function runTimeStop(opts: StopOpts): void {
  const result = tryRun(
    () =>
      stopTimer({
        client: opts.client,
        project: opts.project ?? null,
        description: opts.description ?? null,
        rate: opts.rate ? Number(opts.rate) : null,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(result);
  emitOk(
    `Stopped after ${fmtElapsed(result.elapsedMs)} — logged ${result.entry.hours}h ` +
      `to ${result.entry.clientSlug} on ${result.entry.date}.`,
  );
}

interface StatusOpts {
  json?: boolean;
}

export function runTimeStatus(opts: StatusOpts): void {
  const timer = getActiveTimer();
  if (opts.json) return emitJson(timer);
  if (!timer) {
    process.stdout.write("No active timer.\n");
    return;
  }
  const elapsed = fmtElapsed(Date.now() - timer.startedAt);
  const target = timer.clientSlug ?? "(no client)";
  process.stdout.write(
    `Active timer: ${target} — running for ${elapsed}` +
      (timer.project ? ` [${timer.project}]` : "") +
      (timer.description ? `\n  ${timer.description}` : "") +
      "\n",
  );
}

export function runTimeCancel(opts: { json?: boolean }): void {
  const timer = tryRun(() => cancelTimer(), opts.json);
  if (opts.json) return emitJson({ cancelled: timer });
  if (!timer) {
    process.stdout.write("No active timer.\n");
    return;
  }
  const elapsed = fmtElapsed(Date.now() - timer.startedAt);
  emitOk(`Cancelled timer (was running for ${elapsed}).`);
}

interface GetEntryOpts { json?: boolean }

export function runTimeGet(id: string, opts: GetEntryOpts): void {
  const e = tryRun(() => getTimeEntry(id), opts.json);
  if (!e) fail(`not found: ${id}`);
  if (opts.json) return emitJson(e);
  process.stdout.write(JSON.stringify(e, null, 2) + "\n");
}

interface UpdateEntryOpts {
  client?: string;
  date?: string;
  hours?: string;
  rate?: string;
  clearRate?: boolean;
  project?: string;
  description?: string;
  json?: boolean;
}

export function runTimeUpdate(id: string, opts: UpdateEntryOpts): void {
  const patch: Parameters<typeof updateTimeEntry>[1] = {};
  if (opts.client !== undefined) patch.client = opts.client;
  if (opts.date !== undefined) patch.date = opts.date;
  if (opts.hours !== undefined) {
    const h = Number(opts.hours);
    if (!Number.isFinite(h) || h <= 0) fail("--hours must be > 0");
    patch.hours = h;
  }
  if (opts.clearRate) patch.rate = null;
  else if (opts.rate !== undefined) {
    const r = Number(opts.rate);
    if (!Number.isFinite(r)) fail("--rate must be numeric");
    patch.rate = r;
  }
  if (opts.project !== undefined) patch.project = opts.project === "" ? null : opts.project;
  if (opts.description !== undefined) patch.description = opts.description;
  const e = tryRun(() => updateTimeEntry(id, patch), opts.json);
  if (opts.json) return emitJson(e);
  emitOk(`Updated time entry ${e.id}.`);
}

export function runTimeDelete(id: string, opts: { json?: boolean }): void {
  const e = tryRun(() => deleteTimeEntry(id), opts.json);
  if (opts.json) return emitJson({ deleted: e });
  emitOk(`Deleted time entry ${e.id} (${e.hours}h on ${e.clientSlug}/${e.date}).`);
}

interface TimerUpdateOpts {
  client?: string;
  clearClient?: boolean;
  project?: string;
  description?: string;
  rate?: string;
  json?: boolean;
}

export function runTimerUpdate(opts: TimerUpdateOpts): void {
  const patch: Parameters<typeof updateActiveTimer>[0] = {};
  if (opts.clearClient) patch.client = null;
  else if (opts.client !== undefined) patch.client = opts.client;
  if (opts.project !== undefined) patch.project = opts.project === "" ? null : opts.project;
  if (opts.description !== undefined)
    patch.description = opts.description === "" ? null : opts.description;
  if (opts.rate !== undefined) {
    const r = Number(opts.rate);
    if (!Number.isFinite(r)) fail("--rate must be numeric");
    patch.rate = r;
  }
  const t = tryRun(() => updateActiveTimer(patch), opts.json);
  if (opts.json) return emitJson(t);
  const target = t.clientSlug ?? "(no client)";
  emitOk(`Updated active timer (${target}).`);
}

export function runTimeSummary(opts: SummaryOpts): void {
  const rows = tryRun(
    () =>
      summariseTime({
        client: opts.client,
        from: opts.from,
        to: opts.to,
      }),
    opts.json,
  );
  if (opts.json) return emitJson(rows);
  emitTable(
    rows.map((r) => ({
      client: r.client,
      hours: r.hours,
      unbilled: r.unbilledHours,
      entries: r.entries,
      revenue: r.revenue.toFixed(2),
    })),
    ["client", "hours", "unbilled", "entries", "revenue"],
  );
}
