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
  "timeWindow": { "kind": "periods", "unit": "quarter", "from": -1, "to": -1, "anchor": "now" },
  "limit": 20
}
```

- `measures` is required. To count rows, use the `__count` measure.
- Fields from related datasets use source-bearing refs (`datasetName`); the
  semantic model resolves the joins.
- Comparisons: `"comparison": { "kind": "previous_period" }` or
  `"previous_year"`; add `"driverMode": "all"` to see which dimension values
  drove the change.
- Spikes and declines over time: `"analysis": { "kind": "period_change" }`.
- Share of total: `"includePopulation": true`.
- `responseDetail: "compact"` trims large payloads.

## Date windows

A `timeWindow` takes one of four shapes. They are the windows a dashboard's
date filter offers.

| Shape | Counts | Example |
| --- | --- | --- |
| `{ "kind": "periods", "unit", "from", "to", "anchor" }` | whole days, weeks, months, quarters or years | the last 3 complete months: `"unit": "month", "from": -3, "to": -1` |
| `{ "kind": "rolling", "unit", "n", "anchor" }` | elapsed time, back from the anchor | the last 14 days: `"unit": "day", "n": 14` |
| `{ "kind": "monthDay", "day": "first" }` or `"last"` | one day of the current month | the last day of this month |
| `{ "kind": "absolute", "start", "end" }` | fixed dates or timestamps | `"start": "2025-01-01", "end": "2025-12-31"` |

**Periods.** `0` is the period the anchor falls in, and `-1` the one before
it. `from` is at most `to`.

- This month: `"from": 0, "to": 0`. Month to date: add `"toDate": true`
  (only with `"to": 0`).
- Last month: `"from": -1, "to": -1`. Last calendar year:
  `"unit": "year", "from": -1, "to": -1`.
- The last 6 complete months: `"from": -6, "to": -1`. The current month and
  the 5 before it: `"from": -5, "to": 0`.

**Rolling.** Units are minute, hour, day, week, month, quarter and year.
Minutes and hours are always rolling: there are no whole-minute or whole-hour
periods, and windows don't count seconds.

**Choosing between them.** Calendar words ("last month", "this quarter",
"year to date", "the last 3 complete months") are periods. "The last 14 days"
or "the past 24 hours", asked as a question you answer now, is elapsed time:
rolling. When it isn't clear whether today counts, the readings differ:
`"unit": "day", "from": -29, "to": 0` includes today so far, and
`"from": -30, "to": -1` is the last 30 complete days. Ask the user which.

**The anchor is required** on a periods or rolling window. It says where the
window counts from:

- `"now"`: the moment the query runs.
- `"latest_data"`: the newest row the query can see. Use it when the data
  stops before today and the user means "the latest 6 months of data".
- `{ "lastComplete": "<unit>" }` (periods only): the end of the last complete
  period of that unit.

Year to last completed month runs from January 1 through the end of last
month (in January, all of last year):

```json
{ "kind": "periods", "unit": "year", "from": 0, "to": 0, "toDate": true, "anchor": { "lastComplete": "month" } }
```

Year to date anchored at `"now"` is a different window: it includes the
current, partial month.

A window in any other shape (a `value` or `completeness` key,
`"kind": "calendar"`) is refused. Every refused window comes back with a
`fix` that names the window or windows to send instead: send one of them.
When the fix ends "Ask the user which.", the readings differ in meaning, so
ask; don't pick.

## Reading the answer

Read `answerSummary`, the records, `executionResult.constraints` (every filter
and date window applied, and any it skipped) and any `warnings`.

`metadata.resolvedTimeWindow` is the window that ran:

- `window`: the window as asked, in the form you would send to get it again;
- `label` and `definition`: its name ("Year to last completed month") and
  what it covers;
- `start`, `end` and `timezone`: the bounds it ran with. Quote these dates
  when you state the period;
- `latestData`: the newest row it counted back from, for a `"latest_data"`
  window.

These are the window's own bounds. Another date filter that narrows the rows
is its own entry in `executionResult.constraints`.

A period change reports the same fields in `metadata.timeWindow`. A
comparison (previous period, previous year, drivers) reports its window
without `start` and `end`: the dates it compared are its `comparison_window`
entries in `executionResult.constraints`. A `"latest_data"` window over rows
that match nothing has no bounds. Quote the dates you are given; don't work
them out.

**A period change with no changes** (`"analysis": { "kind": "period_change" }`
with an empty `changes`) carries `metadata.noChanges`: a `reason`, a
`message`, and sometimes a `fix`.

- `no_values_in_window`: the measure has no values in the window. The fix may
  suggest counting back from the newest row (`"anchor": "latest_data"`).
- `no_comparable_values`: there are values, but no group also has a value in
  the period it is compared with.
- `no_changes_in_direction`: there are changes, but none in the direction
  asked for. The fix suggests ranking every change.
- `row_limit`: the source query reached its row limit, so the rows may be
  incomplete. Narrow the dimensions or add a filter.

Report the `message`. Never report an empty result as "no change" or "no
data": the reason says what the rows show.

## Windows on a dashboard

In a dashboard's outline (`semaphor_get_dashboard_details` with
`fields: ["outline"]`), a date filter's `defaultPeriod` and a card query's
`timeWindow` are the stored windows, in the shapes above. To change one, send
a window to `semaphor_propose_change`: `defaultPeriod` on `filter.update` (or
`filter.add`), or `timeWindow` in a card's query on `card.add` or
`card.update`. To set a dashboard to year to last completed month, update its
date filter's default:

```json
{ "op": "filter.update", "filterId": "<from the outline>", "defaultPeriod": { "kind": "periods", "unit": "year", "from": 0, "to": 0, "toDate": true, "anchor": { "lastComplete": "month" } } }
```

A saved window follows rules a question doesn't:

- It counts whole periods. A rolling window of a day or longer is refused;
  ask the user whether they mean the current period so far and the ones
  before it, or the last complete periods.
- Minutes and hours need a date field with a time of day.
- A filter's default counts from `"now"` or from a last complete period,
  never from the latest data, and is never fixed dates.

**A read-only window.** `defaultPeriodReadOnly` beside a filter's
`defaultPeriod`, or `timeWindowReadOnly` beside a card's query, marks a stored
window that can't be saved again (for example, a rolling 7-day default saved
before these rules). It holds the reason and the windows that can replace it.
The stored window stays as long as you leave the field out of the change. To
change it, choose one of its suggestions with the user. Don't copy it to
another filter or card: that write is refused the same way.

## `semaphor_matrix`

For pivot tables and hierarchies: rows, columns and measures with semantic
sources. It returns a bounded window with continuation cursors and coverage;
page with the cursors instead of asking for everything at once. A relative
date in its filters (`relativeMeta`) takes the same window shapes.

## When the question doesn't fit

- A failed `semaphor_analyze` result carries `validation` with repair hints
  and valid field candidates. Fix the request from those; don't retry blindly.
- `semaphor_plan_analytics_recovery` plans the next calls from a typed intent
  and the schemas you have.
- If the semantic model lacks the field or relationship the question needs,
  say so, and see [semantic-model.md](semantic-model.md).
