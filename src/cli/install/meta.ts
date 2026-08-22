import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const META_PATH = (() => {
  const override = process.env.FRETWORK_HOME;
  const dir = override ?? join(homedir(), ".fretwork");
  return join(dir, "install.json");
})();

export interface InstallMeta {
  version: string;
  tarballUrl?: string;
  tarballSha256?: string;
  installedAt: string;
  /** The hosts that were last wired by the wizard (informational). */
  wiredHosts: string[];
  /** Resolved path to the MCP server binary at install time. */
  mcpCommand: string;
}

export function readInstallMeta(): InstallMeta | null {
  if (!existsSync(META_PATH)) return null;
  try {
    return JSON.parse(readFileSync(META_PATH, "utf-8")) as InstallMeta;
  } catch {
    return null;
  }
}

export function writeInstallMeta(meta: InstallMeta): void {
  mkdirSync(dirname(META_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n");
}

export function metaPath(): string {
  return META_PATH;
}
