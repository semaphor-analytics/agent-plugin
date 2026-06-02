# SQL-Backed Views

Use `semaphor.sql` for advanced SQL-backed runtime views when semantic queries
cannot express the product requirement or when the user explicitly asks for raw
SQL. Inline SQL is supported, but execution must still go through the Semaphor
SDK and governed server-side execution.

SQL is the fallback path, not the default dashboard path. Before writing SQL,
try to express the view as:

1. `semaphor.metric(...)` for KPIs and aggregates;
2. `semaphor.records(...)` for bounded rows, charts, and tables;
3. `semaphor.analysis(...)` for governed insights, drivers, trends, and
   period-change analysis;
4. `semaphor.matrix(...)` for pivot or hierarchy tables;
5. `semaphor.derivedField(...)` for calculated metrics that should still run
   through governed execution.

Only keep SQL for the part that remains unsupported after that path.

## Rules

- Use MCP to identify the connection, dialect, tables, and columns.
- Validate candidate SQL with `semaphor_query_sql_advanced` before productizing
  it in React.
- During authoring validation, start with a small preview query such as
  `LIMIT 5` or `LIMIT 10` unless the user explicitly asks to inspect more rows.
  The goal is to confirm connection, syntax, columns, and sample shape without
  filling the agent context with raw data.
- Keep SQL bounded and parameterized.
- Do not concatenate SQL strings in React.
- Use `inputs` for runtime filter/control values.
- Use `defaultParameters` only for static SQL `param(...)` fallback values.
- Keep readonly assumptions explicit. Readonly database access does not remove
  the need for governed execution, row limits, secrets hygiene, and server-side
  filtering.
- In the app plan and code comments, record the exact fallback reason: explicit
  user SQL request, no semantic domain, field not exposed, unsupported
  latest-snapshot/windowing, unsupported join/grain, raw-row inspection, or
  validation/debugging.

## Public SQL Spec Shape

```ts
type SqlQuerySpecShape = {
  id?: string;
  label?: string;
  source: {
    kind: "sql";
    connectionId: string;
    dialect?: string;
    label?: string;
  };
  sql: string;
  inputs?: unknown[]; // Semaphor filter/control/sqlParam specs
  defaultParameters?: Record<
    string,
    string | number | boolean | null | Array<string | number | boolean | null>
  >;
  limit?: number;
  pagination?: { page?: number; pageSize?: number };
  rationale?: string;
};
```

## SQL Table Fast Path

1. Use MCP to identify the connection/table/columns and validate SQL with
   `semaphor_query_sql_advanced`. Start with a tiny preview limit for
   validation.
2. Define runtime controls with `semaphor.sqlParam` and filters with
   `semaphor.filter`.
3. Define one bounded `semaphor.sql` spec with `inputs`,
   `defaultParameters`, and `limit`.
4. Execute it with `useSemaphorInputs` and `useSemaphorQuery`.
5. Render loading, error, empty, and table states from `result.records` and
   `result.columns`; use `column.key` for row access.

```tsx
const limitParam = semaphor.sqlParam({
  id: "limit",
  label: "Rows",
  defaultValue: 100,
});

const latestRowsQuery = semaphor.sql({
  id: "latest-rows",
  label: "Latest rows",
  source: { kind: "sql", connectionId: "conn_123", dialect: "clickhouse" },
  sql: `
    select movement_date, quantity_tons
    from inventory_movements
    order by movement_date desc
    limit {{ param("limit") }}
  `,
  inputs: [limitParam],
  defaultParameters: { limit: 100 },
  limit: 100,
});

function LatestRowsTable() {
  const [limitHandle] = useSemaphorInputs([limitParam]);
  const result = useSemaphorQuery(latestRowsQuery, {
    inputs: [limitHandle],
  });

  if (result.isLoading) return <TableSkeleton />;
  if (result.error) return <ErrorState message={result.error.message} />;
  if ((result.records ?? []).length === 0) return <EmptyState />;

  return (
    <table>
      <thead>
        <tr>
          {(result.columns ?? []).map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {(result.columns ?? []).map((column) => (
              <td key={column.key}>{formatCell(row[column.key], column)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Parameterized SQL With Filters

```tsx
const region = semaphor.filter({
  id: "region",
  label: "Region",
  field: { name: "region", role: "dimension", dataType: "string" },
  operator: "in",
});

const limit = semaphor.sqlParam({
  id: "limit",
  label: "Limit",
  defaultValue: 100,
});

const rowsQuery = semaphor.sql({
  source: { kind: "sql", connectionId: "conn_123", dialect: "clickhouse" },
  sql: `
    select movement_date, quantity_tons
    from inventory_movements
    where 1 = 1
      {{ filter("region").sql }}
    order by movement_date desc
    limit {{ param("limit") }}
  `,
  inputs: [region, limit],
  defaultParameters: { limit: 100 },
  limit: 100,
});

function LatestRows() {
  const [regionHandle, limitHandle] = useSemaphorInputs([region, limit]);
  const rows = useSemaphorQuery(rowsQuery, {
    inputs: [regionHandle, limitHandle],
  });
  return <DataTable rows={rows.records} columns={rows.columns ?? []} />;
}
```
