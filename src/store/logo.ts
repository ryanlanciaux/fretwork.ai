import { copyFileSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fretworkHome } from "./db/client.js";

// The business logo is the one config value that names a file on disk, and
// it is agent-settable (update_config). Everything here exists so that an
// agent can never turn it into "read any file": logos must be image files
// that live INSIDE FRETWORK_HOME (~/.fretwork), or inline data URIs. URLs are
// rejected outright — invoices render fully offline.

export const LOGO_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function logoRoot(): string {
  return resolve(fretworkHome());
}

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function isImageDataUri(v: string): boolean {
  return /^data:image\//i.test(v);
}

export function isUrl(v: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^data:/i.test(v);
}

/** Real (symlink-resolved) path if `p` is an image file inside FRETWORK_HOME, else null. */
export function allowedLogoPath(p: string): string | null {
  let real: string;
  try {
    real = realpathSync(expandHome(p));
  } catch {
    return null;
  }
  if (!real.startsWith(logoRoot() + sep)) return null;
  if (!LOGO_MIME_BY_EXT[extname(real).toLowerCase()]) return null;
  return real;
}

export function logoGuidance(): string {
  return (
    `Logos must be an image file (${Object.keys(LOGO_MIME_BY_EXT).join(", ")}) inside ${logoRoot()} — ` +
    `URLs are not supported because invoices render offline. ` +
    `Ask the user for the image file, then run \`fretwork config set --logo <path>\` (it copies the file into ` +
    `${logoRoot()}), or copy it there yourself and set businessLogo to that path.`
  );
}

/**
 * Validate a businessLogo value for storage. Returns the value to store, or
 * throws with actionable guidance. Does NOT copy files — see stageLogoFile.
 */
export function validateLogoValue(v: string): string {
  if (isImageDataUri(v)) return v;
  if (isUrl(v)) throw new Error(`businessLogo "${v.slice(0, 60)}" is a URL. ${logoGuidance()}`);
  const real = allowedLogoPath(v);
  if (!real) throw new Error(`businessLogo "${v}" is not an image file inside ${logoRoot()}. ${logoGuidance()}`);
  return real;
}

/**
 * Copy a user-chosen logo into FRETWORK_HOME so it satisfies validateLogoValue.
 * Used by the CLI (`fretwork init` / `fretwork config set --logo`) where a
 * human (or an agent with a shell, on the user's behalf) chose the file.
 */
export function stageLogoFile(input: string): string {
  if (isImageDataUri(input)) return input;
  if (isUrl(input)) {
    throw new Error(
      `"${input.slice(0, 60)}" is a URL — logo URLs aren't supported (invoices render offline). ` +
        `Save the image locally and pass its path; it will be copied into ${logoRoot()}.`,
    );
  }
  let real: string;
  try {
    real = realpathSync(expandHome(input));
  } catch {
    throw new Error(`Logo file not found: ${input}`);
  }
  const ext = extname(real).toLowerCase();
  if (!LOGO_MIME_BY_EXT[ext]) {
    throw new Error(`Logo must be an image (${Object.keys(LOGO_MIME_BY_EXT).join(", ")}): ${input}`);
  }
  if (real.startsWith(logoRoot() + sep)) return real;
  mkdirSync(logoRoot(), { recursive: true, mode: 0o700 });
  const dst = join(logoRoot(), `logo${ext}`);
  copyFileSync(real, dst);
  return dst;
}
