# Fretwork — setup recipe for AI agents

You are an AI agent reading this because a person asked you to set up
Fretwork for them. Work through the steps **in order**; each has a check.
When you're done, report back with the template at the end.

**What Fretwork is.** An open-source (MIT), local-first freelance toolkit —
time tracking, invoicing (HTML + PDF), expenses, recurring invoices, and a
light CRM. All data lives in one SQLite file on the machine you run commands
on (`~/.fretwork/data.db`). There is no app, no account, and no server:
Fretwork is used *through you*, and it makes no network requests.

Two surfaces drive the same database. Most hosts — Grok Bot included — can
attach the stdio MCP server; the CLI is the equivalent surface and is always
available:

- `fretwork` — a CLI. Every command supports `--json`.
- `fretwork-mcp-server` — a stdio MCP server exposing the same operations as
  tools (`log_time`, `create_invoice`, `list_followups`, …).

> **Use at your own risk.** You're about to install code from
> https://github.com/ryanlanciaux/fretwork.ai on this machine. It is
> provided as-is, without warranty (MIT). Read the steps before running them.
> You are responsible for your invoices, taxes and data, and for what your agent does.

**Already installed?** Skip to [Upgrading](#upgrading) at the end.

---

## 0. Identify your host

| You are… | How Fretwork attaches | Step 4 |
| --- | --- | --- |
| **Grok Bot** (xAI/Cursor — cloud computer with `/workspace`) | stdio MCP connector (`fretwork-mcp-server`, no args) + saved skill | 4a |
| **Hermes Agent** (`~/.hermes/`) | `hermes mcp add` + skill | 4b |
| **OpenClaw** (`~/.openclaw/`) | `openclaw mcp add` + skill | 4b |
| **Claude Code, Claude Desktop, Cursor IDE, OpenCode, Codex, Grok Build** | `fretwork install --host <id> --yes` | 4b |
| Anything else with stdio MCP | manual snippet | 4c |
| Anything with no local MCP at all | the CLI + saved skill | 4d |

## 1. Prerequisites

```sh
node -v && npm -v && git --version     # Node 22.12 or newer
```

- Node missing or older than 22.12? Install Node 22 LTS via your package
  manager or nvm:
  `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && . "$HOME/.nvm/nvm.sh" && nvm install 22`
- **Grok Bot only:** anything outside `/workspace` can be wiped when the agent
  computer is updated or reset. Pin Fretwork's home and npm prefix inside
  `/workspace` first, and persist them:
  ```sh
  mkdir -p /workspace/fretwork/npm
  cat >> "$HOME/.bashrc" <<'RC'
  export FRETWORK_HOME=/workspace/fretwork
  export NPM_CONFIG_PREFIX=/workspace/fretwork/npm
  export NVM_DIR=/workspace/fretwork/nvm
  export PATH="/workspace/fretwork/npm/bin:$PATH"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  RC
  export FRETWORK_HOME=/workspace/fretwork NPM_CONFIG_PREFIX=/workspace/fretwork/npm NVM_DIR=/workspace/fretwork/nvm PATH="/workspace/fretwork/npm/bin:$PATH"
  ```
  Do this *before* installing Node so nvm lands in `/workspace` too; then
  Node, Fretwork and the database all survive a computer reset.

**Check:** `node -v` prints v22.12+.

## 2. Install

```sh
npm install -g github:ryanlanciaux/fretwork.ai
```

This fetches the repo (prebuilt JS is checked in — nothing to compile),
installs its runtime dependencies, and puts `fretwork` and
`fretwork-mcp-server` on PATH. Takes about a minute. Re-run the same command
later to upgrade. No `git` on this machine? Use the tarball instead:
`npm install -g https://github.com/ryanlanciaux/fretwork.ai/tarball/main`.

- `fretwork` not found afterwards → `export PATH="$(npm prefix -g)/bin:$PATH"`
  (add it to the shell rc too).
- `better-sqlite3` tries to compile → no prebuilt binary for this Node
  version/platform. Use Node 22 LTS, or install Python 3 + build tools and
  retry.

**Check:** `fretwork --version` prints a version and
`command -v fretwork-mcp-server` prints a path.

## 3. Create the database and business profile

The database is created empty the first time the CLI touches it. Set up the
business profile with **one** question to the user, listing the fields with
their defaults so they can answer in a single reply (or say "use defaults"):

| Ask for | Meaning | Default |
| --- | --- | --- |
| Business name | as it should appear on invoices | *(required)* |
| Billing email | the email address printed on invoices | *(required)* |
| Hourly rate | default rate for new clients and time entries | 100 |
| Currency | 3-letter code | USD |
| Tax rate | percent added to invoice totals | 0 |
| Payment terms | how many days after the invoice date payment is due — e.g. 14, or 30 for "net 30" | 14 |

Don't ask about "due days" or other internal names — use the plain wording
above. Then:

```sh
fretwork init --yes --name "<Business name>" --email "<billing email>" \
  --rate <hourly rate> --currency <CUR> --tax-rate <percent> --due-days <days>
```

If you can't ask right now, use placeholders and say so in your report
(fixable later with `fretwork config set …`):

```sh
fretwork init --yes --name "Your Business" --email "you@example.com"
```

**Logo (optional, ask once):** if the user wants their logo on invoices,
they must give you an **image file**, not a URL — invoices render fully
offline and URLs are rejected. Copy it into Fretwork's folder with:

```sh
fretwork config set --logo /path/to/logo.png     # copies it into ~/.fretwork/
```

On **Grok Bot**, the file has to reach the agent computer first: ask the user
to attach/upload the image in chat (or drop it in `/workspace`), then run the
command above on that path. If they only have a URL, download it for them
with `curl -fsSL <url> -o /workspace/fretwork/logo.png` and use that path —
Fretwork itself will not fetch it.

**Check:** `fretwork clients list --json` prints `[]`. `~/.fretwork/data.db`
(or `$FRETWORK_HOME/data.db`) now exists. Never copy or commit that file
anywhere — it is the user's private business data.

## 4. Connect Fretwork to yourself

### 4a. Grok Bot

Attach Fretwork as a **stdio MCP connector**:

- command: the absolute path printed by `command -v fretwork-mcp-server`
- arguments: none
- environment: none needed (the server honours `FRETWORK_HOME`, which you
  exported in step 1)

Once attached, the connector exposes the same operations as the CLI
(`list_clients`, `log_time`, `create_invoice`, …). Then save the Fretwork
skill so future sessions know how to use it: run `fretwork skill print`
(SKILL.md) and `fretwork skill print HELP.md`, and save them as a skill named
**`fretwork`**. The `fretwork` CLI stays available as an equivalent surface
(every command takes `--json`) — use whichever is handier.

### 4b. Hermes, OpenClaw, Claude Code, Claude Desktop, Cursor IDE, OpenCode, Codex, Grok Build

```sh
fretwork install --host <ids> --yes
# ids, comma-separated: hermes, openclaw, claude, claude-desktop, cursor, opencode, codex, grok
# e.g.  fretwork install --host hermes --yes
```

Registers the MCP server with each host (Hermes via `hermes mcp add`,
OpenClaw via `openclaw mcp add`, Claude Code via `claude mcp add`, Cursor IDE
`~/.cursor/mcp.json`, OpenCode `~/.config/opencode/opencode.json`, Claude
Desktop's `claude_desktop_config.json`, Grok Build via `grok mcp add`;
Codex gets a TOML snippet for `~/.codex/config.toml`) and copies the skill
into that host's `skills/fretwork/` directory. If a host's CLI isn't on
PATH it prints the exact command/snippet to apply by hand. Then restart the
host or reload its MCP servers (`/reload-mcp` in Hermes, `openclaw mcp
reload`). Never edit `~/.hermes/config.yaml` with a file tool — Hermes
refuses; use `hermes mcp add`. (These are different hosts from Grok Bot —
don't use them for it.)

### 4c. Any other stdio-MCP host

Transport **stdio**, command = the path from `command -v fretwork-mcp-server`,
no arguments, no env vars (honours `FRETWORK_HOME`).

```json
{ "mcpServers": { "fretwork": { "command": "/ABS/PATH/TO/fretwork-mcp-server" } } }
```

`fretwork install --non-interactive` prints every manual snippet. Copy the
directory printed by `fretwork skill path` to wherever your host loads
skills from.

### 4d. Hosts with no local MCP at all

Use the CLI — it covers everything the MCP tools do (`log_time` →
`fretwork time log`, `create_invoice` → `fretwork invoices create`,
`list_followups` → `fretwork crm followups`, `financial_report` →
`fretwork report financial`; always pass `--json` when you need to read the
result). Save the skill as in 4a so future sessions know how.

## 5. Verify (do not skip)

1. `fretwork --version` prints a version.
2. `fretwork clients list --json` → `[]`.
3. If you attached MCP (4a–4c): after reloading, call `list_clients` → `[]`.
4. Optional round-trip: `fretwork clients add "Smoke Test" --json`, then
   `fretwork clients delete smoke-test --json`. The list must be `[]` again.

## 6. Report back to the user

```
Fretwork <version> is installed and connected.
• Data file: ~/.fretwork/data.db  (back this up like any working file)
• Connected via: <MCP host name | fretwork CLI>
• Business profile: <name / email>  (or: placeholders — tell me your business name + email to fix)
• Upgrade any time: npm install -g github:ryanlanciaux/fretwork.ai
Try: "log 2 hours for Acme on the redesign", "what's outstanding?", "invoice Acme for this month and render the PDF".
```

---

## Upgrading

Already have Fretwork? One command, data and settings untouched:

```sh
fretwork upgrade          # = npm install -g github:ryanlanciaux/fretwork.ai
fretwork --version
```

If that prints `unknown command 'upgrade'`, the installed version predates
it (0.2.0) — run the step 2 command directly instead, which does the same
thing:

```sh
npm install -g github:ryanlanciaux/fretwork.ai
```

Then restart the agent (or reload its MCP servers) so it picks up the new
`fretwork-mcp-server`. Host configs don't change — the binary path is the
same.

---

## Reference

| Path | What |
| --- | --- |
| `~/.fretwork/data.db` | the SQLite database (all business data) |
| `~/.fretwork/templates/invoice.html` | Mustache invoice template (edit via `fretwork template …`) |
| `$FRETWORK_HOME` | overrides `~/.fretwork` |
| `fretwork skill path` | the installed `skill/` directory (SKILL.md, HELP.md) |

**Uninstall:** `npm uninstall -g fretwork`, remove the `fretwork` MCP entry
from the host, delete the host's `skills/fretwork/` directory, and (only if
the user wants their data gone) `rm -rf ~/.fretwork`.

**Troubleshooting**

- `Could not locate fretwork-mcp-server` → `export FRETWORK_MCP_SERVER_PATH="$(command -v fretwork-mcp-server)"` and re-run `fretwork install`.
- `fretwork invoices pdf` / `generate_invoice_pdf` fails → PDF rendering uses
  the machine's own Chrome/Chromium. Install one, or use
  `fretwork invoices render` / `render_invoice_html` (HTML) instead.
- MCP tools missing after setup → the host must be restarted or told to
  reload its MCP servers.
- Re-running `fretwork install` is safe and idempotent.
