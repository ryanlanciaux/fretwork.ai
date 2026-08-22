// Assemble the static site into site-dist/. The markdown files are also
// copied for local previews, but in production `_redirects` sends
// /AGENT.md etc. to raw.githubusercontent.com so they can never go stale.
// Layout:
//   index.html (with the capabilities table injected), styles.css, AGENT.md,
//   CAPABILITIES.md, skill/SKILL.md, skill/HELP.md.
// Also (re)writes CAPABILITIES.md at the repo root so GitHub readers and
// agents get the same table as markdown. Fails if the table and src/mcp.ts
// disagree about which tools exist.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, CLI_ONLY } from "./capabilities.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "site-dist");

// --- verify against src/mcp.ts ---------------------------------------------
const mcpSrc = readFileSync(resolve(root, "src/mcp.ts"), "utf-8");
const toolsBlock = mcpSrc.slice(mcpSrc.indexOf("const tools = ["), mcpSrc.indexOf("server.setRequestHandler"));
const inCode = new Set([...toolsBlock.matchAll(/^\s*name: "([a-z_]+)"/gm)].map((m) => m[1]));
const inTable = AREAS.flatMap((a) => a.rows.map((r) => r[0]));
const dupes = inTable.filter((t, i) => inTable.indexOf(t) !== i);
const missing = [...inCode].filter((t) => !inTable.includes(t));
const extra = inTable.filter((t) => !inCode.has(t));
if (dupes.length || missing.length || extra.length) {
  console.error("capabilities.mjs is out of sync with src/mcp.ts", { dupes, missing, extra });
  process.exit(1);
}

// --- markdown ----------------------------------------------------------------
const esc = (s) => s.replace(/\|/g, "\\|");
let md = `# Fretwork capabilities\n\nEvery operation is available two ways over the same local SQLite database: as an **MCP tool** (for agents that attach local MCP servers) and as a **CLI command** (every command accepts \`--json\`). Generated from \`src/mcp.ts\` by \`npm run site\`.\n\n`;
for (const area of AREAS) {
  md += `## ${area.name}\n\n| MCP tool | CLI | What it does |\n| --- | --- | --- |\n`;
  for (const [tool, cli, what] of area.rows) md += `| \`${tool}\` | ${cli === "—" ? "—" : "`" + esc(cli) + "`"} | ${esc(what)} |\n`;
  md += "\n";
}
md += `## CLI only\n\n| Command | What it does |\n| --- | --- |\n`;
for (const [cli, what] of CLI_ONLY) md += `| \`${esc(cli)}\` | ${esc(what)} |\n`;
writeFileSync(resolve(root, "CAPABILITIES.md"), md);

// --- html --------------------------------------------------------------------
const h = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let html = "";
for (const area of AREAS) {
  html += `<tbody><tr class="caps-area"><th colspan="3">${h(area.name)}</th></tr>\n`;
  for (const [tool, cli, what] of area.rows) {
    html += `<tr><td><code>${h(tool)}</code></td><td>${cli === "—" ? "<span class=\"caps-none\">—</span>" : `<code>${h(cli)}</code>`}</td><td>${h(what)}</td></tr>\n`;
  }
  html += `</tbody>\n`;
}
html += `<tbody><tr class="caps-area"><th colspan="3">CLI only</th></tr>\n`;
for (const [cli, what] of CLI_ONLY) html += `<tr><td><span class="caps-none">—</span></td><td><code>${h(cli)}</code></td><td>${h(what)}</td></tr>\n`;
html += `</tbody>\n`;

const page = readFileSync(resolve(root, "site/index.html"), "utf-8");
if (!page.includes("<!--CAPABILITIES-->")) throw new Error("site/index.html is missing the <!--CAPABILITIES--> marker");
const count = inTable.length;

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "skill"), { recursive: true });
writeFileSync(resolve(out, "index.html"), page.replace("<!--CAPABILITIES-->", html).replaceAll("{{TOOL_COUNT}}", String(count)));
cpSync(resolve(root, "site/styles.css"), resolve(out, "styles.css"));
cpSync(resolve(root, "site/_redirects"), resolve(out, "_redirects"));
cpSync(resolve(root, "AGENT.md"), resolve(out, "AGENT.md"));
cpSync(resolve(root, "CAPABILITIES.md"), resolve(out, "CAPABILITIES.md"));
cpSync(resolve(root, "skill/SKILL.md"), resolve(out, "skill/SKILL.md"));
cpSync(resolve(root, "skill/HELP.md"), resolve(out, "skill/HELP.md"));
console.log(`✓ site-dist/ ready (${count} tools in the capabilities table)`);
