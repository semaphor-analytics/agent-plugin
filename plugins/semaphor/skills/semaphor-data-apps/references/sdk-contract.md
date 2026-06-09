# SDK Contract

This is the compact public SDK reference for ordinary app authoring. Use it
before looking anywhere else when a task needs imports, result types, provider
setup, filters, row/column access, or query builders.

Do not search for `docs/DATA_APP_SDK_REFERENCE.md` in the customer repo. The
customer repo is not expected to contain plugin docs.

Do not inspect `node_modules/react-semaphor/dist`, bundled implementation
files, SDK source files, or SDK validator internals during ordinary app
authoring. If this reference is missing a public contract detail and the app
cannot be completed without it, inspect only public
`react-semaphor/data-app-sdk` exported type declarations narrowly, record the
docs gap, and continue with the public contract rather than implementation
internals.

## Imports

Generated React should import SDK values from:

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
  defineSemaphorDataApp,
  semaphor,
  useClearInvalidSemaphorInputValue,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
```

Reusable helper components can import SDK result types as needed:

```tsx
import type {
  SemaphorQueryResult,
  SemaphorMetricQueryResult,
  SemaphorRecordsField,
  SemaphorRecordsQueryResult,
  SemaphorResultColumn,
  SemaphorRowsQueryResult,
  SemaphorSourceRef,
  SemaphorSqlQueryResult,
  SemaphorMatrixQueryResult,
  SemaphorDerivedFieldDefinition,
} from "react-semaphor/data-app-sdk";
```

## Public Shapes

```ts
type SemaphorResultColumn = {
  key: string; // stable row accessor: row[column.key]
  name: string; // semantic/source field name
  label: string; // display label
  role?: "dimension" | "measure" | "date" | string;
  dataType?: "string" | "number" | "date" | "boolean" | string;
  aggregate?: string;
  source?: unknown;
};

type SemaphorQueryState = {
  status: "idle" | "loading" | "success" | "error";
  isLoading: boolean;
  error: Error | null;
};

type SemaphorSqlQueryResult<TRecord extends Record<string, unknown>> =
  SemaphorQueryState & {
    id?: string;
    intent?: unknown;
    records: TRecord[];
    columns?: SemaphorResultColumn[];
    rowCount?: number;
    pagination?: unknown;
    output?: string;
    rowLimitExceeded?: boolean;
    executionResult?: unknown;
  };

type SemaphorRecordsQueryResult<TRecord extends Record<string, unknown>> =
  SemaphorQueryState & {
    id?: string;
    intent?: unknown;
    records: TRecord[];
    columns?: SemaphorResultColumn[];
    rowCount?: number;
    pagination?: unknown;
    executionResult?: unknown;
  };
```

Metric, records, SQL, matrix, and analysis results should be rendered from the
documented public result surface. Do not inspect hidden `dist` declaration files
or SDK internals. For scalar KPI cards, prefer `semaphor.metric(...)` and render
from the metric result:

```tsx
function metricValue(
  result: SemaphorMetricQueryResult,
  measureName?: string,
) {
  return measureName ? result.measures?.[measureName] : result.value;
}
```

Use `semaphor.records(...)` for row-shaped KPI support only when the visual
requires rows: trend points, sparklines, grouped breakdowns, tables, detail
lists, or a shape that cannot be expressed as scalar measures.

When typing reusable helper components, use public SDK result types. Do not use
`ReturnType<typeof useSemaphorQuery>`; TypeScript collapses overloaded hook
signatures in a way that can produce the wrong result shape.

- Use `SemaphorQueryResult` for generic query status/error helper components.
- Use `SemaphorMetricQueryResult` for `semaphor.metric(...)` scalar KPI
  results.
- Use `SemaphorRecordsQueryResult` for `semaphor.records(...)` results.
- Use `SemaphorSqlQueryResult` for `semaphor.sql(...)` results.
- Use `SemaphorRowsQueryResult` for table helpers that accept records-backed
  or SQL-backed row results.
- Use `SemaphorMatrixQueryResult` for `semaphor.matrix(...)` results.
- Use `SemaphorRecordsField` for source-bearing fields passed to
  `semaphor.records(...)`. `SemaphorFieldRef` is too loose for records queries
  because the records contract requires every selected field to have a definite
  `role`.

## Provider

Provider setup should be token-only for execution routing. Generated Vite React
apps should enable SDK DevTools in local development so humans and agents can
inspect runtime traces:

```tsx
const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;
const enableDevtools =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && window.location.hostname === "localhost");

