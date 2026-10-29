# Active Implementation Context

Active effort: **Plan B, agents state the same date windows as the editor** (relative-date-as-of). **Phase 5 of 5 in progress: agents are taught windows, then the plan closes.** Phases 1 to 4 closed and committed by Rohit (2026-10-28). Phase 5 stays uncommitted. Plan Revision 6 and spec Revision 5 approved by Rohit (2026-10-28).

The plan is `semaphor-app/docs/implementation-plans/relative-date-as-of/`, and the documents in it own the detail:
- **`PLAN-B.md`**: scope, decisions (RB-D1 to RB-D16), invariants (RB-INV-1 to RB-INV-7) and the phase checklists, each with its review boundary and expected behavior changes.
- **`SPEC-B.md`**: every type, signature, rule, refusal and reference example. "SPEC-B 3.2" means its section 3.2.
- **`REVIEW-LEDGER-B.md`**: investigation (B-IN), design review (B-ED) and phase (B-Pn) findings, with evidence and recurring hotspots.
- Plan A (`PLAN.md`, `SPEC.md`, closed) owns the window type itself; SPEC-B builds on it.

Read this file with `AGENTS.md` and `REVIEWER_GUIDANCE.md` before implementing or reviewing.

This file is identical in `react-semaphor`, `semaphor-app`, `semaphor-report-scheduler`, `agent-plugin` and `semaphor-fumadocs`; edit every copy together. The scheduler, agent-plugin and fumadocs work on `main`, uncommitted.

**Where the work is:**
- **Branch:** `feature/relative-date-window` in both repos, continuing after Plan A (react-semaphor `595e2661`, semaphor-app `6c5d08de0`).
- **Commits** are Rohit's. **Database:** no changes. **Release:** once, after Phase 5: semaphor-app, react-semaphor and the scheduler together (RB-D13).
- **Builds** take a long time: build react-semaphor only when the app needs its new exports or a check can't be had otherwise. Record a skipped build and its reason in the ledger.

## Intent

Today agents state dates in their own grammar (`{ unit, value, anchor?, completeness? }`, calendar and absolute windows), and about twenty files translate it into the editor's window type at the edges. The result is windows agents can't state ("Year to last completed month"), one request with two meanings, guessed completeness, several resolvers, hidden period-change fallbacks, and three validators. Plan B makes an agent's window the editor's window (`RelativeDateWindow`) or two absolute instants, read by one reader (`readAgentTimeWindow`), resolved by one resolver (`resolveAgentTimeWindow`), and reported from what ran by one builder (`reportTimeWindow`).

| Phase | Milestone |
| --- | --- |
| 1 (closed) | Retire the frozen Data App SDK: the rs SDK and its exports, the app route `POST /api/v1/data-app/execute`, the modules only it reaches (its records window path included), and its local eval. |
| 2 (closed) | Agent queries hold one checked window and use the resolver and the report builder. Inputs still take today's grammar (an interim reader body). |
| 3 (closed) | Period change on the same window; both fallbacks gone; every windowed request bounded to its window; empty results say why. |
| 4 (closed) | Every window field takes the window form; readback reports stored windows; today's grammar deleted. |
| **5 (now)** | Guidance, prompts, evals and docs teach the window form; the plan closes. |

## Key decisions (approved; do not re-litigate)

- **RB-D9:** the Data App SDK is retired, not migrated. It is a false start (Rohit, 2026-10-23). It is deleted by import graph; anything dashboards, input options or the MCP reach stays.
- **RB-D11:** hard break. Nobody uses the MCP in production; no aliases, translations or version pins for today's grammar.
- **RB-D2:** the anchor is required. **RB-D5:** saved cards and defaults refuse rolling windows of a day or longer. **RB-D16:** saved minute and hour windows need a column with a time of day.
- **RB-D1, RB-D3, RB-D4, RB-D6 to RB-D8, RB-D10, RB-D12 to RB-D15:** as PLAN-B states them, including: `semaphor_matrix` conditions unchanged (RB-D14); the interim body is scaffolding that ships in no release (RB-D12); reported dates are the window's own executed bounds, not an intersection with other filters (RB-D10).

## Phase 5 review boundary

- **Plan:** the Phase 5 checklist and the close-out. **Spec:** SPEC-B 5 "Files per phase", row 5; what agents read must match SPEC-B 2.1 (the window form), 2.4 and 3.2 (refusals and fixes), 2.5 and 3.9 (`resolvedTimeWindow`), 3.6 (read-only windows) and 3.7 (`noChanges`).
- **Built:**
  - agent-plugin `answering-questions.md`, app `SEMAPHOR_MCP_README.md`, and the plugin and agent evals teach the window form, how to read `resolvedTimeWindow`, `noChanges` and a read-only window; the evals gain "set the revenue dashboard to year to last completed month";
  - the scheduler's insight agent states the window form (RB-D13) and reports `noChanges.message`, never "no change"; a coverage test shows an empty period change answers no slot;
  - fumadocs: the retired Data App SDK section removed with its navigation; the MCP pages on the window form; `content/mcp-tools.json` regenerated; the filters page no longer says agents can't set Year to last completed month;
  - close-out: the dashboard-runtime and mcp-and-sdk areas, their explainers and `verified` stamps; plan, spec and ledger headers `closed`.
- **Unchanged:** runtime code in the app and react-semaphor (Phase 4, closed). Only the scheduler's prompt text and tests change code.
- **Proof:** the evals in the window form; scheduler tests; the coverage test; the fumadocs build; `npm run docs:check` and `npm run docs:map`.

## Expected behavior changes in Phase 5 (not findings)

- None at run time. The scheduler's insight agent sends window-form windows (its old grammar is refused since Phase 4) and reports why a period change has no changes.
- Customer docs drop the Data App SDK pages (RB-D9) and describe the window form.

Any other behavior change is a finding.

## Not findings for this effort

- **Decided design:** the window type, anchors, uses, refusals and the comparison rule (Plan A SPEC; SPEC-B 2 and 3). The decisions above.
- **Later work:** the release (Rohit, RB-D13) and commits (Rohit).
- **Renaming** the governed execution modules the Data App SDK leaves behind (`lib/data-apps/execution/**` that dashboards still use): its own plan.
- **`mcp-tools.json`** not regenerated: Phase 5 and a release check.
- **A deferred react-semaphor build** recorded in the ledger with its reason.
- **Races no real caller produces** (`REVIEWER_GUIDANCE.md`).

## Checks for Phase 5

- **semaphor-report-scheduler:** the insight-runner's tests and typecheck.
- **semaphor-app:** `npm run eval:analytics-plugin` live, once (read `scripts/analytics-plugin-eval/README.md` first), the eval harness tests, one `npm run briefing:replay:latest`, `npm run docs:check`, `npm run docs:map`.
- **semaphor-fumadocs:** the build.
- Customer docs: brand-neutral where they describe customer surfaces, generic BI examples (orders, customers, regions), capabilities first, second person.

## Ledger

The implementer records every finding in `REVIEW-LEDGER-B.md` under its phase: the finding, the root cause, the owning seam, the fix, the evidence and the status. Checklist items are ticked in PLAN-B.md in the same edit that records their evidence. A pattern seen in two or more findings goes in the recurring hotspots table with its strategic fix. Reviewers are read-only; the implementer records their findings.
