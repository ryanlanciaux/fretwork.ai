# Fretwork capabilities

Every operation is available two ways over the same local SQLite database: as an **MCP tool** (for agents that attach local MCP servers) and as a **CLI command** (every command accepts `--json`). Generated from `src/mcp.ts` by `npm run site`.

## Clients

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `list_clients` | `fretwork clients list` | List clients, optionally by status (prospect / lead / client / archived). |
| `get_client` | `fretwork clients get <slug>` | One client by slug or id. |
| `add_client` | `fretwork clients add <name>` | Create a client; slug is derived from the name. |
| `update_client` | `fretwork clients update <slug>` | Change name, email, rate, address, status. |
| `promote_client` | `fretwork clients promote <slug>` | Advance prospect → lead → client (or set explicitly). |
| `archive_client` | `fretwork clients archive <slug>` | Soft-delete; keeps history and reports intact. |
| `delete_client` | `fretwork clients delete <slug>` | Hard-delete; refused while anything still references the client. |

## Time

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `log_time` | `fretwork time log` | Log billable hours against a client (decimal hours, ISO date). |
| `list_time_entries` | `fretwork time list` | Entries with client / date-range / unbilled / project filters. |
| `get_time_entry` | `fretwork time get <id>` | One entry by id. |
| `update_time_entry` | `fretwork time update <id>` | Edit an entry; refused once it's on an invoice. |
| `delete_time_entry` | `fretwork time delete <id>` | Delete an entry; refused once it's on an invoice. |
| `summarise_time` | `fretwork time summary` | Hours, unbilled hours and revenue per client over a range. |

## Timer

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `start_timer` | `fretwork time start` | Start a running timer (client can be set later). |
| `stop_timer` | `fretwork time stop` | Stop and log the elapsed time as an entry. |
| `get_active_timer` | `fretwork time status` | Show the running timer, if any. |
| `cancel_timer` | `fretwork time cancel` | Discard the running timer without logging. |
| `update_active_timer` | `fretwork time timer-update` | Change the running timer's client / project / description / rate in place. |

## Expenses & activity

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `add_expense` | `fretwork expenses add` | Expense with an amount, or a dated activity record (mileage, meeting) without one. |
| `list_expenses` | `fretwork expenses list` | Filter by client, dates, category, billable, unbilled. |
| `get_expense` | `fretwork expenses get <id>` | One record by id. |
| `update_expense` | `fretwork expenses update <id>` | Patch fields; can clear the amount. |
| `delete_expense` | `fretwork expenses delete <id>` | Delete a record. |

## Invoices

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `list_invoices` | `fretwork invoices list` | Invoices, optionally by client or status. |
| `get_invoice` | `fretwork invoices get <number>` | One invoice with line items. |
| `create_invoice` | `fretwork invoices create` | From a client's unbilled time over a date range, explicit line items, or both. |
| `update_invoice` | — | Edit notes, dates, tax rate, currency (not on paid/void invoices). |
| `set_invoice_status` | `fretwork invoices status <number> <status>` | draft → sent → paid / overdue / void; timestamps set automatically. |
| `list_overdue_invoices` | `fretwork invoices overdue` | Unpaid invoices past due, with days overdue. |
| `reconcile_overdue_invoices` | `fretwork invoices overdue --mark` | Mark past-due 'sent' invoices as overdue. Idempotent. |
| `delete_invoice` | `fretwork invoices delete <number>` | Delete; releases its time entries back to unbilled. |
| `render_invoice_html` | `fretwork invoices render <number>` | The invoice as HTML (Mustache template you can customise). |
| `generate_invoice_pdf` | `fretwork invoices pdf <number>` | PDF via your own Chrome, rendered fully offline. |

## Payments

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `record_payment` | `fretwork invoices pay <number>` | Record a full or partial payment; marks paid when settled. |
| `list_payments` | `fretwork invoices payments` | Payments for one invoice or all. |
| `delete_payment` | `fretwork invoices payment-delete <id>` | Remove a payment; reopens the invoice if it drops below total. |

## Recurring invoices

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `add_recurring_invoice` | `fretwork recurring add` | Retainers and subscriptions: weekly / monthly / quarterly / yearly templates. |
| `list_recurring_invoices` | `fretwork recurring list` | Templates, with filters. |
| `get_recurring_invoice` | `fretwork recurring get <id>` | One template. |
| `update_recurring_invoice` | `fretwork recurring update <id>` | Pause / resume, change cadence or line items. |
| `delete_recurring_invoice` | `fretwork recurring delete <id>` | Delete a template. |
| `run_recurring_invoices` | `fretwork recurring run` | Generate every invoice that's due. Safe to run daily. |
| `upcoming_recurring_invoices` | `fretwork recurring upcoming` | Preview the next issuances without creating anything. |

## CRM

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `add_crm_note` | `fretwork crm note` | A dated touchpoint note, optionally with a follow-up date. |
| `list_crm_notes` | `fretwork crm notes` | Notes by client / date range. |
| `get_crm_note` | `fretwork crm note-get <id>` | One note. |
| `update_crm_note` | `fretwork crm note-update <id>` | Edit body, date, follow-up, client. |
| `delete_crm_note` | `fretwork crm note-delete <id>` | Delete a note. |
| `list_followups` | `fretwork crm followups` | Clients you haven't talked to in N days (default 14). |

## Business profile

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `get_config` | `fretwork config show` | Business name, email, address, logo, rate, currency, tax, due days. |
| `update_config` | `fretwork config set` | Change any of those (the CLI copies a logo file into ~/.fretwork for you). |
| `init_config` | `fretwork init` | First-run setup; creates the empty database. |

## Reports & data

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `financial_report` | `fretwork report financial` | Totals by status, revenue and outstanding per client. |
| `export_data` | `fretwork export` | Versioned JSON snapshot of everything — backup or move machines. |
| `import_data` | `fretwork import <file>` | Restore: merge (default) or replace (requires confirmation; a backup is written first). |

## Invoice template

| MCP tool | CLI | What it does |
| --- | --- | --- |
| `print_invoice_template` | `fretwork template print` | Current template HTML (your copy, or the bundled default). |
| `write_invoice_template` | `fretwork template write` | Replace it; validated first, previous version kept as .bak. |
| `reset_invoice_template` | `fretwork template reset` | Back to the bundled default. |

## CLI only

| Command | What it does |
| --- | --- |
| `fretwork upgrade` | Upgrade to the latest version from GitHub; data and settings untouched. |
| `fretwork install --host <ids> --yes` | Wire the MCP server + skill into Hermes, OpenClaw, Claude Code, Claude Desktop, Cursor, OpenCode, Codex, Grok Build. |
| `fretwork skill path \| print` | Locate or print the bundled SKILL.md / HELP.md (to save as a skill in hosts like Grok Bot). |
| `fretwork template path \| show-default` | Where your template lives; the bundled default for diffing. |
