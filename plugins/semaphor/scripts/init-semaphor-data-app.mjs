#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = { dir: process.cwd(), force: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      args.dir = argv[i + 1];
      i += 1;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function writeFileIfAllowed(filePath, contents, force) {
  const existed = fs.existsSync(filePath);
  if (existed && !force) {
    return { path: filePath, status: 'skipped' };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return { path: filePath, status: existed ? 'written' : 'created' };
}

const providerSource = `import type { ReactNode } from "react";
import {
  SemaphorDataAppProvider,
  SemaphorDevtools,
} from "react-semaphor/data-app-sdk";

export function SemaphorAppProvider({ children }: { children: ReactNode }) {
  const enableDevtools =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && window.location.hostname === "localhost");

  return (
    <SemaphorDataAppProvider
      token={import.meta.env.VITE_SEMAPHOR_PROJECT_TOKEN}
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
`;

const dashboardSource = `import {
  defineSemaphorDataApp,
  semaphor,
  useSemaphorQuery,
} from "react-semaphor/data-app-sdk";
import type {
  SemaphorRecordsField,
  SemaphorResultColumn,
  SemaphorSourceRef,
} from "react-semaphor/data-app-sdk";

const source = {
  kind: "semantic",
  domainId: "replace-with-domain-id",
  datasetName: "replace-with-dataset-name",
  datasetId: "replace-with-dataset-id",
  label: "Replace With Dataset Label",
} satisfies SemaphorSourceRef;

const metricField = {
  name: "replace_with_metric_field",
  role: "measure",
  aggregate: "SUM",
  source,
} satisfies SemaphorRecordsField;

const dimensionField = {
  name: "replace_with_dimension_field",
  role: "dimension",
  source,
} satisfies SemaphorRecordsField;

const dateField = {
  name: "replace_with_date_field",
  role: "date",
  source,
} satisfies SemaphorRecordsField;

const totalMetric = semaphor.metric({
  source,
  id: "total",
  label: "Total",
  measures: [metricField],
  primaryMeasure: metricField,
});

const recordsQuery = semaphor.records({
  source,
  id: "records",
  label: "Records",
  fields: [dimensionField, metricField],
  dateField,
  limit: 50,
});

export const semaphorApp = defineSemaphorDataApp({
  id: "example-semaphor-data-app",
  title: "Semaphor Data App",
  views: [
    { id: "total", title: "Total", query: totalMetric },
    { id: "records", title: "Records", query: recordsQuery },
  ],
});

const fallbackColumns: SemaphorResultColumn[] = [
  {
    key: dimensionField.name,
    name: dimensionField.name,
    label: dimensionField.name,
    role: dimensionField.role,
    source,
  },
  {
    key: metricField.name,
    name: metricField.name,
    label: metricField.name,
    role: metricField.role,
    aggregate: metricField.aggregate,
    source,
  },
];

export function ExampleSemaphorDashboard() {
  const total = useSemaphorQuery(totalMetric);
  const records = useSemaphorQuery(recordsQuery);

  if (total.isLoading || records.isLoading) {
    return <div>Loading Semaphor data...</div>;
  }

  if (total.error || records.error) {
    return <div>Unable to load Semaphor data.</div>;
  }

  return (
    <section>
      <h2>Semaphor Data App</h2>
      <dl>
        <dt>{total.id ?? "Total"}</dt>
        <dd>{total.value ?? "--"}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            {(records.columns?.length ? records.columns : fallbackColumns).map(
              (column) => (
                <th key={column.key}>{column.label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {records.records.map((row, index) => (
            <tr key={index}>
              {(records.columns?.length ? records.columns : fallbackColumns).map(
                (column) => (
                  <td key={column.key}>{formatCell(row[column.key], column)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatCell(value: unknown, column: SemaphorResultColumn) {
  if (column.role === "date" || column.dataType === "date") {
    return typeof value === "string" ? value : "--";
  }
  if (column.role === "measure" || column.dataType === "number") {
    return typeof value === "number" ? value.toLocaleString() : "--";
  }
  return value == null ? "--" : String(value);
}
`;

const manifestSource = `{
  "schemaVersion": "data-app/v1",
  "notes": "Replace placeholder source and field refs with Semaphor MCP-inspected metadata before production use.",
  "sdk": {
    "package": "react-semaphor",
    "subpath": "react-semaphor/data-app-sdk"
  }
}
`;

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: init-semaphor-data-app.mjs [--dir <path>] [--force]');
    process.exit(0);
  }

  const root = path.resolve(args.dir);
  const packageJsonPath = path.join(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`No package.json found at ${packageJsonPath}`);
    process.exit(1);
  }

  const srcRoot = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
  const files = [
    writeFileIfAllowed(path.join(srcRoot, 'semaphor', 'SemaphorAppProvider.tsx'), providerSource, args.force),
    writeFileIfAllowed(path.join(srcRoot, 'semaphor', 'ExampleSemaphorDashboard.tsx'), dashboardSource, args.force),
    writeFileIfAllowed(path.join(root, 'semaphor.data-app.json'), manifestSource, args.force),
  ];

  console.log('Semaphor integration files:');
  for (const file of files) {
    console.log(`- ${file.status}: ${path.relative(root, file.path)}`);
  }
  console.log('');
  console.log('Next steps:');
  console.log('1. Install react-semaphor if it is not already installed.');
  console.log('2. Use Semaphor MCP to inspect project datasets and replace placeholder source/field refs.');
  console.log('3. Mount SemaphorAppProvider near the React route/component using Semaphor data hooks.');
}

main();
