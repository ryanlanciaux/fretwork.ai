import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cancel, confirm, intro, isCancel, log, multiselect, note, outro, select, spinner, text, } from "@clack/prompts";
import pc from "picocolors";
import { bootstrapConfig, getConfig } from "../../store/index.js";
import { stageLogoFile } from "../../store/render/index.js";
import { codexHint, detectHosts, findSkillSource, installSkill, isHostId, manualConfigsSnippet, resolveMcpServerPath, skillDirFor, wireClaude, wireClaudeDesktop, wireCursor, wireGrok, wireHermes, wireOpenClaw, wireOpenCode, } from "./hosts.js";
import { readInstallMeta, writeInstallMeta } from "./meta.js";
// ─────────────────────────────────────────────────────────────────────────
// Business profile step — runs before MCP wiring so the user's first
// rendered invoice already has their name/email/address in the "From"
// section instead of the "Your Business / you@example.com" placeholders.
// ─────────────────────────────────────────────────────────────────────────
// Copy the chosen logo into ~/.fretwork; on any problem keep going without
// a logo rather than failing the whole profile step.
function safeStageLogo(input) {
    try {
        return stageLogoFile(input);
    }
    catch (e) {
        log.warn(`Logo skipped: ${e.message}`);
        return null;
    }
}
const DEFAULT_BUSINESS_NAME = "Your Business";
const DEFAULT_BUSINESS_EMAIL = "you@example.com";
// Returns `true` if the user already ran `fretwork init` (or completed
// this wizard step before). Used to switch the prompt default from
// "yes, set me up" to "no, I've already configured this."
function hasBootstrappedBusiness() {
    const cfg = getConfig();
    return (cfg.businessName !== DEFAULT_BUSINESS_NAME ||
        cfg.businessEmail !== DEFAULT_BUSINESS_EMAIL);
}
// Run a single text() prompt with cancel handling. Returns the trimmed
// answer (or undefined if the user hit Esc / Ctrl-C).
//
// IMPORTANT: clack 0.8's text() can resolve to `undefined` (not just
// `string | symbol` as the types claim) when the user submits an empty
// field and no `defaultValue` is provided. Mirror `initialValue` into
// `defaultValue` so the resolved value is always a string, and add a
// defensive coercion in case a future clack version regresses.
async function askText(opts) {
    const r = await text({
        message: opts.message,
        placeholder: opts.placeholder,
        initialValue: opts.initialValue,
        defaultValue: opts.initialValue ?? "",
        validate: opts.validate,
    });
    if (isCancel(r))
        return undefined;
    if (typeof r !== "string")
        return "";
    return r.trim();
}
function validateRequired(v) {
    if (!v.trim())
        return "Required.";
    return undefined;
}
function validateEmail(v) {
    const t = v.trim();
    if (!t)
        return "Required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t))
        return "Doesn't look like an email.";
    return undefined;
}
function validateNumber(v) {
    if (!v.trim())
        return undefined; // empty = keep current
    if (!Number.isFinite(Number(v)))
        return "Expected a number.";
    return undefined;
}
// Prompt the user for business + invoice-default fields, persist via
// bootstrapConfig. Returns false if the user explicitly cancels the
// section (the rest of the wizard still continues — business profile
// is independent from MCP wiring).
async function promptBusinessProfile() {
    const current = getConfig();
    const isFirstRun = !hasBootstrappedBusiness();
    const proceed = await confirm({
        message: isFirstRun
            ? "Set up your business profile now? (shown on every invoice)"
            : "Update your business profile?",
        initialValue: isFirstRun,
    });
    if (isCancel(proceed) || proceed === false) {
        if (isFirstRun) {
            log.warn("Skipping — invoices will show placeholder business info until you run `fretwork init` or `fretwork config set`.");
        }
        return;
    }
    // Required — name + email.
    const name = await askText({
        message: "Business name",
        placeholder: isFirstRun ? "Acme Studio" : current.businessName,
        initialValue: isFirstRun ? "" : current.businessName,
        validate: validateRequired,
    });
    if (name === undefined) {
        log.warn("Cancelled. Re-run `fretwork install` later to finish.");
        return;
    }
    const email = await askText({
        message: "Business email",
        placeholder: isFirstRun ? "hello@acme.studio" : current.businessEmail,
        initialValue: isFirstRun ? "" : current.businessEmail,
        validate: validateEmail,
    });
    if (email === undefined) {
        log.warn("Cancelled. Re-run `fretwork install` later to finish.");
        return;
    }
    // Optional fields — empty answer keeps the prior value (or null on
    // first run). Esc skips the rest of the section.
    const tagline = await askText({
        message: "Tagline (optional)",
        placeholder: "Independent design & engineering",
        initialValue: current.businessTagline ?? "",
    });
    if (tagline === undefined)
        return savePartial({ name, email });
    const address = await askText({
        message: "Street address (optional)",
        placeholder: "148 Lafayette Street, Floor 4",
        initialValue: current.businessAddress ?? "",
    });
    if (address === undefined)
        return savePartial({ name, email, tagline });
    const city = await askText({
        message: "City / region (optional)",
        placeholder: "New York, NY 10013",
        initialValue: current.businessCity ?? "",
    });
    if (city === undefined)
        return savePartial({ name, email, tagline, address });
    const phone = await askText({
        message: "Phone (optional)",
        placeholder: "+1 555 0100",
        initialValue: current.businessPhone ?? "",
    });
    if (phone === undefined)
        return savePartial({ name, email, tagline, address, city });
    const site = await askText({
        message: "Website (optional, shown in footer)",
        placeholder: "acme.studio",
        initialValue: current.businessSite ?? "",
    });
    if (site === undefined)
        return savePartial({ name, email, tagline, address, city, phone });
    const logo = await askText({
        message: "Logo path or URL (optional)",
        placeholder: "~/Pictures/logo.svg  (copied into ~/.fretwork)",
        initialValue: current.businessLogo ?? "",
    });
    if (logo === undefined)
        return savePartial({ name, email, tagline, address, city, phone, site });
    // Invoice defaults — numeric + currency. Default to existing values so
    // pressing Enter keeps what's there. Empty input also = keep current.
    const rateRaw = await askText({
        message: "Default hourly rate",
        placeholder: String(current.defaultRate),
        initialValue: String(current.defaultRate),
        validate: validateNumber,
    });
    if (rateRaw === undefined)
        return savePartial({ name, email, tagline, address, city, phone, site, logo });
    const currencyRaw = await askText({
        message: "Currency",
        placeholder: current.currency,
        initialValue: current.currency,
    });
    if (currencyRaw === undefined)
        return savePartial({
            name,
            email,
            tagline,
            address,
            city,
            phone,
            site,
            logo,
            rate: parseRate(rateRaw, current.defaultRate),
        });
    const taxRaw = await askText({
        message: "Tax rate (%)",
        placeholder: String(current.taxRate),
        initialValue: String(current.taxRate),
        validate: validateNumber,
    });
    if (taxRaw === undefined)
        return savePartial({
            name,
            email,
            tagline,
            address,
            city,
            phone,
            site,
            logo,
            rate: parseRate(rateRaw, current.defaultRate),
            currency: currencyRaw || current.currency,
        });
    const dueRaw = await askText({
        message: "Payment terms: days until an invoice is due (e.g. 14 or 30)",
        placeholder: String(current.dueDays),
        initialValue: String(current.dueDays),
        validate: validateNumber,
    });
    saveProfile({
        name,
        email,
        tagline,
        address,
        city,
        phone,
        site,
        logo,
        rate: parseRate(rateRaw, current.defaultRate),
        currency: currencyRaw || current.currency,
        taxRate: parseRate(taxRaw, current.taxRate),
        dueDays: dueRaw === undefined
            ? current.dueDays
            : Math.max(0, Math.floor(Number(dueRaw || current.dueDays))),
    });
}
// Numeric helper that tolerates empty input (keep prior value).
function parseRate(raw, fallback) {
    if (!raw.trim())
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
// Saves whatever fields the user has answered so far (handy when they
// Esc partway through). The required pair (name, email) is always set;
// optional fields fall through to their current DB values via the
// `?? current` pattern in saveProfile.
function savePartial(p) {
    saveProfile(p);
    log.warn("Stopped partway through — saved what you'd entered. Re-run any time.");
}
function saveProfile(p) {
    const current = getConfig();
    const saved = bootstrapConfig({
        businessName: p.name,
        businessEmail: p.email,
        businessTagline: p.tagline === undefined ? current.businessTagline : p.tagline || null,
        businessAddress: p.address === undefined ? current.businessAddress : p.address || null,
        businessCity: p.city === undefined ? current.businessCity : p.city || null,
        businessPhone: p.phone === undefined ? current.businessPhone : p.phone || null,
        businessSite: p.site === undefined ? current.businessSite : p.site || null,
        businessLogo: p.logo === undefined ? current.businessLogo : p.logo ? safeStageLogo(p.logo) : null,
        defaultRate: p.rate ?? current.defaultRate,
        currency: p.currency ?? current.currency,
        taxRate: p.taxRate ?? current.taxRate,
        dueDays: p.dueDays ?? current.dueDays,
    });
    log.success(`Saved business profile (${pc.bold(saved.businessName)}, ${saved.currency}, ${saved.dueDays}-day terms).`);
}
// One host → one wire call. Shared by the interactive wizard and the
// unattended `--host … --yes` path so both behave identically.
function wireHost(host, ctx) {
    switch (host) {
        case "claude":
            return wireClaude(ctx);
        case "claude-desktop":
            return wireClaudeDesktop(ctx);
        case "cursor":
            return wireCursor(ctx);
        case "opencode":
            return wireOpenCode(ctx);
        case "hermes":
            return wireHermes(ctx);
        case "openclaw":
            return wireOpenClaw(ctx);
        case "grok":
            return wireGrok(ctx);
        case "codex":
            // No auto-write for Codex (TOML) — surface the snippet as a soft result.
            return { ok: false, message: codexHint(ctx) };
        case "manual":
            return null;
    }
}
function parseHostList(raw) {
    const hosts = [];
    const bad = [];
    for (const chunk of raw ?? []) {
        for (const id of chunk.split(",").map((s) => s.trim()).filter(Boolean)) {
            if (isHostId(id)) {
                if (!hosts.includes(id))
                    hosts.push(id);
            }
            else {
                bad.push(id);
            }
        }
    }
    return { hosts, bad };
}
// Unattended path: no prompts at all. Wires the requested hosts (or every
// detected one when none were named), installs the skill for each, records
// install.json, prints one line per host. Exit 0 if at least one host wired
// (or nothing was requested), 1 if every requested host failed.
async function runUnattended(args, binName, mcpCmd) {
    const { hosts: requested, bad } = parseHostList(args.hosts);
    if (bad.length) {
        process.stderr.write(pc.red(`Unknown host id(s): ${bad.join(", ")}. Valid: claude, claude-desktop, cursor, opencode, codex, hermes, openclaw, grok, manual\n`));
        return 1;
    }
    let hosts = requested;
    if (hosts.length === 0) {
        hosts = defaultPicks(detectHosts(), "user");
        process.stdout.write(hosts.length
            ? pc.dim(`No --host given; wiring detected hosts: ${hosts.join(", ")}\n`)
            : pc.dim("No --host given and no supported hosts detected.\n"));
    }
    const ctx = { binName, mcpCmd, scope: "user" };
    const wired = [];
    let failures = 0;
    const skillSrc = findSkillSource();
    for (const host of hosts) {
        const r = wireHost(host, ctx);
        if (r === null) {
            process.stdout.write(manualConfigsSnippet(ctx) + "\n");
            continue;
        }
        if (r.ok) {
            wired.push(host);
            process.stdout.write(pc.green("✓ ") + r.message + "\n");
        }
        else {
            failures++;
            process.stdout.write(pc.yellow("! ") + r.message + "\n");
        }
        // Skills: install whenever the host has a skills dir, even if the MCP
        // wire needed a manual step — the skill is useful either way.
        const dir = skillDirFor(host);
        if (dir && skillSrc) {
            const sr = installSkill(dir, skillSrc);
            process.stdout.write((sr.ok ? pc.green("✓ ") : pc.yellow("! ")) + sr.message + "\n");
        }
    }
    if (!skillSrc)
        process.stdout.write(pc.yellow("! Could not locate SKILL.md — skipped skill installs.\n"));
    const prev = readInstallMeta();
    writeInstallMeta({
        version: prev?.version ?? "unknown",
        tarballUrl: prev?.tarballUrl,
        tarballSha256: prev?.tarballSha256,
        installedAt: prev?.installedAt ?? new Date().toISOString(),
        wiredHosts: wired,
        mcpCommand: mcpCmd,
    });
    process.stdout.write(`MCP server: ${mcpCmd}\n` +
        (wired.length ? `Wired: ${wired.join(", ")}\n` : "") +
        `Restart the host (or reload its MCP servers) to pick up \`${binName}\`.\n`);
    return hosts.length > 0 && failures === hosts.length ? 1 : 0;
}
export async function runInstallWizard(args = {}) {
    const binName = args.name ?? "fretwork";
    const mcpCmd = resolveMcpServerPath();
    if (!mcpCmd) {
        process.stderr.write(pc.red(`Could not locate \`fretwork-mcp-server\` on this machine.\n` +
            `Either:\n` +
            `  • build + install fretwork per https://fretwork.ai/AGENT.md (npm install -g ./dist/fretwork), or\n` +
            `  • set FRETWORK_MCP_SERVER_PATH to an absolute path before re-running.\n`));
        return 1;
    }
    if (args.yes || (args.hosts && args.hosts.length > 0)) {
        return runUnattended(args, binName, mcpCmd);
    }
    if (args.nonInteractive) {
        process.stdout.write(pc.dim("Non-interactive install — skipping wizard.\n" +
            "Run `fretwork install` later to wire up MCP hosts.\n\n"));
        process.stdout.write(manualConfigsSnippet({ binName, mcpCmd, scope: "user" }) + "\n");
        return 0;
    }
    if (!args.skipBanner) {
        intro(pc.bold("fretwork-mcp setup"));
    }
    else {
        log.message(pc.bold("fretwork-mcp setup"));
    }
    log.info(`MCP server: ${pc.cyan(mcpCmd)}`);
    // 0. Business profile — runs before MCP wiring so the first rendered
    //    invoice has the user's actual business info, not placeholders.
    await promptBusinessProfile();
    // 1. Scope.
    const scope = await select({
        message: "Where should fretwork-mcp be available?",
        options: [
            { value: "user", label: "All projects on this machine", hint: "recommended" },
            { value: "project", label: "A single project only" },
        ],
        initialValue: "user",
    });
    if (isCancel(scope)) {
        cancel("Setup cancelled. Run `fretwork install` later to finish.");
        return 0;
    }
    let projectDir;
    if (scope === "project") {
        const cwd = process.cwd();
        const dir = await text({
            message: "Project directory",
            placeholder: cwd,
            defaultValue: cwd,
            validate: (val) => {
                const v = val.trim() || cwd;
                if (!existsSync(v))
                    return `Not a directory: ${v}`;
                return undefined;
            },
        });
        if (isCancel(dir)) {
            cancel("Setup cancelled. Run `fretwork install` later to finish.");
            return 0;
        }
        projectDir = resolve(dir.trim() || cwd);
        log.warn(`Cursor / OpenCode / Codex configs are profile-wide — only Claude Code can be wired for a single project here.`);
    }
    // 2. Host multiselect.
    const hosts = detectHosts();
    const options = [
        {
            value: "claude",
            label: "Claude Code",
            hint: hosts.claude ? "detected" : "not installed",
        },
    ];
    if (scope === "user") {
        options.push({
            value: "claude-desktop",
            label: "Claude Desktop",
            hint: hosts.claudeDesktop ? "detected" : "config dir not found",
        }, {
            value: "cursor",
            label: "Cursor",
            hint: hosts.cursor ? "detected" : "no ~/.cursor",
        }, {
            value: "opencode",
            label: "OpenCode",
            hint: hosts.opencode ? "detected" : "no ~/.config/opencode",
        }, {
            value: "codex",
            label: "OpenAI Codex CLI",
            hint: hosts.codex ? "detected" : "no ~/.codex",
        }, {
            value: "hermes",
            label: "Hermes Agent",
            hint: hosts.hermes ? "detected" : "no hermes / ~/.hermes",
        }, {
            value: "openclaw",
            label: "OpenClaw",
            hint: hosts.openclaw ? "detected" : "no openclaw / ~/.openclaw",
        }, {
            value: "grok",
            label: "Grok Build CLI",
            hint: hosts.grok ? "detected" : "no grok / ~/.grok",
        });
    }
    options.push({
        value: "manual",
        label: "Show manual configs for other / unsupported editors",
        hint: "no auto-write",
    });
    const picks = await multiselect({
        message: scope === "user"
            ? "Which agents should we configure for fretwork-mcp?"
            : "Which agents should we configure (single-project)?",
        options,
        required: false,
        initialValues: defaultPicks(hosts, scope),
    });
    if (isCancel(picks)) {
        cancel("Setup cancelled. Run `fretwork install` later to finish.");
        return 0;
    }
    const selected = new Set(picks);
    const ctx = { binName, mcpCmd, scope, projectDir };
    // 3. Apply each selection.
    const wiredHosts = [];
    if (selected.size === 0 || (selected.size === 1 && selected.has("manual"))) {
        log.warn("No hosts selected for auto-wiring.");
        note(manualConfigsSnippet(ctx));
    }
    else {
        if (selected.has("claude")) {
            const s = spinner();
            s.start("Wiring Claude Code…");
            const r = wireClaude(ctx);
            r.ok ? s.stop(pc.green("✓ ") + r.message) : s.stop(pc.yellow("! ") + r.message);
            if (r.ok)
                wiredHosts.push("claude");
        }
        if (selected.has("claude-desktop")) {
            const s = spinner();
            s.start("Writing Claude Desktop config…");
            const r = wireClaudeDesktop(ctx);
            r.ok ? s.stop(pc.green("✓ ") + r.message) : s.stop(pc.yellow("! ") + r.message);
            if (r.ok)
                wiredHosts.push("claude-desktop");
        }
        if (selected.has("cursor")) {
            const s = spinner();
            s.start("Writing ~/.cursor/mcp.json…");
            const r = wireCursor(ctx);
            r.ok
                ? s.stop(pc.green("✓ ") + `Cursor: ${r.message}`)
                : s.stop(pc.yellow("! ") + `Cursor: ${r.message}`);
            if (r.ok)
                wiredHosts.push("cursor");
        }
        if (selected.has("opencode")) {
            const s = spinner();
            s.start("Writing ~/.config/opencode/opencode.json…");
            const r = wireOpenCode(ctx);
            r.ok
                ? s.stop(pc.green("✓ ") + `OpenCode: ${r.message}`)
                : s.stop(pc.yellow("! ") + `OpenCode: ${r.message}`);
            if (r.ok)
                wiredHosts.push("opencode");
        }
        for (const host of ["hermes", "openclaw", "grok"]) {
            if (!selected.has(host))
                continue;
            const s = spinner();
            s.start(`Wiring ${host}…`);
            const r = wireHost(host, ctx);
            r.ok ? s.stop(pc.green("✓ ") + r.message) : s.stop(pc.yellow("! ") + r.message);
            if (r.ok)
                wiredHosts.push(host);
        }
        if (selected.has("codex")) {
            log.warn(codexHint(ctx));
        }
        if (selected.has("manual")) {
            note(manualConfigsSnippet(ctx));
        }
        // Skills — only for hosts the user actually wired.
        const skillSrc = findSkillSource();
        if (skillSrc) {
            for (const host of selected) {
                const dir = skillDirFor(host, scope === "project" ? projectDir : undefined);
                if (!dir)
                    continue;
                const r = installSkill(dir, skillSrc);
                r.ok ? log.success(r.message) : log.warn(r.message);
            }
        }
        else {
            log.warn("Could not locate SKILL.md — skipped skill installs.");
        }
    }
    // 4. Persist install metadata.
    const prev = readInstallMeta();
    const meta = {
        version: prev?.version ?? "unknown",
        tarballUrl: prev?.tarballUrl,
        tarballSha256: prev?.tarballSha256,
        installedAt: prev?.installedAt ?? new Date().toISOString(),
        wiredHosts,
        mcpCommand: mcpCmd,
    };
    writeInstallMeta(meta);
    outro(pc.bold("Setup finished.") +
        `\nTry it: ${pc.cyan(`${binName} clients list`)}` +
        pc.dim(`\nFirst run will lazily create ~/.fretwork/data.db.`));
    return 0;
}
function defaultPicks(hosts, scope) {
    const picks = [];
    if (hosts.claude)
        picks.push("claude");
    if (scope === "user") {
        if (hosts.claudeDesktop)
            picks.push("claude-desktop");
        if (hosts.cursor)
            picks.push("cursor");
        if (hosts.opencode)
            picks.push("opencode");
        if (hosts.codex)
            picks.push("codex");
        if (hosts.hermes)
            picks.push("hermes");
        if (hosts.openclaw)
            picks.push("openclaw");
        if (hosts.grok)
            picks.push("grok");
    }
    return picks;
}
