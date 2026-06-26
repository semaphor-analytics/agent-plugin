# Filters And Inputs

Filters, controls, and SQL params are explicit input specs. Bind them with
`useSemaphorInputs`, then pass the returned handles into every query that
should respond.

## Runtime Handle Contract

Input specs are static definitions. Handles are runtime state. Use the handles
for UI values and events:

```tsx
const [regionHandle, limitHandle] = useSemaphorInputs([region, limit]);

const result = useSemaphorQuery(rowsQuery, {
  inputs: [regionHandle, limitHandle],
});

<select
  value={String(limitHandle.value ?? 100)}
  onChange={(event) => limitHandle.setValue(Number(event.target.value))}
>
  <option value="25">25 rows</option>
  <option value="100">100 rows</option>
</select>;
```

- Read `handle.value` to render the current selected value.
- Call `handle.setValue(nextValue)` from controls.
- Pass handles, not raw specs, to `useSemaphorQuery`.
- Bind shared filters once in a parent when multiple queries should subscribe.
- For shadcn/Base UI selects, type `onValueChange` as `(value: string | null)
  => void`; clear with `handle.clear()` or `handle.setValue(undefined)`.
- For multi-selects and date ranges, narrow `handle.value` with
  `Array.isArray(...)` before indexing or displaying it.

## Option Query Contract

When a visible select, combobox, multi-select, typeahead, or filter menu needs
choices from Semaphor data, generate a `semaphor.inputOptions(...)` query and
execute it with `useSemaphorQuery(...)`.

Do not use `semaphor.records(...)` to fetch broad lookup rows and derive option
lists in React. That hides the query's intent from Semaphor DevTools, makes
agent review ambiguous, and pushes filter semantics into app-local code.

Use `semaphor.records(...)` only when the row set itself is app content, such
as a table, chart, trend, grouped breakdown, or detail/lookup panel that the
user reads directly. Scalar KPI cards should use `semaphor.metric(...)`; if an
option-loading or KPI case genuinely cannot be expressed with the intended SDK
builder, keep the workaround narrow and report the SDK gap and workaround in
the final response.

For cascading filters, use separate option queries with explicit input
dependencies. Example: a `state-options` query for the State select and a
`facility-options` query for the Facility select, where the facility query
receives the selected State input handle.

```tsx
const stateFilter = semaphor.filter({
  id: "facility_state",
  label: "State",
  field: facilityState,
  operator: "=",
});

const facilityFilter = semaphor.filter<number[]>({
  id: "facility_id",
  label: "Facility",
  field: facilityId,
  operator: "in",
});

const stateOptions = semaphor.inputOptions({
  id: "facility-state-options",
  inputId: "facility_state",
  source: facilitySource,
  labelField: facilityState,
  valueField: facilityState,
  limit: 100,
});

const facilityOptions = semaphor.inputOptions({
  id: "facility-options",
  inputId: "facility_id",
  source: facilitySource,
  labelField: facilityName,
  valueField: facilityId,
  disambiguationFields: [facilityState],
  dependencies: { mode: "explicit", includeInputIds: ["facility_state"] },
  limit: 200,
});

function Filters() {
  const [stateHandle, facilityHandle] = useSemaphorInputs([
    stateFilter,
    facilityFilter,
  ]);
  const states = useSemaphorQuery(stateOptions);
  const facilities = useSemaphorQuery(facilityOptions, {
    inputs: [stateHandle],
  });

  const selectedState = String(stateHandle.value ?? "");
  const selectedFacility = Array.isArray(facilityHandle.value)
    ? String(facilityHandle.value[0] ?? "")
    : "";

  function onStateChange(nextValue: string | null) {
    stateHandle.setValue(nextValue || undefined);
    facilityHandle.clear();
  }

  function onFacilityChange(nextValue: string | null) {
    facilityHandle.setValue(nextValue ? [nextValue] : undefined);
  }

  // Render controls from states.options and facilities.options using
  // selectedState, selectedFacility, onStateChange, and onFacilityChange.
}
```

