# Data App SDK Reference For Agents

Use this as the first reference when authoring Semaphor-backed React code. It is
intentionally compact so agents do not need to inspect
`node_modules/react-semaphor/dist` or implementation internals during ordinary
app building.

If this reference is missing a public contract detail, prefer the exported
TypeScript declarations for the public subpath
`react-semaphor/data-app-sdk`. Do not read SDK implementation bundles as the
normal discovery path. Record the missing example as a plugin or SDK docs gap.

## Runtime Provider

Generated customer code should pass the project/runtime token only. Vite
example:

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
} from "react-semaphor/data-app-sdk";

const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;
const enableDevtools =
  import.meta.env.DEV || window.location.hostname === "localhost";

root.render(
  <SemaphorDataAppProvider
    token={runtimeToken}
    debug={enableDevtools ? { exposeWindowBridge: true } : false}
  >
    <App />
    <SemaphorDevtools
      initialIsOpen={false}
      buttonPosition="bottom-right"
      panelPosition="right"
    />
  </SemaphorDataAppProvider>,
);
```

For generated local/dev apps, mount one root `<SemaphorDevtools />` and enable
provider debug with `exposeWindowBridge` as shown above. The default right dock
keeps vertical analytics space intact while the app remains visible beside the
inspector; use `panelPosition="bottom"` only when the user asks for a bottom
dock. This gives developers the floating
inspector and gives coding agents a structured trace snapshot via
`window.__SEMAPHOR_DEVTOOLS__?.snapshot()`. Do not enable the window bridge for
production embeds, tenant/end-user views, or normal customer runtime code.
Do not wrap every card in DevTools boilerplate; `useSemaphorQuery()` traces are
enough for the global inspector. For broad generated dashboards, use the
TanStack-style root DevTools integration only. If traceability needs help, pass
hook-level debug metadata/source hints instead of adding per-card DevTools
wrapper boilerplate.
When cheap and non-repetitive, add hook-level source hints so DevTools and evals
can point from a query trace back to code:

```tsx
const result = useSemaphorQuery(salesTrendQuery, {
  debug: {
    sourceHint: {
      file: "src/components/SalesTrendCard.tsx",
      component: "SalesTrendCard",
    },
  },
});
```

Source hints are optional. Stable query ids, labels, and small query modules
remain the primary traceability contract.

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or `apiBaseUrl` unless
the user explicitly needs local or self-hosted routing that intentionally
differs from the token's `apiServiceUrl`.

For Next.js, Remix, React Router, or custom shells, follow the app's existing
runtime configuration convention instead of forcing Vite env names.

## Code Organization For Generated Dashboards

For broad or multi-view generated dashboards, keep Semaphor definitions in
dedicated modules. This is what lets DevTools traces, reviewer feedback, and
future edits map a visible card back to the source/query contract quickly.

Use this shape unless the host app already has an equivalent convention:

```text
src/
  App.tsx
  semaphor/
    sources.ts
    fields.ts
    inputs.ts
    queries.ts
  components/
    layout/FilterBar.tsx
    cards/<ViewName>Card.tsx
  utils/formatting.ts
