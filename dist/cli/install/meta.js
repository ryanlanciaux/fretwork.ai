import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const META_PATH = (() => {
    const override = process.env.FRETWORK_HOME;
    const dir = override ?? join(homedir(), ".fretwork");
    return join(dir, "install.json");
})();
export function readInstallMeta() {
    if (!existsSync(META_PATH))
        return null;
    try {
        return JSON.parse(readFileSync(META_PATH, "utf-8"));
    }
    catch {
        return null;
    }
}
export function writeInstallMeta(meta) {
    mkdirSync(dirname(META_PATH), { recursive: true, mode: 0o700 });
    writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n");
}
export function metaPath() {
    return META_PATH;
}