<SemaphorDataAppProvider
  token={runtimeToken}
  debug={enableDevtools ? { exposeWindowBridge: true } : false}
>
  {children}
  <SemaphorDevtools
    initialIsOpen={false}
    buttonPosition="bottom-right"
    panelPosition="right"
  />
</SemaphorDataAppProvider>
```

`SemaphorDataAppProvider` accepts `token?: string`, `apiBaseUrl?: string`, an
optional executor override, `debug?: boolean | object`, and `children`. The
provider internally reads Semaphor hosted runtime auth when present, so
generated app code normally does not need to call runtime helpers itself.

DevTools defaults:

- Always mount one root `<SemaphorDevtools />` in generated local/dev apps when
  the package exports it.
- Use the default `panelPosition="right"` dock so vertical analytics space
  remains available and the app stays visible beside the inspector. Use
  `panelPosition="bottom"` only when the user asks for a bottom dock.
- Use `debug={enableDevtools ? { exposeWindowBridge: true } : false}` in
  local/dev apps so the floating inspector appears and agents can read
  `window.__SEMAPHOR_DEVTOOLS__?.snapshot()`.
- Do not enable `debug` or `exposeWindowBridge` in production embeds,
  published tenant/end-user views, or normal customer runtime code.
- Do not wrap every card in DevTools boilerplate. `useSemaphorQuery()`
  registrations populate the global inspector. For broad generated dashboards,
  use the TanStack-style root DevTools integration only. If traceability needs
  help, pass hook-level debug metadata/source hints instead of adding per-card
  DevTools wrapper boilerplate.
- For generated contracts, prefer
  `useSemaphorQuery(queries.someView, queryOptionsForView.someView(inputHandles))`
  over manually composing `{ inputs: inputsForView.someView(inputHandles) }`.
  `queryOptionsForView` carries the planner's dashboard view title and visual
  type into DevTools traces.
- For generated records/analysis rows, map records through `rowValuesForView`
  or resolve keys with `columnKeysForView`; never treat visual encoding names
  or semantic field names as runtime row keys.
- When you can add source metadata without extra component wrappers, pass a
  hook-level source hint so DevTools and evals can point back to the likely app
  file:

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

Source hints are optional and should not replace stable query ids, labels, or
small query modules. Do not add noisy repeated wrappers just to provide them.

The SDK decodes the Semaphor API URL from the token. Do not generate
`VITE_SEMAPHOR_API_BASE_URL`, `SEMAPHOR_API_BASE_URL`, or an `apiBaseUrl` prop
for normal Vite React apps. For other React runtimes, adapt token loading to
the host app before codegen instead of copying the Vite snippet unchanged. Use
`apiBaseUrl` only when the user explicitly needs self-hosted or local routing
that intentionally differs from the token's `apiServiceUrl`.

Do not import `readWindowRuntime` or generate extra token fallback variables
such as `VITE_SEMAPHOR_TOKEN` for normal customer apps. Use hosted runtime
helpers only when the target app is explicitly being authored as a
Semaphor-hosted runtime entrypoint and the user asks for direct runtime access.

## Query Builders

Use source-bearing field refs when the source is known. Define inputs and
queries as typed module-level specs with `semaphor.*`, then execute those specs
with `useSemaphorQuery`. Validation, save, and publish use the canonical
`useSemaphorQuery` contract; do not generate alternate query execution
patterns.

Every runtime query spec must include a stable, human-readable `id`. This
includes `semaphor.metric`, `semaphor.records`, `semaphor.analysis`,
`semaphor.matrix`, `semaphor.sql`, and `semaphor.inputOptions`. Query ids are
the bridge between the visible app, Semaphor DevTools traces, validation
output, and reviewer comments. Do not rely on inferred ids or variable names.

Builder selection:

- `semaphor.metric` for scalar KPIs and aggregate KPI cards, including multiple
  independent scalar measures from the same source. `primaryMeasure` controls
  `result.value`; all values are available through `result.measures`.
- `semaphor.records` for row-shaped results, tables, charts, trends,
  breakdowns, and detail lists, including bounded windows via `dateField` and
  `timeWindow`; generated contracts provide `rowValuesForView`/`columnKeysForView`
  for safe row access. For bar, stacked bar, pie/donut, and categorical
  comparison charts, make the records query grouped/aggregate-shaped for the
  chart. Do not chart a bounded raw-row detail result unless the user explicitly
  asked for raw rows.
- `semaphor.analysis` for insight, driver, spike/drop, and period-change
  views; also exposes `columns` and `resultSets` for typed row access.
- `semaphor.sql` for advanced SQL-backed runtime views when semantic queries
  cannot express the product requirement or the user explicitly asks for raw
  SQL. Execution must still go through Semaphor SDK and governed server-side
  execution.
- `semaphor.matrix` for pivot tables, hierarchy tables, subtotals, grand
  totals, sparse cells, and matrix display limits.
- `semaphor.derivedField` for governed app-local calculations used by
  `semaphor.metric`, `semaphor.records`, `semaphor.analysis`, or
  `semaphor.inputOptions`.
- `semaphor.filter`, `semaphor.sqlParam`, and `semaphor.control` for filters
  and controls.

Execute query specs with:

```tsx
const inputHandles = useSemaphorInputs([someFilterOrParam]);
const result = useSemaphorQuery<RowType>(someQuery, { inputs: inputHandles });
```

The `inputs` option accepts handles returned by `useSemaphorInputs`.

## Copyable Query Patterns

Use these patterns before inspecting SDK type declarations.

Metric KPI:

```tsx
const source = {
  kind: "semantic",
  domainId: "sales",
  datasetName: "orders",
} satisfies SemaphorSourceRef;

