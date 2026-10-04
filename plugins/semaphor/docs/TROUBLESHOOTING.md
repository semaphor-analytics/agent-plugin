# Troubleshooting

## The Semaphor tools don't appear

- Restart the client (Claude Code: `/reload-plugins`) after installing.
- Check the plugin is installed: `claude plugin list` or
  `codex plugin list --marketplace semaphor-analytics`.
- Check the server: in Claude Code run `/mcp` and look for `semaphor`; in
  Codex run `codex mcp list`.
- If the server needs a login, complete it (`/mcp` in Claude Code,
  `codex mcp login semaphor` in Codex), then ask again.

## A tool I expected is missing

The tool list depends on who is calling. Ask the agent to call
`semaphor_get_access_context`; it reports the access mode, your scopes and
whether SQL is available.

- No SQL or table tools: your role doesn't include SQL, or the token was
  minted with `"sql": false`.
- No change tools: the session is read-only. Log in again and grant write
  access, or mint a token with `"mcp:write"` (organization authors only).
- No project listing: you're using a token, which is pinned to one project.

## Errors

| Message | What it means | What to do |
| --- | --- | --- |
| 401 "No authorization provided" | No credential, or the login expired. | Log in again (`/mcp`, or `codex mcp login semaphor`). |
| 401 "MCP project token is invalid or expired…" | The token expired, or it wasn't minted for the MCP. | Mint a new token with the `mcp` option and update it in your client's configuration. |
| 401 "This token was not minted for the MCP…" | The token was minted without the `mcp` option (for example a dashboard embed token). | Mint an MCP project token (see [Installation and auth](INSTALLATION_AND_AUTH.md)). |
| `write_scope_required` | A change tool was called by a read-only session. | Log in again with write access, or use a token with `"mcp:write"`. |
| `capability_required` | An argument needs SQL access the session doesn't have. | Use the semantic form of the tool (domain, dataset and fields). |
| `tool_timeout` | The query ran past the time limit. | Ask a narrower question: fewer rows, a shorter window, fewer fields. |
| `Project token is scoped to project "…"` | A token session can't switch projects. | Use the token's project, or mint a token for the other project. |
| `projectId is required` with a list of projects | You belong to several projects. | Tell the agent which project you mean. |

## Mint errors (`POST /api/v1/token` with `mcp`)

| `error` | Fix |
| --- | --- |
| `mcp_invalid_scope` | `mcp.scopes` must be `["mcp:read"]` or `["mcp:read", "mcp:write"]`. |
| `mcp_write_not_allowed` | Write access needs an organization user (`orgUserId`) with an author role or higher. |
| `mcp_token_lifetime_invalid` | `tokenExpiry` must be a whole number of seconds from 60 to 86400. |

## Answers look wrong

- Ask the agent which dataset, fields and time window it used; governed
  results report the window that actually ran.
- Compare with the dashboard: ask the agent to read the dashboard's analysis
  context and re-run a card's question.
- Your security policies apply to every query. Two people can see different
  numbers for the same question.
