# Access, tools and errors

## Who is calling

`semaphor_get_access_context` reports:

- `mode`: `org_interactive` (a person logged in with OAuth),
  `org_headless` (automation with an MCP project token) or `tenant_embedded`
  (an end user inside the customer's product);
- `credential` and `scopes` (`mcp:read`, plus `mcp:write` for change tools);
- `capabilities.sql`: whether SQL and physical discovery are available;
- `projectId` for token sessions, which are pinned to one project.

## What each kind of session sees

| | Interactive org user | Headless org token | Embedded end user |
| --- | --- | --- | --- |
| Project listing | Yes | No (pinned) | No (pinned) |
| Semantic discovery, `analyze`, `matrix`, dashboards | Yes | Yes | Yes, for their own data |
| SQL and physical discovery | Author role or higher | Author role or higher, unless the token turns SQL off | Unless the token turns SQL off |
| Change tools (`semaphor_propose_change`, `semaphor_apply_change`) | Author role or higher with write scope | Same, dashboards only | No |

## Errors worth knowing

| Error | What to do |
| --- | --- |
| `capability_required` | The argument needs SQL access. Use the semantic form of the tool. |
| `write_scope_required` | The session is read-only. Tell the user; they can reconnect requesting write access. |
| `proposal_stale` | The target changed after the preview. Propose the change again. |
| `apply_in_progress` | The first apply is still running. Retry the same call shortly. |
| `apply_outcome_unknown` | The first apply never recorded a result. Check whether the change landed (the error says how) before proposing again. |
| `proposal_not_found` | The proposal expired (30 minutes) or belongs to someone else. Propose again. |
| `change_not_allowed_for_credential` | Semantic model changes need an interactive login, not a token. |
| `tool_timeout` | Narrow the request (fewer rows, a shorter window, fewer fields) and retry. |
| `Project token is scoped to project "…"` | Token sessions can't switch projects. Use the token's project. |
| `projectId is required` (with a project list) | Pick the project the user means and pass `projectId`. |
| 401 "MCP project token is invalid or expired" | The token expired or wasn't minted for the MCP. The token owner mints a new one. |