const revenue = {
  name: "revenue",
  label: "Revenue",
  role: "measure",
  dataType: "number",
  aggregate: "SUM",
  source,
} satisfies SemaphorRecordsField;

const revenueKpi = semaphor.metric({
  id: "revenue-kpi",
  source,
  measures: [revenue],
  primaryMeasure: revenue,
});

const result = useSemaphorQuery(revenueKpi);
```

Multiple scalar KPIs in one card:

```tsx
const salesKpis = semaphor.metric({
  id: "sales-kpis",
  source,
  measures: [revenue, orders, grossMargin],
  primaryMeasure: revenue,
});

const result = useSemaphorQuery(salesKpis);
const revenueValue = result.value;
const orderCount = result.measures?.orders;
const grossMarginValue = result.measures?.gross_margin;
```

If the planner returns `queryKind: "metric"`, implement the view with
`semaphor.metric(...)` unless the visual is actually row-shaped or the SDK
cannot express the required metric. Record any `records` fallback as an explicit
SDK/product limitation.

Records chart/table:

```tsx
const segment = {
  name: "segment",
  label: "Segment",
  role: "dimension",
  dataType: "string",
  source,
} satisfies SemaphorRecordsField;

const revenueBySegment = semaphor.records({
  id: "revenue-by-segment",
  source,
  fields: [segment, revenue],
  orderBy: { field: revenue, direction: "desc" },
  limit: 10,
});

