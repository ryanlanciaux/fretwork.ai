# fretwork — quick help

fretwork-mcp is a local toolkit for tracking time, managing clients, and
generating invoices. It exposes both a CLI (`fretwork`) and an MCP server
(`fretwork-mcp-server`) that operate on the same SQLite store at
`~/.fretwork/data.db`.

## Install

Open source (MIT), no app, no account. Hand the recipe to your agent:

> Read https://raw.githubusercontent.com/ryanlanciaux/fretwork.ai/refs/heads/main/AGENT.md and follow it.

or by hand:

```sh
npm install -g github:ryanlanciaux/fretwork.ai            # fretwork + fretwork-mcp-server on PATH
fretwork init --yes --name "Acme Studio" --email "hello@acme.studio"   # creates ~/.fretwork/data.db
fretwork install --host hermes,claude --yes               # wire agents without prompts
```

## CLI cheatsheet

```sh
# config
fretwork config show
fretwork config set --rate 200 --currency USD --tax-rate 8.875

# clients
fretwork clients add "Acme Corp" --email ar@acme.test --rate 200
fretwork clients list
fretwork clients promote acme-corp           # prospect → lead → client
fretwork clients archive globex

# time
fretwork time log --client acme-corp --hours 4 --description "scoping"
fretwork time list --client acme-corp --unbilled
fretwork time summary --from 2026-05-01 --to 2026-05-31

# invoices
fretwork invoices create --client acme-corp --from 2026-05-01 --to 2026-05-31
fretwork invoices list
fretwork invoices render INV-2026-001 --output ~/Desktop/acme-may.html
fretwork invoices pdf    INV-2026-001 --output ~/Desktop/acme-may.pdf
fretwork invoices status INV-2026-001 sent
fretwork invoices status INV-2026-001 paid

# crm
fretwork crm note --client acme-corp --body "Talked about renewal."
fretwork crm followups --staleness 14

# reports
fretwork report financial --from 2026-01-01 --to 2026-12-31
```

Every command supports `--json` for machine output.

## MCP tools (when used through Claude / Cursor / etc.)

- Clients: `list_clients`, `get_client`, `add_client`, `update_client`,
  `promote_client`, `archive_client`.
- Time: `log_time`, `list_time_entries`, `summarise_time`.
- Invoices: `list_invoices`, `get_invoice`, `create_invoice`,
  `update_invoice`, `set_invoice_status`, `delete_invoice`,
  `render_invoice_html`, `generate_invoice_pdf`.
- CRM: `add_crm_note`, `list_crm_notes`, `list_followups`.
- Config: `get_config`, `update_config`, `init_config`.
- Report: `financial_report`.
- Resources: `client://{slug}`, `invoice://{number}`.

## Conventions

- Dates are ISO `YYYY-MM-DD`. Hours are decimal floats. Tax rate is a
  percent (8.875, not 0.08875). Money is in the invoice's currency,
  defaulting to config currency.
- Client slugs are kebab-case, auto-derived from `name`.
- Invoice numbers look like `INV-YYYY-NNN`, auto-generated.
- The store is `~/.fretwork/data.db`. Override the location with
  `FRETWORK_HOME=/some/dir`.
