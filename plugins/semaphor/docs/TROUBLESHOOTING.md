# Troubleshooting

Use this guide to classify common Semaphor Agent Plugin failures. Fix reusable
Semaphor layers when the failure is not truly plugin packaging or local app
workflow.

## Quick Triage

1. Is the agent/MCP connected?
2. Can MCP inspect the Semaphor project?
3. Can governed analysis execute?
4. Does the React app compile?
5. Does the React app have a runtime token?
6. Does the browser show governed data?

## MCP Tools Not Exposed By The Agent Host

Symptom:

```text
The plugin is installed, but the agent cannot call semaphor_* MCP tools.
```

Expected behavior:

- the hosted OAuth MCP server is named `semaphor`;
- the project-token MCP bridge is named `semaphor-project`;
- the host exposes Semaphor MCP tools as first-class callable tools;
- the agent can call `semaphor_get_access_context` or
  `semaphor_get_analysis_context` without manually starting the bridge.

Fallback check:

```bash
npm run call:mcp -- --list-tools --dir /path/to/react-app
npm run call:mcp -- semaphor_get_access_context --dir /path/to/react-app
```

If the wrapper works but first-class tools are missing, this is a plugin-host
mounting issue. Do not debug by printing tokens or manually speaking MCP
protocol in the target app. Capture the host, Codex or Claude version,
marketplace/plugin install commands, and whether the MCP server appears in the
host's plugin list.

The wrapper and MCP launcher are packaged local scripts. They should not use
`npx mcp-remote` or fetch bridge code from npm while holding a project token.
If a run attempts that, update the plugin package before continuing the eval or
customer workflow.

Owner layer: plugin host integration or plugin MCP packaging.

## Missing Project Token

Symptom:

```text
MCP tools are unavailable or unauthorized.
```

If hosted OAuth is available, prefer logging in through the `semaphor` MCP
server, selecting a project, and minting a local runtime token with
`semaphor_get_data_app_runtime_token`. If the user needs deterministic
project-token mode, continue with the checks below.

If an OAuth tool says the app connection requires reauthentication, ask the
user to use the current host's MCP OAuth login or reauthentication flow for the
server named `semaphor`.

For Codex, that login command is:

```bash
codex mcp login semaphor
```

For Claude Code or another agent host, use that host's MCP server
authentication UI or command. Then tell them to say "try again". Treat this as
a recoverable setup step, not as a refusal.

Check:

```bash
test -n "$VITE_SEMAPHOR_PROJECT_TOKEN" || test -n "$SEMAPHOR_PROJECT_TOKEN"
```

Fix:

