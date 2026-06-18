# Active Implementation Context

## Current Slice

Hard-migrate the Semaphor agent plugin to one logical Data App MCP surface.
Data App contract creation, generation, update, and validation are server-owned
MCP tools exposed by live Semaphor `tools/list` after auth.

The plugin bridge may still:

- read a project token from the target app workspace when `workspaceDir` is
  supplied;
- accept bridge-local `workspaceDir` on contract create/generate/update calls
  so the installed plugin bridge can materialize server-returned generated
  files under the target app after the server-owned tool call succeeds;
- accept bridge-local `workspaceDir` on validation calls so the bridge can read
  the generated manifest plus generated TypeScript files and forward that
  payload to the server-owned validator;
- strip `workspaceDir` before forwarding tool arguments to Semaphor. It is a
  local bridge hint, not a server generator input;
- expose only auth/access guidance before project-token auth is available;
- proxy live Semaphor MCP tools after auth.

The plugin bridge and plugin package must not:

- define plugin-local MCP schemas for Data App contract tools;
- ship local generated-contract generator or validator wrappers;
- ask agents to use file paths, `planArtifactPath`, `codegenSummaryPath`, or
  inline codegen artifacts as generator inputs;
- forward `workspaceDir` to Semaphor or describe it as part of the server
  generator contract;
- preserve compatibility shims for old generated contract workflows.

## Review Guardrails

Raise findings for:

- missing first-class server-owned contract tools in the authenticated tool
  surface;
- reintroduced local generator/validator scripts or package scripts;
- docs, skills, or eval prompts telling agents to use local contract wrappers,
  `planArtifactPath`, `codegenSummaryPath`, inline codegen artifacts, or
  app file paths for generation;
- docs, skills, or eval prompts telling agents to hand-write returned
  generated contract payload files when `localWrite` is absent or
  `src/semaphor/generated` was not materialized by the installed plugin bridge;
- docs, skills, or eval prompts describing `workspaceDir` as a server-side
  generator input instead of a bridge-local hint that is stripped before
  forwarding;
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
