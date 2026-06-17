# Matrix And Pivot Tables

Use matrix queries for pivot tables, hierarchy tables, subtotals, grand totals,
sparse cells, and row/column display limits. The authoring path is:

```text
MCP semaphor_matrix during planning/validation
  -> shared SemaphorMatrixIntent
  -> semaphor.matrix(...)
  -> useSemaphorQuery(...)
  -> matrix payload/grid rendering
```

Do not build matrix behavior by fetching unbounded detail rows and pivoting in
React. That bypasses Semaphor execution budgets, governed aggregation, totals,
and server-side display limits.

Matrix, pivot, and hierarchical tables are server-shaped BI views. Do not
invent sparse-cell parsing, hierarchy projection, subtotal handling,
grand-total placement, or pivot-column layout from scratch when Semaphor
starter reference files are available. Use the starter component as the source
of truth for payload mechanics in starter/eval apps, then adapt the
presentation to the customer app's design system when the full component does
not fit.

## Customer Language

Customers may not say "matrix". Treat these as the same governed matrix-table
family unless the requested shape is plainly a simple flat records table:

- pivot table;
- crosstab or cross-tab;
- matrix table;
- hierarchy table;
- hierarchical table;
- grouped table with subtotals;
- row/column totals table;
- drilldown-style table with nested row groups.

Use `semaphor_matrix` during authoring/validation and productize with
`semaphor.matrix(...)` when the requested table needs row axes, column axes,
hierarchy, subtotals, grand totals, sparse cells, display limits, or
server-shaped aggregation. Use `semaphor.records(...)` only for ordinary
bounded detail rows without pivot/hierarchy semantics.

Distinguish the table shapes:

- hierarchical table: row hierarchy only, with no pivot columns. Use rows and
  values, omit `columns`, and configure hierarchy/subtotals/totals as needed.
- pivot table or crosstab: row axes plus one or more pivot column axes. Use
  `columns` for the pivoted fields or time grains.
- matrix table: umbrella term for either shape when the app needs governed
  axes, totals, sparse cells, or server-shaped aggregation.

## Builder

```tsx
const revenueMatrix = semaphor.matrix({
  id: "revenue-matrix",
  label: "Revenue Matrix",
  source,
  rows: [
    {
      id: "region",
      field: regionField,
      subtotal: { enabled: true, position: "after" },
    },
    countryField,
  ],
  columns: [
    {
      id: "order-quarter",
      field: orderDateField,
      grain: "quarter",
    },
  ],
  values: [
    {
      id: "revenue",
      field: revenueField,
      aggregate: "SUM",
      label: "Revenue",
    },
  ],
  totals: { rows: true, columns: true, grandTotal: true },
  sort: [
    {
      axis: "row",
      targetId: "region",
      direction: "desc",
      by: { kind: "value", valueId: "revenue" },
    },
  ],
  displayLimits: {
    rows: { limit: 100 },
    columns: { limit: 24 },
  },
  layout: { hierarchy: "tabular", stickyRowHeaders: true },
});
```

Use no `columns` array for hierarchy-only tables that group rows and measures
without a pivot axis.

## Planning Checklist

For every matrix view, make the plan explicit:

- row axis fields and hierarchy order;
- column axis fields and time grains, if any;
- value fields and aggregates;
- row/column/grand totals and subtotal behavior;
- sort rules;
- count-only row/column display limits;
- filters and input handles that should affect the matrix.

## Rendering Guidance

`useSemaphorQuery(matrixQuery)` returns matrix payload/grid data, not ordinary
`records`. Render from the matrix result shape or a local matrix projection
component. Include loading, error, and empty states like any other query.

When the target app uses compatible shadcn/base UI primitives and does not
already have a high-quality matrix or pivot component, prefer the
starter-included Semaphor matrix component instead of hand-rolling sticky
headers, sparse cell rendering, empty/error states, and bounded scrolling.
The starter component is canonical for generated starter/eval apps and handles
both matrix row-axis modes:

- hierarchy mode: expandable parent rows render as one compact indented sticky
  row-header column;
- tabular mode: flat multi-level row axes render as separate sticky row-header
  columns for each row level.

If the host app uses another table/grid/design system, use the starter matrix
component as a reference implementation for mechanics and adapt the visible
shell. The hard parts to preserve are:

- prefer the SDK-returned matrix `grid` projection when present;
- derive a display grid from `matrixResult` only through the Semaphor matrix
  payload contract, not ad hoc row/column guesses;
- preserve row hierarchy, flat multi-level row headers, pivot column hierarchy,
  sparse cell presence, subtotals, row totals, column totals, and grand totals;
- keep row/column collapse state as presentation state only;
- keep matrix sort/display limits represented in the Semaphor matrix query
  where supported.

The starter matrix source lives under:

```text
components/semaphor/matrix-table/
  core.ts
  index.tsx
  view.tsx
```

Use `SemaphorMatrixTable` when the app should execute a governed
`semaphor.matrix(...)` query directly. Use `MatrixTableView` when rendering a
fixture, a fake-server result, or an already loaded SDK matrix `grid` or
`matrixResult`. Keep the matrix query spec visible in the app source through
`queryFactory`; do not hide source, rows, columns, values, totals, filters,
sort, or display limits inside a generic component.

If the target app has no matrix component and does not use compatible shadcn,
build a small bounded renderer from the returned grid shape first. Use the
starter `core.ts` as the reference for matrix result-to-grid projection,
visible hierarchy projection, collapse state, path keys, sort state, and cell
formatting. Use a richer table library only after checking the existing app and
asking before adding dependencies.

## Current Caveats

- Matrix is for semantic/explorer sources, not raw SQL-backed matrix requests.
- Joined matrix requests should rely on Semaphor grounding and relationship
  metadata. If the model cannot prove the join is safe, mark the matrix
  unsupported and explain the semantic-model improvement needed.
- Frontend-only pivoting is acceptable only for tiny presentation-only data
  that is not a governed analytical result.
- Matrix display limits are count-only in v1: use `{ rows: { limit } }`
  and/or `{ columns: { limit } }` for axes the matrix actually has. Do not
  request top/bottom limiting, value-based limiting, or `Others` buckets until
  Semaphor exposes bounded member-planning support for those behaviors.