```bash
VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

For OAuth mode, the agent should write the token returned by
`semaphor_get_data_app_runtime_token` to `VITE_SEMAPHOR_PROJECT_TOKEN` in the
target app's ignored `.env.local`. For non-Vite deterministic project-token
workflows, use `SEMAPHOR_PROJECT_TOKEN` instead. Do not commit local env files
containing real tokens into source control.

Owner layer: local setup/auth docs unless the MCP error is unclear.

## Wrong Semaphor Server Override

Symptom:

```text
MCP connection fails, times out, or points at stale behavior.
```

Hosted customer default: do not set a server override. The plugin infers the
Semaphor host from the project token's `apiServiceUrl`, then connects to
`/api/mcp`.

For local development, self-hosted deployments, tunnels, or dogfooding against
an unreleased Semaphor app, set the host-level override in the target app's
ignored `.env.local`:

```bash
SEMAPHOR_SERVER_URL="http://localhost:3000"
```

The plugin derives MCP as `$SEMAPHOR_SERVER_URL/api/mcp`, and save/publish use
the same host. Use `SEMAPHOR_MCP_URL` only when the MCP route intentionally
differs from the Semaphor app host, such as a custom proxy path:

```bash
SEMAPHOR_MCP_URL="https://your-semaphor-host.example.com/custom/mcp"
```

Unset overrides when they do not intentionally differ from the project token's
environment.

Owner layer: plugin setup unless the endpoint is up but returns poor
diagnostics.

## Token Expired Or Unauthorized

Symptom:

```text
401/403 from MCP or Data App execution.
```

Check:

- token expiration,
- project scope,
- semantic domain access,
- whether the token is intended for authoring or runtime use.

Fix:

- if OAuth is available, call `semaphor_get_data_app_runtime_token` for the
  selected project and replace the expired local runtime token,
- otherwise generate or provide a fresh project token for MCP authoring,
- use a scoped runtime token for React execution,
- do not use frontend source as a token store.

Owner layer: Semaphor auth/token UX if the error does not explain what token
scope is missing.

## Save Or Publish Fails

Symptom:

```text
The agent can build locally, but save or publish cannot complete.
```

Check:

- Semaphor Data App lifecycle APIs are available in the target environment,
- the local project token carries the correct `project_id`,
- the resolved actor can create/edit the target Data App,
- publish was started from the saved draft id and
  `sourceRevision.snapshotHash`,
- `semaphor.data-app.json` has `runtime.entry` and optional `runtime.styles`
  that point at hashed built assets,
- asset upload and complete calls bind to the same publish session.

Expected agent behavior:

- do not switch to MCP lifecycle wrappers,
- do not publish from unsaved local source,
- fail the Semaphor publish session if build/upload/complete fails after
  publish start,
- classify unavailable APIs as lifecycle gaps, not plugin-only prompt issues.

Owner layer: Semaphor Data App lifecycle unless the failure is local
build/package setup.

## Hosted Publish Cannot Infer Runtime Entry

Symptom:

```text
Could not infer a Semaphor-hosted runtime entry file.
```

Cause:

Semaphor-hosted publish needs a static browser bundle with a hashed JavaScript
module entry that mounts into `#root`.

Fix:

- run `npm run prepare:publish -- --dir /path/to/app`,
- make sure the build writes static assets, usually `dist/index.html` and
  `dist/assets/index-<hash>.js`,
- for server-rendered apps, add a static Data App entrypoint or pass
  `--manifest` with `runtime.entry`,
- do not replace the customer app; add the smallest publish-specific entrypoint
  when needed.

Owner layer: customer app build configuration or plugin packaging if a common
static build shape is not detected.

## Existing Data App Restore Has Conflicts

Symptom:

```text
The saved Semaphor Data App source differs from the local repo.
```

Expected agent behavior:

- compare by saved `sourceRevision.snapshotHash` and local snapshot content,
- use git commit, dirty tree hash, and workspace path only as diagnostics,
- summarize likely overwrites before applying,
- ask the user before replacing local files,
- never trust a saved local path as the restore target by itself.

Owner layer: plugin workflow if conflict reporting is unclear; Semaphor
lifecycle if source snapshot or revision metadata is missing.

## No Semantic Domain Access

Symptom:

```text
MCP connects, but no semantic domains or datasets are available.
```

Check:

- project token has semantic domain access,
- requested domain exists,
- user/project permissions are correct.

Expected agent behavior:

- report that no governed semantic data is available,
- do not invent datasets or fall back to guessed table names,
- use physical discovery only when semantic context is explicitly absent or
  insufficient.

Owner layer: Semaphor permissions or MCP discovery diagnostics.

## `react-semaphor` Missing

Symptom:

```text
Cannot resolve "react-semaphor/data-app-sdk".
```

Check:

```bash
npm run detect -- --dir /path/to/app
```

Fix with the target app's package manager:

```bash
npm install react-semaphor
pnpm add react-semaphor
yarn add react-semaphor
bun add react-semaphor
```

Owner layer: customer app dependency setup.

## Queries Stay Idle Or Return No Data

Symptom:

```text
useSemaphorQuery stays idle, or no network request is made.
```

Likely causes:

