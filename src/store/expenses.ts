import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { expenses as expensesTable } from "./db/schema.js";
import { openDb } from "./db/client.js";
import { requireClient } from "./clients.js";
import { isIsoDate, newId, round2, todayIso } from "./util.js";
import type {
  AddExpenseInput,
  Expense,
  ListExpensesFilter,
  UpdateExpenseInput,
} from "./types.js";

function rowToExpense(row: typeof expensesTable.$inferSelect): Expense {
  return {
    id: row.id,
    date: row.date,
    clientSlug: row.clientSlug,
    category: row.category,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    quantity: row.quantity,
    unit: row.unit,
    billable: row.billable,
    billed: row.billed,
    invoiceNumber: row.invoiceNumber,
    createdAt: row.createdAt,
  };
}

function resolveClientSlug(input: string | null | undefined): string | null {
  if (input === undefined || input === null || input === "") return null;
  return requireClient(input).slug;
}

export function addExpense(input: AddExpenseInput): Expense {
  if (!input.description || !input.description.trim()) {
    throw new Error("description is required");
  }
  const date = input.date ?? todayIso();
  if (!isIsoDate(date)) throw new Error(`date must be YYYY-MM-DD (got: ${date})`);

  const clientSlug = resolveClientSlug(input.client);
  const db = openDb();
  const id = newId();
  db.insert(expensesTable)
    .values({
      id,
      date,
      clientSlug,
      category: input.category ?? null,
      description: input.description,
      amount: input.amount == null ? null : round2(input.amount),
      currency: input.currency ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      billable: input.billable ?? false,
      billed: false,
      invoiceNumber: null,
      createdAt: Date.now(),
    })
    .run();
  return requireExpense(id);
}

export function getExpense(id: string): Expense | null {
  const db = openDb();
  const row = db.select().from(expensesTable).where(eq(expensesTable.id, id)).all()[0];
  return row ? rowToExpense(row) : null;
}

export function requireExpense(id: string): Expense {
  const e = getExpense(id);
  if (!e) throw new Error(`Expense not found: ${id}`);
  return e;
}

export function listExpenses(filter: ListExpensesFilter = {}): Expense[] {
  const db = openDb();
  const conditions = [];
  if (filter.client) {
    const c = requireClient(filter.client);
    conditions.push(eq(expensesTable.clientSlug, c.slug));
  }
  if (filter.from) {
    if (!isIsoDate(filter.from)) throw new Error(`from must be YYYY-MM-DD (got: ${filter.from})`);
    conditions.push(gte(expensesTable.date, filter.from));
  }
  if (filter.to) {
    if (!isIsoDate(filter.to)) throw new Error(`to must be YYYY-MM-DD (got: ${filter.to})`);
    conditions.push(lte(expensesTable.date, filter.to));
  }
  if (filter.category) {
    conditions.push(eq(expensesTable.category, filter.category));
  }
  if (filter.unbilled) {
    conditions.push(eq(expensesTable.billed, false));
  }
  if (filter.billable !== undefined) {
    conditions.push(eq(expensesTable.billable, filter.billable));
  }
  if (filter.hasAmount === true) {
    conditions.push(isNotNull(expensesTable.amount));
  } else if (filter.hasAmount === false) {
    conditions.push(isNull(expensesTable.amount));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = (where ? db.select().from(expensesTable).where(where) : db.select().from(expensesTable))
    .orderBy(desc(expensesTable.date), asc(expensesTable.createdAt))
    .all();
  return rows.map(rowToExpense);
}

export function updateExpense(id: string, patch: UpdateExpenseInput): Expense {
  const current = requireExpense(id);
  const db = openDb();
  if (patch.date !== undefined && !isIsoDate(patch.date)) {
    throw new Error(`date must be YYYY-MM-DD (got: ${patch.date})`);
  }
  const clientSlug =
    patch.client === undefined
      ? current.clientSlug
      : resolveClientSlug(patch.client);
  db.update(expensesTable)
    .set({
      date: patch.date ?? current.date,
      clientSlug,
      category: patch.category === undefined ? current.category : patch.category,
      description: patch.description ?? current.description,
      amount:
        patch.amount === undefined
          ? current.amount
          : patch.amount == null
            ? null
            : round2(patch.amount),
      currency: patch.currency === undefined ? current.currency : patch.currency,
      quantity: patch.quantity === undefined ? current.quantity : patch.quantity,
      unit: patch.unit === undefined ? current.unit : patch.unit,
      billable: patch.billable === undefined ? current.billable : patch.billable,
    })
    .where(eq(expensesTable.id, id))
    .run();
  return requireExpense(id);
}

export function deleteExpense(id: string): Expense {
  const existing = requireExpense(id);
  const db = openDb();
  db.delete(expensesTable).where(eq(expensesTable.id, id)).run();
  return existing;
}
