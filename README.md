# forkable-mcp

[![CI](https://github.com/kyleyee23/forkable-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/colinds/forkable-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-black.svg)](https://modelcontextprotocol.io)
[![Runtime: Bun or Node](https://img.shields.io/badge/runtime-Bun%20or%20Node-fbf0df.svg)](https://bun.sh)

Order and manage your [Forkable](https://forkable.com) lunches from Claude, Codex, Cursor, or another
MCP client. You can see your week, browse menus, get recommendations, change meals, and check where
lunch is without opening the Forkable app.

> [!WARNING]
> This is an unofficial project and is not affiliated with Forkable. It uses your Forkable web
> session and an undocumented API that may change.
>
> This is a personal fork of [colinds/forkable-mcp](https://github.com/colinds/forkable-mcp). It
> runs from a local checkout with pinned dependencies and does not read browser cookie stores.

## Features

- See upcoming deliveries and the meals already selected
- Track courier ETAs, arrival times, and office access notes
- Browse and search menus
- Get Forkable's meal recommendations
- Add, replace, remove, and confirm meals
- Rate meals from 1–5 and leave written feedback
- Use it from any MCP client that can launch a stdio server

## Quick start

This fork runs from a local checkout rather than an npm package, so nothing is fetched from a
registry when the server starts. You need [Bun](https://bun.sh).

```bash
git clone git@github.com:kyleyee23/forkable-mcp.git
cd forkable-mcp
bun install --frozen-lockfile
```

Authenticate once (see [Authentication](#authentication)), then register the checkout with your
MCP client, replacing `/path/to/forkable-mcp` with the real location:

| Client                   | Command or configuration                                                          |
| ------------------------ | --------------------------------------------------------------------------------- |
| Claude Code              | `claude mcp add -s user forkable -- bun run /path/to/forkable-mcp/src/index.ts`   |
| Claude Desktop or Cursor | Add the JSON below under `mcpServers`                                             |
| VS Code                  | Add the JSON below under `servers` in `.vscode/mcp.json`                          |

```json
{
  "mcpServers": {
    "forkable": {
      "command": "bun",
      "args": ["run", "/path/to/forkable-mcp/src/index.ts"]
    }
  }
}
```

Restart or reconnect your client, then ask something like:

> What's for lunch this week?

## Skills

Three [agent skills](https://agentskills.io) ship with the server:

- `forkable` contains the shared instructions for meals, deliveries, and tool use
- `forkable-friday` adds a week-ahead planning routine on top of `forkable`
- `forkable-setup` covers installation and authentication

The source files are in [`skills/`](./skills). Copy or symlink the ones you want into
`~/.claude/skills/`.

## Tools

| Tool                  | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `list_deliveries`     | Shows upcoming deliveries and selected meals                       |
| `get_delivery_status` | Shows courier status, ETA, arrival time, tracking, and access notes |
| `get_menus`           | Lists menus and item options for a delivery                         |
| `search_items`        | Searches a delivery's menus                                        |
| `recommend_meals`     | Returns Forkable's meal recommendations                            |
| `get_profile`         | Shows the signed-in Forkable user                                  |
| `set_meal`            | Adds or replaces a meal                                            |
| `set_meal_all`        | Sets the same meal on several deliveries                           |
| `remove_meal`         | Removes a meal                                                     |
| `rate_meal`           | Rates a meal or edits its score and text feedback                   |
| `confirm_delivery`    | Confirms or unconfirms a delivery                                  |

Forkable still decides whether a change is allowed, including deadlines, restaurant capacity, and
billing rules.

To skip a delivery, use `list_deliveries` and remove each selected owned meal with `remove_meal`.
This removes those meals; it does not change your auto-order settings. Compare selected meals with
`recommend_meals` when choosing alternatives.

### Meal ratings

List the delivery first, supplying `from` and `to` for past meals. Each owned meal includes `rating`:
`null` means Forkable has not made a rating available, while a rating with `level: null` is unrated.

Use `rate_meal` with the delivery ID, the meal's `pieceId`, and a `level` from 1–5. It previews first;
call again with the same arguments and its `confirmToken` to submit. The search starts 14 days ago
by default; pass both `from` and `to` to limit the lookup to an older day or week.

Optional `reasons`, `comment`, `forGuest`, and `allowRatingFollowUps` edit the feedback. Omitted fields
keep their current values; an empty comment or reason array clears it. Levels 4–5 accept compliment
codes, while 1–3 accept issue codes listed in the tool schema. Known incompatible stored reasons are
removed, unknown server codes are preserved, and duplicates are ignored. Score changes show both
the old and new score in the preview. Marking a meal as a guest meal excludes its rating from future
suggestions. Follow-up preferences apply to this rating without changing your account settings.
If Forkable has not reported a follow-up preference, omitting it lets Forkable apply its default,
which may allow its team to contact you about your feedback. Set `allowRatingFollowUps: false`
to opt out for the rating.
Existing attachments are kept; photo editing and buffet ratings are not supported.

## Authentication

There is no API key. The server reuses a Forkable web session and stores it in
`~/.forkable-mcp/session.json` with mode `0600`. The browser cookie import from upstream has been
removed from this fork; use one of the two methods below.

### Email and password

```bash
bun run auth --login --email you@example.com
```

The command asks for your password without showing it. Password-based sessions can sign in again
after they expire. SSO-only accounts need the cookie method instead.

For non-interactive use, send the password on standard input with `--password-stdin`, or set
`FORKABLE_EMAIL` and `FORKABLE_PASSWORD`.

### Copy as cURL

Copy an authenticated Forkable GraphQL request from your browser's developer tools:

1. Open Forkable, then open Developer Tools and select **Network**.
2. Reload the page and filter for `graphql`.
3. Right-click a request to `/api/v2/graphql` and choose **Copy as cURL**.
4. Pipe the copied command into the auth command:

```bash
pbpaste | bun run auth
```

Only the Cookie header is imported. You can also save the copied command and pass it with
`--file ./forkable.curl`, or set `FORKABLE_COOKIE` to the full Cookie header.

Cookie-based sessions cannot refresh themselves. Import the cookie again when it expires.

## Configuration

All settings are optional. Bun reads `.env` automatically; with Node, set them in the MCP server's
environment.

| Variable             | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `FORKABLE_EMAIL`     | Email for non-interactive login and session refresh            |
| `FORKABLE_PASSWORD`  | Password used with `FORKABLE_EMAIL`                            |
| `FORKABLE_MFA`       | MFA code for password login                                    |
| `FORKABLE_COOKIE`    | Full Forkable Cookie header for headless or SSO authentication |
| `FORKABLE_CSRF`      | Sets the initial CSRF token; normally unnecessary              |
| `FORKABLE_MAX_TOTAL` | Local per-meal spending limit in dollars                       |
| `FORKABLE_MCP_HOME`  | Changes where the session is stored                            |

`FORKABLE_MAX_TOTAL` is a local limit, not a Forkable allowance or billing rule. Billing information
is shown as Forkable reports it.

## Running directly

```bash
bun run start   # serve MCP over stdio
bun run dev     # same, with file watching
```

## Development

```bash
bun test
bun run test:tz
bun run check
bun run smoke
```

## License

[MIT](./LICENSE) © Colin D'Souza
