# Active Implementation Context

## Current Slice

Hard-migrate the Semaphor agent plugin to one logical Data App MCP surface.
Data App contract creation, generation, update, and validation are server-owned
MCP tools exposed by live Semaphor `tools/list` after auth.

The plugin bridge may still:

- read a project token from the target app workspace when `workspaceDir` is
  supplied;
- expose only auth/access guidance before project-token auth is available;
- proxy live Semaphor MCP tools after auth.

The plugin bridge and plugin package must not:

- define plugin-local MCP schemas for Data App contract tools;
- ship local generated-contract generator or validator wrappers;
- ask agents to use `workspaceDir` or file paths as generator inputs;
- preserve compatibility shims for old generated contract workflows.

## Review Guardrails

Raise findings for:

- missing first-class server-owned contract tools in the authenticated tool
  surface;
- reintroduced local generator/validator scripts or package scripts;
- docs, skills, or eval prompts telling agents to use local contract wrappers,
  `planArtifactPath`, or `workspaceDir` for generation;
- a bridge fallback that advertises rich contract tools before auth.

Do not raise findings asking for legacy compatibility with the removed local
generator/validator scripts. This feature is still under development and the
approved invariant is hard migration.

## Required Checks

For this phase, run:

```bash
cd <agent-plugin-repo>
npm --prefix plugins/semaphor run validate:plugin
```

From `semaphor-app`, run the focused MCP/tool tests and TypeScript checks for
any server-side tool changes.
