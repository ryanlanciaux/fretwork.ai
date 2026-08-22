# Fretwork

Local-first time tracking, invoicing, expenses and a light CRM — for the AI
agent you already use. No app, no account, no server: your agent installs
Fretwork from this repo, keeps your data in one SQLite file on your machine,
and drives it through MCP tools or the `fretwork` CLI. MIT. Nothing phones
home.

## Install (let your agent do it)

Paste this to Grok Bot, Hermes, OpenClaw, Claude Code, Cursor, OpenCode,
Codex — any agent that can run commands:

> Read https://raw.githubusercontent.com/ryanlanciaux/fretwork.ai/refs/heads/main/AGENT.md and follow it to install Fretwork on this
> machine, set up my database and business profile, and connect it to
> yourself. Ask me for my business name, billing email, and a logo image file
> if I have one.

[`AGENT.md`](./AGENT.md) is the whole recipe. [`CAPABILITIES.md`](./CAPABILITIES.md)
lists every operation as an MCP tool and a CLI command.

## Install by hand

```sh
npm install -g github:ryanlanciaux/fretwork.ai   # fretwork + fretwork-mcp-server on PATH
fretwork init                                     # business profile → creates ~/.fretwork/data.db
fretwork install                                  # wires the MCP server + skill into your agents
```

Requires Node 22.12+ and git. **Upgrade** any time with `fretwork upgrade`
(or tell your agent "upgrade Fretwork") — data and settings are untouched.

## Layout

| Path | What |
| --- | --- |
| `src/store/` | SQLite store (better-sqlite3 + drizzle), invoice rendering (Mustache; PDF via your own Chrome) |
| `src/cli.ts`, `src/cli/` | `fretwork` CLI — every command has `--json` |
| `src/mcp.ts` | `fretwork-mcp-server` — stdio MCP, same operations |
| `skill/` | `SKILL.md` / `HELP.md`, copied into each agent's skills dir |
| `templates/` | default invoice template, seeded to `~/.fretwork/templates/` |
| `AGENT.md` | the recipe (fretwork.ai/AGENT.md redirects to the raw GitHub file) |
| `site/` | fretwork.ai — one static page; `npm run site` assembles `site-dist/` and regenerates `CAPABILITIES.md` (host it anywhere static) |

Data lives in `~/.fretwork/data.db` (override with `FRETWORK_HOME`).
`fretwork export` / `fretwork import` move it between machines.

## Supported hosts

`fretwork install --host <ids> --yes`: `hermes`, `openclaw`, `claude`,
`claude-desktop`, `cursor`, `opencode`, `codex`, `grok` (Grok Build). Grok Bot
attaches `fretwork-mcp-server` directly as a stdio MCP connector (AGENT.md §4a).

## Develop

```sh
npm install
npm run typecheck && npm test
npm run dev -- clients list     # run the CLI from source
npm run compile                 # → dist/ (committed: installs need no TypeScript)
npm run site                    # assemble site-dist/
```

`dist/` is checked in on purpose — `npm install -g github:…` and the tarball
URL both work with nothing but Node on the user's machine. Run
`npm run compile` before committing source changes (`npm run check:dist`
verifies). The script is deliberately not named `build`/`prepare`: npm
re-enters the clone with an inner install when a git dependency declares
those, which breaks `npm install -g github:…`.

## Deploying fretwork.ai (maintainer)

The site is static: `npm run site` builds `site-dist/`, and `npm run
site:deploy` uploads it to the Cloudflare Worker the domain is attached to.
The only credential is a Cloudflare API token read from the environment —
it is never stored in this repo:

```sh
CLOUDFLARE_API_TOKEN=… npm run site:deploy
```

Use a token scoped to *Workers Scripts: Edit* on the one account. Nothing
else about hosting lives here; `site-dist/` is gitignored.

## License

MIT — see [LICENSE](./LICENSE). Provided as-is, without warranty. Use at your
own risk. You are responsible for your invoices, taxes and data, and for what your agent does.
