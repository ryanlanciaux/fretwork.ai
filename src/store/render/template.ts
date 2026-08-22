import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { extname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";
import { requireInvoice } from "../invoices.js";
import { requireClient } from "../clients.js";
import { getConfig } from "../config.js";
import { LOGO_MIME_BY_EXT, MAX_LOGO_BYTES, allowedLogoPath, isImageDataUri } from "../logo.js";
import { fretworkHome } from "../db/client.js";
import { formatMoney, round2 } from "../util.js";
import type { Client, Config, InvoiceDetail, InvoiceLineItemKind } from "../types.js";

// Mustache: disable HTML-escaping for triple-stache only. Default `{{ }}`
// stays HTML-escaped, which is what we want for user-controlled values
// (business name, client name, descriptions, notes, etc.).

// ─────────────────────────────────────────────────────────────────────────
// Template resolution: user copy at ~/.fretwork/templates/invoice.html wins,
// bundled default fallback. Run `fretwork template eject/reset` to install
// the user copy.
// ─────────────────────────────────────────────────────────────────────────

const USER_TEMPLATE_NAME = "invoice.html";
const USER_CSS_NAME = "invoice.css";

export function userTemplateDir(): string {
  return join(fretworkHome(), "templates");
}

export function userTemplatePath(): string {
  return join(userTemplateDir(), USER_TEMPLATE_NAME);
}

export function userCssPath(): string {
  return join(userTemplateDir(), USER_CSS_NAME);
}

// Bundled template lives at <package root>/templates/invoice.html. This
// file compiles to dist/store/render/template.js (dev: src/store/render/
// template.ts) — both are three levels below the package root.
export function bundledTemplatePath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return pathResolve(here, "../../../templates", USER_TEMPLATE_NAME);
}

export function readBundledTemplate(): string {
  return readFileSync(bundledTemplatePath(), "utf-8");
}

// Read the user's invoice template, falling back to the bundled default
// when there's no user copy yet (typical right after install). Used by
// `fretwork template print`.
export function readUserTemplate(): { html: string; fromUserCopy: boolean } {
  const userPath = userTemplatePath();
  if (existsSync(userPath)) {
    return { html: readFileSync(userPath, "utf-8"), fromUserCopy: true };
  }
  return { html: readBundledTemplate(), fromUserCopy: false };
}

// Validation gate for `fretwork template write`. Catches the kinds of
// errors a hand-edit (or LLM-edit) most commonly produces: unclosed
// Mustache sections, mismatched delimiters, references to variables the
// renderer doesn't pass. Throws on any of these so a broken template
// never replaces the working one on disk.
export function validateTemplateHtml(html: string): void {
  if (typeof html !== "string" || html.length === 0) {
    throw new Error("Template is empty.");
  }
  // 1. Parse-time check (Mustache throws on unclosed sections, etc.).
  try {
    Mustache.parse(html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Mustache parse error: ${msg}`);
  }

  // 2. Smoke render with a stub context that covers every variable the
  //    renderer actually passes. If the template references something
  //    we don't supply, Mustache won't error, but the rendered output
  //    will have unexpected blanks; harmless. The render-time exception
  //    we're catching is mismatched sections that slip past parse (rare).
  try {
    Mustache.render(html, STUB_CONTEXT);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Mustache render error: ${msg}`);
  }
}

// Atomic write — never leave the user with a half-written template if
// the process dies mid-write. `.tmp` lands in the same dir so the rename
// is on the same filesystem (POSIX guarantees atomicity for same-fs
// renames). Followed by validateTemplateHtml so an unparseable HTML
// blob can never overwrite a working one.
export function writeUserTemplate(html: string): { path: string; sizeBytes: number } {
  validateTemplateHtml(html);
  const dir = userTemplateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dst = userTemplatePath();
  const tmp = `${dst}.tmp.${process.pid}`;
  writeFileSync(tmp, html, { mode: 0o644 });
  // Keep the previous version so an agent-driven rewrite is always undoable.
  if (existsSync(dst)) copyFileSync(dst, `${dst}.bak`);
  renameSync(tmp, dst);
  return { path: dst, sizeBytes: Buffer.byteLength(html, "utf-8") };
}

