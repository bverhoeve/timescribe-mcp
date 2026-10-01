# timescribe-mcp

An [MCP](https://modelcontextprotocol.io) server that gives Claude read-only access to your local [TimeScribe](https://github.com/WINBIGFOX/TimeScribe) time tracking data. Ask things like "how many hours did I track per project last week?" without exporting a CSV.

- Reads TimeScribe's local SQLite database directly, **read-only**. It never writes.
- Works while TimeScribe is running, including the live timer.
- No network access. Your data stays on your machine.

## Requirements

- TimeScribe installed (macOS or Windows)
- Node.js 22.13 or newer

## Install

### Claude Code

```bash
git clone https://github.com/bverhoeve/timescribe-mcp && cd timescribe-mcp
npm ci && npm run build
claude mcp add timescribe -- node "$(pwd)/dist/index.js"
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "timescribe": { "command": "node", "args": ["/absolute/path/to/timescribe-mcp/dist/index.js"] }
  }
}
```

### Database location

Found automatically:

- macOS: `~/Library/Application Support/timescribe/database/database.sqlite`
- Windows: `%APPDATA%\timescribe\database\database.sqlite`

Elsewhere, set `TIMESCRIBE_DB_PATH` to the full path of `database.sqlite`.

## Tools

| Tool | What it returns |
|---|---|
| `list_projects` | All projects, including archived ones (`archived: true`) |
| `get_time_summary` | Work, break and scheduled hours for a date range, grouped per `project` (default), `day` or `project_day`, plus the running timer |
| `list_entries` | Individual work/break entries in a range, filterable by `project_id` and `type`, max 500 |

Dates are `YYYY-MM-DD`, inclusive, in the timezone set in TimeScribe. Leave out `from` and `to` for the current week (Monday to Sunday). Output times are ISO 8601 with offset.

## How times are counted

- An entry counts on the day it **started** (TimeScribe splits entries at midnight itself).
- A running timer counts up to now. A timer left open while TimeScribe was closed counts up to the last moment the app saw it running.
- `work_hours` is **tracked time only**. TimeScribe's own balance also credits public holidays and absences as worked hours, so in weeks with a holiday this server reports less than the app's balance.
- `scheduled_hours` comes from your TimeScribe work schedule and does not deduct holidays or absences.

## Development

```bash
npm test          # type-check, build, run all tests (never touches your real data)
npm run inspect   # open the MCP Inspector against your real database
```

## License

MIT
