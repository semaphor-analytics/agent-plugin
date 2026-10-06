# Installation and auth

## Install the plugin

Claude Code:

```bash
claude plugin marketplace add semaphor-analytics/agent-plugin
claude plugin install semaphor@semaphor-analytics
```

Or, inside a Claude Code session:

```text
/plugin marketplace add semaphor-analytics/agent-plugin
/plugin install semaphor@semaphor-analytics
```

Restart Claude Code (or run `/reload-plugins`) so it picks up the plugin.

Codex:

```bash
codex plugin marketplace add semaphor-analytics/agent-plugin
codex plugin add semaphor@semaphor-analytics
```

The plugin adds one MCP server, `semaphor`, at
`https://semaphor.cloud/api/mcp`, and the `semaphor-analytics` skill.

## Log in (interactive use)

When you work in Claude Code or Codex yourself, log in with OAuth. You see
every Semaphor project you belong to.

- Claude Code: run `/mcp`, choose `semaphor`, and complete the login in your
  browser.
- Codex: run `codex mcp login semaphor`.

By default the login grants read access. Change tools (creating dashboards,
adding relationships to the semantic model) also need write access and an
author role or higher; your client asks for write access when it requests the
`mcp:write` scope.

After login, ask:

```text
What data can I analyze in Semaphor?
```

## Headless and embedded use (MCP project token)

Automation (CI, schedulers, scripts) and agents you build into your own
product can't open a browser to log in. They use an MCP project token
instead: a short-lived token your backend mints with your project secret.

### Mint a token

Call `POST https://semaphor.cloud/api/v1/token` from your server, the same
call you use for embedded dashboards, with the `mcp` option:

```json
{
  "projectId": "p_...",
  "projectSecret": "...",
  "orgUserId": "...",
  "mcp": { "scopes": ["mcp:read"], "sql": true },
  "tokenExpiry": 3600
}
```

- For automation, identify an organization user with `orgUserId`. For an end
  user inside your product, use `endUserId` (or `tenantId` with
  `endUserEmail`); the usual security fields (`cls`, `rcls`, `params`,
  `semanticDomainAccess`) apply, exactly as for embedded dashboards.
- `mcp.scopes`: `["mcp:read"]` (the default) or `["mcp:read", "mcp:write"]`.
  Write access is only for organization users with an author role or higher.
- `mcp.sql`: `false` turns off SQL and physical table discovery for that token.
- `tokenExpiry`: seconds, from 60 to 86400 (default 3600). Mint a new token
  before it expires.

The response is `{ "accessToken": "..." }`. Keep it out of source control and
logs. A token session is pinned to the token's project, so the agent never
lists or switches projects.

### Point your client at the token

Add a second server next to the plugin's OAuth server, at
`https://semaphor.cloud/api/mcp` over Streamable HTTP, that sends the token
as `Authorization: Bearer <token>`. Step-by-step setup for Claude Code, Codex,
Cursor and other clients is in the Semaphor docs:
https://docs.semaphor.cloud/docs/mcp/connect-with-token#point-a-client-at-the-token

## What each session can do

What the agent sees depends on who is calling:

| | You, logged in | Automation token | End-user token |
| --- | --- | --- | --- |
| Projects | All of yours | One | One |
| Semantic model, governed analytics, dashboards | Yes | Yes | Yes, for that user's data |
| SQL and physical tables | Author role or higher | Author role or higher, unless the token turns SQL off | Unless the token turns SQL off |
| Create dashboards | Author role or higher with write access | Same | No |
| Change the semantic model | Author role or higher with write access | No | No |

Every query runs under the caller's permissions and security policies.

## Self-hosted Semaphor

Replace `https://semaphor.cloud` with your Semaphor URL in the server
configuration and the mint call.
