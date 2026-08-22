import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
export const ALL_HOST_IDS = [
    "claude",
    "claude-desktop",
    "cursor",
    "opencode",
    "codex",
    "hermes",
    "openclaw",
    "grok",
    "manual",
];
export function isHostId(v) {
    return ALL_HOST_IDS.includes(v);
}
// Hermes Agent (Nous Research) — ~/.hermes, or HERMES_HOME.
export function hermesHome() {
    return process.env.HERMES_HOME ?? resolve(homedir(), ".hermes");
}
// OpenClaw — state dir ~/.openclaw (OPENCLAW_STATE_DIR); the agent workspace
// (OPENCLAW_WORKSPACE_DIR, default <state>/workspace) is where skills load
// from with the highest precedence.
export function openclawStateDir() {
    return process.env.OPENCLAW_STATE_DIR ?? resolve(homedir(), ".openclaw");
}
export function openclawWorkspaceDir() {
    return process.env.OPENCLAW_WORKSPACE_DIR ?? resolve(openclawStateDir(), "workspace");
}
// Grok Build (xAI's terminal coding agent) — ~/.grok, or GROK_HOME. Note this
// is NOT Grok Bot (the hosted cloud-VM agent), which has no local config at
// all and can't attach stdio MCP servers; the agent runbook served at
// /agent/<token> tells Grok Bot to use the CLI instead.
export function grokHome() {
    return process.env.GROK_HOME ?? resolve(homedir(), ".grok");
}
// Claude Desktop ships per-OS config files. The macOS path is the
// canonical one Anthropic documents; Windows uses %APPDATA%; Linux
// follows XDG conventions (used by community Linux builds — the
// official Anthropic Linux desktop isn't out yet, but if it lands
// it'll almost certainly read this path).
export function claudeDesktopConfigPath() {
    const home = homedir();
    const p = platform();
    if (p === "darwin") {
        return resolve(home, "Library/Application Support/Claude/claude_desktop_config.json");
    }
    if (p === "win32") {
        const appData = process.env.APPDATA ?? resolve(home, "AppData/Roaming");
        return resolve(appData, "Claude/claude_desktop_config.json");
    }
    return resolve(home, ".config/Claude/claude_desktop_config.json");
}
export function cmdExists(cmd) {
    if (platform() === "win32") {
        const r = spawnSync("where", [cmd], { stdio: "ignore" });
        return r.status === 0;
    }
    const r = spawnSync("sh", ["-c", `command -v ${cmd} >/dev/null 2>&1`], { stdio: "ignore" });
    return r.status === 0;
}
export function detectHosts() {
    const home = homedir();
    const claudeDesktopCfg = claudeDesktopConfigPath();
    return {
        claude: cmdExists("claude"),
        // The Desktop app creates its config dir on first launch even before
        // any MCPs are wired, so probing the parent dir is a reliable signal.
        claudeDesktop: existsSync(claudeDesktopCfg) || existsSync(dirname(claudeDesktopCfg)),
        cursor: existsSync(resolve(home, ".cursor")),
        opencode: existsSync(resolve(home, ".config/opencode")) ||
            existsSync(resolve(home, ".config/opencode/opencode.json")),
        codex: existsSync(resolve(home, ".codex")),
        hermes: cmdExists("hermes") || existsSync(hermesHome()),
        openclaw: cmdExists("openclaw") || existsSync(openclawStateDir()),
        grok: cmdExists("grok") || existsSync(grokHome()),
    };
}
export function wireClaude(ctx) {
    if (!cmdExists("claude")) {
        return {
            ok: false,
            message: `claude CLI not found. Install Claude Code, then run:\n  ` +
                (ctx.scope === "user"
                    ? `claude mcp add --scope user ${ctx.binName} ${ctx.mcpCmd}`
                    : `cd <project-dir> && claude mcp add ${ctx.binName} ${ctx.mcpCmd}`),
        };
    }
    if (ctx.scope === "user") {
        spawnSync("claude", ["mcp", "remove", "-s", "user", ctx.binName], { stdio: "ignore" });
        const r = spawnSync("claude", ["mcp", "add", "-s", "user", ctx.binName, ctx.mcpCmd], {
            stdio: "ignore",
        });
        if (r.status === 0) {
            return { ok: true, message: `Claude Code: registered \`${ctx.binName}\` (user scope)` };
        }
        return {
            ok: false,
            message: `claude mcp add failed. Run manually:\n  claude mcp add --scope user ${ctx.binName} ${ctx.mcpCmd}`,
        };
    }
    const cwd = ctx.projectDir;
    if (!cwd)
        return { ok: false, message: "Project scope chosen but no project dir provided." };
    spawnSync("claude", ["mcp", "remove", "-s", "project", ctx.binName], { cwd, stdio: "ignore" });
    spawnSync("claude", ["mcp", "remove", ctx.binName], { cwd, stdio: "ignore" });
    const r = spawnSync("claude", ["mcp", "add", ctx.binName, ctx.mcpCmd], { cwd, stdio: "ignore" });
    if (r.status === 0) {
        return { ok: true, message: `Claude Code: registered \`${ctx.binName}\` in ${cwd}` };
    }
    return {
        ok: false,
        message: `claude mcp add failed. Run manually:\n  cd ${cwd} && claude mcp add ${ctx.binName} ${ctx.mcpCmd}`,
    };
}
export function mergeJsonFile(path, mutate) {
    let cfg = {};
    if (existsSync(path)) {
        const raw = readFileSync(path, "utf-8");
        if (raw.trim()) {
            try {
                cfg = JSON.parse(raw);
            }
            catch {
                // Refuse to overwrite a file we can't parse (JSON5 / comments /
                // trailing commas). Clobbering someone's hand-edited host config
                // is far worse than asking them to add one entry by hand.
                return {
                    ok: false,
                    message: `${path} exists but isn't strict JSON — not overwriting. Add the fretwork entry by hand.`,
                };
            }
        }
    }
    mutate(cfg);
    const tmp = `${path}.tmp.${process.pid}`;
    try {
        if (!existsSync(dirname(path)))
            mkdirSync(dirname(path), { recursive: true });
        writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
        renameSync(tmp, path);
        return { ok: true, message: `Wrote ${path}` };
    }
    catch (err) {
        return { ok: false, message: `Failed to write ${path}: ${err.message}` };
    }
}
export function wireClaudeDesktop(ctx) {
    const target = claudeDesktopConfigPath();
    const r = mergeJsonFile(target, (cfg) => {
        const servers = (cfg.mcpServers ??= {});
        servers[ctx.binName] = { command: ctx.mcpCmd };
    });
    if (!r.ok)
        return r;
    // Desktop reads config on launch; users won't see the new MCP until they
    // quit and reopen the app. Mention that explicitly so they don't think
    // the install silently failed.
    return {
        ok: true,
        message: `Claude Desktop: wrote ${target} — restart the app to load fretwork-mcp.`,
    };
}
export function wireCursor(ctx) {
    const target = resolve(homedir(), ".cursor/mcp.json");
    return mergeJsonFile(target, (cfg) => {
        const servers = (cfg.mcpServers ??= {});
        servers[ctx.binName] = { command: ctx.mcpCmd };
    });
}
export function wireOpenCode(ctx) {
    const target = resolve(homedir(), ".config/opencode/opencode.json");
    return mergeJsonFile(target, (cfg) => {
        const mcp = (cfg.mcp ??= {});
        mcp[ctx.binName] = {
            type: "local",
            command: [ctx.mcpCmd],
            enabled: true,
        };
    });
}
export function codexHint(ctx) {
    return (`Codex CLI uses TOML — add this block to ~/.codex/config.toml ` +
        `(or use its MCP UI):\n` +
        `  [mcp_servers.${ctx.binName}]\n  command = "${ctx.mcpCmd}"`);
}
// Hermes Agent: `hermes mcp add` is the supported way in (its config.yaml
// is YAML and Hermes itself refuses agent-driven writes to it). We never
// edit the YAML directly.
export function wireHermes(ctx) {
    const hint = `hermes CLI not found. Once Hermes is installed, run:\n` +
        `  hermes mcp add ${ctx.binName} --command ${ctx.mcpCmd}`;
    if (!cmdExists("hermes"))
        return { ok: false, message: hint };
    spawnSync("hermes", ["mcp", "remove", ctx.binName], { stdio: "ignore" });
    const r = spawnSync("hermes", ["mcp", "add", ctx.binName, "--command", ctx.mcpCmd], {
        stdio: "ignore",
    });
    if (r.status === 0) {
        return {
            ok: true,
            message: `Hermes: registered \`${ctx.binName}\` via hermes mcp add — run /reload-mcp (or restart Hermes).`,
        };
    }
    return { ok: false, message: `hermes mcp add failed. Run manually:\n  hermes mcp add ${ctx.binName} --command ${ctx.mcpCmd}` };
}
// OpenClaw: prefer `openclaw mcp add`; fall back to merging `mcp.servers`
// into openclaw.json ONLY if it's strict JSON (it's JSON5 by spec, so a
// commented file makes us bail with a hint instead of clobbering it).
export function wireOpenClaw(ctx) {
    const cfgPath = resolve(openclawStateDir(), "openclaw.json");
    const snippet = `  "mcp": { "servers": { "${ctx.binName}": { "command": "${ctx.mcpCmd}" } } }`;
    if (cmdExists("openclaw")) {
        const r = spawnSync("openclaw", ["mcp", "add", ctx.binName, "--command", ctx.mcpCmd], {
            stdio: "ignore",
        });
        if (r.status === 0) {
            return {
                ok: true,
                message: `OpenClaw: registered \`${ctx.binName}\` via openclaw mcp add — run \`openclaw mcp reload\` (or restart the gateway).`,
            };
        }
    }
    const merged = mergeJsonFile(cfgPath, (cfg) => {
        const mcp = (cfg.mcp ??= {});
        const servers = (mcp.servers ??= {});
        servers[ctx.binName] = { command: ctx.mcpCmd };
    });
    if (merged.ok) {
        return { ok: true, message: `OpenClaw: wrote ${cfgPath} — run \`openclaw mcp reload\`.` };
    }
    return {
        ok: false,
        message: `${merged.message}\n  Either run: openclaw mcp add ${ctx.binName} --command ${ctx.mcpCmd}\n` +
            `  or merge into ${cfgPath}:\n${snippet}`,
    };
}
// Grok Build CLI: `grok mcp add <name> -- <cmd>`; fall back to a TOML hint
// for ~/.grok/config.toml.
export function wireGrok(ctx) {
    const toml = `Add to ${resolve(grokHome(), "config.toml")}:\n` +
        `  [mcp_servers.${ctx.binName}]\n  command = "${ctx.mcpCmd}"`;
    if (!cmdExists("grok"))
        return { ok: false, message: `grok CLI not found. ${toml}` };
    const r = spawnSync("grok", ["mcp", "add", ctx.binName, "--", ctx.mcpCmd], { stdio: "ignore" });
    if (r.status === 0) {
        return { ok: true, message: `Grok Build: registered \`${ctx.binName}\` via grok mcp add.` };
    }
    return { ok: false, message: `grok mcp add failed. ${toml}` };
}
// Where each host loads skills from (user scope).
export function skillDirFor(host, projectDir) {
    const home = homedir();
    switch (host) {
        case "claude":
            return projectDir
                ? resolve(projectDir, ".claude/skills/fretwork")
                : resolve(home, ".claude/skills/fretwork");
        case "cursor":
            return resolve(home, ".cursor/skills/fretwork");
        case "opencode":
            return resolve(home, ".config/opencode/skills/fretwork");
        case "codex":
            return resolve(home, ".codex/skills/fretwork");
        case "hermes":
            return resolve(hermesHome(), "skills/fretwork");
        case "openclaw":
            return resolve(openclawWorkspaceDir(), "skills/fretwork");
        case "grok":
            return resolve(grokHome(), "skills/fretwork");
        default:
            return null; // claude-desktop has no skills dir; manual = user's call
    }
}
export function manualConfigsSnippet(ctx) {
    return [
        pc.bold("Manual MCP configuration snippets"),
        `Use the command below in any host that speaks local stdio MCP.`,
        `Resolved binary on this machine: ${pc.cyan(ctx.mcpCmd)}`,
        "",
        pc.bold("Claude Code"),
        `  claude mcp add --scope user ${ctx.binName} ${ctx.mcpCmd}`,
        `  # or, for a single project:`,
        `  cd <project> && claude mcp add ${ctx.binName} ${ctx.mcpCmd}`,
        "",
        pc.bold("Cursor (~/.cursor/mcp.json — merge into mcpServers)"),
        `  "${ctx.binName}": { "command": "${ctx.mcpCmd}" }`,
        "",
        pc.bold(`Claude Desktop (${claudeDesktopConfigPath()} — merge into mcpServers, then restart the app)`),
        `  "${ctx.binName}": { "command": "${ctx.mcpCmd}" }`,
        "",
        pc.bold("OpenCode (~/.config/opencode/opencode.json — merge into mcp)"),
        `  "${ctx.binName}": {`,
        `    "type": "local",`,
        `    "command": ["${ctx.mcpCmd}"],`,
        `    "enabled": true`,
        `  }`,
        "",
        pc.bold("OpenAI Codex CLI (~/.codex/config.toml)"),
        `  [mcp_servers.${ctx.binName}]`,
        `  command = "${ctx.mcpCmd}"`,
        "",
        pc.bold("Hermes Agent"),
        `  hermes mcp add ${ctx.binName} --command ${ctx.mcpCmd}`,
        `  # then /reload-mcp`,
        "",
        pc.bold("OpenClaw"),
        `  openclaw mcp add ${ctx.binName} --command ${ctx.mcpCmd}`,
        `  # or merge into ~/.openclaw/openclaw.json → mcp.servers.${ctx.binName} = { "command": "${ctx.mcpCmd}" }`,
        "",
        pc.bold("Grok Build (~/.grok/config.toml)"),
        `  grok mcp add ${ctx.binName} -- ${ctx.mcpCmd}`,
        "",
        pc.bold("Grok Bot / hosts without local MCP"),
        `  Use the CLI: every MCP tool has a \`fretwork …\` equivalent (run \`fretwork --help\`).`,
        "",
        pc.bold("Generic"),
        `  Transport: stdio. Command: ${ctx.mcpCmd} (no arguments).`,
    ].join("\n");
}
/**
 * Locate the bundled SKILL.md. This file compiles to dist/cli/install/hosts.js
 * (dev: src/cli/install/hosts.ts) — three levels below the package root,
 * where `skill/SKILL.md` lives. `npm root -g` is the last resort.
 */
