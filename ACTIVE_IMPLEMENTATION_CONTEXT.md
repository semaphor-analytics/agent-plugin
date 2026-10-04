# Active Implementation Context

## Active boundary: Analytics MCP focus, Plan 1, Phase 1.3b (tool surface and plugin)

The plan lives in the Semaphor app repository:

- names and exact values:
  `semaphor-app/docs/implementation-plans/analytics-mcp-and-sdk/CONTRACTS.md`
  (wins on any conflict);
- tasks, "not in this phase" and "done when":
  `semaphor-app/docs/implementation-plans/analytics-mcp-and-sdk/PLAN-1-PHASES.md`,
  Phase 1.3b;
- findings: `semaphor-app/docs/implementation-plans/analytics-mcp-and-sdk/PLAN-1-REVIEW-LEDGER.md`.

Rohit asked for all of Plan 1 in one pass (2026-10-04). The work is
uncommitted on branch `fix/mcp-rework` in this repo and in semaphor-app; the
server change and the plugin change ship in the same release (R3).

### Intent

The plugin is analytics-first. It connects Claude Code or Codex to the hosted
Semaphor MCP and teaches agents to answer business questions with governed
analytics. The Data App building workflow (skill, local bridge, contract
scripts, publishing) is removed; the server no longer registers those tools.

### In scope

- `ACTIVE_IMPLEMENTATION_CONTEXT.md` and `AGENTS.md` moved from
  `plugins/semaphor/` to the repo root and rewritten.
- Deleted: `skills/semaphor-data-apps/`; the Data App and bridge scripts
  (`semaphor-mcp-remote.mjs`, `test-mcp-bridge.mjs`, `semaphor-data-app.mjs`,
  `materialize-generated-contract.mjs`, `inspect-generated-contract.mjs`,
  `init-semaphor-data-app.mjs`, `detect-react-app.mjs`,
  `data-app-authoring-surface.mjs`, `call-semaphor-tool.mjs`); the Data App
  docs (`DATA_APP_SDK_REFERENCE.md`, `PUBLISHING_TO_SEMAPHOR.md`,
  `SDK_HOOK_EXAMPLES.md`, `GOLDEN_WORKFLOWS.md`, after sections 2, 3 and 3A
  moved into the new skill).
- New `skills/semaphor-analytics/` (`SKILL.md` and `references/`).
- `.mcp.json`: one hosted `http` server, `semaphor`.
- Manifests (Claude and Codex `plugin.json`, both marketplace files),
  `LICENSE` (MIT), `validate-plugin-package.mjs`, both `package.json` files.
- Docs: both READMEs, `INSTALLATION_AND_AUTH.md`, `TROUBLESHOOTING.md`.
- Version `0.2.0` through `npm run version:plugin`.

### Key decisions (do not raise findings against these)

- MIT license, copyright "Semaphor Analytics Corp.", 2026 (README Q4).
- The save and publish CLI is deleted (P2-D2). Plan 2 (2026-10-04) then
  deleted hosting and the public Data App too.
- One server in `.mcp.json`, `"type": "http"`, no `semaphor-project` bridge.
  Headless and embedded use is documented as a client header setup with an
  MCP project token read from the environment variable `SEMAPHOR_MCP_TOKEN`.
- The skill tells agents the tool list depends on who is calling; it never
  promises a tool exists.
- Examples use camelCase arguments (CONTRACTS section 12.1).
- Data App server code: deleted by Plan 2 (branch `chore/data-app-removal`).

### Not in this phase

- Deleting Data App server code (Plan 2).
- The change pair (`semaphor_propose_change` / `semaphor_apply_change`,
  Phases 1.6a and 1.6b; see the 1.6b boundary below).
- The directory submission (Phase 1.7).

## Active boundary: Analytics MCP focus, Plan 1, Phase 1.6b (change pair references)

**Plan:** `semaphor-app/docs/implementation-plans/analytics-mcp-and-sdk/PLAN-1-PHASES.md`
Phase 1.6b; uncommitted.

**In scope:**
- `references/semantic-model.md`: the "Changing" section names
  `semaphor_propose_change` and `semaphor_apply_change` with the
  `semantic_model` (`add_relationship`) and `dashboard` (`create`) kinds,
  the 30-minute expiry, safe retries and the stale and unknown-outcome
  answers; the dataset schema bullet names the field roles, `fieldKind` and
  `aggregate` (Phase 1.4c);
- `references/access-and-tools.md`: the change tools by name and the change
  pair's errors;
- version `0.3.0` through `npm run version:plugin`.

**Key decisions (do not raise findings against these):**
- The skill keeps "show the preview and get a go-ahead"; it doesn't claim the
  client enforces review.
- Examples use the contract's argument shapes (CONTRACTS section 11).

**Not in this phase:** the directory submission (Phase 1.7).

## Review protocol: reviewers are read-only

- Do not edit the review ledger, the plan, this file, or any other doc.
- Do not edit source or tests, and do not leave new files in the working tree.
  Reproduction probes go outside the repository.
- Report findings in your review output only, each with severity, file and
  line, the concrete failing scenario, how you reproduced it, and whether a
  product setting or only raw custom options can reach it.
- The implementer records findings in the Plan 1 ledger and replies with the
  outcome.

## Working rules

- No commits; Rohit commits.
- Never put tokens, local env files or run evidence in this repository.
- Before marketplace-visible changes, follow
  `semaphor-app/docs/engineering/agent-plugin/RELEASE_VERSIONING.md`
  (Plan 2 Phase 2.3 moves it to `semaphor-app/docs/engineering/agent-plugin/`).
