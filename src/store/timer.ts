import { eq } from "drizzle-orm";
import { activeTimer as timerTable } from "./db/schema.js";
import { openDb } from "./db/client.js";
import { requireClient } from "./clients.js";
import { logTime } from "./time.js";
import { round2 } from "./util.js";
import type {
  ActiveTimer,
  StartTimerInput,
  StopTimerInput,
  TimerStopResult,
  UpdateActiveTimerInput,
} from "./types.js";

const SINGLETON_ID = "active";

function rowToTimer(row: typeof timerTable.$inferSelect): ActiveTimer {
  return {
    id: row.id,
    clientSlug: row.clientSlug,
    project: row.project,
    description: row.description,
    rate: row.rate,
    startedAt: row.startedAt,
  };
}

export function getActiveTimer(): ActiveTimer | null {
  const db = openDb();
  const row = db
    .select()
    .from(timerTable)
    .where(eq(timerTable.id, SINGLETON_ID))
    .all()[0];
  return row ? rowToTimer(row) : null;
}

export function startTimer(input: StartTimerInput = {}): ActiveTimer {
  const existing = getActiveTimer();
  if (existing) {
    const ageMs = Date.now() - existing.startedAt;
    const minutes = Math.floor(ageMs / 60000);
    const target = existing.clientSlug ?? "(no client)";
    throw new Error(
      `A timer is already running for ${target} (started ${minutes}m ago). ` +
        `Stop or cancel it first.`,
    );
  }

  // Validate client up-front so we fail fast instead of at stop time.
  const clientSlug = input.client ? requireClient(input.client).slug : null;

  const db = openDb();
  db.insert(timerTable)
    .values({
      id: SINGLETON_ID,
      clientSlug,
      project: input.project ?? null,
      description: input.description ?? null,
      rate: input.rate ?? null,
      startedAt: Date.now(),
    })
    .run();

  return getActiveTimer()!;
}

// Mutate the metadata on the running timer without restarting it. Useful
// for "attach a description while it's still going" — passing null on a
// field clears it, omitting the field leaves it as-is. Does NOT touch
// startedAt, so the elapsed time the user sees doesn't reset.
export function updateActiveTimer(patch: UpdateActiveTimerInput): ActiveTimer {
  const current = getActiveTimer();
  if (!current) throw new Error("No active timer.");

  const clientSlug =
    patch.client === undefined
      ? current.clientSlug
      : patch.client === null || patch.client === ""
        ? null
        : requireClient(patch.client).slug;

  const db = openDb();
  db.update(timerTable)
    .set({
      clientSlug,
      project: patch.project === undefined ? current.project : patch.project,
      description: patch.description === undefined ? current.description : patch.description,
      rate: patch.rate === undefined ? current.rate : patch.rate,
    })
    .where(eq(timerTable.id, SINGLETON_ID))
    .run();

  return getActiveTimer()!;
}

export function cancelTimer(): ActiveTimer | null {
  const existing = getActiveTimer();
  if (!existing) return null;
  const db = openDb();
  db.delete(timerTable).where(eq(timerTable.id, SINGLETON_ID)).run();
  return existing;
}

export function stopTimer(input: StopTimerInput = {}): TimerStopResult {
  const active = getActiveTimer();
  if (!active) throw new Error("No active timer.");

  const clientArg = input.client ?? active.clientSlug;
  if (!clientArg) {
    throw new Error(
      "Timer has no client. Pass --client to associate it with one (or cancel the timer).",
    );
  }

  const stoppedAt = Date.now();
  const elapsedMs = stoppedAt - active.startedAt;
  // Round to 2 decimals but floor at 0.01h (~36s) so very short timers
  // still log something rather than failing logTime's hours > 0 check.
  const hours = Math.max(0.01, round2(elapsedMs / 3_600_000));

  const db = openDb();
  db.delete(timerTable).where(eq(timerTable.id, SINGLETON_ID)).run();

  // Bucket the entry by the start date (the day the work began), not the
  // stop date — matters for timers that cross midnight.
  const startDate = new Date(active.startedAt).toISOString().slice(0, 10);
  const entry = logTime({
    client: clientArg,
    date: startDate,
    hours,
    rate: input.rate ?? active.rate ?? null,
    project: input.project ?? active.project ?? null,
    description: input.description ?? active.description ?? "",
  });

  return { timer: active, entry, elapsedMs };
}
