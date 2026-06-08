# Publishing To Semaphor

Semaphor-hosted publish is narrower than local React integration.

Any React app can use `react-semaphor/data-app-sdk` hooks in a customer-owned
runtime. To render inside Semaphor as a hosted Data App, the app must also
produce a static browser bundle that Semaphor can load in an iframe.

## Hosted Runtime Contract

The published bundle must:

- build to static files, default `dist/`,
- include a hashed JavaScript module entry,
- optionally include hashed CSS files,
- mount into the iframe's `#root` element,
- read runtime auth and URLs from `react-semaphor/data-app-sdk` provider/runtime
  context, not from committed secrets.

The manifest points Semaphor at those built files:

```json
{
  "schemaVersion": "data-app/v1",
  "runtime": {
    "framework": "react",
    "bundler": "vite",
    "entry": "assets/index-a1b2c3d4.js",
    "styles": ["assets/index-e5f6g7h8.css"]
  }
}
```

Asset paths must be relative and content-hashed. Paths such as
`assets/index.js`, `/assets/index-a1b2.js`, `https://.../index-a1b2.js`, and
`../index-a1b2.js` are not valid hosted publish paths.

Semaphor sets `runtime.assetsBasePath` on the server when publish completes.
Do not hardcode it in source.

## Prepare Locally

Run:

```bash
npm run prepare:publish -- --dir /path/to/customer-app
```

The helper:

1. runs the app build script,
2. inspects the built asset directory, default `dist/`,
3. reads `dist/index.html` when available,
4. infers the hashed JS entry and CSS files,
5. updates `semaphor.data-app.json`,
6. reports the assets that would be uploaded.

Use `--check` to validate inference without writing the manifest:

```bash
npm run prepare:publish -- --dir /path/to/customer-app --check
```

Use `--assets-dir` when the build output is not `dist`:

```bash
npm run prepare:publish -- --dir /path/to/customer-app --assets-dir build
```

## Publish

Run:

```bash
npm run publish:data-app -- \
  --dir /path/to/customer-app \
  --project-id <project-id> \
  --title "Operations App"
```

The publish command automatically runs the same prepare step before saving the
draft. That matters because the saved source snapshot must include the prepared
manifest that Semaphor publishes.

When publish succeeds, the Semaphor API returns canonical links. The helper
also exposes `url`, `sampleEmbedUrl`, and `consoleUrl` at the top level for
agent ergonomics. `sampleEmbedUrl` intentionally contains an `<accessToken>`
placeholder; customers should replace it with a runtime embed token generated
by their backend.

```json
{
  "dataAppId": "d_123",
  "links": {
    "consoleUrl": "https://semaphor.cloud/project/proj_123/data-apps/d_123",
    "sampleEmbedUrl": "https://semaphor.cloud/embed/<accessToken>?dataAppId=d_123"
  },
  "url": "https://semaphor.cloud/embed/<accessToken>?dataAppId=d_123",
  "sampleEmbedUrl": "https://semaphor.cloud/embed/<accessToken>?dataAppId=d_123",
  "consoleUrl": "https://semaphor.cloud/project/proj_123/data-apps/d_123"
}
```

Use `sampleEmbedUrl`/`url` as the customer-facing iframe sample and
`consoleUrl` as the Semaphor console/edit link. Do not report a viewer URL or
reconstruct links by reading env files or probing route definitions.

On the first save or publish, the helper creates the hosted Data App and writes
the returned identity to `semaphor.data-app.json`:

```json
{
  "semaphor": {
    "projectId": "proj_123",
    "dataAppId": "dash_abc"
  }
}
```

Later saves and publishes use that identity by default and update the same
Semaphor Data App. Pass `--data-app-id` to override the manifest identity, or
`--new` to intentionally create a separate Data App and replace the local
manifest identity with the newly-created id.

The helper records a local source baseline in
`.semaphor.data-app.local.json`. On later saves or publishes, it checks that the
remote Data App draft/current source still matches the baseline this workspace
last loaded or saved. If the remote source changed elsewhere, the helper stops
instead of overwriting it. Load the latest Data App source before editing,
publish with `--new` to create a separate copy, or pass `--force` only for an
intentional overwrite/recovery.

The publish sequence is:

```text
build static assets
  -> infer and write semaphor.data-app.json runtime fields
  -> save draft with source snapshot and sourceRevision.snapshotHash
  -> start Semaphor publish from that saved draft
  -> upload hashed assets
  -> complete or fail the publish session
```

## Static Browser Entry

Semaphor-hosted publish needs a static browser entry. For the supported Vite
React path, the normal app build should produce `dist/index.html` plus hashed
assets. If the normal build does not produce that shape, add a small static
Data App entrypoint for Semaphor publish, then point `--build-command`,
`--assets-dir`, or `semaphor.data-app.json` at that output.

The agent should explain this distinction instead of replacing the customer's
app structure.