const result = useSemaphorQuery(revenueBySegment);
```

Row access:

```tsx
function RecordsTable({ result }: { result: SemaphorRecordsQueryResult }) {
  const records = result.records ?? [];
  const columns = result.columns ?? [];

  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label || column.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {columns.map((column) => (
              <td key={column.key}>{String(row[column.key] ?? "")}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Use `column.key` for code access and `column.label` for display. Never read
`row[column.label]`.

When a helper accepts a broad `SemaphorQueryResult` union, narrow before reading
records:

```tsx
function queryRecords(result: SemaphorQueryResult) {
  return "records" in result && Array.isArray(result.records)
    ? result.records
    : [];
}
```

Input-options-backed filter:

```tsx
const segmentFilter = semaphor.filter({
  id: "segment",
  label: "Segment",
  field: segment,
  operator: "in",
});

const segmentOptions = semaphor.inputOptions({
  id: "segment-options",
  source,
  inputId: "segment",
  labelField: segment,
  valueField: segment,
  dependencies: { mode: "auto" },
  limit: 100,
});

function SegmentFilter() {
  const [segmentHandle] = useSemaphorInputs([segmentFilter]);
  const optionsResult = useSemaphorQuery(segmentOptions, {
    inputs: [segmentHandle],
  });
  useClearInvalidSemaphorInputValue(segmentHandle, optionsResult);
  const revenueResult = useSemaphorQuery(revenueBySegment, {
    inputs: [segmentHandle],
  });

  // Render choices from optionsResult.options and write selected values with
  // segmentHandle.setValue(nextValue).
}
```

`inputOptions` must use explicit `inputId`, `labelField`, and `valueField`.
Use `labelField` for the human-readable dropdown text and `valueField` for the
stable value sent back as the filter value. Do not use the older one-field
shape. When clearing invalid selections for cascading filters, pass the full
`optionsResult` to `useClearInvalidSemaphorInputValue`; do not pass
`optionsResult.options`, because idle/loading query data is also an empty array.

Server-paginated table:

```tsx
const page = 1;
const pageSize = 100;
const ordersPage = semaphor.records({
  id: "orders-page",
  source,
  fields: [segment, revenue],
  pagination: { page, pageSize },
  orderBy: { field: revenue, direction: "desc" },
});

const pageResult = useSemaphorQuery(ordersPage);
// Render page controls from pageResult.pagination and pageResult.rowCount.
```

For bounded client-rendered tables, include sortable headers and a numeric
footer total for the displayed result set. For server-paginated tables, encode
sort and page state in the Semaphor query spec, reset to page 1 when filters or
sort change, and use a separate aggregate query when the UI needs a true total
across all filtered rows rather than only the current page.

Shared visible input bound into source-specific fields:

```tsx
const dateRange = semaphor.filter({
  id: "date_range",
  label: "Date Range",
  field: orderDate,
  operator: "between",
});

function Dashboard() {
  const [dateRangeHandle] = useSemaphorInputs([dateRange]);

  const orderRows = useSemaphorQuery(ordersQuery, {
    inputs: [semaphor.bindInput(dateRangeHandle, { field: orderDate })],
  });
  const invoiceRows = useSemaphorQuery(invoicesQuery, {
    inputs: [semaphor.bindInput(dateRangeHandle, { field: invoiceDate })],
  });

  const range = Array.isArray(dateRangeHandle.value)
    ? dateRangeHandle.value
    : [];
  const [start, end] = range;
}
```

Use `semaphor.bindInput(...)` when one visible input should map to different
query fields, such as one Date Range filtering `orders.order_date` and
`invoices.invoice_date`, or one Material Family selector filtering multiple
facts through source-bearing related dimension fields. Narrow `handle.value`
with `Array.isArray(...)` before indexing date ranges or multi-select values.

## Derived Fields

Use `semaphor.derivedField(...)` when a view needs a calculated field that is
not yet modeled in Semaphor but should still execute through governed Semaphor
query execution.

```tsx
const grossMargin = semaphor.derivedField({
  name: "gross_margin",
  label: "Gross Margin",
  resultRole: "measure",
  dataType: "number",
  computeStage: "row",
  expression: "{revenue} - {cost}",
  inputs: {
    revenue: { kind: "field", field: revenueField },
    cost: { kind: "field", field: costField },
  },
  defaultAggregate: "SUM",
  aggregationBehavior: "additive",
});

const grossMarginQuery = semaphor.metric({
  id: "gross-margin-by-segment",
  source,
  derivedFields: [grossMargin],
  measures: [
    { name: "gross_margin", role: "measure", dataType: "number", source },
  ],
  dimensions: [segmentField],
});
```

Rules:

- every derived field input must reference a visible field from the selected
  source;
- derived field names must not collide with source/catalog fields;
- row-stage derived measures need `defaultAggregate`;
- use aggregate-stage only for calculations that must happen after grouping;
- if the calculation is important to analytical correctness, keep it in the
  SDK query spec instead of computing it only in React.

## Matrix Queries

Use `semaphor.matrix(...)` for pivot-style and hierarchy-style tables.

```tsx
const revenueMatrix = semaphor.matrix({
  id: "revenue-matrix",
  source,
  rows: [
    { id: "region", field: regionField, subtotal: { enabled: true, position: "after" } },
    countryField,
  ],
  columns: [{ id: "quarter", field: orderDateField, grain: "quarter" }],
  values: [{ id: "revenue", field: revenueField, aggregate: "SUM", label: "Revenue" }],
  totals: { rows: true, columns: true, grandTotal: true },
  displayLimits: {
    rows: { limit: 100, by: "value", direction: "top", others: true },
  },
});
```

`useSemaphorQuery(revenueMatrix)` returns matrix payload/grid data, not
`records`. Render from the matrix result shape or a local matrix projection
component. Do not fake a matrix by loading all detail rows and pivoting them on
the client.

## Input Handles

`semaphor.filter`, `semaphor.sqlParam`, and `semaphor.control` define input
specs. `useSemaphorInputs` binds those specs to runtime state and returns
handles. UI controls should read and write the handles; queries should receive
the same handles.

```tsx
const rowLimit = semaphor.sqlParam({
  id: "row_limit",
  label: "Rows",
  defaultValue: 50,
});

const latestRowsQuery = semaphor.sql({
  id: "latest-rows",
  source: { kind: "sql", connectionId: "connection-id-from-mcp" },
  sql: `
    select movement_date, quantity_tons
    from database_name.table_name
    order by movement_date desc
    limit {{ param("row_limit") }}
  `,
  inputs: [rowLimit],
  defaultParameters: { row_limit: 50 },
  limit: 50,
});

function LatestRows() {
  const [rowLimitHandle] = useSemaphorInputs([rowLimit]);
  const result = useSemaphorQuery(latestRowsQuery, {
    inputs: [rowLimitHandle],
  });

  return (
    <select
      value={String(rowLimitHandle.value ?? 50)}
      onChange={(event) => rowLimitHandle.setValue(Number(event.target.value))}
    >
      <option value="25">25 rows</option>
      <option value="50">50 rows</option>
      <option value="100">100 rows</option>
    </select>
  );
}
```

Do not pass raw input specs directly to `useSemaphorQuery` after binding them.
Pass the handles returned by `useSemaphorInputs`. If a filter should affect
multiple queries, bind it once and pass the same handle to each subscribed
query.

## Row And Column Access

For record/table rendering, treat `column.key` as the stable code accessor and
`column.label` as display text:

```tsx
{
  result.records.map((row) => (
    <tr>
      {result.columns.map((column) => (
        <td key={column.key}>{row[column.key]}</td>
      ))}
    </tr>
  ));
}
```

Do not access records with display labels such as `row[column.label]` or
`row["Movement Date"]`.

For `semaphor.analysis` query results, prefer
`insight.resultSets.<name>.columns` and `row[column.key]` over top-level
analysis arrays when rendering tables or charts. For simple insight views, the
SDK also exposes the default row-bearing analysis result as `insight.records`
and `insight.columns`; use those columns rather than `Object.keys(...)`.
