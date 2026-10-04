# Answering questions with governed analytics

## The path

```text
semaphor_get_analysis_context
  -> semaphor_list_semantic_domains
  -> semaphor_list_datasets
  -> semaphor_get_dataset_schema
  -> semaphor_analyze  (or semaphor_matrix for pivots)
```

Skip steps you already have answers for in this conversation, but never guess
a dataset or field name.

## `semaphor_analyze`

Pass the agent-friendly fields:

```json
{
  "projectId": "p_...",
  "domainId": "<from list_semantic_domains>",
  "datasetName": "orders",
  "measures": [{ "name": "revenue", "datasetName": "orders" }],
  "dimensions": [{ "name": "region", "datasetName": "customers" }],
  "dateField": { "name": "order_date", "datasetName": "orders" },
  "timeGrain": "month",
  "timeWindow": { "kind": "calendar", "unit": "quarter", "period": "previous" },
  "limit": 20
}
```

- `measures` is required. To count rows, use the `__count` measure.
- Fields from related datasets use source-bearing refs (`datasetName`); the
  semantic model resolves the joins.
- Time windows:
  - rolling: `{ "unit": "month", "value": 6, "anchor": "latest_available" }`;
  - calendar: `{ "kind": "calendar", "unit": "month", "period": "this", "toDate": true }`;
  - fixed: `{ "kind": "absolute", "start": "2025-01-01", "end": "2025-12-31" }`.
- Comparisons: `"comparison": { "kind": "previous_period" }` or
  `"previous_year"`; add `"driverMode": "all"` to see which dimension values
  drove the change.
- Spikes and declines over time: `"analysis": { "kind": "period_change" }`.
- Share of total: `"includePopulation": true`.
- `responseDetail: "compact"` trims large payloads.

Read `answerSummary`, the records, `metadata.timeWindowResolution` (the window
that actually ran) and any `warnings`.

## `semaphor_matrix`

For pivot tables and hierarchies: rows, columns and measures with semantic
sources. It returns a bounded window with continuation cursors and coverage;
page with the cursors instead of asking for everything at once.

## When the question doesn't fit

- A failed `semaphor_analyze` result carries `validation` with repair hints
  and valid field candidates. Fix the request from those; don't retry blindly.
- `semaphor_plan_analytics_recovery` plans the next calls from a typed intent
  and the schemas you have.
- If the semantic model lacks the field or relationship the question needs,
  say so, and see [semantic-model.md](semantic-model.md).
