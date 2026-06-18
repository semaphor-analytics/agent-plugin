# Publish Lifecycle

Use the plugin helper for Semaphor-hosted lifecycle writes:

```bash
npm run load:data-app -- --data-app-id <data-app-id>
npm run save:data-app -- --dir <app> --project-id <project-id> --title "<title>"
npm run prepare:publish -- --dir <app>
npm run publish:data-app -- --dir <app> --project-id <project-id> --title "<title>"
```

Save/publish must go through Semaphor Data App lifecycle REST/command APIs. Do
not use MCP lifecycle wrappers for publish.

The Semaphor Data App lifecycle API returns canonical `links.consoleUrl` and
`links.sampleEmbedUrl` when an app id is known. The plugin helper maps those to
top-level `url`, `sampleEmbedUrl`, and `consoleUrl` in its JSON output for
convenience. `sampleEmbedUrl` contains an `<accessToken>` placeholder for the
customer's runtime embed token. Report the sample embed URL and console URL
after publish; do not report a viewer URL, inspect env files, or probe route
definitions to reconstruct links.

## Tokens And Routing

The helper reads the project token from shell env or the target app's local env
files. It accepts:

- `SEMAPHOR_PROJECT_TOKEN`
- `VITE_SEMAPHOR_PROJECT_TOKEN`

It resolves the Semaphor app URL from `SEMAPHOR_SERVER_URL`, then the token's
`apiServiceUrl`, then `https://semaphor.cloud`. Use `SEMAPHOR_SERVER_URL` only
for self-hosted deployments where the token URL should not be used. Use
`--api-base-url` only for an exact helper override.
Use `--validation-status <path>` only for a precomputed Semaphor validation
result.

Do not use `allowEdit: false` as an auth or runtime boundary.

## Identity

After the first successful save or publish, the helper writes
`semaphor.projectId` and `semaphor.dataAppId` to `semaphor.data-app.json`.

Subsequent `load`, `save-draft`, and `publish` commands may omit
`--data-app-id`; they update the manifest-bound Data App. Use `--new` only when
the user wants a separate hosted Data App copy.

## Publish Sequence

Publish always:

1. saves a draft first;
2. starts publish from that draft id plus `sourceRevision.snapshotHash`;
3. builds locally;
4. prepares `semaphor.data-app.json` with `runtime.entry` and
   `runtime.styles`;
5. uploads generated hashed assets;
6. completes or fails the same server-owned publish session.

Semaphor-hosted publish requires a static browser bundle that mounts into
`#root`. If a server-rendered app does not produce that bundle, add a small
static Data App entrypoint for publish instead of reshaping the whole customer
app.

## Source Snapshots And Assets

Source snapshots must respect `.gitignore` in git repos and must not include:

- ignored local files;
- dotfiles;
- env files;
- registry config;
- service-account JSON;
- common credential JSON files.

Publish uploads must exclude source maps unless Semaphor later defines an
explicit debug artifact contract.
