# shadcn Dashboard Best Practices

Use this reference before creating or changing visible Semaphor Data App UI.
The goal is a polished analytical surface that feels native to the target app,
not a Semaphor-branded theme pasted into a customer repo.

## Operating Model

Prefer the target app's design system. If the app uses shadcn, use its
installed components, aliases, theme tokens, and icon library. If a component
is missing, add it through the project's package runner and shadcn CLI after
checking the project setup.

Use shadcn primitives for structure:

- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and
  `CardFooter` for KPI cards and visual panels.
- `Table` for small and medium bounded tables.
- `Select`, `Popover`, `Command`, `Checkbox`, `ToggleGroup`, `Slider`,
  `Input`, and `Button` for controls.
- `Skeleton`, `Alert`, `Empty`, `Progress`, `Badge`, `Tooltip`, and `Separator`
  for states and supporting UI.
- The app's chart wrapper or shadcn chart pattern for Recharts-based visuals.

Do not create a parallel component system. Compose from the host app's
components and only add small local helpers for app-specific repeated patterns
such as `KpiCard`, `InsightCard`, `SortableDataTable`, or `QueryState`.

## Required Dashboard Quality

Every generated data app should include:

- A clear page title and concise subtitle explaining the business question.
- Filter controls near the top when filters affect multiple views.
- KPI cards that show value, label, comparison or context when available, and
  loading/error states.
- Charts with readable axes, labels, tooltips, and bounded series counts.
- Tables with sortable headers, right-aligned numeric values, tabular numbers,
  empty states, and totals when totals are meaningful.
- Responsive layout that works at desktop and mobile widths without text
  overlap.
- No decorative UI that competes with the data.

Do not add user-facing implementation badges or proof-of-plumbing labels such
as "Governed SDK queries", "Token configured", "MCP connected", "SQL fallback",
or raw domain/debug chips. Those are developer observability details, not
customer dashboard content. If the app needs development observability, hide it
behind an explicit debug/inspect affordance or development-only panel.

## shadcn Composition Rules

Use complete component composition, not styled divs that imitate shadcn:

```tsx
<Card className="rounded-lg border shadow-none">
  <CardHeader className="gap-1">
    <CardTitle className="text-sm font-medium">Revenue</CardTitle>
    <CardDescription>Current month</CardDescription>
  </CardHeader>
  <CardContent>
    <div className="text-2xl font-semibold tabular-nums">$128.4K</div>
  </CardContent>
</Card>
```

For dashboards:

- Use `gap-*` for spacing, not `space-x-*` or `space-y-*`.
- Use semantic tokens such as `bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, and `border-border`.
- Do not hardcode raw color utilities for analytics status unless the host app
  already has a clear status-color convention.
- Use `Badge` for statuses and deltas when it reads better than colored text.
- Use `Skeleton` for loading, `Alert` for blocking errors, and `Empty` or an
  equivalent host empty-state component for no-data states.
- Use `Tooltip`, `HoverCard`, or `Popover` for detail, not always-visible
  explanatory text.
- Keep icon use functional. Icons in buttons should clarify action; avoid
  decorative icons inside KPI cards unless the host app already uses that
  pattern.

## Cards And Layout

Use compact, scan-friendly layouts. Analytics apps are working surfaces, not
landing pages.

- Prefer a top filter row, then KPI grid, then charts/tables.
- Use `grid gap-4 md:grid-cols-2 xl:grid-cols-4` style layouts for KPI cards.
- Use 2-column chart layouts on desktop and a single column on mobile.
- Avoid nested cards. A chart panel can be a `Card`; content inside it should
  not be another card.
- Prefer `rounded-lg border shadow-none` for analytical cards when host card
  defaults are overly soft or heavy.
- Do not use oversized hero sections, gradient blobs, decorative glass panels,
  or marketing-style sections in operational dashboards.

Host defaults are allowed when they remain usable. Override them when the
default card radius, shadow, spacing, or typography makes dense data harder to
scan.

## Tables

For bounded tables, use the host table component and implement:

- Header labels from `result.columns[].label`.
- Row access through `row[column.key]`.
- Sortable headers for user-facing tables.
- Right-aligned numeric cells with `tabular-nums`.
- Totals row for displayed additive numeric columns when meaningful.
- Constrained height such as `max-h-[420px]` to `max-h-[560px]` with
  `overflow-auto`.
- Sticky or repeated headers when the table scrolls.
- Horizontal scrolling for wide tables instead of squeezed unreadable columns.
- Loading, error, and empty states.

For large or server-paginated tables, prefer TanStack Table and, for virtual
scrolling, TanStack Virtual. Ask before adding dependencies unless the user has
already approved installing table libraries.

When the app uses shadcn and lacks an equivalent server table, prefer the
Semaphor registry item documented in [tables.md](tables.md):

```bash
npx shadcn@latest add semaphor-analytics/semaphor-data-app-components/server-data-table
```

Do not fetch large result sets only to paginate, sort, or filter in React. Use
server-side pagination, sorting, and filters when the app needs large tables.

## Charts

Charts should answer one question clearly.

- Prefer line charts for trends, bars for ranked comparisons, stacked bars for
  composition over categories, and area only when volume over time is the point.
- Keep series counts small. If many categories exist, show top contributors and
  group the rest only when that grouping is supported by the data.
- Include tooltips and readable axis labels.
- Use chart colors from the host chart theme when available.
- Do not use pie or donut charts for many categories.
- Do not render charts with static mock data when Semaphor query data is
  available.

## Filters And Inputs

Use shadcn controls that fit the input:

- Date range: app date picker or two date inputs if no picker exists.
- Small option set: `ToggleGroup`.
- Single selection: `Select` or Combobox.
- Multi-select: `Popover` plus `Command` and checkboxes, or an installed host
  multi-select component.
- Numeric threshold: `Slider` plus an input when precision matters.

Shared filters should show which views they affect through placement and label
clarity. Keep option labels unique; when labels duplicate, add a meaningful
secondary label or disambiguator.

## States And Error UX

Every data-bearing visual needs explicit states:

- Loading: use `Skeleton` or a compact in-panel loading state.
- Error: show which visual failed and a short actionable message.
- Empty: say there is no data for the current filters, not a generic "No data".
- Partial: show available data and explain unavailable views or unsupported
  modeling gaps.

Never let a query failure collapse the whole dashboard when only one visual
failed.

## Dependency Guidance

Use what is already installed first. If a high-quality table, chart, date, or
command component is missing:

- Explain why the dependency improves the app.
- Ask before installing unless the user already authorized dependency changes.
- Prefer `@tanstack/react-table` for advanced tables.
- Prefer `@tanstack/react-virtual` for virtualized large tables.
- Prefer the app's existing chart stack; shadcn chart examples commonly use
  Recharts.

## Completion Checklist

Before reporting UI work complete, verify:

- The app uses host shadcn components or host design-system primitives.
- No visible data UI relies on mock data when Semaphor query data is available.
- Loading, error, empty, and partial states exist for data-bearing visuals.
- Numeric cells and KPI values use readable formatting and `tabular-nums`.
- Tables use `columns[].key` for row access and display `columns[].label`.
- Shared filters are server-side where supported and clearly affect the right
  views.
- The layout works on desktop and mobile without overlapping text.
- Styling is restrained and does not fight the host app theme.