- no `SemaphorDataAppProvider` in the rendered tree,
- provider has no token,
- hosted runtime did not inject `window.__SEMAPHOR_DATA_APP_RUNTIME__`,
- component is rendered on the server without a client-side execution path.

Fix:

- ensure the hook component is inside a provider or hosted runtime,
- pass a runtime token,
- in Next.js, ensure hook components are client components.

Owner layer: customer app integration or SDK diagnostics if the idle state is
unclear.

## Data App DevTools Are Not Visible

Symptom:

```text
The generated app runs, but the Semaphor DevTools bubble is missing.
```

Likely causes:

- `<SemaphorDevtools />` is not mounted under `SemaphorDataAppProvider`,
- provider `debug` is omitted or false,
- the app is running from a non-dev host and the debug gate evaluates false,
- the app still resolves an older `react-semaphor` package that does not export
  `SemaphorDevtools`.

Fix:

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
} from "react-semaphor/data-app-sdk";

const enableDevtools =
  import.meta.env.DEV || window.location.hostname === "localhost";

<SemaphorDataAppProvider
  token={runtimeToken}
  debug={enableDevtools ? { exposeWindowBridge: true } : false}
>
  <App />
  <SemaphorDevtools
    initialIsOpen={false}
    buttonPosition="bottom-right"
    panelPosition="right"
  />
</SemaphorDataAppProvider>;
```

For agent/browser inspection, check:

```js
window.__SEMAPHOR_DEVTOOLS__?.snapshot()
```

If the snapshot is undefined in local dev, verify `debug` is enabled with
`exposeWindowBridge: true` and restart the dev server after linking or
upgrading `react-semaphor`.

Owner layer: generated app provider wiring or package resolution.

## Browser Fetch Fails

Symptom:

```text
Failed to fetch
```

Check:

- a custom `apiBaseUrl` override, if present, points at the intended Semaphor
  host,
- the configured hosted or self-hosted Semaphor service is reachable,
- CORS/proxy configuration allows the request,
- browser network tab shows the actual target URL,
- token is present and not expired.

By default, the SDK derives the Semaphor API URL from the token's
`apiServiceUrl`; most local apps should not set a separate API base URL.

Owner layer: setup/networking if the request never reaches Semaphor; Semaphor
API diagnostics if it reaches Semaphor but returns an unclear error.

## Dataset Or Field Not Found

Symptom:

```text
Data App execution reports invalid dataset or field refs.
```

Expected agent behavior:

- re-run MCP discovery for the domain/dataset/schema,
- use source-bearing refs from Semaphor metadata,
- preserve semantic identity by domain plus dataset id/name,
- do not compare semantic sources by `connectionId`,
- do not guess physical table names as a semantic substitute.

Owner layer: MCP metadata if source refs are missing or ambiguous; SDK/codegen
if generated query specs are stale.

## Singular `metric` Instead Of `metrics[]`

Symptom:

```text
Typecheck fails or analytics intent validation rejects the hook spec.
```

Fix:

```tsx
const revenueQuery = semaphor.metric({
  source,
  measures: [revenue],
  primaryMeasure: revenue,
});

