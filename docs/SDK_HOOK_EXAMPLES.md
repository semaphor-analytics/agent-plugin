# Data App SDK Examples

These examples show the canonical runtime contract generated React should use.
New agent-authored Data Apps should define typed inputs and queries with
`semaphor.*` builders, then execute them with `useSemaphorQuery`.

Validation, save, and publish use the canonical `useSemaphorQuery` contract.
Do not generate any alternate query execution pattern.

For the shortest agent-facing reference, start with the `SDK Contract` section
in `skills/semaphor-data-apps/SKILL.md`. Customer repos are not expected to
contain plugin docs. This page and
[Data App SDK Reference For Agents](DATA_APP_SDK_REFERENCE.md) provide deeper
examples, but agents should not inspect `node_modules/react-semaphor/dist` or
implementation bundles as the normal way to discover SDK usage.

## Provider

Wrap the app surface that uses Semaphor queries with `SemaphorDataAppProvider`.

```tsx
import type { ReactNode } from "react";
import { SemaphorDataAppProvider } from "react-semaphor/data-app-sdk";

export function SemaphorAnalyticsProvider({
  children,
  token,
}: {
  children: ReactNode;
  token: string;
}) {
  return (
    <SemaphorDataAppProvider token={token}>
      {children}
    </SemaphorDataAppProvider>
  );
}
```

In production, pass a scoped runtime token from the customer app backend, embed
token flow, or hosted Semaphor runtime. Do not commit long-lived tokens into
frontend source.

The SDK decodes the Semaphor API URL from the token. Generated customer code
should not read `VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or pass
`apiBaseUrl` by default. Set `apiBaseUrl` only when the user explicitly needs
unusual local or self-hosted routing where the token's `apiServiceUrl` should
not be used.

## Sources And Fields

Use MCP-discovered semantic metadata. Do not invent domains, datasets, fields,
or connection ids.

```tsx
const source = {
  kind: "semantic",
  domainId: "domain-id-from-mcp",
  datasetName: "orders",
  datasetId: "semantic-dataset-id",
  label: "Orders",
} as const;

const revenue = {
  name: "revenue",
  label: "Revenue",
  role: "measure",
  dataType: "number",
  aggregate: "SUM",
  source,
} as const;

const orderDate = {
  name: "order_date",
  label: "Order Date",
  role: "date",
  dataType: "date",
  source,
} as const;

const segment = {
  name: "segment",
  label: "Segment",
  role: "dimension",
  dataType: "string",
  source,
} as const;
```

## Fast Path: SQL-Backed Table

Use this when the user explicitly asks for SQL, or when the requested view
cannot be expressed with `semaphor.metric`, `semaphor.records`, or
`semaphor.analysis`. Validate the SQL through Semaphor MCP first, then keep the
runtime code small and canonical.

```tsx
import {
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
  type SemaphorSqlQueryResult,
} from "react-semaphor/data-app-sdk";

const rowLimit = semaphor.sqlParam({
  id: "row_limit",
  label: "Rows",
  defaultValue: 100,
});

const latestRowsQuery = semaphor.sql({
  id: "latest-rows",
  label: "Latest rows",
  source: {
    kind: "sql",
    connectionId: "connection-id-from-mcp",
    dialect: "clickhouse",
  },
  sql: `
    select movement_date, quantity_tons
    from schema_name.table_name
    order by movement_date desc
    limit {{ param("row_limit") }}
  `,
  inputs: [rowLimit],
  defaultParameters: { row_limit: 100 },
  limit: 100,
});

function renderQueryState({
  result,
}: {
  result: SemaphorSqlQueryResult<Record<string, unknown>>;
}) {
  if (result.isLoading) return <div>Loading...</div>;
  if (result.error) return <div>{result.error.message}</div>;
  if ((result.records ?? []).length === 0) return <div>No rows returned.</div>;
  return null;
}

