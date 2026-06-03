# Data App UX And Tables

Generated Semaphor-backed views should feel like real data apps, not raw API
proofs of concept. Match the target app's existing design system, but include
these baseline behaviors unless the user asks for a deliberately minimal view.

## Query States

Every `useSemaphorQuery` result rendered on screen needs:

- loading state;
- error state;
- empty state.

Do not leave cards stuck at `0`, blank charts, or empty tables while a query
is loading or has failed. Loading skeletons or compact placeholders are
preferred over large explanatory text. Errors should be specific enough to
debug but must not expose secrets.

For controls that trigger multiple queries, preserve the previous layout while
queries refresh. Show per-card loading state rather than replacing the whole
app with one global spinner unless the whole app truly cannot render.

## Query Ownership

Each data-bearing card should normally own its own query. Shared-query
derivation is valid when it is an intentional optimization, but for dashboard
apps a KPI, chart, table, and insight panel should generally have distinct
query specs and distinct loading/error states.

Shared filters are input handles. Bind the input once, then pass it into every
card query that should respond to it.

## Table Baseline

Table views should:

- render from `result.columns` for stable order and labels;
- use `column.key` for row access;
- support user sorting;
- show an empty state when no rows are returned;
- format numeric, currency, percentage, and date values for human scanning;
- preserve raw values only when the user needs exact IDs, codes, or
  machine-readable output.

Tables with numeric columns should include a total row for the rows being
displayed. If the product needs a true total across all filtered data rather
than the current page/window, create a separate aggregate query for that total
instead of summing a paginated or truncated table client-side.

Do not leave table sorting or totals as validator TODOs. If the app has a
bounded rows table, implement displayed-row sorting and displayed-row totals in
the generated table component. If the table is server-paginated, implement
sort controls that update the Semaphor query/order spec and reset to the first
page, then use a separate aggregate query when all-filtered-row totals are
needed.

Minimum bounded table pattern:

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

const numericTotals = useMemo(() => {
  return (result.columns ?? [])
    .filter((column) => column.dataType === "number")
    .map((column) => ({
      key: column.key,
      value: sortedRows.reduce((sum, row) => {
        const value = row[column.key];
        return typeof value === "number" ? sum + value : sum;
      }, 0),
    }));
}, [result.columns, sortedRows]);
```

Render sortable headers as buttons and render a footer row for `numericTotals`.
For exact totals across all filtered rows, replace displayed-row totals with a
separate `semaphor.metric(...)` aggregate query that receives the same input
handles.

## Large Tables

Large or complete-dataset tables must be server-side tables. Do not fetch a
million rows into React and then filter, sort, paginate, or virtualize only on
the client.

Represent filtering and ordering in the Semaphor query spec, and represent
server pages with:

```ts
pagination: { page, pageSize }
```

on `semaphor.records(...)` or `semaphor.sql(...)`. Use `result.pagination` for
page controls and `result.rowCount` for the server-reported total count.

Sorting may be client-side for small, bounded result sets. For large,
paginated, or complete-dataset tables, sorting should be represented in the
Semaphor query/order contract so the server owns the sorted result.

If a needed table behavior cannot be expressed yet, call that out as a
`react-semaphor/data-app-sdk` or Semaphor execution gap and build a bounded
table instead of pretending the frontend has the full dataset.

## Table Libraries

For rich table UX, inspect the target app first. Use its existing table/grid
library when one is already installed.

If the app does not have one, ask the user before adding dependencies.
Recommend:

- `@tanstack/react-table` for table state such as columns, sorting, row models,
  and pagination controls;
- `@tanstack/react-virtual` only when virtualized row rendering is needed.

These libraries are rendering/state helpers, not a substitute for Semaphor
server-side query limits.
