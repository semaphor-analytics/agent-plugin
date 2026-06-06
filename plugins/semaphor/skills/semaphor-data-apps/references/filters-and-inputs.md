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

## Option Query Contract

When a visible select, combobox, multi-select, typeahead, or filter menu needs
choices from Semaphor data, generate a `semaphor.inputOptions(...)` query and
execute it with `useSemaphorQuery(...)`.

Do not use `semaphor.records(...)` to fetch broad lookup rows and derive option
lists in React. That hides the query's intent from Semaphor DevTools, makes
agent review ambiguous, and pushes filter semantics into app-local code.

Use `semaphor.records(...)` only when the row set itself is app content, such
as a table, chart, KPI backing query, or detail/lookup panel that the user
reads directly. If an option-loading case genuinely cannot be expressed with
`inputOptions`, keep the `records` workaround narrow and report the SDK gap and
workaround in the final response.

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

  // Render controls from states.options and facilities.options.
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
```

If the planner returns `input.bindings[]`, each binding is a server-side
subscription target. Preserve its `fieldRef`, `relationshipHint`,
`relationshipsUsed`, and `appliesToViewIds` in codegen. Do not flatten this
into one bare `field` unless all subscribed queries truly use the same
source-bearing field.

## Planner-Emitted Relationship Filters

When `semaphor_plan_data_app` returns planned inputs, use them directly. A
planned input may include:

- `relationshipHint`: relationship ids the runtime should use to disambiguate
  role-playing or alternate paths;
- `relationshipsUsed`: evidence to show or inspect why the filter is valid;
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
