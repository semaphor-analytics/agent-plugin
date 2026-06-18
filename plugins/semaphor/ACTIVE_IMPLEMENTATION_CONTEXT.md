# Active Implementation Context

## Current Slice

Hard-migrate the Semaphor agent plugin to one logical Data App MCP surface.
Data App contract creation, generation, update, and validation are server-owned
MCP tools exposed by live Semaphor `tools/list` after auth.

OAuth and project-token MCP auth modes must expose the same project-scoped Data
App capabilities after project scope is known. OAuth may additionally list and
select projects; project-token mode is already scoped. Do not introduce a
planner/generator/materializer capability split by auth mode. Local file writes
are an installed-bridge capability layered on top of the same generated-contract
artifact workflow, not a different MCP behavior.

The plugin bridge may still:

- read a project token from process env, current working directory, configured
  client roots, or a target app workspace only on bridge-local tools that still
  explicitly accept `workspaceDir`;
- accept bridge-local `workspaceDir` on
  `semaphor_materialize_data_app_contract` calls so the installed plugin bridge
  can materialize server-returned generated contract artifacts under the target
  app after the server-owned materializer call succeeds;
- accept bridge-local `workspaceDir` on validation calls so the bridge can read
  the generated manifest plus generated TypeScript files and forward that
  payload to the server-owned validator;
- strip `workspaceDir` before forwarding tool arguments to Semaphor. It is a
  local bridge hint, not a server generator input;
- expose only auth/access guidance plus the narrow
  `semaphor_materialize_data_app_contract` artifact materializer before
  project-token auth is available. This exception exists so a user can
  materialize a server-generated short-lived `generatedContractArtifactId`
  locally without adding a project token to the target workspace;
- proxy live Semaphor MCP tools after auth.

The plugin bridge and plugin package must not:

- define plugin-local MCP schemas for Data App contract tools;
- ship local generated-contract generator or validator wrappers;
- ask agents to use file paths, `planArtifactPath`, `codegenSummaryPath`, or
  inline codegen artifacts as generator inputs;
- forward `workspaceDir` to Semaphor or describe it as part of the server
  generator contract;
- preserve compatibility shims for old generated contract workflows.

Version constraint for reviewers:

- Do not ask to re-advertise `workspaceDir` on
  `semaphor_generate_data_app_contract`,
  `semaphor_create_data_app_contract`, or
  `semaphor_update_data_app_contract` for project-token auth discovery. For
  this hard-migration version, project-token runs are expected to launch from
  the target app root, use configured client roots, or export
  `SEMAPHOR_PROJECT_TOKEN` / `VITE_SEMAPHOR_PROJECT_TOKEN` before calling
  generate/create/update. `workspaceDir` is reserved for
  `semaphor_materialize_data_app_contract` local writes and validation
  workspace reads. If non-app-cwd project-token auth becomes a blocking
  workflow, the follow-up should be a separate bridge-only auth hint, not
  overloading `workspaceDir` on generator/update tools again.

## Review Guardrails

Raise findings for:

- missing first-class server-owned contract tools in the authenticated tool
  surface;
- reintroduced local generator/validator scripts or package scripts;
- docs, skills, or eval prompts telling agents to use local contract wrappers,
  `planArtifactPath`, `codegenSummaryPath`, inline codegen artifacts, or
  app file paths for generation;
- docs, skills, or eval prompts telling agents to reconstruct generated
  contract files from hosted tool output when `localWrite` is absent or
  `src/semaphor/generated` was not materialized by the installed plugin bridge;
- docs, skills, or eval prompts telling agents to pass `workspaceDir` to
  `semaphor_generate_data_app_contract`,
  `semaphor_create_data_app_contract`, or
  `semaphor_update_data_app_contract` instead of calling
  `semaphor_materialize_data_app_contract` with `generatedContractArtifactId`
  plus `generatedContractMaterializationToken` plus `workspaceDir`;
- docs, skills, or eval prompts describing `workspaceDir` as a server-side
  generator input instead of a bridge-local hint that is stripped before
  forwarding;
- a bridge fallback that advertises rich planning, generation, update,
  validation, semantic, runtime-token, or analytics tools before auth. The only
  allowed Data App fallback before project-token auth is
  `semaphor_materialize_data_app_contract`, and it must accept only
  `generatedContractArtifactId` plus `generatedContractMaterializationToken`
  plus `workspaceDir`.

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