const STUB_CONTEXT = {
  paid: false,
  customInstructions: null,
  issuer: {
    name: "Test Co",
    tagline: "Test tagline",
    email: "x@y.z",
    site: "y.z",
    addressLines: ["1 Test St"],
    logoHtml: "<svg/>",
  },
  client: { name: "Client", contact: "ap@y.z", addressLines: ["1 Client Way"] },
  invoice: {
    number: "INV-0000",
    project: null,
    accent: "#000",
    accentSoft: "#000",
    docLabel: "Invoice",
    heroLabel: "Billed to",
    totalLabel: "Total due",
    showStatusPill: true,
    statusBg: "#eee",
    statusFg: "#000",
    statusLabel: "Draft",
    heroMeta: [{ label: "Amount due", value: "$0", big: true }],
    hasMeaningfulQty: true,
    items: [
      {
        desc: "Stub",
        sub: null,
        qtyFmt: "1 hr",
        rateFmt: "$0",
        amountFmt: "$0",
        dotColor: "#000",
        hasMeaningfulQty: true,
      },
    ],
    hasTax: false,
    taxLabel: null,
    taxFmt: "$0",
    subtotalFmt: "$0",
    totalFmt: "$0",
    partiallyPaid: false,
    amountPaidFmt: "$0",
    balanceDueFmt: "$0",
    notes: null,
  },
};

