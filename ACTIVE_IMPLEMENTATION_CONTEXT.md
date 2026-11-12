# Active Implementation Context

**Active effort: Calculated fields, one core for every scope, in the editor and through the MCP** (`docs/implementation-plans/mcp-calculated-fields/`): [PLAN.md](../semaphor-app/docs/implementation-plans/mcp-calculated-fields/PLAN.md) (Revision 3.4; every decision MC-D1 to MC-D20 approved by Rohit; Phases 0 to 4 authorized 2026-11-12) and its [REVIEW-LEDGER.md](../semaphor-app/docs/implementation-plans/mcp-calculated-fields/REVIEW-LEDGER.md). Built uncommitted on `feature/calculated-fields-one-core` (cut from local `main` 2026-11-12) in react-semaphor, semaphor-app, agent-plugin and semaphor-fumadocs. Phase 5 (the backfill) and Phase 6 (release 2) are **not** part of this work. Commits, merges and releases are Rohit's.

Read this file with `AGENTS.md` and `REVIEWER_GUIDANCE.md`. The same text is in each repo's context file; the plan and ledger live in semaphor-app. The plan is self-contained: its **Terms** and **Names and shapes** sections define every word and type used below.

## Intent

A calculated field has one definition in one of two places, the semantic domain or the dashboard (`dashboard.calculatedFields`). A card's calculated column is either a **domain reference** (rebuilt from the domain on every run) or a **dashboard copy** (run as stored, kept in step with its dashboard field by one owner). Release 1 (Phases 0 to 4) delivers:

1. **Phase 0, measure and characterize:** read-only counts across every organization, the editor's stored shapes pinned by tests, the domain compiler compared with the editor, the IN-03 refusal reproduced.
2. **Phase 1, reader fix:** cards on domain calculations read, build and change through the MCP; the refusal reads as a sentence.
3. **Phase 2, one core:** one owner per calculation job (tokens, column identity and kind, definition writer, validation, `compileCalculation` service); duplicates and the dead validator deleted; the same SQL for every card.
4. **Phase 3, dashboard fields in the editor:** `calculatedField.add/update/remove` operations that keep every copy in step; the frame commit merges instead of replacing; `adoptCalculatedFields`; release 1 save checks of the field list; no new card or sheet fields.
5. **Phase 4, the MCP:** `calculation.add/update/remove` routed by the proposal's target; cards naming dashboard fields; the outline's `calculatedFields`; sentences, refusals, parity test, evals, plugin guidance, MCP docs.

## Key decisions (approved; do not raise findings against them)

- **MC-D1** Two places only: domain and dashboard. Card and sheet scope are retired: the editor offers no "This card" or "This sheet" choice from release 1, a new field goes to the dashboard, existing card fields stay readable and editable until Phase 5 moves them.
- **MC-D2** `checkColumn` refuses a column with an origin only when `readExactDomainCalculatedFieldReference` returns nothing; the round-trip check still refuses a change whose built card holds a different field. `holdsAsked` passes a reader refusal's own message and fix through.
- **MC-D3** One `calculation.*` schema module, registered once in the tool shape, listed in both op lists for routing; an all-`calculation.*` proposal routes by target (`domainId` without `dashboardId` → domain, else dashboard); mixed with card ops → dashboard; mixed with domain edit ops → domain; other mixes refused as today; `create` takes `calculation.add` only.
- **MC-D4** Agents add a dashboard field; no `query.calculatedFields` on `card.add`.
- **MC-D5** A dashboard formula compiles with the domain's compiler (`placeNewCalculation`, `compileDatasetMetricExplorerField` / `compileDatasetDimensionExplorerField`) through `ChangeServices.compileCalculation`. No new parser.
- **MC-D6** One token module (`shared/dashboard-authoring/calculations/tokens.ts`); the editor keeps its looser matcher only for text being typed.
- **MC-D7** `calculation.update` in a domain proposal goes to the domain writers; `calculation.remove` in a domain proposal is refused ("Remove it on the domain page.").
- **MC-D8** `validateCalculation` holds the validate route's body; used at propose and in the dialog only. `analyzeExpressionAggregateContext` scans with `scanAggregateExpression`; the dead explorer validator is deleted.
- **MC-D9** A card whose calculated columns are domain references, or dashboard copies equal to their field (`calculatedColumnMatchesField`), is editable; a card query names a dashboard field by name; `resolveCalculatedFieldName` is dashboard first, then domain.
- **MC-D10** The `calculatedField.*` operations are the one owner of dashboard-field changes; removal of a field in use is refused on every surface, naming the cards and filters.
- **MC-D11** `FrameCommit.calculatedFieldOps` replaces `dashboardCalculatedFields` and `sheetCalculatedFields`; the commit never replaces the list.
- **MC-D12** Release 1 save checks of `dashboard.calculatedFields` only (unique identity keys and names, every `{field_N}` has its input, every input used, `role` and `dataType` present). The refusal of columns without a definition and of card `calculatedFields` is **release 2 only** and not in this work.
- **MC-D15** Matrix bindings unchanged; agents can't create Matrix calculations (`editorOnly`).
- **MC-D16** No change of the stored shape: `{field_N}` over full `calculatedFormula.inputFields`.
- **MC-D17** Authorized as today: dashboard place uses the `card.add` edit rule; domain place `authorizeDomainWrite`.
- **MC-D19** `adoptCalculatedFields(dashboard, cards, { frozen })`; in release 1 it adopts dashboard copies only and leaves frozen copies alone.
- **MC-D20** A dashboard `calculation.add` names `domainId` and `dataset` and reads one dataset; metric and cross-dataset inputs are refused with "add it to the domain"; an update can't move a field between measure and dimension.