```

`src/semaphor/*` owns Semaphor sources, field refs, shared filters, input option
queries, and query specs. Components import those specs, call
`useSemaphorQuery(...)`, and render loading/error/empty/ready states. Do not
move a large dashboard from `App.tsx` into one large component while leaving
all `semaphor.*(...)` specs there.

## Public Imports

```tsx
import {
  SemaphorDataAppProvider,
  defineSemaphorDataApp,
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";

import type {
  SemaphorQueryResult,
  SemaphorMetricQueryResult,
  SemaphorRecordsField,
  SemaphorRecordsQueryResult,
  SemaphorRowsQueryResult,
  SemaphorSqlQueryResult,
  SemaphorMatrixQueryResult,
  SemaphorDerivedFieldDefinition,
  SemaphorSourceRef,
} from "react-semaphor/data-app-sdk";
```

Do not type helpers with `ReturnType<typeof useSemaphorQuery>`. The hook is
overloaded, and TypeScript can collapse the overloads to the wrong result
shape. Use the exported result types above.

## Builder Selection

- `semaphor.metric`: scalar KPIs and aggregate KPI cards, including multiple
  independent scalar measures from the same source.
- `semaphor.records`: row-shaped results for charts, tables, trends,
  breakdowns, grouped values, and detail lists from semantic fields.
- `semaphor.analysis`: governed insight, driver, spike/drop, and
  period-change views.
- `semaphor.sql`: SQL-backed views when the user explicitly asks for SQL or
  the semantic contract cannot express the view yet.
- `semaphor.matrix`: pivot tables, hierarchy tables, subtotals, grand totals,
  sparse cells, and matrix display limits.
- `semaphor.derivedField`: app-local calculated fields that should execute
  through governed Semaphor query execution.
- `semaphor.filter`, `semaphor.sqlParam`, `semaphor.control`: runtime inputs.

Always inspect Semaphor MCP metadata first. Do not invent source, connection,
dataset, table, or field identifiers.

Use the planner's `queryKind` as the source of truth. If a planned view is
`queryKind: "metric"`, implement it with `semaphor.metric(...)` unless the
requested visual is actually row-shaped or the SDK cannot express the metric.
When you must fall back to `semaphor.records(...)` for a planned metric view,
record the fallback plainly in the final response and eval findings.

`semaphor.metric(...)` supports multiple KPIs in one query through the
`measures` array. `primaryMeasure` controls `result.value`; all scalar values
are available in `result.measures` keyed by measure field name:

```tsx
const kpiQuery = semaphor.metric({
  id: "sales-kpis",
  source: salesSource,
  measures: [salesValue, shippedTons, grossMargin],
  primaryMeasure: salesValue,
});

const result = useSemaphorQuery(kpiQuery, { inputs });

const sales = result.value;
const tons = result.measures?.shipped_tons;
const margin = result.measures?.gross_margin;
```

Use separate `semaphor.records(...)` queries for companion trends, sparklines,
tables, or grouped breakdowns. Do not use `records` just to make scalar KPI
rendering easier. A successful scalar metric query should render from
`result.value` and `result.measures`; if those are missing while DevTools shows
aggregate rows, treat that as a Semaphor metric-runtime issue to report or fix,
not as permission to silently convert the KPI to records.

When validating SQL through MCP during authoring, start with a tiny preview
such as `LIMIT 5` or `LIMIT 10` unless the user explicitly asks for more rows.
The preview should confirm syntax, columns, and sample shape; runtime app
queries can have their own bounded limit, pagination, or server-side table
contract.

## Result Shape

Rows are keyed by `column.key`. Labels are display text only.

```tsx
function RowsTable({ result }: { result: SemaphorRowsQueryResult }) {
  if (result.isLoading) return <TableSkeleton />;
  if (result.error) return <ErrorState message={result.error.message} />;
  if ((result.records ?? []).length === 0) return <EmptyState />;

  return (
    <table>
      <thead>
        <tr>
          {(result.columns ?? []).map((column) => (
            <th key={column.key}>{column.label ?? column.key}</th>
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

Do not use `row[column.label]`, `row[column.name]`, display-looking hardcoded
keys such as `row["Movement Date"]`, or `Object.entries(row)` for rendered
tables.

Tables should also include sorting and numeric totals. For bounded result
sets, sort the displayed rows in React and show displayed-row totals for
numeric columns. For paginated or complete-dataset tables, represent sorting
and pagination in the Semaphor query spec and use a separate aggregate query
when the total must cover all filtered rows.

```tsx
const [sortKey, setSortKey] = useState<string | null>(null);
const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

const sortedRows = useMemo(() => {
  const rows = [...(result.records ?? [])];
  if (!sortKey) return rows;
  return rows.sort((left, right) => {
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return sortDirection === "asc"
        ? leftValue - rightValue
        : rightValue - leftValue;
    }
    return sortDirection === "asc"
      ? String(leftValue ?? "").localeCompare(String(rightValue ?? ""))
      : String(rightValue ?? "").localeCompare(String(leftValue ?? ""));
  });
}, [result.records, sortDirection, sortKey]);

const numericTotals = (result.columns ?? [])
  .filter((column) => column.dataType === "number")
  .map((column) => ({
    key: column.key,
    value: sortedRows.reduce((sum, row) => {
      const value = row[column.key];
      return typeof value === "number" ? sum + value : sum;
    }, 0),
  }));
```

## SQL-Backed Table Fast Path

Use this when a prompt is SQL-first.

1. Use MCP to identify the connection, database/schema, table, and columns.
2. Validate the SQL with `semaphor_query_sql_advanced`.
3. Keep runtime SQL bounded and parameterized.
4. Execute through `semaphor.sql` and `useSemaphorQuery`.
5. Render from `result.records`, `result.columns`, and `column.key`.

```tsx
import {
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";

type MovementRow = {
  movement_date: string;
  movement_type: string;
  quantity_tons: number;
};

const rowLimit = semaphor.sqlParam<number>({
  id: "row_limit",
  label: "Rows",
  defaultValue: 100,
  options: [25, 50, 100],
});

const latestMovementsQuery = semaphor.sql({
  id: "latest-movements",
  label: "Latest movements",
  source: {
    kind: "sql",
    connectionId: "connection-id-from-mcp",
    dialect: "clickhouse",
    label: "Warehouse",
  },
  sql: `
    select movement_date, movement_type, quantity_tons
    from database_name.table_name
    order by movement_date desc
    limit {{ param("row_limit") }}
  `,
  inputs: [rowLimit],
  defaultParameters: { row_limit: 100 },
  limit: 100,
});

function LatestMovementsTable() {
  const [rowLimitHandle] = useSemaphorInputs([rowLimit]);
  const result =
    useSemaphorQuery<MovementRow>(latestMovementsQuery, {
      inputs: [rowLimitHandle],
    });

  if (result.isLoading) return <TableSkeleton />;
  if (result.error) return <ErrorState message={result.error.message} />;
  if ((result.records ?? []).length === 0) return <EmptyState />;

  return (
    <table>
      <thead>
        <tr>
          {(result.columns ?? []).map((column) => (
            <th key={column.key}>{column.label ?? column.key}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {(result.columns ?? []).map((column) => (
              <td key={column.key}>
                {formatCell(row[column.key as keyof MovementRow], column)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Inline SQL is acceptable for the initial implementation, but it must remain
read-only, governed by Semaphor execution, bounded by `limit` or pagination,
and parameterized with `param(...)` or Semaphor inputs. Do not concatenate SQL
strings in React.

## Semantic Records Table

Use `SemaphorRecordsField` for `semaphor.records(...)` fields so `role` is
definite.

```tsx
const source = {
  kind: "semantic",
  domainId: "domain-id-from-mcp",
  datasetName: "inventory_movements",
  datasetId: "dataset-id-from-mcp",
  label: "Inventory Movements",
} satisfies SemaphorSourceRef;

const movementDate = {
  name: "movement_date",
  label: "Movement Date",
  role: "date",
  dataType: "date",
  source,
} satisfies SemaphorRecordsField;

const quantity = {
  name: "quantity_tons",
  label: "Quantity (Tons)",
  role: "measure",
  dataType: "number",
  aggregate: "SUM",
  source,
} satisfies SemaphorRecordsField;

const rowsQuery = semaphor.records({
  id: "movement-rows",
  source,
  fields: [movementDate, quantity],
  dateField: movementDate,
  timeWindow: { unit: "month", value: 6, anchor: "latest_available" },
  orderBy: { field: movementDate, direction: "desc" },
  limit: 100,
});
```

## Shared Inputs

Inputs affect only the queries that receive their handles.

```tsx
const regionFilter = semaphor.filter({
  id: "region",
  label: "Region",
  field: regionField,
  operator: "in",
});

const [regionHandle] = useSemaphorInputs([regionFilter]);
const result = useSemaphorQuery(rowsQuery, { inputs: [regionHandle] });
```

Use canonical operators such as `"="`, `"!="`, `"in"`, `"not_in"`,
`"between"`, `">"`, `">="`, `"<"`, and `"<="`.

`useSemaphorInputs` returns runtime handles. Read `handle.value` to render a
control, call `handle.setValue(nextValue)` from UI events, and pass the same
handles into `useSemaphorQuery(query, { inputs })`. Do not pass raw input specs
to `useSemaphorQuery` after binding them.

Server-side option lists use explicit label and value fields:

```tsx
const regionOptions = semaphor.inputOptions({
  id: "region-options",
  source,
  inputId: "region",
  labelField: regionField,
  valueField: regionField,
  dependencies: { mode: "auto" },
  limit: 100,
});

const optionsResult = useSemaphorQuery(regionOptions, {
  inputs: [regionHandle],
});
```

`labelField` is what the user sees. `valueField` is the stable submitted value.
Do not use the older `field`-only option query shape.

For cascading filters, clear stale child selections only from authoritative
option results. Pass the full query result to the helper so loading/idle
`options: []` does not clear valid defaults before the server responds:

```tsx
useClearInvalidSemaphorInputValue(regionHandle, optionsResult);
```

Do not pass `optionsResult.options` to this helper.

## Large Tables

For bounded detail views, a server `limit` plus displayed-row totals is enough.
For large or complete-dataset tables, use Semaphor server-side filtering,
sorting, and pagination/windowing. Do not fetch huge row sets and slice them in
React.

Ask before adding dependencies. Prefer an existing table/grid in the customer
app. If no suitable table library exists, `@tanstack/react-table` is a good
choice for table state and controls; add `@tanstack/react-virtual` only when
virtualized rendering is required.

Infer server-backed table needs from table behavior. Operational tables,
queues, drill-through/detail tables, exploratory tables, paginated/sortable
tables, and complete or large result tables should use Semaphor server-side
table mechanics even when the user did not literally say "server-side table."
After planning, ask to use, install, or adapt the Semaphor table registry unless
the app already has an equivalent server-backed table abstraction. Do not
downgrade to client-only pagination/sorting to avoid a registry install.

## Validation

After editing:

```bash
node <installed-semaphor-plugin>/scripts/validate-semaphor-data-app.mjs --dir <app>
npm run typecheck
npm run build
```

Use the customer app's own package manager and scripts when they differ.
