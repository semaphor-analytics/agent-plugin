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

## Server-Backed Table Principle

Semaphor data tables are BI tables. Treat them as server-backed views even when
the currently displayed row count is small. The app may render a bounded
server-limited result, a server-paginated result, or a server-windowed result,
but it should not fetch broad or complete data and then rely on React for the
real table semantics.

Server-backed means:

- filters are represented as Semaphor inputs and applied by Semaphor execution;
- pagination/windowing is represented in the Semaphor query when the table is
  exploratory or large;
- sorting for large or exploratory tables is represented in the Semaphor query;
- displayed-row totals may be computed in React only for the returned page or
  bounded window;
- all-filtered-row totals require Semaphor-provided totals or a separate
  aggregate query.

The implementation choice is a UI strategy, not a data strategy. Use the
customer app's design system where possible, but preserve Semaphor server-side
query mechanics.

## Table Baseline

If the Data App planner returns `view.visualSpec.tableBehavior`, use it as the
table implementation contract. It tells you the table mode, max height,
sticky-header behavior, pagination source, sorting mode, totals semantics, and
whether server-side execution is required.

Table views should:

- render from `result.columns` for stable order and labels;
- use `column.key` for row access;
- support user sorting;
- show an empty state when no rows are returned;
- format numeric, currency, percentage, and date values for human scanning;
- constrain table height inside dashboard cards, usually with `max-h-[420px]`
  to `max-h-[560px]` and `overflow-auto`;
- use sticky headers when the table scrolls;
- allow horizontal scrolling for wide tables instead of shrinking columns until
  labels and values are unreadable;
- preserve raw values only when the user needs exact IDs, codes, or
  machine-readable output.

Tables with numeric columns should include a total row for the rows being
displayed. If the product needs a true total across all filtered data rather
than the current page/window, create a separate aggregate query for that total
instead of summing a paginated or truncated table client-side.

Do not leave table sorting or totals as validator TODOs. For bounded
server-limited rows, displayed-row sorting and displayed-row totals are
acceptable only when the table is not pretending to represent the complete
dataset. For server-paginated or exploratory tables, implement sort controls
that update the Semaphor query/order spec and reset to the first page, then use
a separate aggregate query when all-filtered-row totals are needed.

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

Minimum shadcn table shell:

```tsx
<Card className="rounded-lg border shadow-none">
  <CardHeader className="gap-1">
    <CardTitle className="text-base">Open Opportunities</CardTitle>
    <CardDescription>Sorted by expected revenue</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="max-h-[520px] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {result.columns.map((column) => (
              <TableHead key={column.key}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                </Button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row, index) => (
            <TableRow key={String(row.id ?? index)}>
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={column.dataType === "number" ? "text-right tabular-nums" : undefined}
                >
                  {formatCellValue(row[column.key], column)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </CardContent>
</Card>
```

Keep this as a pattern, not a required exact component. Use the target app's
existing card, table, button, and formatting helpers when present.

## Exploratory And Large Tables

Exploratory, drill-through, large, or complete-dataset tables must keep table
semantics on the server. Do not fetch a million rows into React and then
filter, sort, paginate, or virtualize only on the client.

Represent filtering and ordering in the Semaphor query spec, and represent
server pages with:

```ts
pagination: { page, pageSize }
```

on the generated query builder for the table view, or on a hand-authored
`semaphor.records(...)` / `semaphor.sql(...)` query when no generated contract
view exists. Use `result.pagination` for page controls and `result.rowCount`
for the server-reported total count.

Sorting may be client-side for small, bounded result sets. For large,
paginated, or complete-dataset tables, sorting should be represented in the
Semaphor query/order contract so the server owns the sorted result.

If a needed table behavior cannot be expressed yet, call that out as a
`react-semaphor/data-app-sdk` or Semaphor execution gap and build a bounded
table instead of pretending the frontend has the full dataset.

Minimum generated records-table pattern when `tableBehavior.sorting.mode ===
"server"`:

```tsx
import {
  queries,
  queryOptionsForView,
  recordsSortOptionsForView,
} from "@/semaphor/generated";

const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(25);
const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

const sortOptions = recordsSortOptionsForView.ordersTable;
const sortOption = sortOptions.find((option) => option.key === sort?.key);
const query = queries.ordersTable({
  page,
  pageSize,
  sort: sort && sortOption
    ? { key: sortOption.key, direction: sort.direction }
    : undefined,
});

const result = useSemaphorQuery(
  query,
  queryOptionsForView.ordersTable(inputHandles),
);

// Render rows from result.records.
// Render page controls from result.pagination and result.rowCount.
// Reset page to 1 when filters, pageSize, or sort changes.
```

Minimum generated pagination-only pattern for SQL views or records views with
`tableBehavior.sorting.mode === "client_for_bounded_rows"`:

```tsx
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(25);

const query = queries.ordersTable({ page, pageSize });
const result = useSemaphorQuery(
  query,
  queryOptionsForView.ordersTable(inputHandles),
);

// Render rows from result.records.
// Render page controls from result.pagination and result.rowCount.
// If sorting.mode is client_for_bounded_rows, sort only the returned rows.
```