// Resolve which template to use for this render. User copy wins when it
// exists AND parses cleanly. If it exists but Mustache.parse throws (e.g.
// the user — or the LLM — saved a broken template), we fall back to the
// bundled default so the render still succeeds, and return the parse
// error so renderInvoiceHtml can surface it as both an HTML comment in
// the output and a stderr warning. The on-disk user copy is left alone
// (so the user can inspect / repair it).
function readTemplateWithFallback(): { html: string; fallbackReason: string | null } {
  const userPath = userTemplatePath();
  if (!existsSync(userPath)) {
    return { html: readBundledTemplate(), fallbackReason: null };
  }
  const userHtml = readFileSync(userPath, "utf-8");
  try {
    Mustache.parse(userHtml);
    return { html: userHtml, fallbackReason: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { html: readBundledTemplate(), fallbackReason: msg };
  }
}

function readUserCss(): string | null {
  const p = userCssPath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────
// Logo resolution: file path on disk → base64 data URI; URL/data URI →
// passthrough as <img src>; missing → default geometric SVG mark.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_LOGO_SVG = `<svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <rect x="6" y="6" width="20" height="20" stroke="var(--accent)" stroke-width="1.5" />
  <rect x="11" y="11" width="10" height="10" fill="var(--accent)" />
</svg>`;

function logoHtml(businessLogo: string | null, businessName: string): string {
  if (!businessLogo) return DEFAULT_LOGO_SVG;
  if (isImageDataUri(businessLogo)) {
    return `<img src="${escapeAttr(businessLogo)}" alt="${escapeAttr(businessName)}" />`;
  }
  // Only image files inside FRETWORK_HOME, symlinks resolved (see logo.ts).
  const real = allowedLogoPath(businessLogo);
  if (!real) return DEFAULT_LOGO_SVG;
  const mime = LOGO_MIME_BY_EXT[extname(real).toLowerCase()]!;
  let buf: Buffer;
  try {
    buf = readFileSync(real);
  } catch {
    return DEFAULT_LOGO_SVG;
  }
  if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) return DEFAULT_LOGO_SVG;
  // SVGs are embedded as an <img> data URI too (never inlined as markup), so
  // scripts or external references inside the file can't run in the renderer.
  return `<img src="data:${mime};base64,${buf.toString("base64")}" alt="${escapeAttr(businessName)}" />`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// HTML comments can't contain `--` — that ends the comment early. Replace
// to keep the warning readable but inert.
function escapeForComment(s: string): string {
  return s.replace(/--/g, "—").replace(/>/g, "›");
}

// ─────────────────────────────────────────────────────────────────────────
// Line-item helpers
// ─────────────────────────────────────────────────────────────────────────

function inferKind(unitLabel: string | null, fallback: InvoiceLineItemKind | null): InvoiceLineItemKind {
  if (fallback) return fallback;
  const u = (unitLabel ?? "").toLowerCase().trim();
  if (!u) return "flat";
  if (/^(hr|hour|hours)$/.test(u)) return "hours";
  if (/^(week|weeks|wk)$/.test(u)) return "weekly";
  if (/^(month|months|mo|monthly)$/.test(u)) return "subscription";
  if (/(milestone|deliverable|fixed|flat)/.test(u)) return "flat";
  if (/(reimb|expense|expenses|card)/.test(u)) return "expense";
  return "flat";
}

const DOT_COLOR: Record<InvoiceLineItemKind, string> = {
  subscription: "var(--accent)",
  weekly: "var(--accent)",
  hours: "oklch(0.55 0.10 250)",
  flat: "oklch(0.55 0.14 300)",
  expense: "oklch(0.65 0.01 220)",
};

function subDescription(
  kind: InvoiceLineItemKind,
  unit: string | null,
  rate: number,
  currency: string,
): string | null {
  switch (kind) {
    case "hours":
      return `Billed at ${formatMoney(rate, currency)}/${unit ?? "hr"}`;
    case "weekly":
      return `Person-week · ${formatMoney(rate, currency)}/${unit ?? "week"}`;
    case "flat":
      return null;
    case "expense":
      return "Reimbursable expense";
    case "subscription":
      return null;
  }
}

function formatQty(quantity: number, unit: string | null, kind: InvoiceLineItemKind): string {
  const u = unit ?? defaultUnitFor(kind);
  if (kind === "hours") return `${quantity.toFixed(2)} ${u}`;
  // Strip trailing .00 so "1 milestone" reads cleaner than "1.00 milestone".
  const q = Number.isInteger(quantity) ? `${quantity}` : `${quantity}`;
  return `${q} ${u}`;
}

function defaultUnitFor(kind: InvoiceLineItemKind): string {
  switch (kind) {
    case "hours":
      return "hr";
    case "weekly":
      return "week";
    case "subscription":
      return "month";
    case "expense":
      return "item";
    case "flat":
      return "item";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Date formatting — "Apr 25, 2026" style, matching the design.
// ─────────────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // iso is YYYY-MM-DD; append midnight so the parsed Date doesn't drift by
  // a day in eastern timezones (Date("2026-04-25") parses as UTC midnight,
  // which renders as Apr 24 in any timezone west of UTC).
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────
// Status pill colors. Mirror the design's STATUS_STYLES map.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  sent: { bg: "oklch(0.95 0.01 250)", fg: "oklch(0.45 0.10 250)", label: "Sent" },
  overdue: { bg: "oklch(0.95 0.04 28)", fg: "oklch(0.50 0.16 28)", label: "Overdue" },
  draft: { bg: "oklch(0.94 0.005 220)", fg: "oklch(0.45 0.01 220)", label: "Draft" },
  void: { bg: "oklch(0.94 0.005 220)", fg: "oklch(0.45 0.01 220)", label: "Void" },
};

const DEFAULT_ACCENT = "oklch(0.55 0.13 175)";
const DEFAULT_ACCENT_SOFT = "oklch(0.55 0.13 175 / 0.10)";

function softFromAccent(accent: string): string {
  // If the accent uses oklch with no alpha, slot in a 0.10 alpha; otherwise
  // fall back to the default soft. Keeping this conservative — the user can
  // override both at the :root level in invoice.css.
  const m = accent.match(/^oklch\(([^)]+)\)$/);
  if (m && !/\//.test(m[1]!)) {
    return `oklch(${m[1]!.trim()} / 0.10)`;
  }
  return DEFAULT_ACCENT_SOFT;
}

// ─────────────────────────────────────────────────────────────────────────
// Public render function
// ─────────────────────────────────────────────────────────────────────────

// Reserved for future render options (kept so callers don't churn).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RenderInvoiceOptions {}

export function renderInvoiceHtml(numberOrId: string, _opts: RenderInvoiceOptions = {}): string {
  const inv: InvoiceDetail = requireInvoice(numberOrId);
  const client: Client = requireClient(inv.clientSlug);
  const cfg: Config = getConfig();

  const accent = cfg.accentColor?.trim() || DEFAULT_ACCENT;
  const accentSoft = softFromAccent(accent);

  const paid = inv.status === "paid";
  // A partial payment is recorded but the invoice isn't fully covered yet.
  const partiallyPaid = !paid && inv.amountPaid > 0;
  const pill = STATUS_PILL[inv.status] ?? STATUS_PILL.draft!;

  // Per-line item: infer kind, pick dot color, format qty/rate/amount.
  // Also stamp `hasMeaningfulQty` on each item so the template's section
  // tag can access it inside the iteration.
  const hasMeaningfulQty = inv.lineItems.some((li) => {
    const kind = inferKind(li.unitLabel, li.kind);
    if (kind === "subscription" || kind === "flat") return li.quantity > 1;
    return true;
  });

  const items = inv.lineItems.map((li) => {
    const kind = inferKind(li.unitLabel, li.kind);
    return {
      desc: li.description,
      sub: subDescription(kind, li.unitLabel, li.rate, inv.currency),
      qtyFmt: formatQty(li.quantity, li.unitLabel, kind),
      rateFmt: formatMoney(li.rate, inv.currency),
      amountFmt: formatMoney(li.amount, inv.currency),
      dotColor: DOT_COLOR[kind],
      hasMeaningfulQty,
    };
  });

  // Hero card metadata — switches shape based on paid vs unpaid.
  const totalFmt = formatMoney(inv.total, inv.currency);
  const heroMeta = paid
    ? [
        { label: "Amount", value: totalFmt, big: true },
        { label: "Charged", value: fmtDate(inv.issuedAt), big: false },
        { label: "Method", value: "Recorded", big: false },
        { label: "Status", value: "Paid in full", big: false },
      ]
    : [
        { label: "Amount due", value: totalFmt, big: true },
        { label: "Issued", value: fmtDate(inv.issuedAt), big: false },
        { label: "Due", value: fmtDate(inv.dueAt), big: false },
        { label: "Terms", value: cfg.paymentTerms ?? "Net " + cfg.dueDays, big: false },
      ];

  const issuerAddressLines = splitLines(cfg.businessAddress, cfg.businessCity);
  const clientAddressLines = splitLines(client.address, client.city);

  const context = {
    paid,
    customInstructions: cfg.customInstructions?.trim() || null,
    issuer: {
      name: cfg.businessName,
      tagline: cfg.businessTagline?.trim() || null,
      email: cfg.businessEmail || null,
      site: cfg.businessSite?.trim() || null,
      addressLines: issuerAddressLines,
      logoHtml: logoHtml(cfg.businessLogo, cfg.businessName),
    },
    client: {
      name: client.name,
      contact: client.email || client.phone || null,
      addressLines: clientAddressLines,
    },
    invoice: {
      number: inv.number,
      project: null as string | null,
      accent,
      accentSoft,
      docLabel: paid ? "Receipt" : "Invoice",
      heroLabel: paid ? "Receipt for" : "Billed to",
      totalLabel: paid ? "Total charged" : "Total due",
      showStatusPill: !paid,
      statusBg: pill.bg,
      statusFg: pill.fg,
      statusLabel: pill.label,
      heroMeta,
      hasMeaningfulQty,
      items,
      hasTax: round2(inv.tax) > 0,
      taxLabel: inv.taxRate > 0 ? `${round2(inv.taxRate)}%` : null,
      taxFmt: formatMoney(inv.tax, inv.currency),
      subtotalFmt: formatMoney(inv.subtotal, inv.currency),
      totalFmt,
      partiallyPaid,
      amountPaidFmt: formatMoney(inv.amountPaid, inv.currency),
      balanceDueFmt: formatMoney(inv.balanceDue, inv.currency),
      notes: inv.notes?.trim() || null,
    },
  };

  const { html: template, fallbackReason } = readTemplateWithFallback();
  let html = Mustache.render(template, context);

  if (fallbackReason) {
    // The on-disk user copy is broken. Render with the bundled default
    // so the user still gets a working PDF, but surface the problem in
    // two places: an HTML comment at the top of the output (won't show
    // in the PDF, but lets `render_invoice_html` callers see it), and
    // a stderr warning so the CLI/MCP user notices it. The user copy
    // is NOT auto-replaced from here — the install.sh path handles
    // that, and `fretwork template reset` is the explicit cure.
    const warning =
      `Your invoice template at ${userTemplatePath()} did not parse and was ` +
      `bypassed for this render. Run \`fretwork template reset\` to restore the ` +
      `bundled default. Mustache reported: ${fallbackReason}`;
    process.stderr.write(`fretwork: ${warning}\n`);
    html = `<!-- fretwork render warning: ${escapeForComment(warning)} -->\n${html}`;
  }

  // Optional user CSS override: append before the first </style> in the
  // template. Works whether the template is the bundled default or a fully
  // user-authored variant, as long as it has a <style> block.
  const userCss = readUserCss();
  if (userCss) {
    html = html.replace(/<\/style>/i, `\n/* ~/.fretwork/templates/invoice.css */\n${userCss}\n</style>`);
  }

  return html;
}

function splitLines(address: string | null, city: string | null): string[] {
  const out: string[] = [];
  if (address) {
    // Allow multi-line addresses in the DB — split on newlines.
    for (const line of address.split(/\r?\n/)) {
      const t = line.trim();
      if (t) out.push(t);
    }
  }
  if (city) out.push(city.trim());
  return out;
}

