#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateContractUpdatePolicy } from "./data-app-contract-update-policy.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const generatorPath = path.join(scriptDir, "generate-data-app-contract.mjs");
const validatorPath = path.join(scriptDir, "validate-semaphor-data-app.mjs");

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "semaphor-generator-fixture-"),
);

try {
  runValidPartialScopeFixture();
  runAggregateRecordsAccessorFixture();
  runNoFilterFixture();
  runTableBehaviorFixture();
  runMalformedSummaryFixture();
  runRootLevelSummaryIssuePathFixture();
  runMalformedIdentityFixture();
  runDatasetIdOnlySourceFixture();
  runExecutableFieldsOnPresentationViewFixture();
  runMalformedSdkSpecFixture();
  runQueryKindDivergenceFixture();
  runUnsupportedMetricSpecKeysFixture();
  runMalformedOptionalSdkFieldRefsFixture();
  runMalformedSdkFiltersFixture();
  runMalformedSortDirectionsFixture();
  runSqlMatrixSourceFixture();
  runMalformedMatrixSpecFixture();
  runMalformedAnalysisOptionsFixture();
  runNumericViewScopeIdsFixture();
  runMissingFilterInputIdFixture();
  runFilterBindingScopeConflictFixture();
  runPresentationFilterScopeFixture();
  runMalformedManifestFixture();
  runStructuredValidationFixtures();
  await runLiveFilterEffectSuccessValidationFixture();
  await runLiveGeneratedViewsRequestShapeValidationFixture();
  runLiveGeneratedViewsMissingTokenValidationFixture();
  runLiveGeneratedViewsFetchFailureValidationFixture();
  runContractUpdatePolicyFixture();
  console.log("Semaphor generator fixture tests passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runValidPartialScopeFixture() {
  const workspaceDir = path.join(tempRoot, "valid-partial-scope");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `Expected valid generator fixture to pass:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true || parsed.executableViewCount !== 3) {
    throw new Error(`Unexpected generator result: ${result.stdout}`);
  }

  const metadataPath = path.join(
    workspaceDir,
    "src/semaphor/generated/metadata.ts",
  );
  const metadataText = fs.readFileSync(metadataPath, "utf8");
  if (
    !metadataText.includes("export type SemaphorGeneratedFilterContract") ||
    !metadataText.includes(
      "generatedFilterContracts: readonly SemaphorGeneratedFilterContract[]",
    )
  ) {
    throw new Error(
      "Generated metadata must type generatedFilterContracts explicitly.",
    );
  }
  const manifestPath = path.join(
    workspaceDir,
    "src/semaphor/generated/contract.manifest.json",
  );
  const firstManifestText = fs.readFileSync(manifestPath, "utf8");
  const firstManifest = JSON.parse(firstManifestText);
  if (
    firstManifest.codegenSummaryValidatorVersion !==
    "semaphor-data-app-codegen-summary-validator/v2"
  ) {
    throw new Error(
      "Contract manifest must persist the codegenSummary validator version.",
    );
  }
  const secondResult = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (secondResult.status !== 0) {
    throw new Error(
      `Expected deterministic regeneration to pass:\n${secondResult.stdout}\n${secondResult.stderr}`,
    );
  }
  const secondManifestText = fs.readFileSync(manifestPath, "utf8");
  if (firstManifestText !== secondManifestText) {
    throw new Error(
      "Contract manifest must be deterministic for the same codegen summary.",
    );
  }
  typecheckGeneratedFilesIfAvailable({ workspaceDir });
}

function runNoFilterFixture() {
  const workspaceDir = path.join(tempRoot, "no-filters");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.inputs = [];
  summary.filterContracts = [];
  summary.views.push(
    {
      id: "commentary",
      title: "Commentary",
      visual: "text_block",
      computation: { kind: "presentation_only" },
    },
    {
      id: "derived_summary",
      title: "Derived Summary",
      computation: {
        kind: "derived",
        upstreamViewId: "sales_kpi",
        derivation: "Read the primary KPI result and render a sentence.",
      },
    },
    {
      id: "unsupported_gap",
      title: "Unsupported Gap",
      computation: {
        kind: "unsupported",
        reason: "missing relationship",
        suggestedModelingFix: "Model the relationship before generating.",
      },
    },
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `Expected no-filter generator fixture to pass:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  if (
    parsed.warnings?.some(
      (warning) =>
        warning.includes("derived_summary") ||
        warning.includes("unsupported_gap"),
    )
  ) {
    throw new Error(
      `Derived and unsupported non-executable views must not be skipped:\n${result.stdout}`,
    );
  }
  const metadataText = fs.readFileSync(
    path.join(workspaceDir, "src/semaphor/generated/metadata.ts"),
    "utf8",
  );
  if (
    !metadataText.includes('"id": "derived_summary"') ||
    !metadataText.includes('"kind": "derived"') ||
    !metadataText.includes('"id": "unsupported_gap"') ||
    !metadataText.includes('"kind": "unsupported"')
  ) {
    throw new Error(
      "Generated metadata must preserve derived and unsupported non-executable views.",
    );
  }
  typecheckGeneratedFilesIfAvailable({ workspaceDir });
}

function runAggregateRecordsAccessorFixture() {
  const workspaceDir = path.join(tempRoot, "aggregate-records-accessor");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const measureWithoutAggregate = {
    ...summary.views[0].fields[0],
  };
  delete measureWithoutAggregate.aggregate;
  summary.views[0] = {
    ...summary.views[0],
    fields: [measureWithoutAggregate],
    sdkSpec: {
      ...summary.views[0].sdkSpec,
      spec: {
        ...summary.views[0].sdkSpec.spec,
        fields: [measureWithoutAggregate],
      },
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `Expected aggregate records accessor fixture to pass:\n${result.stdout}\n${result.stderr}`,
    );
  }
  typecheckGeneratedFilesIfAvailable({ workspaceDir });
  assertAggregateRecordsAccessorBehavior({ workspaceDir });
}

function runTableBehaviorFixture() {
  const workspaceDir = path.join(tempRoot, "table-behavior");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].visual = "table";
  summary.views[0].visualSpec = {
    visualType: "table",
    tableBehavior: {
      tableMode: "server_paginated",
      height: {
        maxPx: 560,
        scroll: "both",
        stickyHeader: true,
      },
      pagination: {
        mode: "server",
        pageSize: 100,
        readsFrom: "result.pagination",
      },
      sorting: {
        mode: "server",
        defaultField: "order_date",
        defaultDirection: "desc",
        resetPageOnChange: true,
      },
      totals: {
        displayedRows: true,
        allFilteredRows: "separate_aggregate_query_required",
      },
      serverSideRequired: true,
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `Expected table behavior fixture to pass:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(workspaceDir, "src/semaphor/generated/contract.manifest.json"),
      "utf8",
    ),
  );
  const tableBehavior =
    manifest.codegenSummary.views[0].visualSpec.tableBehavior;
  if (
    tableBehavior?.pagination?.readsFrom !== "result.pagination" ||
    tableBehavior?.sorting?.defaultDirection !== "desc" ||
    tableBehavior?.totals?.allFilteredRows !==
      "separate_aggregate_query_required"
  ) {
    throw new Error(
      "Generated manifest must preserve full table behavior guidance.",
    );
  }
}

function runMalformedSummaryFixture() {
  const workspaceDir = path.join(tempRoot, "missing-filter-scope");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.filterContracts[0].appliesToViewIds;
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed generator fixture to fail.");
  }
  if (
    !result.stdout.includes(
      "filterContracts.0.appliesToViewIds must be an array",
    )
  ) {
    throw new Error(
      `Malformed fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runRootLevelSummaryIssuePathFixture() {
  const workspaceDir = path.join(tempRoot, "root-level-summary-issue-path");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(null, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected root-level summary issue fixture to fail.");
  }
  const parsed = parseGeneratorJson(result);
  const planIssue = parsed.issues?.find((issue) =>
    issue.message?.includes("Plan artifact must be a Semaphor codegenSummary object"),
  );
  if (!planIssue) {
    throw new Error(
      `Expected root-level summary issue fixture to report plan artifact issue:\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (planIssue.path !== undefined) {
    throw new Error(
      `Root-level plan artifact issue must not report a bogus path:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runMalformedIdentityFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-identities");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.title;
  summary.sources[0] = null;
  delete summary.inputs[0].id;
  delete summary.views[0].id;
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed identity fixture to fail.");
  }
  for (const expectedIssue of [
    "title is required",
    "sources.0 must be an object",
    "inputs.0.id is required",
    "views.0.id is required",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed identity fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runDatasetIdOnlySourceFixture() {
  const workspaceDir = path.join(tempRoot, "dataset-id-only-source");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.sources[0] = {
    sourceKey: "semantic:domain:sales",
    kind: "semantic",
    domainId: "domain",
    datasetId: "dataset-sales",
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected dataset-id-only source fixture to fail.");
  }
  if (
    !result.stdout.includes(
      "sources.0 must include sourceKey or a supported source identity",
    )
  ) {
    throw new Error(
      `Dataset-id-only source fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runExecutableFieldsOnPresentationViewFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "executable-fields-on-presentation-view",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const executableSdkSpec = summary.views[0].sdkSpec;
  summary.views.push({
    id: "derived_summary",
    title: "Derived Summary",
    fields: [],
    queryKind: "metric",
    sdkBuilder: "semaphor.metric",
    sdkSpec: executableSdkSpec,
    computation: {
      kind: "derived",
      upstreamViewId: "sales_kpi",
      derivation: "Read the primary KPI result and render a sentence.",
    },
  });
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected executable fields on presentation view fixture to fail.",
    );
  }
  for (const expectedIssue of [
    "views.3.queryKind is not allowed for non-executable views",
    "views.3.sdkBuilder is not allowed for non-executable views",
    "views.3.sdkSpec is not allowed for non-executable views",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Executable fields on presentation view fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runMalformedSdkSpecFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-sdk-spec");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].queryKind = "records";
  summary.views[0].sdkSpec = {
    builder: "semaphor.metric",
    spec: {
      source: summary.sources[0],
      measures: [summary.views[0].fields[0]],
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed SDK spec fixture to fail.");
  }
  if (!result.stdout.includes("views.0.sdkSpec.builder must match queryKind")) {
    throw new Error(
      `Malformed SDK spec fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = parseGeneratorJson(result);
  assertIssueCode(
    parsed,
    "sdk_builder_query_kind_mismatch",
    result,
    "malformed SDK spec generator",
  );
  assertIssueCode(
    parsed,
    "sdk_builder_declared_builder_mismatch",
    result,
    "malformed SDK spec generator",
  );
}

function runQueryKindDivergenceFixture() {
  const workspaceDir = path.join(tempRoot, "query-kind-divergence");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].computation = {
    kind: "server_query",
    queryKind: "metric",
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected query kind divergence fixture to fail.");
  }
  if (
    !result.stdout.includes(
      "views.0.computation.queryKind must match queryKind",
    )
  ) {
    throw new Error(
      `Query kind divergence fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
  assertIssueCode(
    parseGeneratorJson(result),
    "computation_query_kind_mismatch",
    result,
    "query-kind divergence generator",
  );
}

function runMalformedOptionalSdkFieldRefsFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-optional-sdk-field-refs");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const source = summary.sources[0];
  summary.views[0] = {
    id: "sales_kpi",
    title: "Sales KPI",
    visual: "kpi",
    queryKind: "metric",
    sdkBuilder: "semaphor.metric",
    fields: [summary.views[0].fields[0]],
    sdkSpec: {
      builder: "semaphor.metric",
      spec: {
        source,
        measures: [summary.views[0].fields[0]],
        primaryMeasure: { name: "sales_value" },
        dateField: { name: "order_date" },
        dimensions: [{ name: "region" }],
        orderBy: {
          field: { name: "region" },
          direction: "asc",
        },
      },
    },
  };
  summary.views.push(
    {
      id: "sales_records",
      title: "Sales Records",
      visual: "table",
      queryKind: "records",
      sdkBuilder: "semaphor.records",
      fields: [summary.views[0].fields[0]],
      sdkSpec: {
        builder: "semaphor.records",
        spec: {
          source,
          fields: [summary.views[0].fields[0]],
          dateField: { name: "order_date" },
          orderBy: {
            field: { name: "region" },
            direction: "asc",
          },
        },
      },
    },
    {
      id: "sales_matrix",
      title: "Sales Matrix",
      visual: "matrix",
      queryKind: "matrix",
      sdkBuilder: "semaphor.matrix",
      fields: [summary.views[0].fields[0]],
      sdkSpec: {
        builder: "semaphor.matrix",
        spec: {
          source,
          rows: [{ field: { name: "region", sourceKey: source.sourceKey } }],
          values: [{ field: summary.views[0].fields[0], aggregate: "SUM" }],
          sort: [
            {
              axis: "row",
              direction: "asc",
              by: { kind: "field", field: { name: "region" } },
            },
          ],
        },
      },
    },
  );
  const sqlSource = {
    sourceKey: "sql:conn",
    kind: "sql",
    connectionId: "conn",
  };
  summary.sources.push(sqlSource);
  summary.views.push({
    id: "sql_fallback",
    title: "SQL Fallback",
    visual: "table",
    queryKind: "sql_fallback",
    sdkBuilder: "semaphor.sql",
    fields: [{ name: "sales_value", sourceKey: sqlSource.sourceKey }],
    sdkSpec: {
      builder: "semaphor.sql",
      spec: {
        source: sqlSource,
        sql: "select 1 as sales_value",
        fields: [{ name: "sales_value" }],
      },
    },
  });
  summary.filterContracts[0].notAppliedToViewIds = [
    "margin_kpi",
    "sales_records",
    "sales_matrix",
    "sql_fallback",
  ];
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected malformed optional SDK field refs fixture to fail.",
    );
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.primaryMeasure must include source or sourceKey",
    "views.0.sdkSpec.spec.dateField must include source or sourceKey",
    "views.0.sdkSpec.spec.dimensions.0 must include source or sourceKey",
    "views.0.sdkSpec.spec.orderBy.field must include source or sourceKey",
    "views.3.sdkSpec.spec.dateField must include source or sourceKey",
    "views.3.sdkSpec.spec.orderBy.field must include source or sourceKey",
    "views.4.sdkSpec.spec.sort.0.by.field must include source or sourceKey",
    "views.5.sdkSpec.spec.fields.0 must include source or sourceKey",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed optional SDK field refs fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runUnsupportedMetricSpecKeysFixture() {
  const workspaceDir = path.join(tempRoot, "unsupported-metric-spec-keys");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].queryKind = "metric";
  summary.views[0].sdkBuilder = "semaphor.metric";
  summary.views[0].sdkSpec = {
    builder: "semaphor.metric",
    spec: {
      source: summary.sources[0],
      measures: [summary.views[0].fields[0]],
      filters: [],
      timeWindow: { unit: "day", value: 30 },
      analysis: { kind: "period_change" },
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected unsupported metric spec keys fixture to fail.");
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.timeWindow is not supported for this SDK builder",
    "views.0.sdkSpec.spec.analysis is not supported for this SDK builder",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Unsupported metric spec keys fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runMalformedSdkFiltersFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-sdk-filters");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const source = summary.sources[0];
  const measure = summary.views[0].fields[0];
  summary.views = [
    {
      id: "sales_metric",
      title: "Sales Metric",
      visual: "kpi",
      queryKind: "metric",
      sdkBuilder: "semaphor.metric",
      fields: [measure],
      sdkSpec: {
        builder: "semaphor.metric",
        spec: {
          source,
          measures: [measure],
          filters: [{ field: { name: "segment" }, values: ["Enterprise"] }],
        },
      },
    },
    {
      id: "sales_change",
      title: "Sales Change",
      visual: "table",
      queryKind: "analysis",
      sdkBuilder: "semaphor.analysis",
      fields: [measure],
      sdkSpec: {
        builder: "semaphor.analysis",
        spec: {
          source,
          measures: [measure],
          filters: [{ field: { name: "segment" }, values: ["Enterprise"] }],
        },
      },
    },
    {
      id: "sales_records",
      title: "Sales Records",
      visual: "table",
      queryKind: "records",
      sdkBuilder: "semaphor.records",
      fields: [measure],
      sdkSpec: {
        builder: "semaphor.records",
        spec: {
          source,
          fields: [measure],
          filters: [{ field: { name: "segment" }, values: ["Enterprise"] }],
        },
      },
    },
    {
      id: "sales_matrix",
      title: "Sales Matrix",
      visual: "matrix",
      queryKind: "matrix",
      sdkBuilder: "semaphor.matrix",
      fields: [measure],
      sdkSpec: {
        builder: "semaphor.matrix",
        spec: {
          source,
          rows: [{ field: { name: "segment", sourceKey: source.sourceKey } }],
          values: [{ field: measure, aggregate: "SUM" }],
          filters: [{ field: { name: "segment" }, values: ["Enterprise"] }],
        },
      },
    },
  ];
  summary.filterContracts[0].notAppliedToViewIds = [
    "margin_kpi",
    "sales_analysis",
    "sales_matrix_missing_direction",
    "sales_records",
    "sales_matrix",
  ];
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed SDK filters fixture to fail.");
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.filters.0.field must include source or sourceKey",
    "views.1.sdkSpec.spec.filters.0.field must include source or sourceKey",
    "views.2.sdkSpec.spec.filters.0.field must include source or sourceKey",
    "views.3.sdkSpec.spec.filters.0.field must include source or sourceKey",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed SDK filters fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runMalformedSortDirectionsFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-sort-directions");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const source = summary.sources[0];
  const measure = summary.views[0].fields[0];
  const dimension = {
    name: "region",
    role: "dimension",
    dataType: "string",
    sourceKey: source.sourceKey,
  };
  summary.views = [
    {
      id: "sales_kpi",
      title: "Sales KPI",
      visual: "kpi",
      queryKind: "metric",
      sdkBuilder: "semaphor.metric",
      fields: [measure, dimension],
      sdkSpec: {
        builder: "semaphor.metric",
        spec: {
          source,
          measures: [measure],
          orderBy: {
            field: dimension,
            direction: "sideways",
          },
        },
      },
    },
    {
      id: "sales_records",
      title: "Sales Records",
      visual: "table",
      queryKind: "records",
      sdkBuilder: "semaphor.records",
      fields: [measure, dimension],
      sdkSpec: {
        builder: "semaphor.records",
        spec: {
          source,
          fields: [measure, dimension],
          orderBy: {
            field: dimension,
            direction: "later",
          },
        },
      },
    },
    {
      id: "sales_analysis",
      title: "Sales Analysis",
      visual: "table",
      queryKind: "analysis",
      sdkBuilder: "semaphor.analysis",
      fields: [measure, dimension],
      sdkSpec: {
        builder: "semaphor.analysis",
        spec: {
          source,
          measures: [measure],
          orderBy: {
            field: dimension,
          },
        },
      },
    },
    {
      id: "sales_matrix_missing_direction",
      title: "Sales Matrix Missing Direction",
      visual: "matrix",
      queryKind: "matrix",
      sdkBuilder: "semaphor.matrix",
      fields: [measure, dimension],
      sdkSpec: {
        builder: "semaphor.matrix",
        spec: {
          source,
          rows: [{ field: dimension }],
          values: [{ field: measure, aggregate: "SUM" }],
          sort: [
            {
              axis: "row",
              by: { kind: "field", field: dimension },
            },
          ],
        },
      },
    },
    {
      id: "sales_matrix",
      title: "Sales Matrix",
      visual: "matrix",
      queryKind: "matrix",
      sdkBuilder: "semaphor.matrix",
      fields: [measure, dimension],
      sdkSpec: {
        builder: "semaphor.matrix",
        spec: {
          source,
          rows: [{ field: dimension }],
          values: [{ field: measure, aggregate: "SUM" }],
          sort: [
            {
              axis: "row",
              direction: "sideways",
              by: { kind: "field", field: dimension },
            },
          ],
        },
      },
    },
  ];
  summary.filterContracts[0].notAppliedToViewIds = [
    "margin_kpi",
    "sales_records",
    "sales_matrix",
  ];
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed sort directions fixture to fail.");
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.orderBy.direction must be asc or desc",
    "views.1.sdkSpec.spec.orderBy.direction must be asc or desc",
    "views.2.sdkSpec.spec.orderBy.direction must be asc or desc",
    "views.3.sdkSpec.spec.sort.0.direction must be asc or desc",
    "views.4.sdkSpec.spec.sort.0.direction must be asc or desc",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed sort directions fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runMalformedMatrixSpecFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-matrix-spec");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0] = {
    id: "sales_matrix",
    title: "Sales Matrix",
    visual: "matrix",
    queryKind: "matrix",
    sdkBuilder: "semaphor.matrix",
    fields: [],
    sdkSpec: {
      builder: "semaphor.matrix",
      spec: {
        source: summary.sources[0],
        rows: [{}],
        columns: [{}],
        values: [{}],
      },
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed matrix spec fixture to fail.");
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.rows.0.field must be an object",
    "views.0.sdkSpec.spec.columns.0.field must be an object",
    "views.0.sdkSpec.spec.values.0.field must be an object",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed matrix spec fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runSqlMatrixSourceFixture() {
  const workspaceDir = path.join(tempRoot, "sql-matrix-source");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const measure = summary.views[0].fields[0];
  const dimension = {
    name: "region",
    role: "dimension",
    dataType: "string",
    sourceKey: summary.sources[0].sourceKey,
  };
  const sqlSource = {
    sourceKey: "sql:conn",
    kind: "sql",
    connectionId: "conn",
  };
  summary.sources.push(sqlSource);
  summary.views[0] = {
    id: "sql_matrix",
    title: "SQL Matrix",
    visual: "matrix",
    queryKind: "matrix",
    sdkBuilder: "semaphor.matrix",
    fields: [measure, dimension],
    sdkSpec: {
      builder: "semaphor.matrix",
      spec: {
        source: sqlSource,
        rows: [{ field: dimension }],
        values: [{ field: measure, aggregate: "SUM" }],
      },
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected SQL matrix source fixture to fail.");
  }
  const expectedIssue =
    "views.0.sdkSpec.spec.source.kind must be semantic or physical";
  if (!result.stdout.includes(expectedIssue)) {
    throw new Error(
      `SQL matrix source fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runMalformedAnalysisOptionsFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-analysis-options");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0] = {
    id: "sales_change",
    title: "Sales Change",
    visual: "table",
    queryKind: "analysis",
    sdkBuilder: "semaphor.analysis",
    fields: [summary.views[0].fields[0]],
    sdkSpec: {
      builder: "semaphor.analysis",
      spec: {
        source: summary.sources[0],
        measures: [summary.views[0].fields[0]],
        driverMode: "fastest",
        includePopulation: "yes",
        calendarContext: {
          tz: 123,
          weekStart: 7,
          anchor: {},
        },
      },
    },
  };
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected malformed analysis options fixture to fail.");
  }
  for (const expectedIssue of [
    "views.0.sdkSpec.spec.driverMode must be a supported analysis driver mode",
    "views.0.sdkSpec.spec.includePopulation must be a boolean",
    "views.0.sdkSpec.spec.calendarContext.tz must be a string",
    "views.0.sdkSpec.spec.calendarContext.weekStart must be an integer between 0 and 6",
    "views.0.sdkSpec.spec.calendarContext.anchor must be now or { iso }",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Malformed analysis options fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runNumericViewScopeIdsFixture() {
  const workspaceDir = path.join(tempRoot, "numeric-view-scope-ids");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.inputs[0].appliesToViewIds = [123];
  summary.filterContracts[0].appliesToViewIds = [123];
  summary.filterContracts[0].notAppliedToViewIds = [456];
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected numeric view scope ids fixture to fail.");
  }
  for (const expectedIssue of [
    "inputs.0.appliesToViewIds must be an array of strings",
    "filterContracts.0.appliesToViewIds must be an array of strings",
    "filterContracts.0.notAppliedToViewIds must be an array of strings",
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(
        `Numeric view scope ids fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
}

function runMissingFilterInputIdFixture() {
  const workspaceDir = path.join(tempRoot, "missing-filter-input-id");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.filterContracts[0].inputId;
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected missing filter input id fixture to fail.");
  }
  if (!result.stdout.includes("filterContracts.0.inputId is required")) {
    throw new Error(
      `Missing filter input id fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runFilterBindingScopeConflictFixture() {
  const workspaceDir = path.join(tempRoot, "filter-binding-scope-conflict");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.filterContracts[0].bindings[0].viewId = "margin_kpi";
  summary.filterContracts[0].notAppliedToViewIds = ["margin_kpi"];
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected filter binding scope conflict fixture to fail.");
  }
  if (
    !result.stdout.includes(
      "filterContracts.0.bindings.0.viewId must be included in appliesToViewIds",
    )
  ) {
    throw new Error(
      `Filter binding scope conflict fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runPresentationFilterScopeFixture() {
  const workspaceDir = path.join(tempRoot, "presentation-filter-scope");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views.push({
    id: "explanation",
    title: "Explanation",
    visual: "text_block",
    fields: [],
    computation: { kind: "presentation_only" },
  });
  summary.filterContracts[0].appliesToViewIds = ["explanation"];
  summary.filterContracts[0].bindings[0].viewId = "explanation";
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error("Expected presentation filter-scope fixture to fail.");
  }
  if (!result.stdout.includes("must reference an executable generated view")) {
    throw new Error(
      `Presentation filter-scope fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runMalformedManifestFixture() {
  const workspaceDir = path.join(tempRoot, "malformed-manifest");
  const generatedDir = path.join(workspaceDir, "src/semaphor/generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  for (const fileName of [
    "sources.ts",
    "fields.ts",
    "inputs.ts",
    "queries.ts",
    "bindings.ts",
    "accessors.ts",
    "metadata.ts",
    "index.ts",
  ]) {
    fs.writeFileSync(path.join(generatedDir, fileName), "// fixture\n");
  }
  fs.writeFileSync(
    path.join(generatedDir, "contract.manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "semaphor-generated-data-app-contract-manifest/v1",
        generatedContractSchemaVersion:
          "semaphor-generated-data-app-contract/v1",
        generatedContentHash: "sha256:not-real",
        codegenSummaryHash: "sha256:not-real",
      },
      null,
      2,
    ),
  );

  const result = spawnSync(
    process.execPath,
    [validatorPath, "--dir", workspaceDir, "--no-run"],
    {
      cwd: pluginRoot,
      encoding: "utf8",
    },
  );
  if (result.status === 0) {
    throw new Error("Expected malformed manifest fixture to fail.");
  }
  if (
    !result.stdout.includes(
      "codegenSummary.Plan artifact must be a Semaphor codegenSummary object",
    ) ||
    result.stderr.includes("ERR_INVALID_ARG_TYPE")
  ) {
    throw new Error(
      `Malformed manifest fixture failed unclearly:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runStructuredValidationFixtures() {
  runMissingPackageJsonValidationFixture();
  runMalformedPackageJsonValidationFixture();
  runMissingProviderValidationFixture();
  runMissingGeneratedContractValidationFixture();
  runGeneratedContractNotImportedValidationFixture();
  runMalformedManifestJsonValidationFixture();
  runFilterEffectValidationFixture();
  runLiveFilterEffectMissingTokenValidationFixture();
  runLiveFilterEffectFetchFailureValidationFixture();
  runVerboseSuccessfulBuildValidationFixture();
}

function runMissingPackageJsonValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-missing-package-json");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const result = runValidatorJson({ workspaceDir });
  if (result.status === 0) {
    throw new Error(
      "Expected missing-package-json validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "missing_package_json",
    result,
    "missing-package-json validation",
  );
}

function runMalformedPackageJsonValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-malformed-package-json");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "package.json"), "{ nope");

  const result = runValidatorJson({ workspaceDir });
  if (result.status === 0) {
    throw new Error(
      "Expected malformed-package-json validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "invalid_package_json",
    result,
    "malformed-package-json validation",
  );
}

function runMissingProviderValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-missing-provider");
  fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(workspaceDir, "src/App.tsx"),
    [
      'import { semaphor, useSemaphorQuery } from "react-semaphor/data-app-sdk";',
      'const query = semaphor.metric({ source: { kind: "semantic", domainId: "domain", datasetName: "sales" }, metrics: [{ name: "sales" }] });',
      "export function App() { useSemaphorQuery(query); return null; }",
    ].join("\n"),
  );

  const result = runValidatorJson({ workspaceDir });
  if (result.status === 0) {
    throw new Error("Expected missing-provider validation fixture to fail.");
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "missing_provider",
    result,
    "missing-provider validation",
  );
}

function runMissingGeneratedContractValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-missing-generated-contract",
  );
  const generatedDir = path.join(workspaceDir, "src/semaphor/generated");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(generatedDir, "sources.ts"),
    "// incomplete fixture\n",
  );

  const result = runValidatorJson({ workspaceDir });
  if (result.status === 0) {
    throw new Error(
      "Expected missing-generated-contract validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "missing_generated_contract",
    result,
    "missing-generated-contract validation",
  );
}

function runGeneratedContractNotImportedValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-generated-contract-not-imported",
  );
  fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected generated-contract-not-imported fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  fs.writeFileSync(
    path.join(workspaceDir, "src/App.tsx"),
    [
      'import { SemaphorDataAppProvider, SemaphorDevtools, semaphor, useSemaphorQuery } from "react-semaphor/data-app-sdk";',
      'const query = semaphor.records({ source: { kind: "semantic", domainId: "domain", datasetName: "sales" }, fields: [{ name: "sales_value" }] });',
      "function Dashboard() { useSemaphorQuery(query); return null; }",
      "export function App() {",
      "  return <SemaphorDataAppProvider config={{ projectToken: 'fixture', apiBaseUrl: 'https://example.invalid', exposeWindowBridge: true }}><SemaphorDevtools /><Dashboard /></SemaphorDataAppProvider>;",
      "}",
    ].join("\n"),
  );

  const result = runValidatorJson({ workspaceDir });
  if (result.status === 0) {
    throw new Error(
      "Expected generated-contract-not-imported validation fixture to fail.",
    );
  }
  assertIssueCode(
    parseValidationJson(result),
    "generated_contract_not_imported",
    result,
    "generated-contract-not-imported validation",
  );
}

function runMalformedManifestJsonValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-malformed-manifest-json",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected malformed-manifest fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  fs.writeFileSync(
    path.join(workspaceDir, "src/semaphor/generated/contract.manifest.json"),
    "{ nope",
  );

  const snapshotPath = path.join(workspaceDir, "devtools-snapshot.json");
  fs.writeFileSync(snapshotPath, JSON.stringify({ traces: [] }, null, 2));
  const devtoolsResult = runValidatorJson({
    workspaceDir,
    extraArgs: ["--devtools-snapshot", snapshotPath],
  });
  if (devtoolsResult.status === 0) {
    throw new Error(
      "Expected malformed-manifest DevTools validation fixture to fail.",
    );
  }
  assertIssueCode(
    parseValidationJson(devtoolsResult),
    "invalid_contract_manifest",
    devtoolsResult,
    "malformed-manifest DevTools validation",
  );

  const reportPath = path.join(workspaceDir, "filter-effect-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ checks: [] }, null, 2));
  const filterEffectResult = runValidatorJson({
    workspaceDir,
    extraArgs: ["--filter-effect-report", reportPath],
  });
  if (filterEffectResult.status === 0) {
    throw new Error(
      "Expected malformed-manifest filter-effect validation fixture to fail.",
    );
  }
  assertIssueCode(
    parseValidationJson(filterEffectResult),
    "invalid_contract_manifest",
    filterEffectResult,
    "malformed-manifest filter-effect validation",
  );
}

function runFilterEffectValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-filter-effect");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected filter-effect fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  const reportPath = path.join(workspaceDir, "filter-effect-report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        checks: [
          {
            inputId: "date_range",
            passed: false,
            changedQueryIds: [],
            reranQueryIds: [],
            affectedViewIds: [],
            changedViewIds: [],
          },
        ],
      },
      null,
      2,
    ),
  );

  const result = runValidatorJson({
    workspaceDir,
    extraArgs: ["--filter-effect-report", reportPath],
  });
  if (result.status === 0) {
    throw new Error("Expected filter-effect validation fixture to fail.");
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "filter_effect_failed",
    result,
    "filter-effect validation",
  );
  const filterIssue = parsed.issues.find(
    (issue) => issue.code === "filter_effect_failed",
  );
  if (!filterIssue?.path?.includes("date_range")) {
    throw new Error(
      `Expected filter-effect issue path to reference date_range:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runLiveFilterEffectMissingTokenValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-live-filter-effect");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live filter-effect fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }

  const env = { ...process.env };
  delete env.VITE_SEMAPHOR_PROJECT_TOKEN;
  delete env.SEMAPHOR_PROJECT_TOKEN;
  const result = runValidatorJson({
    workspaceDir,
    extraArgs: ["--live-filter-effect"],
    env,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected live filter-effect missing-token validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "filter_effect_failed",
    result,
    "live filter-effect missing-token validation",
  );
}

function runLiveFilterEffectFetchFailureValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-live-filter-effect-fetch-failure",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live filter-effect fetch-failure fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }

  const env = { ...process.env };
  delete env.VITE_SEMAPHOR_API_SERVICE_URL;
  delete env.SEMAPHOR_API_SERVICE_URL;
  delete env.NEXT_PUBLIC_API_SERVICE_URL;
  delete env.VITE_SEMAPHOR_SERVER_URL;
  delete env.NEXT_PUBLIC_SEMAPHOR_SERVER_URL;
  env.VITE_SEMAPHOR_PROJECT_TOKEN = "not-a-real-token";
  env.SEMAPHOR_PROJECT_TOKEN = "not-a-real-token";
  env.SEMAPHOR_SERVER_URL = "http://127.0.0.1:9";
  const result = runValidatorJson({
    workspaceDir,
    extraArgs: ["--live-filter-effect"],
    env,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected live filter-effect fetch-failure validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "filter_effect_failed",
    result,
    "live filter-effect fetch-failure validation",
  );
}

async function runLiveFilterEffectSuccessValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-live-filter-effect-success",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live filter-effect success fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  writeMinimalRuntimeApp(workspaceDir);

  const server = await startFixtureExecuteServer(({ body }) => {
    if (body?.intent?.kind === "inputOptions") {
      return {
        options: [{ label: "Facility A", value: 101 }],
      };
    }
    return {
      records: body?.activeInputs?.length
        ? [{ value: 50 }]
        : [{ value: 100 }],
      rowCount: 1,
    };
  });
  try {
    const env = liveValidationEnv(server.url);
    const result = await runValidatorJsonAsync({
      workspaceDir,
      extraArgs: ["--live-filter-effect"],
      env,
    });
    if (result.status !== 0) {
      throw new Error(
        `Expected live filter-effect success validation to pass:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const parsed = parseValidationJson(result);
    if (parsed.ok !== true) {
      throw new Error(
        `Expected live filter-effect success validation to return ok true:\n${result.stdout}\n${result.stderr}`,
      );
    }
  } finally {
    await server.close();
  }
}

async function runLiveGeneratedViewsRequestShapeValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-live-generated-views-request-shape",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summary = validSummary();
  const analysisView = summary.views.find((view) => view.id === "sales_analysis");
  if (!analysisView?.sdkSpec?.spec) {
    throw new Error("Expected valid summary to include sales_analysis spec.");
  }
  delete analysisView.sdkSpec.spec.driverMode;
  delete analysisView.sdkSpec.spec.includePopulation;
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live generated-views request-shape fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  writeMinimalRuntimeApp(workspaceDir);

  const server = await startFixtureExecuteServer(({ body }) => {
    if (body?.intent?.id === "sales_analysis") {
      if (body.intent.kind === "analysis") {
        return { error: "analysis must execute as a metric intent" };
      }
      if (
        body.intent.kind !== "metric" ||
        body.resultShape !== "analysis" ||
        !body.analysisOptions ||
        Object.keys(body.analysisOptions).length !== 0 ||
        body.intent.driverMode !== undefined ||
        body.intent.includePopulation !== undefined
      ) {
        return { error: "analysis request shape is not SDK-compatible" };
      }
    }
    return {
      records: [{ value: 1 }],
      rowCount: 1,
    };
  });
  try {
    const env = liveValidationEnv(server.url);
    const result = await runValidatorJsonAsync({
      workspaceDir,
      extraArgs: ["--live-generated-views"],
      env,
    });
    if (result.status !== 0) {
      throw new Error(
        `Expected live generated-views request-shape validation to pass:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const parsed = parseValidationJson(result);
    if (parsed.ok !== true) {
      throw new Error(
        `Expected live generated-views request-shape validation to return ok true:\n${result.stdout}\n${result.stderr}`,
      );
    }
    if (server.requests.length !== 3) {
      throw new Error(
        `Expected one execution request per executable generated view, saw ${server.requests.length}.`,
      );
    }
    for (const request of server.requests) {
      if (
        request.method !== "POST" ||
        request.url !== "/api/v1/data-app/execute"
      ) {
        throw new Error(`Unexpected generated-view request target: ${request.method} ${request.url}`);
      }
      const bodyText = JSON.stringify(request.body);
      if (bodyText.includes("sourceKey")) {
        throw new Error(
          `Expected generated-view execution request to expand sourceKey refs:\n${bodyText}`,
        );
      }
      if (request.body?.intent?.source?.datasetName !== "sales") {
        throw new Error(
          `Expected generated-view execution request to include expanded source:\n${bodyText}`,
        );
      }
    }
    const analysisRequest = server.requests.find(
      (request) => request.body?.intent?.id === "sales_analysis",
    );
    if (!analysisRequest) {
      throw new Error("Expected generated analysis view to be executed.");
    }
    if (
      analysisRequest.body.intent.kind !== "metric" ||
      analysisRequest.body.resultShape !== "analysis" ||
      !analysisRequest.body.analysisOptions ||
      Object.keys(analysisRequest.body.analysisOptions).length !== 0 ||
      analysisRequest.body.intent.driverMode !== undefined ||
      analysisRequest.body.intent.includePopulation !== undefined
    ) {
      throw new Error(
        `Expected analysis view to execute as metric intent plus empty analysisOptions:\n${JSON.stringify(analysisRequest.body, null, 2)}`,
      );
    }
  } finally {
    await server.close();
  }
}

function runLiveGeneratedViewsMissingTokenValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-live-generated-views");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live generated-views fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }

  const env = { ...process.env };
  delete env.VITE_SEMAPHOR_PROJECT_TOKEN;
  delete env.SEMAPHOR_PROJECT_TOKEN;
  const result = runValidatorJson({
    workspaceDir,
    extraArgs: ["--live-generated-views"],
    env,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected live generated-views missing-token validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "generated_view_execution_failed",
    result,
    "live generated-views missing-token validation",
  );
}

function liveValidationEnv(serverUrl) {
  const env = { ...process.env };
  env.VITE_SEMAPHOR_PROJECT_TOKEN = "fixture-token";
  env.SEMAPHOR_PROJECT_TOKEN = "fixture-token";
  env.SEMAPHOR_SERVER_URL = serverUrl;
  delete env.VITE_SEMAPHOR_API_SERVICE_URL;
  delete env.SEMAPHOR_API_SERVICE_URL;
  delete env.NEXT_PUBLIC_API_SERVICE_URL;
  delete env.VITE_SEMAPHOR_SERVER_URL;
  delete env.NEXT_PUBLIC_SEMAPHOR_SERVER_URL;
  return env;
}

function writeMinimalRuntimeApp(workspaceDir) {
  const srcDir = path.join(workspaceDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, "App.tsx"),
    [
      'import { SemaphorDataAppProvider, SemaphorDevtools } from "react-semaphor/data-app-sdk";',
      'import { generatedQueries } from "./semaphor/generated";',
      "",
      "export function App() {",
      "  return (",
      "    <SemaphorDataAppProvider config={{ projectToken: 'fixture-token', exposeWindowBridge: true }}>",
      "      <SemaphorDevtools />",
      "      <pre>{generatedQueries.length}</pre>",
      "    </SemaphorDataAppProvider>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
}

async function startFixtureExecuteServer(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      let body = {};
      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        body = {};
      }
      requests.push({
        method: request.method,
        url: request.url,
        body,
      });
      const payload = handler({ request, body });
      response.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture execute server did not bind to a local port.");
  }
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function runLiveGeneratedViewsFetchFailureValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-live-generated-views-fetch-failure",
  );
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
      },
      null,
      2,
    ),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live generated-views fetch-failure fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }

  const env = { ...process.env };
  delete env.VITE_SEMAPHOR_API_SERVICE_URL;
  delete env.SEMAPHOR_API_SERVICE_URL;
  delete env.NEXT_PUBLIC_API_SERVICE_URL;
  delete env.VITE_SEMAPHOR_SERVER_URL;
  delete env.NEXT_PUBLIC_SEMAPHOR_SERVER_URL;
  env.VITE_SEMAPHOR_PROJECT_TOKEN = "not-a-real-token";
  env.SEMAPHOR_PROJECT_TOKEN = "not-a-real-token";
  env.SEMAPHOR_SERVER_URL = "http://127.0.0.1:9";
  const result = runValidatorJson({
    workspaceDir,
    extraArgs: ["--live-generated-views"],
    env,
  });
  if (result.status === 0) {
    throw new Error(
      "Expected live generated-views fetch-failure validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "generated_view_execution_failed",
    result,
    "live generated-views fetch-failure validation",
  );
}

function runVerboseSuccessfulBuildValidationFixture() {
  const workspaceDir = path.join(tempRoot, "validation-verbose-build");
  fs.mkdirSync(path.join(workspaceDir, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        dependencies: {
          react: "^19.0.0",
          "react-semaphor": "^0.0.0",
        },
        scripts: {
          build: "node scripts/noisy-build.mjs",
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(workspaceDir, "scripts/noisy-build.mjs"),
    [
      "const chunk = 'x'.repeat(1024 * 1024);",
      "for (let index = 0; index < 2; index += 1) {",
      "  process.stdout.write(chunk);",
      "}",
      "process.stdout.write('\\n');",
    ].join("\n"),
  );

  const result = runValidatorJson({ workspaceDir, runBuild: true });
  if (result.status !== 0) {
    throw new Error(
      `Expected verbose successful build validation to pass:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = parseValidationJson(result);
  if (parsed.ok !== true) {
    throw new Error(
      `Expected verbose successful build validation to return ok true:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function runContractUpdatePolicyFixture() {
  const beforeSummary = updatePolicySummaryFixture();
  const afterWarningFixSummary = updatePolicySummaryFixture();
  afterWarningFixSummary.views[0].fields = [
    { name: "sales_value", aggregate: "SUM" },
  ];
  afterWarningFixSummary.views[0].sdkSpec = {
    builder: "semaphor.metric",
    spec: {
      id: "sales_kpi",
      measures: [{ name: "sales_value", aggregate: "SUM" }],
    },
  };

  const narrowWarningFix = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "fix_warnings",
      targetViewIds: ["sales_kpi"],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (!narrowWarningFix.ok) {
    throw new Error(
      `Expected narrow warning fix to pass: ${JSON.stringify(narrowWarningFix)}`,
    );
  }

  const missingTargets = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "fix_warnings",
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (missingTargets.ok) {
    throw new Error(
      "Expected diagnostic warning fix to require targetViewIds.",
    );
  }

  const hiddenChecklistChange = updatePolicySummaryFixture();
  hiddenChecklistChange.views[0].fields =
    afterWarningFixSummary.views[0].fields;
  hiddenChecklistChange.views[0].sdkSpec =
    afterWarningFixSummary.views[0].sdkSpec;
  hiddenChecklistChange.implementationChecklist.validationCommands = [
    "npm run something-else",
  ];
  const hiddenSummaryChange = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: hiddenChecklistChange,
    operationIntent: {
      kind: "fix_warnings",
      targetViewIds: ["sales_kpi"],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (hiddenSummaryChange.ok) {
    throw new Error(
      "Expected diagnostic warning fix to reject hidden summary changes.",
    );
  }

  const unrelatedFilterChange = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "fix_warnings",
      targetViewIds: ["sales_kpi"],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: {
        added: [],
        removed: [],
        changed: [{ id: "facility", reasons: ["appliesToViewIds"] }],
      },
      filterContracts: {
        added: [],
        removed: [],
        changed: [{ id: "facility", reasons: ["bindings"] }],
      },
    },
  });
  if (unrelatedFilterChange.ok) {
    throw new Error(
      "Expected diagnostic warning fix to reject unrelated filter changes.",
    );
  }

  const explicitGeneralEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: {
      ...beforeSummary,
      views: [{ ...beforeSummary.views[0], title: "New Sales Title" }],
    },
    operationIntent: {
      kind: "edit",
      targetViewIds: ["sales_kpi"],
      change: "title",
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["title"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (!explicitGeneralEdit.ok) {
    throw new Error(
      `Expected general edit not to be blocked: ${JSON.stringify(explicitGeneralEdit)}`,
    );
  }

  const aggregateOverrideEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "edit",
      targetViewIds: ["sales_kpi"],
      measureAggregateOverrides: [
        { fieldName: "sales_value", aggregate: "AVG" },
      ],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (!aggregateOverrideEdit.ok) {
    throw new Error(
      `Expected metric aggregate override edit to pass: ${JSON.stringify(aggregateOverrideEdit)}`,
    );
  }

  const broadenedAggregateOverrideEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: {
      ...afterWarningFixSummary,
      views: [
        ...afterWarningFixSummary.views,
        {
          id: "unrelated_breakdown",
          title: "Unrelated Breakdown",
          fields: [],
        },
      ],
    },
    operationIntent: {
      kind: "edit",
      targetViewIds: ["sales_kpi"],
      measureAggregateOverrides: [
        { fieldName: "sales_value", aggregate: "AVG" },
      ],
    },
    migrationReport: {
      views: {
        added: [{ id: "unrelated_breakdown" }],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (broadenedAggregateOverrideEdit.ok) {
    throw new Error(
      "Expected metric aggregate override edit to reject unrelated view additions.",
    );
  }

  const preferenceAggregateOverrideEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "edit",
      targetViewIds: ["sales_kpi"],
    },
    preferences: {
      measureAggregateOverrides: [
        { fieldName: "sales_value", aggregate: "AVG" },
      ],
    },
    migrationReport: {
      views: {
        added: [{ id: "unrelated_breakdown" }],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (preferenceAggregateOverrideEdit.ok) {
    throw new Error(
      "Expected update preferences aggregate overrides to be rejected.",
    );
  }
  if (
    preferenceAggregateOverrideEdit.policy?.mode !==
    "invalid_update_preferences"
  ) {
    throw new Error(
      `Expected update preferences aggregate overrides to be rejected as invalid preferences: ${JSON.stringify(preferenceAggregateOverrideEdit)}`,
    );
  }

  const emptyOperationIntentAggregateOverrideEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: "edit",
      targetViewIds: ["sales_kpi"],
      measureAggregateOverrides: [],
    },
    preferences: {
      measureAggregateOverrides: [
        { fieldName: "sales_value", aggregate: "AVG" },
      ],
    },
    migrationReport: {
      views: {
        added: [{ id: "unrelated_breakdown" }],
        removed: [],
        changed: [{ id: "sales_kpi", reasons: ["fields", "sdkSpec"] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (emptyOperationIntentAggregateOverrideEdit.ok) {
    throw new Error(
      "Expected preference aggregate overrides to be rejected even when operationIntent has an empty override array.",
    );
  }
  if (
    emptyOperationIntentAggregateOverrideEdit.policy?.mode !==
    "invalid_update_preferences"
  ) {
    throw new Error(
      `Expected preference overrides plus empty operationIntent overrides to be rejected as invalid preferences: ${JSON.stringify(emptyOperationIntentAggregateOverrideEdit)}`,
    );
  }
}

function updatePolicySummaryFixture() {
  return {
    schemaVersion: "semaphor-data-app-codegen-summary/v1",
    title: "Policy fixture",
    sources: [
      {
        sourceKey: "sales",
        kind: "semantic",
        domainId: "domain",
        datasetName: "sales",
      },
    ],
    inputs: [],
    views: [
      {
        id: "sales_kpi",
        title: "Sales KPI",
        visual: "kpi",
        fields: [{ name: "sales_value", aggregate: "AVG" }],
        sdkSpec: {
          builder: "semaphor.metric",
          spec: {
            id: "sales_kpi",
            measures: [{ name: "sales_value", aggregate: "AVG" }],
          },
        },
      },
    ],
    filterContracts: [],
    implementationChecklist: {
      validationCommands: ["npm run validate"],
    },
  };
}

function runGenerator({ workspaceDir, summaryPath }) {
  return spawnSync(
    process.execPath,
    [generatorPath, "--dir", workspaceDir, "--plan", summaryPath, "--json"],
    {
      cwd: pluginRoot,
      encoding: "utf8",
    },
  );
}

function runValidatorJson({
  workspaceDir,
  extraArgs = [],
  env = process.env,
  runBuild = false,
}) {
  const args = [validatorPath, "--dir", workspaceDir, "--json", ...extraArgs];
  if (!runBuild) {
    args.splice(3, 0, "--no-run");
  }
  return spawnSync(process.execPath, args, {
    cwd: pluginRoot,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15000,
  });
}

function runValidatorJsonAsync({
  workspaceDir,
  extraArgs = [],
  env = process.env,
  runBuild = false,
  timeoutMs = 15000,
}) {
  const args = [validatorPath, "--dir", workspaceDir, "--json", ...extraArgs];
  if (!runBuild) {
    args.splice(3, 0, "--no-run");
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: pluginRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? null : code,
        signal: timedOut ? "timeout" : signal,
        stdout,
        stderr,
      });
    });
  });
}

function parseValidationJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Validator did not return JSON: ${error.message}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function parseGeneratorJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Generator did not return JSON: ${error.message}\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function assertIssueCode(parsed, code, result, label) {
  if (parsed?.ok !== false || !Array.isArray(parsed?.issues)) {
    throw new Error(
      `Unexpected ${label} validation shape:\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (!parsed.issues.some((issue) => issue?.code === code)) {
    throw new Error(
      `Expected ${label} to report ${code}:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function typecheckGeneratedFilesIfAvailable({ workspaceDir }) {
  const tscPath = findTypeScriptCompiler();
  if (!tscPath) {
    console.warn(
      "Skipping generated TypeScript fixture; no local TypeScript compiler was found.",
    );
    return;
  }
  const generatedDir = path.join(workspaceDir, "src/semaphor/generated");
  const generatedFiles = fs
    .readdirSync(generatedDir)
    .filter((fileName) => fileName.endsWith(".ts"))
    .map((fileName) => path.join(generatedDir, fileName));
  const stubPath = path.join(workspaceDir, "react-semaphor-data-app-sdk.d.ts");
  fs.writeFileSync(
    stubPath,
    [
      'declare module "react-semaphor/data-app-sdk" {',
      '  type SemaphorSemanticSourceRef = { kind: "semantic"; domainId?: string; datasetId?: string; datasetName?: string; connectionId?: string; [key: string]: unknown };',
      '  type SemaphorPhysicalSourceRef = { kind: "physical"; connectionId?: string; databaseName?: string; schemaName?: string; tableName?: string; [key: string]: unknown };',
      '  type SemaphorSqlSourceRef = { kind: "sql"; connectionId?: string; [key: string]: unknown };',
      "  type SemaphorSourceRef = SemaphorSemanticSourceRef | SemaphorPhysicalSourceRef | SemaphorSqlSourceRef;",
      "  export type SemaphorFieldRef = { name: string; source?: SemaphorSourceRef; sourceKey?: string; label?: string; role?: string; dataType?: string; aggregate?: string; [key: string]: unknown };",
      "  type SemaphorFilter = { field: SemaphorFieldRef; operator?: string; values?: unknown[]; scope?: string };",
      '  type SemaphorOrderBy = { field: SemaphorFieldRef; direction: "asc" | "desc" };',
      "  type MetricSpec = { source: SemaphorSourceRef; id?: string; label?: string; measures: SemaphorFieldRef[]; primaryMeasure?: SemaphorFieldRef; dateField?: SemaphorFieldRef; timeGrain?: string; dimensions?: SemaphorFieldRef[]; comparison?: unknown; orderBy?: SemaphorOrderBy; filters?: SemaphorFilter[]; relationshipHint?: unknown; limit?: number; derivedFields?: unknown[] };",
      "  type AnalysisSpec = MetricSpec & { analysis?: unknown; timeWindow?: unknown; driverMode?: string; includePopulation?: boolean; calendarContext?: unknown; chartTitle?: string; chartType?: string };",
      "  type RecordsSpec = { source: SemaphorSourceRef; id?: string; label?: string; fields: SemaphorFieldRef[]; dateField?: SemaphorFieldRef; timeGrain?: string; timeWindow?: unknown; filters?: SemaphorFilter[]; orderBy?: SemaphorOrderBy; relationshipHint?: unknown; limit?: number; pagination?: unknown; derivedFields?: unknown[] };",
      "  type MatrixAxis = SemaphorFieldRef | { id?: string; field: SemaphorFieldRef; grain?: string; label?: string; subtotal?: boolean | { enabled?: boolean; label?: string } };",
      "  type MatrixValue = SemaphorFieldRef | { id?: string; field: SemaphorFieldRef; aggregate?: string; label?: string };",
      '  type MatrixSort = { axis: "row" | "column"; targetId?: string; direction: "asc" | "desc"; by: { kind: "label" } | { kind: "field"; field: SemaphorFieldRef; aggregate?: string } | { kind: "value"; valueId: string; rowPath?: unknown[]; columnPath?: unknown[] }; nulls?: string; scope?: string };',
      "  type MatrixSpec = { source: SemaphorSourceRef; id?: string; label?: string; filters?: SemaphorFilter[]; relationshipHint?: unknown; rows: MatrixAxis[]; columns?: MatrixAxis[]; values: MatrixValue[]; totals?: unknown; sort?: MatrixSort[]; expansion?: unknown; layout?: unknown; displayLimits?: unknown };",
      "  type SqlSpec = { source: SemaphorSourceRef; id?: string; label?: string; sql: string; defaultParameters?: Record<string, unknown>; pythonCode?: string; fields?: SemaphorFieldRef[]; limit?: number; pagination?: unknown; rationale?: string };",
      "  export const semaphor: {",
      '    source: { semantic<T extends Record<string, unknown>>(spec: T): T & { kind: "semantic" }; sql<T extends Record<string, unknown>>(spec: T): T & { kind: "sql" } };',
      '    field: { measure<T extends Record<string, unknown>>(name: string, spec?: T): T & { name: string; role: "measure" }; dimension<T extends Record<string, unknown>>(name: string, spec?: T): T & { name: string; role: "dimension" }; date<T extends Record<string, unknown>>(name: string, spec?: T): T & { name: string; role: "date" }; id<T extends Record<string, unknown>>(name: string, spec?: T): T & { name: string; role: "id" } };',
      "    filter(spec: Record<string, unknown>): unknown;",
      "    bindInput(input: SemaphorInputReference, binding: Record<string, unknown>): SemaphorInputReference;",
      '    metric<T extends MetricSpec>(spec: T): T & { queryKind: "metric" };',
      '    analysis<T extends AnalysisSpec>(spec: T): T & { queryKind: "analysis" };',
      '    records<T extends RecordsSpec>(spec: T): T & { queryKind: "records" };',
      '    matrix<T extends MatrixSpec>(spec: T): T & { queryKind: "matrix" };',
      '    sql<T extends SqlSpec>(spec: T): T & { queryKind: "sql" };',
      "    inputOptions(spec: Record<string, unknown>): unknown;",
      "  };",
      "  export type SemaphorInputReference = any;",
      "  export type SemaphorQueryRuntimeOptions = any;",
      "  export type SemaphorInputHandle = any;",
      "  export type SemaphorResultColumn = { key: string; name?: string; label?: string; aggregate?: string; source?: SemaphorSourceRef };",
      "}",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    process.execPath,
    [
      tscPath,
      "--noEmit",
      "--strict",
      "--target",
      "ES2020",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      ...generatedFiles,
      stubPath,
    ],
    {
      cwd: workspaceDir,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Generated TypeScript did not typecheck:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

function assertAggregateRecordsAccessorBehavior({ workspaceDir }) {
  const tscPath = findTypeScriptCompiler();
  if (!tscPath) {
    console.warn(
      "Skipping generated accessor behavior fixture; no local TypeScript compiler was found.",
    );
    return;
  }
  const sdkStubDir = path.join(
    workspaceDir,
    "node_modules/react-semaphor",
  );
  fs.mkdirSync(sdkStubDir, { recursive: true });
  fs.writeFileSync(
    path.join(sdkStubDir, "package.json"),
    JSON.stringify(
      {
        name: "react-semaphor",
        type: "commonjs",
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(sdkStubDir, "data-app-sdk.js"),
    [
      "exports.semaphor = {",
      "  source: {",
      "    semantic: (spec) => ({ ...spec, kind: 'semantic' }),",
      "    sql: (spec) => ({ ...spec, kind: 'sql' }),",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(sdkStubDir, "data-app-sdk.d.ts"),
    [
      'export type SemaphorSemanticSourceRef = { kind: "semantic"; domainId?: string; datasetId?: string; datasetName?: string; connectionId?: string; [key: string]: unknown };',
      'export type SemaphorPhysicalSourceRef = { kind: "physical"; connectionId?: string; databaseName?: string; schemaName?: string; tableName?: string; [key: string]: unknown };',
      'export type SemaphorSqlSourceRef = { kind: "sql"; connectionId?: string; [key: string]: unknown };',
      "export type SemaphorSourceRef = SemaphorSemanticSourceRef | SemaphorPhysicalSourceRef | SemaphorSqlSourceRef;",
      "export type SemaphorFieldRef = { name: string; source?: SemaphorSourceRef; sourceKey?: string; label?: string; role?: string; dataType?: string; aggregate?: string; [key: string]: unknown };",
      "export type SemaphorResultColumn = { key: string; name?: string; label?: string; aggregate?: string; source?: SemaphorSourceRef };",
      "export const semaphor: { source: { semantic<T extends Record<string, unknown>>(spec: T): T & { kind: 'semantic' }; sql<T extends Record<string, unknown>>(spec: T): T & { kind: 'sql' } } };",
      "",
    ].join("\n"),
  );

  const runnerPath = path.join(workspaceDir, "accessor-behavior.ts");
  fs.writeFileSync(
    runnerPath,
    [
      'import { fieldsForView, readCell, rowValuesForView } from "./src/semaphor/generated/accessors";',
      "",
      "const aggregateColumn = {",
      '  key: "sum_sales_value",',
      '  name: "sales_value",',
      '  label: "Sales Value",',
      '  aggregate: "SUM",',
      "  source: {",
      '    kind: "semantic",',
      '    domainId: "domain",',
      '    datasetName: "sales",',
      "  },",
      "} as const;",
      "",
      "const row = { sum_sales_value: 15420 };",
      "const columns = [aggregateColumn];",
      "const values = rowValuesForView.salesKpi(row, columns);",
      "const direct = readCell(row, columns, fieldsForView.salesKpi.salesValue);",
      "if (values.salesValue !== 15420 || direct !== 15420) {",
      "  throw new Error(`Expected aggregate result column to resolve to 15420, got rowValues=${String(values.salesValue)} direct=${String(direct)}`);",
      "}",
      "",
    ].join("\n"),
  );
  const outDir = path.join(workspaceDir, "accessor-behavior-dist");
  const result = spawnSync(
    process.execPath,
    [
      tscPath,
      "--target",
      "ES2020",
      "--module",
      "CommonJS",
      "--moduleResolution",
      "Node",
      "--esModuleInterop",
      "--strict",
      "--outDir",
      outDir,
      runnerPath,
      path.join(workspaceDir, "src/semaphor/generated/sources.ts"),
      path.join(workspaceDir, "src/semaphor/generated/fields.ts"),
      path.join(workspaceDir, "src/semaphor/generated/accessors.ts"),
    ],
    {
      cwd: workspaceDir,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Generated accessor behavior fixture did not compile:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const runResult = spawnSync(
    process.execPath,
    [path.join(outDir, "accessor-behavior.js")],
    {
      cwd: workspaceDir,
      encoding: "utf8",
    },
  );
  if (runResult.status !== 0) {
    throw new Error(
      `Generated accessor behavior fixture failed:\n${runResult.stdout}\n${runResult.stderr}`,
    );
  }
}

function findTypeScriptCompiler() {
  const candidates = [
    process.env.TSC_BIN,
    path.resolve(pluginRoot, "node_modules/typescript/bin/tsc"),
    path.resolve(pluginRoot, "../../node_modules/typescript/bin/tsc"),
    path.resolve(pluginRoot, "../../../node_modules/typescript/bin/tsc"),
    path.resolve(
      pluginRoot,
      "../../../react-semaphor/node_modules/typescript/bin/tsc",
    ),
    path.resolve(
      pluginRoot,
      "../../../semaphor-app/node_modules/typescript/bin/tsc",
    ),
    path.resolve(
      pluginRoot,
      "../../../semaphor-data-app-starter/node_modules/typescript/bin/tsc",
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function validSummary() {
  const sourceKey = "semantic:domain:sales";
  const source = {
    sourceKey,
    kind: "semantic",
    domainId: "domain",
    datasetName: "sales",
  };
  const dateField = {
    name: "sale_date",
    label: "Sale Date",
    role: "date",
    dataType: "date",
    sourceKey,
  };
  const salesField = {
    name: "sales_value",
    label: "Sales Value",
    role: "measure",
    dataType: "number",
    aggregate: "SUM",
    sourceKey,
  };
  const marginField = {
    name: "margin_value",
    label: "Margin Value",
    role: "measure",
    dataType: "number",
    aggregate: "SUM",
    sourceKey,
  };
  const facilityIdField = {
    name: "facility_id",
    label: "Facility ID",
    role: "id",
    dataType: "number",
    sourceKey,
  };
  const facilityNameField = {
    name: "facility_name",
    label: "Facility Name",
    role: "dimension",
    dataType: "string",
    sourceKey,
  };

  return {
    schemaVersion: "semaphor-data-app-codegen-summary/v1",
    title: "Generator Fixture",
    purpose: "Exercise generated metadata helpers.",
    sources: [source],
    inputs: [
      {
        id: "date_range",
        label: "Date range",
        type: "date_range",
        serverSide: true,
        fieldRef: dateField,
        optionQuery: {
          builder: "semaphor.inputOptions",
          sourceKey,
          valueFieldRef: facilityIdField,
          labelFieldRef: facilityNameField,
        },
        appliesToViewIds: ["sales_kpi"],
        bindings: [
          {
            appliesToViewIds: ["sales_kpi"],
            fieldRef: dateField,
          },
        ],
      },
    ],
    views: [
      {
        id: "sales_kpi",
        title: "Sales KPI",
        visual: "kpi",
        queryKind: "records",
        sdkBuilder: "semaphor.records",
        fields: [salesField],
        sdkSpec: {
          builder: "semaphor.records",
          spec: {
            id: "sales_kpi",
            source,
            fields: [salesField],
            limit: 1,
          },
        },
      },
      {
        id: "margin_kpi",
        title: "Margin KPI",
        visual: "kpi",
        queryKind: "records",
        sdkBuilder: "semaphor.records",
        fields: [marginField],
        sdkSpec: {
          builder: "semaphor.records",
          spec: {
            id: "margin_kpi",
            source,
            fields: [marginField],
            limit: 1,
          },
        },
      },
      {
        id: "sales_analysis",
        title: "Sales Analysis",
        visual: "table",
        queryKind: "analysis",
        sdkBuilder: "semaphor.analysis",
        fields: [salesField],
        sdkSpec: {
          builder: "semaphor.analysis",
          spec: {
            id: "sales_analysis",
            source,
            measures: [salesField],
            driverMode: "all",
            includePopulation: true,
          },
        },
      },
    ],
    filterContracts: [
      {
        inputId: "date_range",
        label: "Date range",
        type: "date_range",
        serverSide: true,
        fieldRef: dateField,
        bindings: [
          {
            viewId: "sales_kpi",
            fieldRef: dateField,
          },
        ],
        appliesToViewIds: ["sales_kpi"],
        notAppliedToViewIds: ["margin_kpi", "sales_analysis"],
      },
    ],
    implementationChecklist: {
      requiredDevtools: {
        mountRootDevtools: true,
        panelPosition: "right",
      },
      requiredInputOptions: [],
      filterScopeByInput: [],
      bindingsByView: {},
      validationCommands: ["node scripts/validate-semaphor-data-app.mjs"],
      browserSmokeChecks: ["DevTools opens"],
    },
  };
}