## Operators

For filter inputs, `operator` accepts canonical SDK symbols:

- `"="`
- `"!="`
- `"in"`
- `"not_in"`
- `"between"`
- `">"`
- `">="`
- `"<"`
- `"<="`

Common MCP aliases such as `"equals"` and `"not_equals"` are normalized by the
SDK. Use `"in"` with multi-select values.

## Shared And Top-Level Filters

A dashboard-wide filter is built by composition, not a global setting. Define
one input spec, bind it once with `useSemaphorInputs` in a shared parent or a
small React context, then pass that same handle array into each query that
should respond.

For every data-backed select/multi-select filter, distinguish three fields
before writing code:

- visible label field: what the user reads in the dropdown, such as
  `material_name`;
- option value field: the stable key stored in the input value, such as
  `material_id`;
- runtime filter field: the source-bearing field applied to each subscribed
  query, such as `fact_inventory_movement.material_id`.

Do not filter a fact query with a dimension display label just because the
dropdown shows that label. If a filter's options come from a dimension but the
card query runs against a fact, bind the selected key to the fact-side key with
planner-provided `fieldRef`, `relationshipHint`, and `semaphor.bindInput(...)`.
If Semaphor cannot prove that relationship, leave the card unsubscribed and
report the missing modeled relationship instead of shipping a filter that does
not affect the card or fails at runtime.

Filter placement must match filter scope. Before rendering a visible filter,
decide and preserve its affected views:

- Dashboard-level filter bar: use only for controls that affect most or all
  visible analytical views, such as a date range with source-specific bindings
  for sales, purchases, and processing facts.
- Section-level filter: use for controls that affect a section, such as
  process type for processing-run cards.
- Card-level filter: use for controls that affect one card, such as market
  index when only the Market exposure card subscribes.

If a top-level filter intentionally affects only a subset, label or position it
so the scope is obvious to the user. Do not create a top-level "Material",
"Process type", "Market index", or similar selector that visually implies
every KPI, chart, and table will change when only one or two queries actually
receive the handle.

In starter/eval apps, use the starter-included Semaphor filter-control helpers
for dashboard-level active-filter summaries instead of hand-building inline
badge strips:

```tsx
import {
  SemaphorActiveFilterSummaryBadge,
  getSemaphorActiveFilterSummaries,
} from "@/components/semaphor/filter-controls";

const activeFilterSummaries = getSemaphorActiveFilterSummaries([
  dateRangeHandle,
  regionHandle,
  facilityHandle,
]);

<SemaphorActiveFilterSummaryBadge filters={activeFilterSummaries} />;
```

Keep the summary compact in the filter bar header or toolbar. Do not render all
active filters as one long horizontal badge list; that overflows on realistic
dimension names and hides the filter controls users need to operate.

Cards should also make active filter scope visible from the card side. For
each data-bearing card, render a compact applied-filter affordance when one or
more subscribed filters are active:

- show small chips, badges, or muted text such as `Filtered by Date range` or
  `Market index: Midwest Scrap`;
- include only filters that the card's query actually receives;
- place the affordance in the card header, card footer, or a compact line above
  the chart/table body;
- truncate long values with a tooltip or popover for full values;
- omit the affordance when no subscribed filter is active, unless the app needs
  to show always-on default context such as "Latest 12 months".

In starter/eval apps, prefer the starter-included `SemaphorViewCard` with its
generated `viewId` when the view should show applied-filter affordances. A
host-owned card is valid when it shows only filters actually applied to the
view query and exposes the generated `data-semaphor-view-id` marker, preferably
through `semaphorViewMarkerProps(viewId)` from `src/semaphor/generated`:

