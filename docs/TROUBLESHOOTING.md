# Troubleshooting

Use this guide to classify common Semaphor Agent Plugin failures. Fix reusable
Semaphor layers when the failure is not truly plugin packaging or local app
workflow.

## Quick Triage

1. Is the agent/MCP connected?
2. Can MCP inspect the Semaphor project?
3. Can governed analysis execute?
4. Does the React app compile?
5. Does the React app have a runtime token and API base URL?
6. Does the browser show governed data?

## Missing `SEMAPHOR_PROJECT_TOKEN`

Symptom:

```text
MCP tools are unavailable or unauthorized.
```

Check:

```bash
echo "$SEMAPHOR_PROJECT_TOKEN"
```

Fix:

```bash
export SEMAPHOR_PROJECT_TOKEN="<project-token>"
```

Do not commit this token into source control.

Owner layer: local setup/auth docs unless the MCP error is unclear.

## Wrong `SEMAPHOR_MCP_URL`

Symptom:

```text
MCP connection fails, times out, or points at stale behavior.
```

Customer default:

```bash
export SEMAPHOR_MCP_URL="https://semaphor.cloud/api/mcp"
```

Self-hosted deployment example:

```bash
export SEMAPHOR_MCP_URL="https://your-semaphor-host.example.com/api/mcp"
```

Use the MCP URL that matches the Semaphor project token's environment.

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

- generate or provide a fresh project token for MCP authoring,
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
- `SEMAPHOR_PROJECT_TOKEN` carries the correct `project_id`,
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

Owner layer: `semaphor-app` Data App lifecycle unless the failure is local
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

## Hooks Stay Idle Or Return No Data

Symptom:

```text
Hooks stay idle, or no network request is made.
```

Likely causes:

- no `SemaphorDataAppProvider` in the rendered tree,
- provider has no token,
- hosted runtime did not inject `window.__SEMAPHOR_DATA_APP_RUNTIME__`,
- component is rendered on the server without a client-side execution path.

Fix:

- ensure the hook component is inside a provider or hosted runtime,
- pass a runtime token and API base URL,
- in Next.js, ensure hook components are client components.

Owner layer: customer app integration or SDK diagnostics if the idle state is
unclear.

## Browser Fetch Fails

Symptom:

```text
Failed to fetch
```

Check:

- `apiBaseUrl` points at the intended Semaphor host,
- the configured hosted or self-hosted Semaphor service is reachable,
- CORS/proxy configuration allows the request,
- browser network tab shows the actual target URL,
- token is present and not expired.

Owner layer: setup/networking if the request never reaches Semaphor;
`semaphor-app` diagnostics if it reaches Semaphor but returns an unclear
error.

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
if generated hook specs are stale.

## Singular `metric` Instead Of `metrics[]`

Symptom:

```text
Typecheck fails or analytics intent validation rejects the hook spec.
```

Fix:

```tsx
useSemaphorMetric({
  source,
  metrics: [revenue],
  primaryMetric: revenue,
});
```

Owner layer: generated code or stale examples.

## Insight View Uses Static Data Instead Of `useSemaphorAnalysis`

Symptom:

```text
The app shows a driver/spike/drop explanation, but the result is hardcoded or
copied from an authoring answer.
```

Expected behavior:

- use MCP `semaphor_analyze` to answer and validate the insight during
  authoring,
- productize the same canonical metric intent with `useSemaphorAnalysis`,
- keep `analysis: { kind: "period_change", orderBy }` in the hook config for
  period-change views,
- pass `driverMode` and `includePopulation` only when the insight needs them,
- validate the extracted hook spec through Semaphor when possible.

Owner layer: generated code or SDK docs if the hook is available; shared
analytics protocol or `semaphor-app` execution if the requested analysis cannot
be expressed by `useSemaphorAnalysis`.

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

## Plugin Validation Fails

Symptom:

```text
npm run validate:plugin
```

This validates the Agent Plugin package, not the customer's React app.

Fix:

- inspect `.codex-plugin/plugin.json`,
- inspect `.mcp.json`,
- ensure plugin skill paths and metadata are valid.

Owner layer: plugin packaging.

## Claude Plugin Validation Fails

Symptom:

```text
npm run validate:claude-plugin
```

This validates the Claude Code plugin manifest and shared plugin components,
not the customer's React app.

Fix:

- inspect `.claude-plugin/plugin.json`,
- inspect `.mcp.json`,
- ensure Claude Code is installed and current,
- keep Claude pointing at the same shared `skills/` and `.mcp.json` rather
  than copying a Claude-only skill.

Owner layer: plugin packaging.

## `validate:data-app` Advisories

Symptom:

```text
Validation advisories:
```

Default advisories are not blockers. They point the agent at likely issues such as
placeholder refs, stale SDK shapes, missing obvious provider wiring, or record
label/key confusion.

Use `--strict` only for explicit Semaphor package-maintainer quality gates.

Owner layer: usually generated code or docs, unless the advisory points to a
missing SDK/MCP capability.
