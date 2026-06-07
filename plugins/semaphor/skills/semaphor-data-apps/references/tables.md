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

on `semaphor.records(...)` or `semaphor.sql(...)`. Use `result.pagination` for
page controls and `result.rowCount` for the server-reported total count.

Sorting may be client-side for small, bounded result sets. For large,
paginated, or complete-dataset tables, sorting should be represented in the
Semaphor query/order contract so the server owns the sorted result.

If a needed table behavior cannot be expressed yet, call that out as a
`react-semaphor/data-app-sdk` or Semaphor execution gap and build a bounded
table instead of pretending the frontend has the full dataset.

Minimum server-paginated state pattern:

```tsx
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(25);
const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

const query = semaphor.records({
  source,
  fields,
  filters,
  pagination: { page, pageSize },
  orderBy: sort ? [{ field: sort.key, direction: sort.direction }] : undefined,
});

const result = useSemaphorQuery(query, { inputs });

// Render rows from result.records.
// Render page controls from result.pagination and result.rowCount.
// Reset page to 1 when filters, pageSize, or sort changes.
```

If the SDK query contract in the installed app uses a different sort/order
field name, follow the installed public SDK contract. The important behavior is
that large-table sort, filter, and pagination are represented in the Semaphor
query, not applied only after fetching a large result set.

## Semaphor Table Registry Reference

When the target app uses shadcn and the table needs server-side pagination,
server-side sorting, bounded height, sticky headers, loading/error/empty states,
or displayed totals, use Semaphor's reusable table registry item as the source
of truth for the hard mechanics:

```bash
npx shadcn@latest add semaphor-analytics/semaphor-data-app-components/server-data-table
```

The registry can be used in two ways:

- install the full component when the host app uses compatible shadcn/base UI
  primitives and the user approves the dependency/source additions;
- inspect or install the core/reference files and adapt the presentation shell
  to the host app's existing table/grid/design system when the full component
  does not fit.

Use the registry reference when:

- the planner returns `view.visualSpec.tableBehavior.serverSideRequired`;
- the user asks for a large table, paginated table, sortable table, operational
  queue, or drill-through/detail table;
- the target app does not already have an equivalent high-quality server table
  component.

Do not install the registry item blindly. First inspect the target app and put
the recommendation in the visible plan unless the user or planner has already
explicitly selected the server-side table/registry path:

- if it already has a durable table/grid abstraction, adapt to that;
- if it uses compatible shadcn/base UI primitives but lacks a server table, ask
  before adding the registry item and its `@tanstack/react-table` dependency;
- if the app does not use shadcn, preserve the host design system and use the
  registry component as implementation reference rather than forcing the UI
  stack.

For broad app builds, this is an approval checkpoint when the user has not
already approved the server-side table approach. The planning response should
say:

```text
This plan includes a server-side table. The recommended implementation is the
Semaphor server table registry reference. It contains the server pagination,
sorting, state, and formatting mechanics. Your app uses <design system>, so I
can either install the full compatible registry component, adapt the mechanics
into your existing table/grid, or build a minimal server-backed table without
new dependencies. Which do you prefer?
```

Wait for the user's choice before running `npx shadcn@latest add ...` or
installing table dependencies, unless the user already explicitly authorized
server-side tables, the Semaphor table registry, or dependency changes for the
session. When the user says to use server-side tables or the registry, do not
fall back to a client-only table to avoid the install; either install/adapt the
registry mechanics or report the concrete incompatibility that prevents it.

The registry item installs source under:

```text
components/semaphor/server-data-table/
  core.ts
  index.tsx
  view.tsx
  table-formatters.ts
```

`SemaphorServerDataTable` is a thin SDK wrapper. Keep the query spec visible in
the app source through `queryFactory`; do not hide source, fields, filters,
pagination, or order spec inside a component.

```tsx
<SemaphorServerDataTable
  title="Orders"
  queryFactory={({ page, pageSize, sort }) =>
    semaphor.records({
      source,
      fields,
      filters,
      pagination: { page, pageSize },
      orderBy: sort
        ? { field: resolveSortField(sort.key), direction: sort.direction }
        : undefined,
    })
  }
  options={{ inputs }}
/>
```

Map `sort.key` back to the SDK field/order contract in app code. Do not assume
the result key is always a valid SDK `orderBy.field` without checking the
installed SDK contract and planner-provided field refs.

When adapting the registry instead of installing it whole, preserve these
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
