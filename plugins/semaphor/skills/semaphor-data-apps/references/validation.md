# Validation

Before reporting completion, run the strongest available checks:

- `node <plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>`;
- package typecheck script, if present;
- package build script, if present and reasonable;
- Semaphor MCP query checks for data-bearing analytics when credentials are
  available.

Treat the build as the authoritative app check when typecheck/build disagree.
Some repos have a loose root `tsc --noEmit` that under-checks app sources, so a
green typecheck plus a failing build means the build is right. Do not report
completion on a passing typecheck alone.

The validator is a compatibility smoke check by default. Treat its Semaphor
advisories as guidance, not customer-facing blockers. Use `--strict` only for
explicit quality gates.

Do not reimplement source/field validation in plugin prompts or scripts once
the Semaphor validation route is available. Plugin-local scans are package and
build preflight; Semaphor owns catalog-aware SDK hook validation.

`POST /api/v1/data-app/validate` and `/api/v1/data-app/execute` support
`semaphor.analysis(...)` query specs executed through `useSemaphorQuery` and
the same governed analytics query-spec service used by MCP
`semaphor_analyze`. Treat failures there as shared analytics/SDK/app execution
issues, not as host-specific prompt issues.

If validation cannot run, say exactly why.
