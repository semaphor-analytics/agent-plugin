# Derived Fields

Use app-local derived fields when a customer needs a calculated metric,
dimension, group, date, id, or filter that is not yet modeled in Semaphor but
should still execute through governed Semaphor query execution.

Derived fields are part of the analytics intent. They are not UI-only helper
values, and they should not be computed only in React when the result affects
analytical correctness, filtering, grouping, totals, or sorting.

## Builder

```tsx
const extendedPrice = semaphor.derivedField({
  name: "extended_price",
  label: "Extended Price",
  resultRole: "measure",
  dataType: "number",
  computeStage: "row",
  expression: "{quantity} * {unit_price}",
  inputs: {
    quantity: { kind: "field", field: quantityField },
    unit_price: { kind: "field", field: unitPriceField },
  },
  defaultAggregate: "SUM",
  aggregationBehavior: "additive",
});
```

Then pass it to a supported SDK query:

```tsx
const revenueQuery = semaphor.metric({
  id: "extended-price-by-region",
  source,
  derivedFields: [extendedPrice],
  metrics: [
    {
      name: "extended_price",
      label: "Extended Price",
      role: "measure",
      dataType: "number",
      aggregate: "SUM",
      source,
    },
  ],
  dimensions: [regionField],
});
```

## Rules

- Use Semaphor MCP metadata to ground every input field before creating a
  derived field.
- `inputs` names must match `{tokens}` used in the expression.
- Every input must come from the same selected Semaphor source unless Semaphor
  adds an explicit cross-source derived-field contract.
- Do not reuse a source/catalog field name for a derived field.
- Row-stage derived measures require `defaultAggregate`.
- Use `aggregationBehavior` when the result has non-obvious aggregation
  semantics, especially ratios, weighted measures, snapshots, or
  non-additive calculations.
- If a derived field should be reusable across many apps, note that it belongs
  in the Semaphor semantic model rather than only in app-local source.

## Compute Stage

- `computeStage: "row"` means compute from row-level values before grouping,
  then aggregate the result. Examples: extended price, gross margin amount,
  normalized status group.
- `computeStage: "aggregate"` means compute after grouping or aggregation.
  Examples: ratio of sums, percent-of-total style outputs, or aggregate-only
  calculations.

Prefer row-stage when the calculation naturally belongs at record grain.
Prefer aggregate-stage when calculating from grouped measures.

## When Not To Use

- Do not use derived fields as a workaround for missing source fields without
  telling the user what semantic-model improvement would make the field
  durable.
- Do not compute governed metrics only in React from already-limited rows.
- Do not use raw SQL just because a small calculated field is needed; use
  `semaphor.derivedField(...)` when the calculation fits the semantic source.
