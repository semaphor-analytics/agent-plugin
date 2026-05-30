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
  metrics: [revenue],
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
