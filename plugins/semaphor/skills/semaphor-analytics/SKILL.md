---
name: semaphor-analytics
description: Answer business and data questions with Semaphor's governed analytics. Use when the user asks about metrics, trends, drivers, comparisons, dashboards, or the semantic model in a Semaphor project, or asks to audit or reconcile a dashboard. Discovers the semantic model first, runs governed queries through the Semaphor MCP, and falls back to SQL only when the question needs it.
---

# Semaphor analytics

Semaphor is a governed analytics platform. Its MCP server (`semaphor`) gives
you the project's semantic model (domains, datasets, measures, dimensions,
relationships), governed query execution, dashboards, and a raw-SQL escape
hatch. Every query runs under the caller's permissions and security
policies, so answers match what the user's dashboards would show.

## The workflow

1. **Start with `semaphor_get_analysis_context`.** It says which path fits the
   project (`semantic`, `physical`, `restricted` or `unavailable`) and which
   tool to call next. In an interactive session, call `semaphor_list_projects`
   first and pass `projectId` (a user with one project can omit it). A token
   session is already pinned to one project: never list or switch projects.
2. **Ground in the semantic model.** `semaphor_list_semantic_domains` →
   `semaphor_list_datasets` → `semaphor_get_dataset_schema`. Use exact dataset
   and field names from these results. Never guess identifiers.
3. **Query with governed tools.**
   - `semaphor_analyze` for measures by dimensions, top-N, trends, time
     windows, period comparisons, drivers and period-change analysis.
   - `semaphor_matrix` for pivots and hierarchies (a bounded window with
     continuation cursors; not a full export).
4. **Explain the answer from the result:** the dataset and fields used, the
   time window that ran, and any warning the result carries. If the data
   can't answer the question, say what is missing.
5. **Fall back to SQL only when needed** (see
   [references/sql-escape-hatch.md](references/sql-escape-hatch.md)).

## The tool list depends on who is calling

Do not assume a tool exists. What the session lists depends on the caller:

- organization users who log in interactively see project listing;
- SQL and physical discovery need the right role (or a token that allows
  them);
- change tools need write access;
- an embedded end user sees read and analytics tools for their own data.

If a tool you expected is missing, call `semaphor_get_access_context`: it
reports the access mode, scopes and whether SQL is available. Work with the
tools you have, and tell the user when a request needs access they don't
have. A `capability_required` error means an argument needs SQL access; use
the semantic form of the same tool instead.

## References

- [Answering questions](references/answering-questions.md): the governed
  analytics path, with examples.
- [Dashboard audits and reconciliation](references/dashboard-audits.md).
- [Semantic model inspection and changes](references/semantic-model.md).
- [The SQL escape hatch](references/sql-escape-hatch.md).
- [Access, tools and errors](references/access-and-tools.md).
- [Golden workflows](references/golden-workflows.md): expected behavior for
  exploration, BI questions and advanced SQL.

## Rules

- Read before you write. Change tools are for explicit requests; show the
  preview and get the user's go-ahead before applying a change.
- Never ask for database credentials or try to bypass Semaphor permissions.
- Never print tokens.
- Use the argument names exactly as each tool lists them (camelCase, for
  example `responseFormat`). A tool rejects any argument it doesn't define.
