# Data App SDK Hook Examples

These examples show the runtime contract generated React should use. They are
framework-neutral and can be adapted to any React app structure.

## Provider

Wrap the part of the app that uses Semaphor hooks with
`SemaphorDataAppProvider`.

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
    <SemaphorDataAppProvider
      apiBaseUrl="https://semaphor.cloud"
      token={token}
    >
      {children}
    </SemaphorDataAppProvider>
  );
}
```

In production, pass a scoped runtime token from the customer app's backend,
embed token flow, or hosted Semaphor runtime. Do not commit long-lived tokens
into frontend source.

## Source And Fields

Use MCP-discovered semantic metadata. Do not invent domains, datasets, or
fields.

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

## KPI Metric

Use `metrics[]` and, when useful, `primaryMetric`.

```tsx
import { useSemaphorMetric } from "react-semaphor/data-app-sdk";

export function RevenueKpi() {
  const totalRevenue = useSemaphorMetric({
    source,
    id: "total-revenue",
    label: "Total Revenue",
    metrics: [revenue],
    primaryMetric: revenue,
  });

  if (totalRevenue.isLoading) return <span>Loading...</span>;
  if (totalRevenue.error) return <span>{totalRevenue.error.message}</span>;

  return <strong>{formatNumber(totalRevenue.value)}</strong>;
}
```

## Governed Analysis Or Driver View

Use `useSemaphorAnalysis` when the UI needs the same advanced governed
analytics kernel as MCP `semaphor_analyze`: period changes, drivers, spikes,
drops, and "why did this change?" views.

```tsx
import { useSemaphorAnalysis } from "react-semaphor/data-app-sdk";

export function RevenueDriverInsight() {
  const insight = useSemaphorAnalysis({
    source,
    id: "revenue-driver-insight",
    label: "Revenue Drivers",
    metrics: [revenue],
    primaryMetric: revenue,
    dateField: orderDate,
    timeGrain: "month",
    timeWindow: {
      kind: "relative",
      unit: "month",
      value: 6,
      anchor: "latest_available",
      completeness: "complete_periods",
    },
    analysis: { kind: "period_change", orderBy: "absolute_change" },
    driverMode: "all",
    includePopulation: true,
  });

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

Do not turn `semaphor_analyze` markdown or raw SQL diagnostics into the runtime
contract. Productized insight views should use `useSemaphorAnalysis` or another
public SDK hook backed by the shared analytics protocol.
The SDK normalizes analysis rows into typed `resultSets`; it also exposes
`records` and `columns` for the default row-bearing result so simple insight
views do not need to guess label-based row keys.

## Records Or Table

Use `columns[].key` for code access and `columns[].label` for display. Labels
are display-only and may change.

Bounded row and chart datasets can use `timeWindow` directly on
`useSemaphorRecords`; use `dateField` with the same grounded date ref used by
MCP `semaphor_analyze`.

```tsx
import { useSemaphorRecords } from "react-semaphor/data-app-sdk";

export function RevenueTable() {
  const result = useSemaphorRecords({
    source,
    id: "revenue-by-segment",
    label: "Revenue by Segment",
    fields: [segment, revenue],
    dateField: orderDate,
    timeWindow: {
      unit: "month",
      value: 6,
      anchor: "latest_available",
    },
    orderBy: { field: revenue, direction: "desc" },
    limit: 25,
  });

  if (result.isLoading) return <span>Loading...</span>;
  if (result.error) return <span>{result.error.message}</span>;

  return (
    <table>
      <thead>
        <tr>
          {result.columns?.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.records.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {result.columns?.map((column) => (
              <td key={column.key}>{formatCell(row[column.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Avoid:

```tsx
row[column.label]
row["Revenue"]
```

## Dynamic Filter Options

Use `useSemaphorInputOptions` to load selectable values and
`useSemaphorInput` to bind the selected value into downstream queries.
Filter input operators accept canonical SDK symbols such as `"="`, `"in"`, and
`"between"` plus common MCP aliases such as `"equals"` and `"not_equals"`. The
SDK normalizes them before execution.

```tsx
import {
  useSemaphorInput,
  useSemaphorInputOptions,
  useSemaphorRecords,
} from "react-semaphor/data-app-sdk";

export function RevenueBySegmentWithFilter() {
  const segmentOptions = useSemaphorInputOptions({
    source,
    field: segment,
    limit: 50,
  });

  const segmentFilter = useSemaphorInput<string[]>({
    id: "segment-filter",
    kind: "filter",
    label: "Segment",
    field: segment,
    operator: "in",
    multi: true,
    options: segmentOptions.options,
  });

  const result = useSemaphorRecords({
    source,
    id: "revenue-by-segment-filtered",
    fields: [segment, revenue],
    inputs: [segmentFilter],
    limit: 25,
  });

  return (
    <>
      <select
        multiple
        value={Array.isArray(segmentFilter.value) ? segmentFilter.value : []}
        onChange={(event) =>
          segmentFilter.setValue(
            Array.from(event.currentTarget.selectedOptions).map(
              (option) => option.value,
            ),
          )
        }
      >
        {segmentOptions.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>

      <pre>{JSON.stringify(result.records, null, 2)}</pre>
    </>
  );
}
```

## Formatting Helpers

Generated apps may use their own design system. Keep formatting local and
simple unless the customer app already has shared formatters.

```tsx
function formatNumber(value: unknown) {
  if (typeof value !== "number") return "--";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCell(value: unknown) {
  if (value == null) return "--";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}
```

## Generation Rules

- Inspect Semaphor metadata through MCP before writing data-bearing hooks.
- Use `useSemaphorAnalysis` for insight, driver, spike/drop, and period-change
  views.
- Prefer semantic source refs with domain plus dataset id/name.
- Use `metrics[]`, not a singular `metric`.
- Use `row[column.key]`, not display labels, for record access.
- Keep customer app structure intact.
- Let the customer's own typecheck/build decide whether the integration works.
