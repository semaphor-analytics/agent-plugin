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

1. Add a Semaphor project token to your React app's ignored local env file:

   ```bash
   VITE_SEMAPHOR_PROJECT_TOKEN="<project-token>"
   ```

2. Open Codex or Claude Code in your React app repository.

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
