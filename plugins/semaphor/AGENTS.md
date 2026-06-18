# Semaphor Agent Plugin - Agent Guide

This repository is the customer-facing Semaphor Agent Plugin package for
Codex, Claude Code, and future coding-agent hosts.

## Operating Rules

- Before reviewing or changing active Data App contract-generation work, read
  `ACTIVE_IMPLEMENTATION_CONTEXT.md` in this directory. It contains
  implementation-slice scope, hard-migration decisions, and reviewer guardrails
  that may be more current than general package guidance.
- Keep this package host-neutral. Codex and Claude Code should use the same
  skill, MCP configuration, helper scripts, SDK query hooks, validation route,
  and Data App lifecycle APIs.
- Keep customer app support focused on Vite React. Do not require the starter
  scaffold, a specific router, a provider filename, a styling system, or a
  table library.
- Use Semaphor MCP for authoring discovery and governed analysis.
- Generate runtime React code with public `react-semaphor/data-app-sdk` hooks.
- Save and publish through Semaphor Data App lifecycle APIs when requested.
- Infer server-backed table needs from user intent and the planned UX, not only
  literal wording. Use starter-included Semaphor components in starter/eval
  apps. In existing apps, ask before copying starter component source or adding
  table dependencies unless the user has already approved them; adapt
  server-backed table mechanics into the host app when the planned experience
  needs pagination, sorting, drill-through, or large/complete result sets.
- If the customer app contains a `samples/`, `src/samples/`, `examples/`, or
  documented design-reference directory with a reference dashboard, study it
  before generating Data App UI. Match its layout patterns, filter-chip
  treatment on affected cards, sortable-table affordances, totals-row
  pattern, loading/error/empty handling, and density choices. Do NOT copy its
  data-loading pattern: reference samples use static fixtures while production
  code uses `useSemaphorQuery` per the SDK contract.
- Before writing code for a broad Data App, decide and state the implementation
  map: file organization, query ids, which filters apply to which cards/views,
  which views are intentionally not affected, and how root SDK DevTools will be
  enabled. Keep `App.tsx` as a small provider/page-shell/composition file, write
  Semaphor source refs, field refs, inputs, query specs, and filter bindings
  only from the server-generated contract under `src/semaphor/generated`, and
  put repeated data-bearing views in separate card/view components. Do not
  hand-author parallel contract modules such as `src/semaphor/sources.ts`,
  `src/semaphor/fields.ts`, `src/semaphor/inputs.ts`, or
  `src/semaphor/queries.ts`. Do not generate a thousand-line `App.tsx` or simply
  move the same problem into one giant dashboard component.
- Do not add a host-specific analytics language. Missing analytical behavior
  belongs in Semaphor's shared MCP, SDK, validation, or execution contracts.
- If a generated Data App filter or joined view requires a semantic
  relationship the model cannot prove, use Semaphor MCP semantic model repair:
  propose the relationship with evidence, ask the author for explicit approval,
  apply only after approval, and rerun planning/validation before updating app
  code. Do not silently force broken filters in React.
- Use the current public Semaphor MCP, SDK, validation, and lifecycle
  contracts. If examples or guidance are stale, update them to the current
  public contract instead of generating compatibility aliases or host-specific
  workarounds.
- Do not commit tokens, local env files, generated run artifacts, screenshots,
  private notes, or release evidence to this package or to customer app repos.
  Keep local evidence in ignored output directories.

## Customer App Validation

For customer React apps, prefer the app's own typecheck/build scripts plus:

`semaphor_validate_data_app_contract({ workspaceDir })` after generation files
are written. The installed plugin bridge reads
`src/semaphor/generated/contract.manifest.json` plus the generated TypeScript
files and forwards them to the server validator.

Do not validate with the manifest alone. Manifest-only validation skips
generated-file drift detection and can let hand-edited or stale generated files
pass.

Use the target app's package manager and scripts when they differ. The
Semaphor MCP validator checks generated contract integrity and file drift; the
app's own build remains the authoritative local app check.
