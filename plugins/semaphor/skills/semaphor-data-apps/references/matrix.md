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
    rows: { limit: 100, by: "value", direction: "top", others: true },
    columns: { limit: 24, by: "label", direction: "top" },
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
- display limits and whether an `Others` bucket is expected;
- filters and input handles that should affect the matrix.

## Rendering Guidance

`useSemaphorQuery(matrixQuery)` returns matrix payload/grid data, not ordinary
`records`. Render from the matrix result shape or a local matrix projection
component. Include loading, error, and empty states like any other query.

If the target app has no matrix component yet, build a small bounded renderer
from the returned grid shape first. Use a richer table library only after
checking the existing app and asking before adding dependencies.

## Current Caveats

- Matrix is for semantic/explorer sources, not raw SQL-backed matrix requests.
- Joined matrix requests should rely on Semaphor grounding and relationship
  metadata. If the model cannot prove the join is safe, mark the matrix
  unsupported and explain the semantic-model improvement needed.
- Frontend-only pivoting is acceptable only for tiny presentation-only data
  that is not a governed analytical result.
