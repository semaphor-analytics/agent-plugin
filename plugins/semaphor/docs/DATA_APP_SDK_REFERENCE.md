# Data App SDK Reference For Agents

This page is a bundled fallback snapshot. The canonical Data App SDK authoring
guide is:

```text
https://docs.semaphor.cloud/docs/data-apps/agent-builder-guide
```

Use the canonical docs and the public `react-semaphor/data-app-sdk` TypeScript
declarations as the source of truth. This plugin page exists only so installed
agents have a compact offline reference when docs are unavailable.

| Field | Value |
| --- | --- |
| Offline fallback | `skills/semaphor-data-apps/references/sdk-contract.md` |

## Durable Rules

- Import SDK APIs from `react-semaphor/data-app-sdk`.
- Wrap runtime app surfaces in `SemaphorDataAppProvider`.
- Use `semaphor.metric`, `semaphor.records`, `semaphor.matrix`,
  `semaphor.analysis`, and `semaphor.sql` instead of custom fetchers.
- Use `measures` and `primaryMeasure`; do not emit `metrics` or
  `primaryMetric`.
- Use `analysis: { kind: "period_change" }`; do not emit `analysisMode`.
- Use structured comparison objects such as
  `comparison: { kind: "previous_period" }`.
- Semantic sources require `domainId` and `datasetName`; `datasetId` is
  optional strengthening metadata.
- SQL sources use `connectionId`, optional `dialect`, and optional `label`.
- Render rows through `columns[].key`.
- Treat `executionResult` as the authoritative governed result. Top-level
  analysis fields are display conveniences.
- Read analysis row sets from `result.resultSets?.<name>.records`.
- Validate before save or publish with the plugin validator.

For examples, use the canonical docs first. When offline, read
`skills/semaphor-data-apps/references/sdk-contract.md`.
