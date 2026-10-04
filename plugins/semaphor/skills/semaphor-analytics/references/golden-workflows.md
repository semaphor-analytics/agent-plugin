# Golden workflows

Expected agent behavior for the three core analytics workflows. Each keeps the
same spine:

```text
customer request
  -> inspect Semaphor metadata through MCP
  -> run governed analysis
  -> explain the answer from the governed result
```

## 2. Explore Available Data

Customer prompt:

```text
What Semaphor data can I use in this project?
```

Expected agent behavior:

- do not edit files,
- call Semaphor MCP discovery tools,
- prefer semantic domains and datasets over physical tables,
- summarize available domains, datasets, important fields, metrics, and date
  fields,
- call out missing metadata or unclear field roles instead of guessing.

Expected validation:

- no file changes,
- answer cites concrete Semaphor domains/datasets/fields.

## 3. Answer A BI Question

Customer prompt:

```text
Why did inventory movement change last month?
```

Expected agent behavior:

- do not edit files,
- inspect semantic metadata,
- use `semaphor_analyze` for governed semantic analysis when the question fits,
- use `semaphor_query_sql_advanced` only for SQL-first questions that cannot be
  represented cleanly by semantic analysis,
- explain the answer from governed execution results.

Expected validation:

- no app build required,
- answer includes the dataset and fields used,
- uncertainty is explicit when the data cannot answer the question.

## 3A. Use Advanced SQL When Needed

Customer prompt:

```text
Use SQL to inspect the latest raw inventory movement rows.
```

Expected agent behavior:

- discover the project, domain, dataset, and connection context before writing
  SQL,
- use `semaphor_query_sql_advanced` because the user explicitly requested raw
  SQL/raw rows,
- validate with a small SQL preview such as `LIMIT 5` or `LIMIT 10` unless the
  user explicitly asks to inspect more rows,
- provide `analyzeFallbackReason` and `analyzeFallbackExplanation`,
- explain that `semaphor_analyze` is still preferred for ordinary governed BI
  questions,
- do not request database credentials or bypass Semaphor permissions.

Expected validation:

- returned rows come from governed Semaphor execution,
- no invented connection/table identifiers,
- no token or credential leakage.
