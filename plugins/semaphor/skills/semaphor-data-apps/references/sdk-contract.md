# SDK Contract Fallback

This bundled page is an offline fallback for Semaphor Data App SDK authoring.
Prefer the live docs and public TypeScript declarations when available.

| Field | Value |
| --- | --- |
| Canonical docs | `https://docs.semaphor.cloud/docs/data-apps/agent-builder-guide` |

If this page conflicts with the canonical docs or the public
`react-semaphor/data-app-sdk` declarations, follow the canonical docs and
declarations. Do not inspect SDK implementation bundles or `dist` internals
during normal app authoring.

## Imports

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
  defineSemaphorDataApp,
  semaphor,
  useSemaphorInputs,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";

import type {
  SemaphorMatrixQueryResult,
  SemaphorMetricQueryResult,
  SemaphorQueryResult,
  SemaphorRecordsField,
  SemaphorRecordsQueryResult,
  SemaphorResultColumn,
  SemaphorRowsQueryResult,
  SemaphorSourceRef,
  SemaphorSqlQueryResult,
} from "react-semaphor/data-app-sdk";
```

Use exported SDK result types for reusable helper components. Do not type
helpers with `ReturnType<typeof useSemaphorQuery>` because hook overloads can
collapse to the wrong shape.

## Provider

Generated Vite React apps should read the project token from the ignored local
environment and mount one root DevTools instance in local development.

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
</SemaphorDataAppProvider>;
```

The SDK decodes the Semaphor API URL from the token. Do not pass `apiBaseUrl`
unless the user explicitly needs local or self-hosted routing that differs from
the token.

## Builder Selection

- `semaphor.metric`: scalar KPI values. Use `measures` and `primaryMeasure`.
- `semaphor.records`: charts, trends, tables, grouped breakdowns, and detail
  rows.
- `semaphor.matrix`: pivot and hierarchy tables.
- `semaphor.analysis`: governed analysis and period-change driver views. Use
  `analysis: { kind: "period_change" }`, not `analysisMode`.
- `semaphor.sql`: SQL-backed views only when the user explicitly asks for SQL
  or the semantic builders cannot express the request.
- `semaphor.filter`, `semaphor.sqlParam`, and `semaphor.control`: runtime
  inputs.

Metric comparison uses structured objects such as
`comparison: { kind: "previous_period" }`; do not emit string comparison
aliases.
Comparison fields in metric results are query-level and describe the
`primaryMeasure`. For a KPI row where every measure needs its own
period-over-period delta, define separate single-measure `semaphor.metric`
queries instead of relying on one multi-measure query to provide per-measure
comparison values.

## Sources And Fields

Use MCP-discovered metadata. Do not invent domains, datasets, fields,
connection ids, or table names.

Semantic sources require `domainId` and `datasetName`. Include `datasetId` when
available because it strengthens identity, but do not omit `datasetName`.

```tsx
const orders = {
  kind: "semantic",
  domainId: "domain-id-from-mcp",
  datasetName: "orders",
  datasetId: "dataset-orders",
  label: "Orders",
} satisfies SemaphorSourceRef;
```

SQL sources use `connectionId`, optional `dialect`, and optional `label`.

```tsx
const sqlSource = semaphor.source.sql({
  connectionId: "connection-id-from-mcp",
  dialect: "postgres",
  label: "Warehouse",
});
```

Rows are keyed by `columns[].key`. Labels and semantic names are display and
metadata fields, not stable row accessors.

```tsx
const revenueColumn = result.columns?.find((column) => column.name === "revenue");
const revenue = revenueColumn ? row[revenueColumn.key] : null;
```

## Inputs And Options

Use server-side filters and option queries instead of fetching all data and
filtering in client code.

```tsx
const regionInput = semaphor.filter({
  id: "region",
  label: "Region",
  field: regionField,
  operator: "in",
});

const regionOptions = semaphor.inputOptions({
  id: "region_options",
  inputId: "region",
  source: regions,
  labelField: regionName,
  valueField: regionId,
  searchField: regionName,
  limit: 100,
});
```

Normal cascading options may omit `dependencies`; `auto` is the default.
Do not require `filterFieldRef` on option queries. Active filtering is modeled
by the input/filter binding.

## Result Rendering

Handle state before rendering data:

- `status`
- `isLoading`
- `isStale`
- `isEmpty`
- `isPartial`
- `isFiltered`
- `error`
- `executionResult`

During refetch, keep rendering stale data when `isStale` is true. For partial
responses, render the usable payload with a warning instead of hiding it behind
an error or empty state.

`executionResult` is the authoritative governed result surface for status,
coverage, validation, relationship diagnostics, row counts, and typed result
payloads. Top-level analysis fields are display conveniences. Top-level
analysis `fieldsUsed` is compact metadata; do not attach or depend on
`derivedField` there.

Analysis row sets should be read from `result.resultSets?.<name>.records`.
Common names include `primary`, `contributors`, `segments`, `periodChanges`,
`changes`, `drivers`, and `absoluteDeltaDrivers`.

## Validation

Before save or publish, run the server-owned MCP validator and fix structured
issues. In installed plugin runs, call
`semaphor_validate_data_app_contract({ workspaceDir })` after generated files
are written so the bridge reads the manifest and generated TypeScript files
deterministically.

For generated contracts, use the generated helpers (`queries`,
`queryOptionsForView`, `rowValuesForView`, `columnKeysForView`,
`metricValuesForView`, and `metricMeasureKeysForView`) rather than manually
reconstructing row keys, metric keys, input bindings, or query options in
components. Metric result keys may be source-qualified at runtime, so KPI
components must not index `result.measures` with hand-typed field names.

Launch-readiness smoke for generated apps should cover at least one KPI, one
records/table view, one matrix view, and one visible filter. Verify that the
same generated input handle reaches every subscribed query, rows are read via
`columns[].key` or `rowValuesForView`, KPIs are read through
`metricValuesForView`, matrix views consume SDK `grid` or `matrixResult`, and
each rendered result preserves public SDK state such as
`isFiltered`, `isEmpty`, `isPartial`, `isValidated`, and `executionResult`.
