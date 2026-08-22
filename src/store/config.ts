import { validateLogoValue } from "./logo.js";
import { eq, sql } from "drizzle-orm";
import { config as configTable } from "./db/schema.js";
import { openDb } from "./db/client.js";
import type { Config, UpdateConfigInput } from "./types.js";

const CONFIG_ID = 1;

const DEFAULTS = {
  businessName: "Your Business",
  businessEmail: "you@example.com",
  defaultRate: 100,
  taxRate: 0,
  currency: "USD",
  dueDays: 14,
};

function rowToConfig(row: typeof configTable.$inferSelect): Config {
  return {
    businessName: row.businessName,
    businessEmail: row.businessEmail,
    businessAddress: row.businessAddress,
    businessCity: row.businessCity,
    businessPhone: row.businessPhone,
    businessLogo: row.businessLogo,
    businessTagline: row.businessTagline,
    businessSite: row.businessSite,
    accentColor: row.accentColor,
    customInstructions: row.customInstructions,
    defaultRate: row.defaultRate,
    taxRate: row.taxRate,
    currency: row.currency,
    dueDays: row.dueDays,
    paymentTerms: row.paymentTerms,
    invoiceTemplate: row.invoiceTemplate,
    updatedAt: row.updatedAt,
  };
}

export function getConfig(): Config {
  const db = openDb();
  const rows = db.select().from(configTable).where(eq(configTable.id, CONFIG_ID)).all();
  const row = rows[0];
  if (row) return rowToConfig(row);
  // Lazy-initialize the singleton row on first read.
  const now = Date.now();
  db.insert(configTable)
    .values({
      id: CONFIG_ID,
      businessName: DEFAULTS.businessName,
      businessEmail: DEFAULTS.businessEmail,
      businessAddress: null,
      businessCity: null,
      businessPhone: null,
      businessLogo: null,
      businessTagline: null,
      businessSite: null,
      accentColor: null,
      customInstructions: null,
      defaultRate: DEFAULTS.defaultRate,
      taxRate: DEFAULTS.taxRate,
      currency: DEFAULTS.currency,
      dueDays: DEFAULTS.dueDays,
      paymentTerms: null,
      invoiceTemplate: null,
      updatedAt: now,
    })
    .run();
  const inserted = db.select().from(configTable).where(eq(configTable.id, CONFIG_ID)).all()[0]!;
  return rowToConfig(inserted);
}

export function updateConfig(patch: UpdateConfigInput): Config {
  const current = getConfig();
  const db = openDb();
  const now = Date.now();
  const next = {
    businessName: patch.businessName ?? current.businessName,
    businessEmail: patch.businessEmail ?? current.businessEmail,
    businessAddress:
      patch.businessAddress === undefined ? current.businessAddress : patch.businessAddress,
    businessCity:
      patch.businessCity === undefined ? current.businessCity : patch.businessCity,
    businessPhone:
      patch.businessPhone === undefined ? current.businessPhone : patch.businessPhone,
    businessLogo:
      patch.businessLogo === undefined
        ? current.businessLogo
        : patch.businessLogo
          ? validateLogoValue(patch.businessLogo)
          : null,
    businessTagline:
      patch.businessTagline === undefined ? current.businessTagline : patch.businessTagline,
    businessSite:
      patch.businessSite === undefined ? current.businessSite : patch.businessSite,
    accentColor:
      patch.accentColor === undefined ? current.accentColor : patch.accentColor,
    customInstructions:
      patch.customInstructions === undefined
        ? current.customInstructions
        : patch.customInstructions,
    defaultRate: patch.defaultRate ?? current.defaultRate,
    taxRate: patch.taxRate ?? current.taxRate,
    currency: patch.currency ?? current.currency,
    dueDays: patch.dueDays ?? current.dueDays,
    paymentTerms:
      patch.paymentTerms === undefined ? current.paymentTerms : patch.paymentTerms,
    invoiceTemplate:
      patch.invoiceTemplate === undefined ? current.invoiceTemplate : patch.invoiceTemplate,
    updatedAt: now,
  };
  db.update(configTable).set(next).where(eq(configTable.id, CONFIG_ID)).run();
  return { ...next };
}

// Touch DB so callers can pre-create the singleton row before they need it.
export function ensureConfig(): void {
  getConfig();
}

// Used by `fretwork init` to seed config in one shot.
export function bootstrapConfig(input: UpdateConfigInput & { businessName: string; businessEmail: string }): Config {
  ensureConfig();
  return updateConfig(input);
}

// Internal: bump updatedAt only.
export function touchConfig(): void {
  const db = openDb();
  db.update(configTable).set({ updatedAt: sql`${Date.now()}` }).where(eq(configTable.id, CONFIG_ID)).run();
}