export function LatestRowsTable() {
  const inputs = useSemaphorInputs([rowLimit]);
  const result = useSemaphorQuery(latestRowsQuery, { inputs });
  const state = renderQueryState({ result });
  if (state !== null) return state;

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

Keep generated SQL bounded and parameterized. Do not concatenate SQL strings in
React. Use `column.key` for row access and `column.label` for display text.

## Canonical Metric Query

```tsx
import {
  defineSemaphorDataApp,
  semaphor,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";

const totalRevenueQuery = semaphor.metric({
  id: "total-revenue",
  label: "Total Revenue",
  source,
  metrics: [revenue],
  primaryMetric: revenue,
});

export const semaphorApp = defineSemaphorDataApp({
  id: "revenue-app",
  title: "Revenue App",
  views: [
    {
      id: "total-revenue",
      title: "Total Revenue",
      query: totalRevenueQuery,
    },
  ],
});

export function RevenueKpi() {
  const totalRevenue = useSemaphorQuery(totalRevenueQuery);

  if (totalRevenue.isLoading) return <span>Loading...</span>;
  if (totalRevenue.error) return <span>{totalRevenue.error.message}</span>;

  return <strong>{formatNumber(totalRevenue.value)}</strong>;
}
```

## Canonical Records Query

Use `columns[].key` for code access and `columns[].label` for display. Labels
are display-only and may change.

```tsx
const ordersBySegmentQuery = semaphor.records({
  id: "orders-by-segment",
  label: "Orders by Segment",
  source,
  fields: [segment, revenue],
  dateField: orderDate,
  timeWindow: {
    unit: "month",
    value: 6,
    anchor: "latest_available",
  },
  limit: 100,
});

export function OrdersBySegmentTable() {
  const result = useSemaphorQuery(ordersBySegmentQuery);

  if (result.isLoading) return <span>Loading...</span>;
  if (result.error) return <span>{result.error.message}</span>;

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
              <td key={column.key}>{formatCell(row[column.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Do not access records with display labels such as `row[column.label]` or
`row["Movement Date"]`.

## Typing Reusable Query Components

Do not type helper components with `ReturnType<typeof useSemaphorQuery>`.
`useSemaphorQuery` is overloaded, and TypeScript can collapse the overloads to a
shape that does not match the query being passed around.

Use the public SDK result types instead:

```tsx
import type {
  SemaphorQueryResult,
  SemaphorRecordsQueryResult,
  SemaphorRowsQueryResult,
  SemaphorSqlQueryResult,
} from "react-semaphor/data-app-sdk";

function QueryStatus({ result }: { result: SemaphorQueryResult }) {
  if (result.isLoading) return <span>Loading...</span>;
  if (result.error) return <span>{result.error.message}</span>;
  return null;
}

function RecordsTable({
  result,
}: {
  result: SemaphorRecordsQueryResult;
}) {
  return <DataTable rows={result.records} columns={result.columns ?? []} />;
}

function SqlRowsTable({
  result,
}: {
  result: SemaphorSqlQueryResult;
}) {
  return <DataTable rows={result.records} columns={result.columns ?? []} />;
}

function RowTable({
  result,
}: {
  result: SemaphorRowsQueryResult;
}) {
  return <DataTable rows={result.records} columns={result.columns ?? []} />;
}
```

Use `SemaphorRecordsQueryResult` for `semaphor.records(...)`,
`SemaphorSqlQueryResult` for `semaphor.sql(...)`, `SemaphorRowsQueryResult` for
table components that accept either records-backed or SQL-backed row results,
and `SemaphorQueryResult` only for generic status/error wrappers.

For production dashboard tables, add the expected table affordances around this
basic pattern: loading/error/empty states, sortable headers, formatted cells,
and a totals row for displayed numeric columns. If the total must represent all
filtered data rather than the currently returned rows, define a separate
aggregate query for that total instead of summing a limited table result.

Keep table queries bounded. For large or complete-dataset tables, use
Semaphor server-side filtering, sorting, and pagination/windowing; do not fetch
a million rows into React and hide the problem with client-side pagination or
virtualization. If the target app does not already have a table library, ask
before adding one. Prefer `@tanstack/react-table` for rich table state and
controls, and add `@tanstack/react-virtual` only when virtualized row rendering
is needed.

Server-paginated table queries carry page state in the query spec and use the
returned pagination metadata for controls:

```tsx
import { useMemo, useState } from "react";
import {
  semaphor,
  useSemaphorQuery,
  type SemaphorRecordsField,
  type SemaphorSourceRef,
} from "react-semaphor/data-app-sdk";

const pageSize = 50;
const inventorySource = {
  kind: "semantic",
  domainId: "domain_inventory",
  datasetName: "inventory_movements",
} satisfies SemaphorSourceRef;

const movementDate = {
  name: "movement_date",
  label: "Movement Date",
  role: "date",
  dataType: "date",
  source: inventorySource,
} satisfies SemaphorRecordsField;

const region = {
  name: "region",
  label: "Region",
  role: "dimension",
  dataType: "string",
  source: inventorySource,
} satisfies SemaphorRecordsField;

const quantityTons = {
  name: "quantity_tons",
  label: "Quantity (Tons)",
  role: "measure",
  dataType: "number",
  aggregate: "SUM",
  source: inventorySource,
} satisfies SemaphorRecordsField;

function inventoryRowsQuery({
  page,
  sortDirection,
}: {
  page: number;
  sortDirection: "asc" | "desc";
}) {
  return semaphor.records({
    id: "inventory-rows",
    source: inventorySource,
    fields: [movementDate, region, quantityTons],
    orderBy: {
      field: movementDate,
      direction: sortDirection,
    },
    pagination: { page, pageSize },
  });
}

function InventoryTable() {
  const [page, setPage] = useState(1);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const query = useMemo(
    () => inventoryRowsQuery({ page, sortDirection }),
    [page, sortDirection],
  );
  const result = useSemaphorQuery(query);

  return (
    <DataTable
      rows={result.records}
      columns={result.columns ?? []}
      page={result.pagination?.page ?? page}
      pageCount={result.pagination?.pageCount ?? 0}
      rowCount={result.pagination?.totalCount ?? result.rowCount ?? 0}
      onPageChange={setPage}
      onSortChange={() => {
        setPage(1);
        setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      }}
    />
  );
}
```

For `semaphor.records(...)`, selected fields should be typed as
`SemaphorRecordsField` or constructed with an equivalent helper that guarantees
`role` is present. Plain `SemaphorFieldRef` is too broad for records queries
and can fail TypeScript because `role` is optional there.

## Shared Inputs

Inputs are the public abstraction for filters and controls. Define them once,
bind runtime values with `useSemaphorInputs` or explicit `useSemaphorInput`,
then pass the handles into each query that should subscribe.

```tsx
import {
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";

const regionFilter = semaphor.filter({
  id: "region",
  label: "Region",
  field: segment,
  operator: "in",
  defaultValue: ["Enterprise"],
});

const filteredRevenueQuery = semaphor.metric({
  id: "filtered-revenue",
  source,
  metrics: [revenue],
  primaryMetric: revenue,
  inputs: [regionFilter],
});

const filteredOrdersQuery = semaphor.records({
  id: "filtered-orders",
  source,
  fields: [segment, revenue],
  inputs: [regionFilter],
});

export function RevenueWithSharedFilter() {
  const inputs = useSemaphorInputs([regionFilter]);
  const filteredRevenue = useSemaphorQuery(filteredRevenueQuery, { inputs });
  const filteredOrders = useSemaphorQuery(filteredOrdersQuery, { inputs });

  return (
    <section>
      <strong>{formatNumber(filteredRevenue.value)}</strong>
      <DataTable
        rows={filteredOrders.records}
        columns={filteredOrders.columns ?? []}
      />
    </section>
  );
}
```

This is opt-in subscription. A view is affected by an input only when that
input handle is passed to that query.

## Governed Analysis Or Driver View

Use `semaphor.analysis` when the UI needs the same advanced governed analytics
kernel as MCP `semaphor_analyze`: period changes, drivers, spikes, drops, and
"why did this change?" views.

```tsx
const revenueDriversQuery = semaphor.analysis({
  id: "revenue-driver-insight",
  label: "Revenue Drivers",
  source,
  metrics: [revenue],
  primaryMetric: revenue,
  dateField: orderDate,
  timeGrain: "month",
  timeWindow: {
    unit: "month",
    value: 6,
    anchor: "latest_available",
  },
  analysis: { kind: "period_change", orderBy: "absolute_change" },
  driverMode: "all",
  includePopulation: true,
});

export function RevenueDriverInsight() {
  const insight = useSemaphorQuery(revenueDriversQuery);

  if (insight.isLoading) return <span>Loading...</span>;
  if (insight.error) return <span>{insight.error.message}</span>;

  const resultSet = insight.resultSets?.changes ?? {
    records: insight.records ?? [],
    columns: insight.columns ?? [],
  };

  return (
    <section>
      <h2>Revenue Drivers</h2>
      <p>{insight.answerSummary}</p>
      <table>
        <tbody>
          {resultSet.records.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {resultSet.columns.map((column) => (
                <td key={column.key}>{formatCell(row[column.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

Do not turn `semaphor_analyze` markdown or raw SQL diagnostics into static
fixture data.

## SQL Views

Use `semaphor.sql` when the product requirement is explicitly SQL-first or
cannot be expressed with semantic metric/records/analysis queries. Inline SQL
is supported; keep it bounded, use Semaphor template helpers for params and
filters, and let Semaphor execute it server-side.

Use `inputs` for runtime filter/control values. Use `defaultParameters` only
for static SQL `param(...)` fallback values.

```tsx
const regionSqlFilter = semaphor.filter({
  id: "region",
  label: "Region",
  field: { name: "region", role: "dimension", dataType: "string" },
  operator: "in",
});

const limitParam = semaphor.sqlParam({
  id: "limit",
  label: "Limit",
  defaultValue: 100,
});

const latestMovementsQuery = semaphor.sql({
  id: "latest-movements",
  source: {
    kind: "sql",
    connectionId: "conn_clickhouse",
    dialect: "clickhouse",
  },
  sql: `
    select movement_date, sku, quantity_tons
    from inventory_movements
    where 1 = 1
      {{ filter("region").sql }}
    order by movement_date desc
    limit {{ param("limit") }}
  `,
  inputs: [regionSqlFilter, limitParam],
  defaultParameters: { limit: 100 },
  limit: 100,
});

export function LatestMovements() {
  const inputs = useSemaphorInputs([regionSqlFilter, limitParam]);
  const result = useSemaphorQuery(latestMovementsQuery, { inputs });

  return <DataTable rows={result.records} columns={result.columns ?? []} />;
}
```

Existing Semaphor SQL template expressions remain first-class:

- `{{ filters | where }}`
- `{{ filters | and }}`
- `filter("name")`
- `param("name")`

Do not concatenate SQL strings in React.