```tsx
import {
  SemaphorViewCard,
  getSemaphorViewFilterSummaries,
} from "@/components/semaphor/view-card";

const filtersForRevenueTrend = getSemaphorViewFilterSummaries({
  filters: activeFilterSummaries,
  viewId: "revenue_trend",
  filterScope: {
    date_range: ["revenue_trend", "sales_table"],
    region: ["revenue_trend"],
  },
});

<SemaphorViewCard
  title="Revenue trend"
  filters={filtersForRevenueTrend}
  state={revenueTrendResult}
>
  <RevenueTrendChart />
</SemaphorViewCard>;
```

Do not show a filter chip on a card merely because a filter exists elsewhere
on the page. The chip is a contract that this card's query was executed with
that filter handle or source-specific binding.

After adding or changing a visible filter, do a filter-effect QA pass before
reporting completion:

- pick one valid non-default option;
- confirm at least one subscribed visible query re-runs with that input in
  DevTools or query traces;
- confirm the card shows the active applied-filter affordance;
- compare a visible metric/chart/table before and after when the selected data
  should differ;
- if values do not change because the selected option has equivalent data,
  state that the trace proved the filter was applied rather than claiming the
  filter is broken or unverified.

Do not pass a shared input to every query just because the control is visible
at the top of the dashboard. Each subscription must be one of:

- the query uses the same source-bearing field as the input;
- the planner listed that view in `input.appliesToViewIds`;
- the query receives a `semaphor.bindInput(...)` binding with a planner-emitted
  `fieldRef` and `relationshipHint` that Semaphor can prove server-side.

If a runtime error says an active input cannot be applied because Semaphor
could not prove a modeled relationship, the implementation is not complete.
Remove that query from the input subscription or change it to the planner's
source-specific binding, then report the missing semantic relationship if the
desired filter cannot be expressed.

When Semaphor exposes semantic model repair tools, use them for the reusable
model fix instead of patching around the gap in React:

1. Call `semaphor_propose_semantic_model_change` with the selected `domainId`,
   endpoint-scoped relationship candidate, affected view ids, and input ids.
2. Show the returned relationship proposal, deterministic evidence, warnings,
   and recommendation to the author.
3. Call `semaphor_apply_semantic_model_patch` only after explicit author
   approval.
4. Rerun Data App planning or validation after apply, then update the generated
   contract from the repaired semantic model.

Do not apply semantic model patches silently during app generation. If the
tools are not exposed or the author declines the repair, keep unsupported views
unsubscribed from that filter and label the limitation.

```tsx
const region = semaphor.filter({
  id: "region",
  field: regionField,
  operator: "=",
});

const revenueQuery = semaphor.metric({
  source,
  measures: [revenue],
  inputs: [region],
});

const recordsQuery = semaphor.records({
  source,
  fields: [regionField, revenue],
  inputs: [region],
});

function Dashboard() {
  const [regionHandle] = useSemaphorInputs([region]);
  const revenueResult = useSemaphorQuery(revenueQuery, {
    inputs: [regionHandle],
  });
  const recordsResult = useSemaphorQuery(recordsQuery, {
    inputs: [regionHandle],
  });
}
```

This per-hook subscription is intentional, not a limitation. Not every filter
is meaningful for every visual. An unfiltered company-total KPI, a benchmark
panel, or a control that only some cards care about should be left out.

A card subscribes by listing the input; it stays unfiltered by omitting it.
This mirrors Semaphor's dashboard model, where filter subscription is opt-in
per card rather than applied to everything.

Do not force a global "apply to all queries" filter or assume every card
inherits a control. Thread the handle only into the cards that should respond.

When one visible input must filter different fields per query, bind the same
handle through `semaphor.bindInput(...)` instead of creating duplicate visible
controls. Common cases:

- one Date Range filtering `orders.order_date` and `invoices.invoice_date`;
- one conformed Material Family selector filtering purchase and sales facts
  through their relationship-aware material-family refs;
- one human-readable dimension selector whose option query comes from a
  related dimension but whose subscribed cards are fact-backed.

