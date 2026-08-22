import { randomBytes } from "node:crypto";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "untitled"
  );
}

export function newId(): string {
  return randomBytes(8).toString("hex");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Advance an ISO date by N months, clamping day-of-month to the target
// month's last day so e.g. (2026-01-31, +1) -> 2026-02-28 instead of
// overflowing into March. Used by recurring-invoice cadence math.
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const targetMonth = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86_400_000);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${round2(amount).toFixed(2)}`;
  }
}

export function formatHours(n: number): string {
  return round2(n).toFixed(2);
}