const result = useSemaphorQuery(revenueQuery);
```

Owner layer: generated code or stale examples.

## Insight View Uses Static Data Instead Of `semaphor.analysis`

Symptom:

```text
The app shows a driver/spike/drop explanation, but the result is hardcoded or
copied from an authoring answer.
```

Expected behavior:

- use MCP `semaphor_analyze` to answer and validate the insight during
  authoring,
- productize the same canonical metric intent with `semaphor.analysis` plus
  `useSemaphorQuery`,
- keep `analysis: { kind: "period_change", orderBy }` in the query config for
  period-change views,
- pass `driverMode` and `includePopulation` only when the insight needs them,
- validate the extracted query spec through Semaphor when possible.

Owner layer: generated code or SDK docs if the hook is available; Semaphor
analytics execution if the requested analysis cannot be expressed by
`semaphor.analysis`.

## Record Key And Label Confusion

Symptom:

```text
Table headers render, but cells are blank.
```

Cause:

Records are keyed by stable `column.key` values, not display labels.

Correct:

```tsx
row[column.key]
```

Incorrect:

```tsx
row[column.label]
row["Movement Date"]
```

Owner layer: SDK examples/codegen if generated incorrectly; SDK contract if
`columns[].key` is missing.

## Input Relationship Cannot Be Proven

Symptom:

```text
Active input "filter_facility_id" cannot be applied because Semaphor could not
prove a modeled relationship to "some_dimension".
```

Cause:

The app passed a visible input handle to a query whose source cannot be safely
filtered through the input's source-bearing field. A valid option list from a
dimension table does not prove every KPI, chart, or table can subscribe to that
dimension filter.

Correct repair:

- inspect the planner input's `appliesToViewIds`, `bindings[]`,
  `relationshipHint`, and `relationshipsUsed`;
- pass the input only to listed/same-source views or through
  `semaphor.bindInput(handle, binding)` for source-specific bindings;
- remove the input from views where Semaphor cannot prove a relationship;
- report the semantic-model relationship gap if the user expected that view to
  be filterable.

Incorrect repair:

- do not join or filter returned rows in React;
- do not guess relationship ids or dimension fields;
- do not convert the filtered query to SQL just to bypass relationship proof
  unless the user explicitly approves a governed SQL fallback and the gap is
  reported.

Owner layer: generated code if it subscribed the wrong views; Semaphor semantic
model if the expected relationship is missing; planner if it emitted an
unprovable binding.

## Derived Field Fails Validation

Symptom:

```text
Derived field expression is invalid, unknown, or cannot be compiled.
```

Expected agent behavior:

- re-run MCP discovery for every source field used by the expression,
- verify placeholders such as `{revenue}` match the derived field `inputs`,
- confirm the derived field name does not collide with a source/catalog field,
- keep the calculation within one source unless Semaphor grounding exposes a
  valid relationship,
- use `computeStage` and `aggregationBehavior` intentionally for row-stage
  versus aggregate-stage calculations,
- do not move the calculation into frontend-only React code unless it is a
  presentation-only transformation.

Owner layer: generated code if the expression or inputs are wrong; Semaphor SDK
or analytics execution if a valid derived-field spec cannot be validated or
executed.

## Matrix Or Pivot View Is Wrong

Symptom:

```text
The pivot table has missing totals, wrong axes, too many rows, or client-only
pivot logic.
```

Expected agent behavior:

- re-run MCP metadata discovery for row axes, column axes, value fields,
  filters, date field, and relationships,
- use MCP `semaphor_matrix` to validate the intended matrix shape when
  available,
- use `semaphor.matrix(...)` for the runtime view,
- define totals, subtotals, sort order, display limits, and sparse/empty-cell
  behavior explicitly,
- render from the matrix result shape rather than ordinary `records`,
- avoid unbounded detail-row queries followed by React-only pivoting.

Owner layer: generated code if the agent chose the wrong axes or rendered the
wrong result shape; Semaphor SDK or analytics execution if a valid matrix
intent cannot be represented or executed.

## App Typecheck Or Build Fails

Symptom:

```text
npm run typecheck
npm run build
```

Expected agent behavior:

- use the target app's package manager and scripts,
- inspect the actual compiler error,
- fix the smallest relevant file,
- do not replace the app with the starter scaffold.

Owner layer: customer app integration or SDK type exports if public SDK types
are missing.

## `validate:data-app` Advisories

Symptom:

```text
Validation advisories:
```

Default advisories are not blockers. They point the agent at likely issues such as
placeholder refs, stale SDK shapes, missing obvious provider wiring, or record
label/key confusion.

Use `--strict` only for explicit quality gates.

Owner layer: usually generated code or docs, unless the advisory points to a
missing SDK/MCP capability.
