# Active Implementation Context

## Current Slice

Hard-migrate the Semaphor agent plugin to one logical Data App MCP surface.
Data App contract creation, generation, update, and validation are server-owned
MCP tools exposed by live Semaphor `tools/list` after auth.

Grounding plan:

- `DATA_APP_CANONICAL_MCP_AUTHORING_SURFACE_PLAN.md` in the Semaphor app
  architecture docs.

OAuth and project-token MCP auth modes must expose the same project-scoped Data
App capabilities after project scope is known. OAuth may additionally list and
select projects; project-token mode is already scoped. Do not introduce a
planner/generator/materializer capability split by auth mode. Local file writes
are an installed-bridge capability layered on top of the same generated-contract
artifact workflow, not a different MCP behavior.

The plugin bridge may still:

- read a project token from process env, current working directory, configured
  client roots, or a target app workspace for installed-bridge calls that
  explicitly accept `workspaceDir` as a bridge-local auth/context hint;
- accept bridge-local `workspaceDir` on
  `semaphor_materialize_data_app_contract` calls so the installed plugin bridge
  can materialize server-returned generated contract artifacts under the target
  app after the server-owned materializer call succeeds;
- expose a typed `localMaterialization.officialCommand` object on generated
  contract responses. Agents may execute that official package command after
  resolving its `workspaceDir` and `semaphorPluginRoot` placeholders. The
  command fetches the generated artifact from the trusted
  `generatedContractArtifactBaseUrl` with the short-lived
  `generatedContractMaterializationToken`; it must not require a project token
  and must not read target-app env files to choose the artifact host;
- accept bridge-local `workspaceDir` on validation calls so the bridge can read
  the generated manifest plus generated TypeScript files and forward that
  payload to the server-owned validator;
- advertise a minimal bootstrap Data App authoring tool surface before
  project-token auth when the target app token is discoverable only from
  `workspaceDir` on the first tool call. This includes the server-owned Data App
  planning/contract/validation tools and the semantic-model repair proposal/apply
  tools used when Data App planning returns a missing-relationship repair
  action. These bootstrap schemas are dispatch/auth-context schemas for
  server-owned tools; the bridge must still strip bridge-only arguments, resolve
  auth, and proxy the call to Semaphor instead of implementing planning,
  generation, update, validation, or semantic repair locally;
- accept bridge-local `workspaceDir` on `semaphor_inspect_data_app_state` so
  the bridge can validate local generated files and return compact
  `currentAuthoringState` for iterative authoring. Hosted MCP may expose the
  tool, but hosted responses are only a typed local handoff because hosted MCP
  cannot read the user's filesystem;
- expose `npm run data-app -- inspect-state --dir <app>` as the official local
  inspection path before iterative analytical edits;
- allow `npm run data-app -- update-contract --goal "<goal>"
  --operation-intent-file <file> --dir <app>` to read the large generated
  manifest locally and send it internally to the server update tool. This is
  not a compatibility shim; it is the first-class local authoring command path
  that prevents agents from hand-authoring or pasting large manifest payloads;
- strip `workspaceDir` before forwarding tool arguments to Semaphor. It is a
  local bridge hint, not a server generator input;
- expose only access/context plus Data App authoring bootstrap dispatch tools
  before project-token auth is available;
- proxy live Semaphor MCP tools after auth.

The plugin bridge and plugin package must not:

- define plugin-local implementation schemas for Data App contract behavior
  beyond the minimal bootstrap dispatch schemas described above;
- ship local generated-contract generator or validator wrappers;
- ask agents to use file paths, `planArtifactPath`, `codegenSummaryPath`, or
  inline codegen artifacts as generator inputs;
- forward `workspaceDir` to Semaphor or describe it as part of the server
  generator contract;
- preserve compatibility shims for old generated contract workflows.
- expose, document, or honor separate MCP/server URL env variables; all
  project-token MCP routing derives from the project token's `apiServiceUrl`.
  Tokenless artifact materialization is the only exception: it uses the
  server-returned `generatedContractArtifactBaseUrl`, not env routing.

Version constraint for reviewers:

- Do not ask to re-advertise `workspaceDir` on the authenticated live
  server-owned schemas for `semaphor_generate_data_app_contract`,
  `semaphor_create_data_app_contract`, or
  `semaphor_update_data_app_contract`. Authenticated live schemas should remain
  the server contract. The installed bridge may expose `workspaceDir` on the
  unauthenticated bootstrap dispatch schemas for these tools only so the first
  call can resolve the target app project token from `.env.local`; the bridge
  must strip `workspaceDir` before forwarding to Semaphor.

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
- docs, skills, or eval prompts treating `nextAgentAction` prose as the
  machine contract when `localMaterialization.officialCommand` is present;
- docs, skills, or eval prompts saying the official
  `npm run data-app -- materialize-contract` command requires a project token;
- docs, skills, or eval prompts telling agents to paste
  `contract.manifest.json`, `codegenSummary`, or generated TypeScript contents
  into chat/tool calls for iterative updates instead of using the official
  local `inspect-state` / `update-contract` command path;
- `semaphor_inspect_data_app_state` reporting `inspection.status="inspected"`
  without validating the local generated manifest plus generated TypeScript
  files through Semaphor;
- docs, skills, or eval prompts telling agents that `workspaceDir` is a
  server-side input for `semaphor_generate_data_app_contract`,
  `semaphor_create_data_app_contract`, or
  `semaphor_update_data_app_contract`, or telling agents to use those tools for
  local file writes instead of calling `semaphor_materialize_data_app_contract`
  with `generatedContractArtifactId` plus
  `generatedContractMaterializationToken` plus `workspaceDir`;
- docs, skills, or eval prompts describing `workspaceDir` as a server-side
  generator input instead of a bridge-local hint that is stripped before
  forwarding;
- a bridge fallback that advertises runtime-token, general analytics, broad
  semantic discovery, or other non-Data-App-authoring bootstrap tools before
  auth. The allowed pre-auth bootstrap surface is `semaphor_get_access_context`
  plus minimal Data App workflow dispatch tools that need `workspaceDir` to
  resolve target-app auth on the first call. Semantic-model repair proposal/apply
  tools are allowed here only as server-owned Data App repair passthrough tools;
  the plugin must not duplicate semantic repair schemas or implementation logic.

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
