# Active Implementation Context

Active effort: **Semantic model editing through the MCP** (mcp-semantic-model-editing). semaphor-app, react-semaphor, semaphor-fumadocs and agent-plugin (Phase 5), on `feature/mcp-semantic-model-editing` cut from main in each, uncommitted. Commits and releases are Rohit's.

The plan is `semaphor-app/docs/implementation-plans/mcp-semantic-model-editing/`:
- **`PLAN.md`** (Revision 2, approved by Rohit 2026-11-01 as recommended): scope, decisions SE-D1 to SE-D12, invariants SE-INV-1 to SE-INV-8, resolved questions SE-Q1 to SE-Q4, and a checklist per phase, ticked as work lands.
- **`REVIEW-LEDGER.md`**: findings with root cause, owning seam, fix and evidence (`P<phase>-<nn>`), and recurring hotspots.

Read this file with `AGENTS.md` and `REVIEWER_GUIDANCE.md` (semaphor-app's is shared by every repo) before implementing or reviewing. It is identical in semaphor-app, react-semaphor, semaphor-fumadocs and agent-plugin; edit every copy together. The usage-events effort's context is replaced here at Rohit's request; its plan stays where it is.

## Intent

An agent in Claude, ChatGPT or any MCP client can improve a semantic domain as it works: add and remove synonyms and example questions, set instructions, labels and descriptions, formats and direction, hide a field, add a calculation, change a definition, and turn a relationship off. Each change reads back in one line before it is saved (what, from → to, what stays), and nothing an author typed by hand is overwritten unseen. Today the MCP's only domain change is `relationship.add`.

## Phases

Current: Phase 4.

1. **One edit owner (app).** The workbench's shared pure edit helpers move from `src/components/domain/utils/` to `src/lib/semantic/template/`; a pure resolver `applyDomainChanges` builds the template, before and after values and the readback line per change.
2. **Descriptive kinds (rs, app, fumadocs).** `domain.update`, `dataset.update`, `field.update`, `metric.update`: label, description, Context, format, unit, direction, display field, `hidden: true`.
3. **Definitions (rs, app, fumadocs).** `calculation.add` (placement decides the home), expressions, default aggregate, granularity, primary date field, `relationship.update`.
4. **The assistant's block (rs, app).** The Data model changes block shows the new kinds.
5. **Customer guide (fumadocs).** One page with every operation; agent-plugin check.

## Decisions in force (approved by Rohit; do not reopen)

- **SE-D1** No new MCP tools: the kinds join `semaphor_propose_change` (with `domainId`) and apply through `semaphor_apply_change`.
- **SE-D2** noun.verb names, no `domain.` prefix on dataset, field or metric kinds.
- **SE-D3** One Context shape on every kind: `instructions` replaced (null clears), `synonyms` and `examples` only `add` / `remove`.
- **SE-D4** Pure edit helpers live in `src/lib/semantic/template/`; kind schemas live in react-semaphor beside `relationshipAddSchema`; writers in the app.
- **SE-D5** Who: `isOrgAuthorOrHigher` and `authorizeDomainWrite`, by role (AJ-D15, AJ-D19). No credential rule.
- **SE-D6** A domain proposal holds `relationship.add` only, or the new kinds only (including `calculation.add` and `relationship.update`). New kinds apply all or nothing, 1 to 20.
- **SE-D7** One readback line per change; text shortened to 80 characters; lists show adds, removes and a kept count.
- **SE-D8** Propose stores the value read for each replaced value; apply refuses the whole proposal as `proposal_stale` if any changed, naming each. List adds and removes apply to the lists as they are at apply. The write uses `saveDomainTemplate` with `expectedStored`.
- **SE-D9** A change to an existing definition (formula, default aggregate, grain, primary date, a relationship's state or join): `risk: medium`, a "used by" line from the domain model. `calculation.add` and the Phase 2 kinds are `risk: low` (nothing reads a new calculation yet). Every domain proposal has `confirm: needed`.
- **SE-D10** What stays in the workbench is listed in the propose tool's description; anything else is refused by the schema.
- **SE-D11** Limits are the template's (`AI_CONTEXT_LIMITS`, `validateDomainTemplate`), at propose and apply.
- **SE-D12** Customer docs ship with each kind (Phases 2, 3) and a guide (Phase 5).
- **SE-D13** The propose definition's hard cap is 32,500 in `mcp-propose-change-schema.test.ts` (approved by Rohit 2026-11-01); the ratchet is the measured size.

## Invariants

- **SE-INV-1** Workbench and MCP build the same template from the same edit (parity test per kind).
- **SE-INV-2** No wholesale replacement of a synonym or example list.
- **SE-INV-3** `name` never changes; refused with "Change the label instead."
- **SE-INV-4** A replaced value changed after propose is never overwritten.
- **SE-INV-5** Every write goes through `saveDomainTemplate` and validates as 2.1.
- **SE-INV-6** Propose saves nothing; apply saves all or none.
- **SE-INV-7** No query hot path change.
- **SE-INV-8** User-facing refusals and readback lines never name the product.

## Review boundary

semaphor-app, Phase 1: the moved helpers and their new home in `src/lib/semantic/template/`, the workbench and other importers, the resolver and its tests. semaphor-app, later phases: `src/lib/mcp/changes/`, `src/lib/mcp/change-proposal-store.ts`, `src/app/api/mcp/tools/change-tools.ts`, the compact schema read in `grounding-tools.ts`, the MCP parity and plugin eval cases, and their tests. react-semaphor: the domain kind schemas beside `relationshipAddSchema` in `src/shared/dashboard-authoring/changes/`, `buildProposeChangeInputSchema`, and the assistant's `assistant-model-change.tsx` (Phase 4). semaphor-fumadocs: `content/docs/mcp/` pages for these kinds and the guide. agent-plugin: `skills/semaphor-analytics/references/semantic-model.md` and `access-and-tools.md`.

## Do not flag (reviewers and implementers)

- A count of dashboards or cards in the "used by" line: decided out (SE-Q1).
- Unhiding a field through the MCP: decided out (SE-Q2).
- `relationship.add` not mixable with the new kinds in one proposal (SE-D6, SE-Q3).
- Keys, unique keys, sources and SQL, adding or removing datasets, removing fields, fact filters, field moves, renames: out of scope (SE-D10).
- No compatibility shims for earlier MCP shapes: nobody depends on the MCP yet; reshaping is allowed.
- The workbench saving by whole-template replace: unchanged; only its helpers move.
- No credential (OAuth versus token) check on domain kinds: decided by role (SE-D5).
- A metric across datasets' formula, turning a relationship back on, RIGHT or FULL joins: stay on the domain page (ledger P3-04, P3-05).
- `relationship.update` not setting `updatedAt`: it matches the workbench's own delete (P3-05).
- `calculation.add` at `risk: low`: agreed (SE-D9); it still asks for a yes.
