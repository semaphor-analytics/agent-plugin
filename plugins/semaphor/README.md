# Semaphor

Build Semaphor-backed React data apps from Codex or Claude Code.

This is the installable Semaphor plugin package. It provides shared skills,
MCP configuration, and helper scripts for building, validating, saving, and
publishing governed Semaphor Data Apps.

For installation instructions, see the marketplace README at the repository
root:

```text
https://github.com/semaphor-analytics/agent-plugin
```

## Quick Start

1. Connect to Semaphor.

   For the lowest-friction first run, log in with the hosted `semaphor` MCP
   server when your agent host asks for auth.

   For deterministic scoped development, add a Semaphor project token to your
   React app's ignored local env file:

   ```bash
   VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
   ```

   For non-Vite apps, use your app's normal runtime config. The plugin helper
   scripts also accept `SEMAPHOR_PROJECT_TOKEN` from shell env or local env
   files.

   Hosted Semaphor needs no extra server URL. For local development,
   self-hosted deployments, tunnels, or Semaphor dogfooding, add the optional
   host override:

   ```bash
   SEMAPHOR_SERVER_URL="http://localhost:3000"
   ```

   If `SEMAPHOR_SERVER_URL` is absent, the plugin uses the host encoded in the
   project token and falls back to `https://semaphor.cloud`.

2. Open Codex or Claude Code in your React app repository. If you are starting
   fresh, use `https://github.com/semaphor-analytics/semaphor-data-app-starter`.

3. Ask:

   ```text
   What Semaphor data can I use in this project?
   ```

4. Then ask the agent to plan, build, validate, save, or publish the app.

## Documentation

- [Installation and auth](docs/INSTALLATION_AND_AUTH.md)
- [Golden workflows](docs/GOLDEN_WORKFLOWS.md)
- [Data App SDK reference](docs/DATA_APP_SDK_REFERENCE.md)
- [Data App SDK examples](docs/SDK_HOOK_EXAMPLES.md)
- [Publishing to Semaphor](docs/PUBLISHING_TO_SEMAPHOR.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