export function findSkillSource() {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const local = resolve(here, "../../../skill/SKILL.md");
    if (existsSync(local))
        return local;
    try {
        const npmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
        const p = resolve(npmRoot, "fretwork/skill/SKILL.md");
        if (existsSync(p))
            return p;
    }
    catch {
        // ignore
    }
    return null;
}
export function installSkill(targetDir, skillSrc) {
    try {
        if (!existsSync(targetDir))
            mkdirSync(targetDir, { recursive: true });
        copyFileSync(skillSrc, resolve(targetDir, "SKILL.md"));
        const helpSrc = resolve(dirname(skillSrc), "HELP.md");
        if (existsSync(helpSrc)) {
            copyFileSync(helpSrc, resolve(targetDir, "HELP.md"));
        }
        return { ok: true, message: `Installed skill at ${targetDir}/SKILL.md` };
    }
    catch (err) {
        return { ok: false, message: `Skill install failed (${targetDir}): ${err.message}` };
    }
}
/**
 * Resolve the absolute path to the fretwork-mcp-server binary.
 *
 * Lookup order:
 *  1. FRETWORK_MCP_SERVER_PATH (explicit override; used by install.sh / CI).
 *  2. A sibling of process.argv[1] (npm-global layout — `fretwork` and
 *     `fretwork-mcp-server` land in the same bin dir).
 *  3. `command -v fretwork-mcp-server` (PATH lookup).
 *  4. null — caller decides whether to error or print a hint.
 */
export function resolveMcpServerPath() {
    const override = process.env.FRETWORK_MCP_SERVER_PATH;
    if (override && existsSync(override))
        return override;
    const argv1 = process.argv[1];
    if (argv1) {
        const sibling = resolve(dirname(argv1), "fretwork-mcp-server");
        if (existsSync(sibling))
            return sibling;
    }
    if (cmdExists("fretwork-mcp-server")) {
        const r = spawnSync(platform() === "win32" ? "where" : "sh", platform() === "win32" ? ["fretwork-mcp-server"] : ["-c", "command -v fretwork-mcp-server"], { encoding: "utf-8" });
        const out = (r.stdout ?? "").trim().split("\n")[0];
        if (out && existsSync(out))
            return out;
    }
    return null;
}
