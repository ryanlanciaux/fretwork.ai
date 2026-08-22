import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { COLUMN_ADDITIONS, INIT_SQL } from "./init.sql.js";
const ENV_HOME = "FRETWORK_HOME";
const ENV_DB_PATH = "FRETWORK_DB_PATH";
export function fretworkHome() {
    return process.env[ENV_HOME] ?? join(homedir(), ".fretwork");
}
export function dbPath() {
    return process.env[ENV_DB_PATH] ?? join(fretworkHome(), "data.db");
}
let cached = null;
export function openDb() {
    if (cached)
        return cached.db;
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(INIT_SQL);
    applyColumnAdditions(sqlite);
    const db = drizzle(sqlite, { schema });
    cached = { db, sqlite };
    return db;
}
// Bring older DBs forward when new columns are added to schema.ts. INIT_SQL
// is `CREATE TABLE IF NOT EXISTS`, so existing tables don't pick up new
// columns from that path. SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS`, so we probe PRAGMA table_info per column.
function applyColumnAdditions(sqlite) {
    for (const add of COLUMN_ADDITIONS) {
        const cols = sqlite.prepare(`PRAGMA table_info(${add.table})`).all();
        if (cols.some((c) => c.name === add.column))
            continue;
        sqlite.exec(`ALTER TABLE ${add.table} ADD COLUMN ${add.column} ${add.ddl}`);
    }
}
export function closeDb() {
    if (!cached)
        return;
    cached.sqlite.close();
    cached = null;
}
export function rawSqlite() {
    if (!cached)
        openDb();
    return cached.sqlite;
}
