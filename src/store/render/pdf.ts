import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import { fretworkHome } from "../db/client.js";
import { requireInvoice } from "../invoices.js";
import { renderInvoiceHtml } from "./template.js";

export interface RenderPdfOptions {
  output?: string;
  format?: "Letter" | "A4" | "Legal";
  /** Replace an existing file at `output`. Ignored for the default path. */
  overwrite?: boolean;
}

// We ship `puppeteer-core` (no bundled Chromium) rather than `puppeteer`, so
// PDF generation reuses a Chrome/Chromium the user already has instead of
// downloading ~150MB at install time. The trade-off is we must locate that
// browser ourselves; this resolver checks env overrides first, then the
// well-known install path per platform.
const CHROME_ENV_VARS = [
  "FRETWORK_CHROME_PATH",
  "PUPPETEER_EXECUTABLE_PATH",
  "CHROME_PATH",
] as const;

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
  ],
};

// Names to probe on PATH (linux/mac) when the absolute paths above miss —
// handles non-standard prefixes (Nix, Homebrew, custom distros).
const CHROME_PATH_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
  "brave-browser",
];

function whichOnPath(name: string): string | null {
  try {
    const out = execFileSync(platform() === "win32" ? "where" : "which", [name], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .split(/\r?\n/)[0]
      ?.trim();
    return out && existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Locate a Chrome/Chromium executable, or return null if none is found.
 * Order: explicit env override → known platform path → PATH lookup.
 */
export function resolveChromePath(): string | null {
  for (const v of CHROME_ENV_VARS) {
    const p = process.env[v];
    if (p && existsSync(p)) return p;
  }
  for (const p of CHROME_PATHS[platform()] ?? []) {
    if (existsSync(p)) return p;
  }
  if (platform() !== "win32") {
    for (const name of CHROME_PATH_NAMES) {
      const p = whichOnPath(name);
      if (p) return p;
    }
  }
  return null;
}

const NO_CHROME_MESSAGE =
  "Could not find a Chrome or Chromium browser to render the PDF. Fretwork uses " +
  "the browser already installed on your machine (it no longer bundles its own). " +
  "Install Google Chrome (https://www.google.com/chrome/) or Chromium, or point " +
  "Fretwork at an existing binary with the FRETWORK_CHROME_PATH environment " +
  "variable. You can still get the invoice as HTML with `render_invoice_html` / " +
  "`fretwork invoices render`.";

export async function generateInvoicePdf(
  numberOrId: string,
  opts: RenderPdfOptions = {},
): Promise<string> {
  const inv = requireInvoice(numberOrId);
  const html = renderInvoiceHtml(inv.number);

  const defaultDir = join(fretworkHome(), "invoices", inv.number);
  const outPath = (() => {
    if (!opts.output) return join(defaultDir, "invoice.pdf");
    const p = isAbsolute(opts.output) ? opts.output : join(process.cwd(), opts.output);
    // `output` is agent-controlled: only ever write *.pdf, and never replace
    // an existing file unless the caller says so. (The default path under
    // ~/.fretwork/invoices/ is ours and may be re-rendered freely.)
    if (!/\.pdf$/i.test(p)) throw new Error(`output must end with .pdf (got ${opts.output})`);
    if (existsSync(p) && !opts.overwrite) {
      throw new Error(`${p} already exists — pass overwrite: true (CLI: --overwrite) to replace it`);
    }
    return p;
  })();
  mkdirSync(dirname(outPath), { recursive: true });

  const executablePath = resolveChromePath();
  if (!executablePath) throw new Error(NO_CHROME_MESSAGE);

  const puppeteerMod = await import("puppeteer-core");
  const puppeteer = puppeteerMod.default ?? (puppeteerMod as unknown as typeof puppeteerMod.default);
  // Chrome's sandbox stays ON unless we're root (containers, Grok Bot's
  // VM) or the user opts out with FRETWORK_CHROME_NO_SANDBOX=1.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const noSandbox = isRoot || process.env.FRETWORK_CHROME_NO_SANDBOX === "1";
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  try {
    const page = await browser.newPage();
    // The invoice template is user/agent-editable HTML. Render it as a
    // static document, fully offline: no JavaScript (so no fetch/WebSocket/
    // beacon exfiltration), and every request except data: URIs refused —
    // including http(s) and file:// — so a template can't leak invoice data
    // or read local files through Chrome.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") {
        void req.continue();
      } else {
        void req.abort("blockedbyclient");
      }
    });
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outPath,
      format: opts.format ?? "Letter",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
  } finally {
    await browser.close();
  }
  return outPath;
}