## Invariants

- **MC-INV-1** Editor and MCP save identical JSON for the same dashboard-field edit (parity test per stored shape).
- **MC-INV-2** One owner per job; no caller keeps a copy.
- **MC-INV-3** What a change writes, the outline reads back as stated.
- **MC-INV-4** Query hot path: running a card adds no metadata, catalog, validation or definition read; copies run as stored.
- **MC-INV-5** A column reads as its field's name only when it equals the field.
- **MC-INV-6** No broader than the editor.
- **MC-INV-7** No new parser; no regex over SQL.
- **MC-INV-8** Phases 1 to 4 change no card's executed SQL (`card-sql-snapshot`).
- **MC-INV-9** No schema changes; no production data writes in this work.
- **MC-INV-10** White label: no product name in sentences, refusals, save errors or docs.
- **MC-INV-11** Release 1 breaks nothing stored: no data migration, the run path unchanged, save accepts everything it accepts today.

## Not findings for this effort

- Anything in the plan's **Out of scope** list: Matrix calculations, the stored shape, resolving dashboard copies at run time, removing domain calculations through the MCP, deleting unused definitions, SQL card text, measure filters on calculated fields, text-valued calculated measures, measure calculations, the dialog's look.
- Frozen copies, raw SQL copies and card-field copies being left as they are, still running as stored, and still saved without refusal: Phase 5 and release 2 handle them.
- Code that Phase 6 deletes (card and sheet field readers and writers, the legacy frame move, `INERT_FIELD_KEYS`) still existing.
- A field list that keeps card fields readable and editable in the editor (MC-D1 until Phase 5).
- Races no real caller produces (AGENTS.md, "Scope And Completion").
- Uncommitted files outside the phase's review boundary belong to other sessions.

## Review boundaries

Each phase's review boundary is the one stated in the plan under that phase (Phases 0 to 4); review the diff against it, the decisions and invariants it names, and its checklist.

## Review ledger

The implementer records every finding in [REVIEW-LEDGER.md](../semaphor-app/docs/implementation-plans/mcp-calculated-fields/REVIEW-LEDGER.md) under its phase (`P0-nn` to `P4-nn`) with root cause, owning seam, fix, evidence and status, and adds a recurring hotspot when a cause repeats. A finding that changes a decision or invariant updates PLAN.md in the same diff.

## Review protocol: reviewers are read-only

Reviewers do not edit any file in any repo: no source, tests, ledger, plan or context edits, and no temporary files in the working tree (probes go outside the repo). They report findings in their review output; the implementer verifies each one, then fixes it or records why it was declined.

## Working rules

- Tick plan checklist items as each is done, in the same edit that records ledger evidence.
- Build react-semaphor only when the app needs new or changed exports, at most once per phase.
- Every react-semaphor change runs `npm run check:guards` (judged by its exit code) with tsc, lint and Vitest on the changed suites.
- Read-only production lookups only through `scripts/lookup/` and `_db.sh`; never print secrets.
- MCP evidence names its server (dev or production); a dev pass is never called "fixed".
- No database changes, no production writes. No commits or pushes unless Rohit asks; the work stays uncommitted on the branch.
