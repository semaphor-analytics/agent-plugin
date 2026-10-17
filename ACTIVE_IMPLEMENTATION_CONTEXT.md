# Active Implementation Context

Active effort: **Domain template 2.1, Phase 3** (writers on 2.1), task 3.6.
The plan lives in the semaphor-app repository; this repo carries one guidance
change that ships in the same release as the server's MCP change tools
(plan "Release safety": semaphor-app, react-semaphor,
semaphor-report-scheduler and this plugin deploy together).

## Read first (they win over this file)

1. `../semaphor-app/docs/implementation-plans/domain-template-organization/PLAN.md`:
   decision DT-D13 (MCP takes 2.1 shapes, no aliases) and task 3.6.
2. `../semaphor-app/docs/implementation-plans/domain-template-organization/SPEC.md`:
   §12.2 (the MCP `add_relationship` schema) and §12.4 (this guidance).
3. `../semaphor-app/ACTIVE_IMPLEMENTATION_CONTEXT.md`: the full Phase 3
   boundary, do-not-flag and flag lists.

## This repo's share (task 3.6)

- `plugins/semaphor/skills/semaphor-analytics/references/semantic-model.md`
  teaches the 2.1 `add_relationship` operation: `relationship.from` and
  `relationship.to` (`{ dataset, fields }`), `from` is the many side,
  cardinality `many_to_one` or `one_to_one`, `defaultJoinType` `LEFT` or
  `INNER`. A key warning does not block the change.

## Flag

- Any 2.0 vocabulary left in guidance that teaches writes
  (`sourceDataset`, `targetDataset`, `sourceFields`, `targetFields`,
  `one_to_many`, `calculatedMetrics`, `fields.metrics`).
- Guidance that differs from spec §12.2.

Reviewers are read-only: report findings in your review output. No commits,
branches or pushes unless Rohit asks.
