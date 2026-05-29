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
  --data-app-id <data-app-id> \
  --title "Operations App"
```

The publish command automatically runs the same prepare step before saving the
draft. That matters because the saved source snapshot must include the prepared
manifest that Semaphor publishes.

The publish sequence is:

```text
build static assets
  -> infer and write semaphor.data-app.json runtime fields
  -> save draft with source snapshot and sourceRevision.snapshotHash
  -> start Semaphor publish from that saved draft
  -> upload hashed assets
  -> complete or fail the publish session
```

## Server-Rendered Apps

Next.js, Remix, or custom server-rendered apps can still use Semaphor SDK hooks
in their own runtime. Semaphor-hosted publish needs a static browser entry.

If the normal app build does not produce one, add a small static Data App
entrypoint for Semaphor publish, then point `--build-command`, `--assets-dir`,
or `semaphor.data-app.json` at that output.

The agent should explain this distinction instead of replacing the customer's
app structure.