```tsx
const [dateRangeHandle] = useSemaphorInputs([dateRange]);

const purchaseRows = useSemaphorQuery(purchaseQuery, {
  inputs: [semaphor.bindInput(dateRangeHandle, { field: purchaseDate })],
});
const salesRows = useSemaphorQuery(salesQuery, {
  inputs: [semaphor.bindInput(dateRangeHandle, { field: saleDate })],
});

<SemaphorViewCard viewId="revenue_trend" title="Revenue Trend" filters={filtersForRevenueTrend}>
  ...
</SemaphorViewCard>
```

If the planner returns `input.bindings[]`, each binding is a server-side
subscription target. Preserve its `fieldRef`, `relationshipHint`,
`relationshipsUsed`, and `appliesToViewIds` in codegen. Emit
`relationshipHint` into runtime `semaphor.bindInput(...)` calls; keep
`relationshipsUsed` as metadata/evidence for review and inspection. Do not
flatten this into one bare `field` unless all subscribed queries truly use the
same source-bearing field.

## Planner-Emitted Relationship Filters

When `semaphor_plan_data_app` returns planned inputs, use them directly. A
planned input may include:

- `relationshipHint`: relationship ids the runtime should use to disambiguate
  role-playing or alternate paths;
- `relationshipsUsed`: evidence to show or inspect why the filter is valid;
  do not pass this object to `semaphor.bindInput(...)`;
- `optionQuery.population`: a related population that constrains options
  through a base fact/source;
- `optionQuery.dependencies`: dependency behavior for cascading option lists.

Example shape:

```tsx
const campaignFilter = semaphor.filter({
  id: "filter_campaign_id",
  label: "Campaign",
  field: campaignIdFromPlanner,
  operator: "in",
  relationshipHint: { relationshipIds: ["orders_campaigns"] },
});

const campaignOptions = semaphor.inputOptions({
  id: "filter_campaign_id_options",
  inputId: "filter_campaign_id",
  source: campaignSourceFromPlanner,
  labelField: campaignNameFromPlanner,
  valueField: campaignIdFromPlanner,
  population: {
    kind: "related_population",
    baseSource: ordersSourceFromPlanner,
    relationshipHint: { relationshipIds: ["orders_campaigns"] },
  },
  limit: 100,
});
```

Pass the bound `campaignFilter` handle only to planned views whose ids appear
in `input.appliesToViewIds`. Do not implement relationship-aware filtering by
joining data in React or filtering a fetched table client-side.

If the planned input includes `bindings[]`, pass the visible input handle
through `semaphor.bindInput(handle, binding)` for each subscribed query rather
than passing the raw handle unchanged. This preserves source-specific fields
and relationship hints when the same control filters multiple datasets.

For dimensions such as Facility, Customer, Region, State, or Product that come
from a dimension table, a valid option query is not enough. Each KPI, chart, or
table that subscribes to that input must still have a same-source field or a
modeled relationship path to that dimension. If one fact table cannot be
related to the dimension, leave that view unfiltered by the input and call out
the semantic-model relationship gap instead of forcing a broken global filter.

If the user asks for a broad filter such as material type, process type, index
type, customer, or facility and the model supports it for only some planned
views, generate either a scoped filter UI or a plan limitation. Examples:

- Material type supported for sales and purchases but not processing inputs:
  render it as a Sales/Purchases section filter, or say the processing-input
  material relationship must be modeled before that card can subscribe.
- Process type supported through processing runs only: render it with the
  processing-run cards, not as a dashboard-wide financial filter.
- Market index supported only by market price rows: render it inside or beside
  Market exposure, not as a top-level control for unrelated KPIs.

## SQL Params

Use `semaphor.sqlParam` for SQL template parameters such as limits, thresholds,
or fixed report switches. Pair it with bounded defaults:

```tsx
const limit = semaphor.sqlParam({
  id: "limit",
  label: "Rows",
  defaultValue: 100,
});
```

Use `defaultParameters` on `semaphor.sql(...)` only for static fallback values.
Do not concatenate values into SQL strings in React.
