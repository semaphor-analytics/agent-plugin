## Active Implementation Context

This document contains active, plan-specific guidance for current Semaphor Agent
Plugin implementation work. Do not generalize this context into permanent
customer-facing docs unless the source-of-truth plan explicitly calls for it.

### Relationship-Aware Filters, Cascading Inputs, And Joined Views

Temporary scope for the current implementation: Agent Plugin guidance for
relationship-aware Data App filters, cascading option lists, joined inputs, and
joined projections.

#### Source Of Truth Docs

Before implementing or reviewing Agent Plugin guidance related to
relationship-aware filters, cascading option lists, joined projections,
cross-source filters, planner prompts, generated React source guidance, or MCP
tool workflow guidance, read:

- [Relationship-Aware Filters, Cascading Inputs, And Joined Views](/Users/rohit/code/semaphor/semaphor-app/docs/system-architecture/data-apps/RELATIONSHIP_AWARE_FILTERS_AND_JOINS_PLAN.md)

That Semaphor App plan is the source of truth for scope, assumptions, accepted
decisions, non-goals, phase gates, progress checklist, and reviewer
constraints. Reviewer agents must evaluate plugin changes against the phase or
phases explicitly claimed by the PR/change. Do not raise findings that conflict
with settled decisions in the plan or require future phases that the
implementation does not claim to complete.

#### Current Slice

- Agent Plugin guidance is Phase 4 work in the source-of-truth plan.
- Customer-facing plugin guidance may advertise Phase 4 relationship-aware
  planner output only for the implemented runtime-backed slice: direct
  key-backed joined labels, same-source cascading inputs, fact-bridged related
  option population, relationship hints, and joined-filter diagnostics.
- Plugin guidance must tell agents to use planner-emitted source-bearing
  bindings, population specs, relationship hints, and relationship diagnostics,
  not hand-written SQL joins or client-side filtering workarounds.
- Missing relationship behavior belongs in Semaphor's shared contracts,
  app-owned relationship module, SDK validation, MCP/planner tools, or runtime
  execution. Do not solve it with plugin prompt rules alone.

#### Settled Decisions

- Relationship-aware behavior is shared analytics spine work, not a
  plugin-only feature.
- V1 defaults option dependencies to `auto`; generated specs should omit
  `dependencies` unless overriding the default.
- V1 invalid selection policy is `clear_dependents`.
- Option narrowing can be bidirectional, but value propagation is disabled in
  v1. Selecting one input must not auto-select a parent or peer input.
- Relationship hints use explicit relationship ids only; do not add role-alias
  parsing such as `buyer_customer`.
- RLS, CLS, tenant access, and project access are owned by existing governed
  execution layers. Do not add plugin guidance that reimplements them.
- Raw SQL remains an explicit escape hatch, but automatic relationship-aware
  filter propagation into SQL is out of scope for this plan.

#### Reviewer Guardrails

Reviewer agents should focus plugin findings on whether guidance is aligned
with the source-of-truth plan and current phase.

Reviewer agents should not require plugin docs/prompts to implement
relationship proof, client-side joins, field-name join heuristics, regex SQL
scanners, RLS/CLS behavior, automatic SQL propagation, selection propagation,
role-alias hints, or relationship-aware features that are not yet implemented
and tested in the shared contracts/runtime.