For generated records-backed views with `tableBehavior.sorting.mode ===
"server"`, do not pass table header labels or row keys directly as sort fields.
Use `recordsSortOptionsForView.<viewName>` and pass the selected option key
back into `queries.<viewName>({ sort })`; the generated query builder maps that
key to the correct source-aware Semaphor field.
Generated SQL table views with `tableBehavior.pagination.mode === "server"`
can receive `page` and `pageSize` through `queries.<viewName>({ page,
pageSize })`; do not invent generic SQL sort rewrites unless the generated
contract explicitly models that sort.

## Semaphor Starter Table Reference

When the target app uses shadcn and the table needs server-side pagination,
server-side sorting, bounded height, sticky headers, loading/error/empty states,
or displayed totals, use the Semaphor starter table component as the reference
implementation for the hard mechanics. In starter/eval apps, import the
starter-included component directly. In existing customer apps, prefer the
host's table/grid abstraction and adapt the starter mechanics only when the
host does not already provide them.

Use the starter table reference when:

- the planner returns `view.visualSpec.tableBehavior.serverSideRequired`;
- the user asks for a large table, paginated table, sortable table, operational
  queue, or drill-through/detail table;
- the plan implies an operational table, queue, drill-through/detail table,
  exploratory table, paginated/sortable table, or complete/large result table,
  even if the user only asked to "show" or "list" records;
- the target app does not already have an equivalent high-quality server table
  component.

Do not copy starter table code blindly. First inspect the target app and put the
recommendation in the visible plan when the inferred table behavior needs
server-side mechanics:

- if it already has a durable table/grid abstraction, adapt to that;
- if it is the Semaphor starter or eval workspace, use
  `src/components/semaphor/server-data-table`;
- if it uses compatible shadcn/base UI primitives but lacks a server table, ask
  before copying/adapting the starter component or adding
  `@tanstack/react-table`;
- if the app does not use shadcn, preserve the host design system and use the
  starter component as implementation reference rather than forcing the UI
  stack.

For broad app builds, this is an approval checkpoint once the agent infers that
the planned table is operational, exploratory, large, complete, paginated,
sortable, or drill-through/detail. The planning response should say:

```text
This plan includes a server-side table. The recommended implementation is the
Semaphor starter server-table reference. It contains the server pagination,
sorting, state, and formatting mechanics. Your app uses <design system>, so I
can either adapt those mechanics into your existing table/grid, copy the
starter component source if it fits this app, or build a minimal server-backed
table without new dependencies. Which do you prefer?
```

Wait for the user's choice before copying starter component source or
installing table dependencies, unless the user already explicitly authorized
server-side tables or dependency changes for the session. If the table behavior
calls for server-side mechanics, do not fall back to a client-only table to
avoid the extra work; either use/adapt the starter mechanics or report the
concrete incompatibility that prevents it.

The starter table source lives under:

```text
components/semaphor/server-data-table/
  core.ts
  index.tsx
  view.tsx
  table-formatters.ts
```

`SemaphorServerDataTable` is a thin SDK wrapper. For generated records-backed
contract views with server sorting, keep the generated query builder visible in
the app source through `queryFactory`; do not rebuild source, fields, filters,
pagination, or order specs by hand inside a component.

```tsx
const sortOptions = recordsSortOptionsForView.ordersTable;

<SemaphorServerDataTable
  title="Orders"
  sortOptions={sortOptions}
  queryFactory={({ page, pageSize, sort }) => {
    const sortOption = sortOptions.find((option) => option.key === sort?.key);
    return queries.ordersTable({
      page,
      pageSize,
      sort: sort && sortOption
        ? { key: sortOption.key, direction: sort.direction }
        : undefined,
    });
  }}
  options={queryOptionsForView.ordersTable(inputHandles)}
/>
```

Use raw `semaphor.records(...)` query specs only for explicitly hand-authored
tables that are not backed by a generated contract view. In that case, map UI
sort state to source-bearing SDK field refs, not display labels or row keys.
For generated records views with `tableBehavior.pagination.mode === "server"`
and `tableBehavior.sorting.mode === "client_for_bounded_rows"`, use
`queries.recordsView({ page, pageSize })` and sort only the returned bounded
rows in the table component. If pagination mode is not `server`, use
`queries.recordsView()` and preserve any pagination already authored in the
generated SDK spec. For generated SQL table views with server pagination, use
the same `queryFactory` pattern with `queries.sqlView({ page, pageSize })` and
omit sort controls unless the generated SQL contract exposes a safe sort
parameter.

When adapting the starter component instead of using it whole, preserve these
mechanics:

- use `core.ts` as the reference for SDK column mapping, pagination metadata,
  pagination summaries, sort state, and displayed numeric totals;
- map `result.columns` to visible table columns with `column.key` as the row
  accessor and `column.label` as display text;
- map `result.pagination` to page controls and do not synthesize complete-data
  pagination from `records.length`;
- reset page to 1 when filters, page size, or server sort changes;
- express server sort through `orderBy` or the installed SDK's public sort
  contract;
- keep loading, refetching, error, empty, and partial states local to the
  table;
- compute displayed-row totals only from the returned page/window, and use a
  separate aggregate query for all-filtered-row totals.

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
