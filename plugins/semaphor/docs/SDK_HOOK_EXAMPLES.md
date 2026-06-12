# Data App SDK Examples

The canonical examples live in the Data Apps documentation:

```text
https://docs.semaphor.cloud/docs/data-apps/agent-builder-guide
```

This bundled page intentionally stays small so it does not become a competing
SDK manual. If this page conflicts with the canonical docs or public
`react-semaphor/data-app-sdk` declarations, follow the canonical source.

## Minimal Provider

```tsx
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
} from "react-semaphor/data-app-sdk";

export function SemaphorProvider({ children }: { children: React.ReactNode }) {
  const runtimeToken = import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN;
  const enableDevtools =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && window.location.hostname === "localhost");

  return (
    <SemaphorDataAppProvider
      token={runtimeToken}
      debug={enableDevtools ? { exposeWindowBridge: true } : false}
    >
      {children}
      <SemaphorDevtools
        initialIsOpen={false}
        buttonPosition="bottom-right"
        panelPosition="right"
      />
    </SemaphorDataAppProvider>
  );
}
```

## Minimal Query

```tsx
import { semaphor, useSemaphorQuery } from "react-semaphor/data-app-sdk";

const orders = semaphor.source.semantic({
  domainId: "domain-id-from-mcp",
  datasetName: "orders",
  datasetId: "dataset-orders",
});

const revenue = {
  name: "revenue",
  label: "Revenue",
  role: "measure",
  dataType: "number",
  aggregate: "SUM",
  source: orders,
} as const;

const revenueQuery = semaphor.metric({
  id: "revenue",
  source: orders,
  measures: [revenue],
  primaryMeasure: revenue,
  comparison: { kind: "previous_period" },
});

export function RevenueKpi() {
  const result = useSemaphorQuery(revenueQuery);

  if (result.isLoading && !result.isStale) return <div>Loading...</div>;
  if (result.error) return <div>{result.error.message}</div>;
  if (result.isEmpty) return <div>No data</div>;

  return (
    <section>
      <strong>{String(result.value ?? "")}</strong>
      {result.isStale ? <span>Refreshing</span> : null}
      {result.isPartial ? <span>Partial result</span> : null}
    </section>
  );
}
```

For generated contracts, prefer the generated `queries`,
`queryOptionsForView`, `rowValuesForView`, and `columnKeysForView` helpers over
handwritten row-key or query-option wiring.
