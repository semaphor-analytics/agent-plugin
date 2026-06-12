#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateContractUpdatePolicy,
} from './data-app-contract-update-policy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const generatorPath = path.join(scriptDir, 'generate-data-app-contract.mjs');
const validatorPath = path.join(scriptDir, 'validate-semaphor-data-app.mjs');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semaphor-generator-fixture-'));

try {
  runValidPartialScopeFixture();
  runNoFilterFixture();
  runMalformedSummaryFixture();
  runMalformedIdentityFixture();
  runDatasetIdOnlySourceFixture();
  runMalformedSdkSpecFixture();
  runQueryKindDivergenceFixture();
  runMalformedOptionalSdkFieldRefsFixture();
  runMalformedMatrixSpecFixture();
  runMalformedAnalysisOptionsFixture();
  runNumericViewScopeIdsFixture();
  runMissingFilterInputIdFixture();
  runFilterBindingScopeConflictFixture();
  runPresentationFilterScopeFixture();
  runMalformedManifestFixture();
  runContractUpdatePolicyFixture();
  console.log('Semaphor generator fixture tests passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runValidPartialScopeFixture() {
  const workspaceDir = path.join(tempRoot, 'valid-partial-scope');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2),
  );
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(validSummary(), null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(`Expected valid generator fixture to pass:\n${result.stdout}\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (parsed.ok !== true || parsed.executableViewCount !== 3) {
    throw new Error(`Unexpected generator result: ${result.stdout}`);
  }

  const metadataPath = path.join(workspaceDir, 'src/semaphor/generated/metadata.ts');
  const metadataText = fs.readFileSync(metadataPath, 'utf8');
  if (
    !metadataText.includes('export type SemaphorGeneratedFilterContract') ||
    !metadataText.includes('generatedFilterContracts: readonly SemaphorGeneratedFilterContract[]')
  ) {
    throw new Error('Generated metadata must type generatedFilterContracts explicitly.');
  }
  const manifestPath = path.join(workspaceDir, 'src/semaphor/generated/contract.manifest.json');
  const firstManifestText = fs.readFileSync(manifestPath, 'utf8');
  const firstManifest = JSON.parse(firstManifestText);
  if (
    firstManifest.codegenSummaryValidatorVersion !==
    'semaphor-data-app-codegen-summary-validator/v2'
  ) {
    throw new Error('Contract manifest must persist the codegenSummary validator version.');
  }
  const secondResult = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (secondResult.status !== 0) {
    throw new Error(`Expected deterministic regeneration to pass:\n${secondResult.stdout}\n${secondResult.stderr}`);
  }
  const secondManifestText = fs.readFileSync(manifestPath, 'utf8');
  if (firstManifestText !== secondManifestText) {
    throw new Error('Contract manifest must be deterministic for the same codegen summary.');
  }
  typecheckGeneratedFilesIfAvailable({ workspaceDir });
}

function runNoFilterFixture() {
  const workspaceDir = path.join(tempRoot, 'no-filters');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.inputs = [];
  summary.filterContracts = [];
  summary.views.push(
    {
      id: 'commentary',
      title: 'Commentary',
      visual: 'text_block',
      computation: { kind: 'presentation_only' },
    },
    {
      id: 'derived_summary',
      title: 'Derived Summary',
      computation: {
        kind: 'derived',
        upstreamViewId: 'sales_kpi',
        derivation: 'Read the primary KPI result and render a sentence.',
      },
    },
    {
      id: 'unsupported_gap',
      title: 'Unsupported Gap',
      computation: {
        kind: 'unsupported',
        reason: 'missing relationship',
        suggestedModelingFix: 'Model the relationship before generating.',
      },
    },
  );
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status !== 0) {
    throw new Error(`Expected no-filter generator fixture to pass:\n${result.stdout}\n${result.stderr}`);
  }
  typecheckGeneratedFilesIfAvailable({ workspaceDir });
}

function runMalformedSummaryFixture() {
  const workspaceDir = path.join(tempRoot, 'missing-filter-scope');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.filterContracts[0].appliesToViewIds;
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed generator fixture to fail.');
  }
  if (!result.stdout.includes('filterContracts.0.appliesToViewIds must be an array')) {
    throw new Error(`Malformed fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runMalformedIdentityFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-identities');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.title;
  summary.sources[0] = null;
  delete summary.inputs[0].id;
  delete summary.views[0].id;
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed identity fixture to fail.');
  }
  for (const expectedIssue of [
    'title is required',
    'sources.0 must be an object',
    'inputs.0.id is required',
    'views.0.id is required',
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(`Malformed identity fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function runDatasetIdOnlySourceFixture() {
  const workspaceDir = path.join(tempRoot, 'dataset-id-only-source');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.sources[0] = {
    sourceKey: 'semantic:domain:sales',
    kind: 'semantic',
    domainId: 'domain',
    datasetId: 'dataset-sales',
  };
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected dataset-id-only source fixture to fail.');
  }
  if (!result.stdout.includes('sources.0 must include sourceKey or a supported source identity')) {
    throw new Error(`Dataset-id-only source fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runMalformedSdkSpecFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-sdk-spec');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].queryKind = 'records';
  summary.views[0].sdkSpec = {
    builder: 'semaphor.metric',
    spec: {
      source: summary.sources[0],
      measures: [summary.views[0].fields[0]],
    },
  };
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed SDK spec fixture to fail.');
  }
  if (!result.stdout.includes('views.0.sdkSpec.builder must match queryKind')) {
    throw new Error(`Malformed SDK spec fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runQueryKindDivergenceFixture() {
  const workspaceDir = path.join(tempRoot, 'query-kind-divergence');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0].computation = {
    kind: 'server_query',
    queryKind: 'metric',
  };
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected query kind divergence fixture to fail.');
  }
  if (!result.stdout.includes('views.0.computation.queryKind must match queryKind')) {
    throw new Error(`Query kind divergence fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runMalformedOptionalSdkFieldRefsFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-optional-sdk-field-refs');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  const source = summary.sources[0];
  summary.views[0] = {
    id: 'sales_kpi',
    title: 'Sales KPI',
    visual: 'kpi',
    queryKind: 'metric',
    sdkBuilder: 'semaphor.metric',
    fields: [summary.views[0].fields[0]],
    sdkSpec: {
      builder: 'semaphor.metric',
      spec: {
        source,
        measures: [summary.views[0].fields[0]],
        primaryMeasure: { name: 'sales_value' },
        dateField: { name: 'order_date' },
        dimensions: [{ name: 'region' }],
        orderBy: {
          field: { name: 'region' },
          direction: 'asc',
        },
      },
    },
  };
  summary.views.push(
    {
      id: 'sales_records',
      title: 'Sales Records',
      visual: 'table',
      queryKind: 'records',
      sdkBuilder: 'semaphor.records',
      fields: [summary.views[0].fields[0]],
      sdkSpec: {
        builder: 'semaphor.records',
        spec: {
          source,
          fields: [summary.views[0].fields[0]],
          dateField: { name: 'order_date' },
          orderBy: {
            field: { name: 'region' },
            direction: 'asc',
          },
        },
      },
    },
    {
      id: 'sales_matrix',
      title: 'Sales Matrix',
      visual: 'matrix',
      queryKind: 'matrix',
      sdkBuilder: 'semaphor.matrix',
      fields: [summary.views[0].fields[0]],
      sdkSpec: {
        builder: 'semaphor.matrix',
        spec: {
          source,
          rows: [{ field: { name: 'region', sourceKey: source.sourceKey } }],
          values: [{ field: summary.views[0].fields[0], aggregate: 'SUM' }],
          sort: [{ field: { name: 'region' } }],
        },
      },
    },
  );
  const sqlSource = {
    sourceKey: 'sql:conn',
    kind: 'sql',
    connectionId: 'conn',
  };
  summary.sources.push(sqlSource);
  summary.views.push({
    id: 'sql_fallback',
    title: 'SQL Fallback',
    visual: 'table',
    queryKind: 'sql_fallback',
    sdkBuilder: 'semaphor.sql',
    fields: [{ name: 'sales_value', sourceKey: sqlSource.sourceKey }],
    sdkSpec: {
      builder: 'semaphor.sql',
      spec: {
        source: sqlSource,
        sql: 'select 1 as sales_value',
        fields: [{ name: 'sales_value' }],
      },
    },
  });
  summary.filterContracts[0].notAppliedToViewIds = [
    'margin_kpi',
    'sales_records',
    'sales_matrix',
    'sql_fallback',
  ];
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed optional SDK field refs fixture to fail.');
  }
  for (const expectedIssue of [
    'views.0.sdkSpec.spec.primaryMeasure must include source or sourceKey',
    'views.0.sdkSpec.spec.dateField must include source or sourceKey',
    'views.0.sdkSpec.spec.dimensions.0 must include source or sourceKey',
    'views.0.sdkSpec.spec.orderBy.field must include source or sourceKey',
    'views.3.sdkSpec.spec.dateField must include source or sourceKey',
    'views.3.sdkSpec.spec.orderBy.field must include source or sourceKey',
    'views.4.sdkSpec.spec.sort.0.field must include source or sourceKey',
    'views.5.sdkSpec.spec.fields.0 must include source or sourceKey',
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(`Malformed optional SDK field refs fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function runMalformedMatrixSpecFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-matrix-spec');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0] = {
    id: 'sales_matrix',
    title: 'Sales Matrix',
    visual: 'matrix',
    queryKind: 'matrix',
    sdkBuilder: 'semaphor.matrix',
    fields: [],
    sdkSpec: {
      builder: 'semaphor.matrix',
      spec: {
        source: summary.sources[0],
        rows: [{}],
        columns: [{}],
        values: [{}],
      },
    },
  };
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed matrix spec fixture to fail.');
  }
  for (const expectedIssue of [
    'views.0.sdkSpec.spec.rows.0.field must be an object',
    'views.0.sdkSpec.spec.columns.0.field must be an object',
    'views.0.sdkSpec.spec.values.0.field must be an object',
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(`Malformed matrix spec fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function runMalformedAnalysisOptionsFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-analysis-options');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views[0] = {
    id: 'sales_change',
    title: 'Sales Change',
    visual: 'table',
    queryKind: 'analysis',
    sdkBuilder: 'semaphor.analysis',
    fields: [summary.views[0].fields[0]],
    sdkSpec: {
      builder: 'semaphor.analysis',
      spec: {
        source: summary.sources[0],
        measures: [summary.views[0].fields[0]],
        driverMode: 'fastest',
        includePopulation: 'yes',
        calendarContext: {
          tz: 123,
          weekStart: 7,
          anchor: {},
        },
      },
    },
  };
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected malformed analysis options fixture to fail.');
  }
  for (const expectedIssue of [
    'views.0.sdkSpec.spec.driverMode must be a supported analysis driver mode',
    'views.0.sdkSpec.spec.includePopulation must be a boolean',
    'views.0.sdkSpec.spec.calendarContext.tz must be a string',
    'views.0.sdkSpec.spec.calendarContext.weekStart must be an integer between 0 and 6',
    'views.0.sdkSpec.spec.calendarContext.anchor must be now or { iso }',
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(`Malformed analysis options fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function runNumericViewScopeIdsFixture() {
  const workspaceDir = path.join(tempRoot, 'numeric-view-scope-ids');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.inputs[0].appliesToViewIds = [123];
  summary.filterContracts[0].appliesToViewIds = [123];
  summary.filterContracts[0].notAppliedToViewIds = [456];
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected numeric view scope ids fixture to fail.');
  }
  for (const expectedIssue of [
    'inputs.0.appliesToViewIds must be an array of strings',
    'filterContracts.0.appliesToViewIds must be an array of strings',
    'filterContracts.0.notAppliedToViewIds must be an array of strings',
  ]) {
    if (!result.stdout.includes(expectedIssue)) {
      throw new Error(`Numeric view scope ids fixture did not report ${expectedIssue}:\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function runMissingFilterInputIdFixture() {
  const workspaceDir = path.join(tempRoot, 'missing-filter-input-id');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  delete summary.filterContracts[0].inputId;
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected missing filter input id fixture to fail.');
  }
  if (!result.stdout.includes('filterContracts.0.inputId is required')) {
    throw new Error(`Missing filter input id fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runFilterBindingScopeConflictFixture() {
  const workspaceDir = path.join(tempRoot, 'filter-binding-scope-conflict');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.filterContracts[0].bindings[0].viewId = 'margin_kpi';
  summary.filterContracts[0].notAppliedToViewIds = ['margin_kpi'];
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected filter binding scope conflict fixture to fail.');
  }
  if (!result.stdout.includes('filterContracts.0.bindings.0.viewId must be included in appliesToViewIds')) {
    throw new Error(`Filter binding scope conflict fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runPresentationFilterScopeFixture() {
  const workspaceDir = path.join(tempRoot, 'presentation-filter-scope');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const summary = validSummary();
  summary.views.push({
    id: 'explanation',
    title: 'Explanation',
    visual: 'text_block',
    fields: [],
    computation: { kind: 'presentation_only' },
  });
  summary.filterContracts[0].appliesToViewIds = ['explanation'];
  summary.filterContracts[0].bindings[0].viewId = 'explanation';
  const summaryPath = path.join(workspaceDir, 'codegen-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = runGenerator({
    workspaceDir,
    summaryPath,
  });
  if (result.status === 0) {
    throw new Error('Expected presentation filter-scope fixture to fail.');
  }
  if (!result.stdout.includes('must reference an executable generated view')) {
    throw new Error(`Presentation filter-scope fixture failed for the wrong reason:\n${result.stdout}\n${result.stderr}`);
  }
}

function runMalformedManifestFixture() {
  const workspaceDir = path.join(tempRoot, 'malformed-manifest');
  const generatedDir = path.join(workspaceDir, 'src/semaphor/generated');
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify({
      type: 'module',
      dependencies: {
        react: '^19.0.0',
        'react-semaphor': '^0.0.0',
      },
    }, null, 2),
  );
  for (const fileName of [
    'sources.ts',
    'fields.ts',
    'inputs.ts',
    'queries.ts',
    'bindings.ts',
    'accessors.ts',
    'metadata.ts',
    'index.ts',
  ]) {
    fs.writeFileSync(path.join(generatedDir, fileName), '// fixture\n');
  }
  fs.writeFileSync(
    path.join(generatedDir, 'contract.manifest.json'),
    JSON.stringify({
      schemaVersion: 'semaphor-generated-data-app-contract-manifest/v1',
      generatedContractSchemaVersion: 'semaphor-generated-data-app-contract/v1',
      generatedContentHash: 'sha256:not-real',
      codegenSummaryHash: 'sha256:not-real',
    }, null, 2),
  );

  const result = spawnSync(process.execPath, [
    validatorPath,
    '--dir',
    workspaceDir,
    '--no-run',
  ], {
    cwd: pluginRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error('Expected malformed manifest fixture to fail.');
  }
  if (
    !result.stdout.includes('codegenSummary.Plan artifact must be a Semaphor codegenSummary object') ||
    result.stderr.includes('ERR_INVALID_ARG_TYPE')
  ) {
    throw new Error(`Malformed manifest fixture failed unclearly:\n${result.stdout}\n${result.stderr}`);
  }
}

function runContractUpdatePolicyFixture() {
  const beforeSummary = updatePolicySummaryFixture();
  const afterWarningFixSummary = updatePolicySummaryFixture();
  afterWarningFixSummary.views[0].fields = [
    { name: 'sales_value', aggregate: 'SUM' },
  ];
  afterWarningFixSummary.views[0].sdkSpec = {
    builder: 'semaphor.metric',
    spec: { id: 'sales_kpi', measures: [{ name: 'sales_value', aggregate: 'SUM' }] },
  };

  const narrowWarningFix = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: 'fix_warnings',
      targetViewIds: ['sales_kpi'],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: 'sales_kpi', reasons: ['fields', 'sdkSpec'] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (!narrowWarningFix.ok) {
    throw new Error(`Expected narrow warning fix to pass: ${JSON.stringify(narrowWarningFix)}`);
  }

  const missingTargets = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: 'fix_warnings',
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: 'sales_kpi', reasons: ['fields', 'sdkSpec'] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (missingTargets.ok) {
    throw new Error('Expected diagnostic warning fix to require targetViewIds.');
  }

  const hiddenChecklistChange = updatePolicySummaryFixture();
  hiddenChecklistChange.views[0].fields = afterWarningFixSummary.views[0].fields;
  hiddenChecklistChange.views[0].sdkSpec = afterWarningFixSummary.views[0].sdkSpec;
  hiddenChecklistChange.implementationChecklist.validationCommands = ['npm run something-else'];
  const hiddenSummaryChange = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: hiddenChecklistChange,
    operationIntent: {
      kind: 'fix_warnings',
      targetViewIds: ['sales_kpi'],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: 'sales_kpi', reasons: ['fields', 'sdkSpec'] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (hiddenSummaryChange.ok) {
    throw new Error('Expected diagnostic warning fix to reject hidden summary changes.');
  }

  const unrelatedFilterChange = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: afterWarningFixSummary,
    operationIntent: {
      kind: 'fix_warnings',
      targetViewIds: ['sales_kpi'],
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: 'sales_kpi', reasons: ['fields', 'sdkSpec'] }],
      },
      inputs: {
        added: [],
        removed: [],
        changed: [{ id: 'facility', reasons: ['appliesToViewIds'] }],
      },
      filterContracts: {
        added: [],
        removed: [],
        changed: [{ id: 'facility', reasons: ['bindings'] }],
      },
    },
  });
  if (unrelatedFilterChange.ok) {
    throw new Error('Expected diagnostic warning fix to reject unrelated filter changes.');
  }

  const explicitGeneralEdit = evaluateContractUpdatePolicy({
    beforeSummary,
    afterSummary: {
      ...beforeSummary,
      views: [{ ...beforeSummary.views[0], title: 'New Sales Title' }],
    },
    operationIntent: {
      kind: 'edit',
      targetViewIds: ['sales_kpi'],
      change: 'title',
    },
    migrationReport: {
      views: {
        added: [],
        removed: [],
        changed: [{ id: 'sales_kpi', reasons: ['title'] }],
      },
      inputs: { added: [], removed: [], changed: [] },
      filterContracts: { added: [], removed: [], changed: [] },
    },
  });
  if (!explicitGeneralEdit.ok) {
    throw new Error(`Expected general edit not to be blocked: ${JSON.stringify(explicitGeneralEdit)}`);
  }
}

function updatePolicySummaryFixture() {
  return {
    schemaVersion: 'semaphor-data-app-codegen-summary/v1',
    title: 'Policy fixture',
    sources: [{ sourceKey: 'sales', kind: 'semantic', domainId: 'domain', datasetName: 'sales' }],
    inputs: [],
    views: [
      {
        id: 'sales_kpi',
        title: 'Sales KPI',
        visual: 'kpi',
        fields: [{ name: 'sales_value', aggregate: 'AVG' }],
        sdkSpec: {
          builder: 'semaphor.metric',
          spec: { id: 'sales_kpi', measures: [{ name: 'sales_value', aggregate: 'AVG' }] },
        },
      },
    ],
    filterContracts: [],
    implementationChecklist: {
      validationCommands: ['npm run validate'],
    },
  };
}

function runGenerator({ workspaceDir, summaryPath }) {
  return spawnSync(process.execPath, [
    generatorPath,
    '--dir',
    workspaceDir,
    '--plan',
    summaryPath,
    '--json',
  ], {
    cwd: pluginRoot,
    encoding: 'utf8',
  });
}

function typecheckGeneratedFilesIfAvailable({ workspaceDir }) {
  const tscPath = findTypeScriptCompiler();
  if (!tscPath) {
    console.warn('Skipping generated TypeScript fixture; no local TypeScript compiler was found.');
    return;
  }
  const generatedDir = path.join(workspaceDir, 'src/semaphor/generated');
  const generatedFiles = fs.readdirSync(generatedDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => path.join(generatedDir, fileName));
  const stubPath = path.join(workspaceDir, 'react-semaphor-data-app-sdk.d.ts');
  fs.writeFileSync(stubPath, [
    'declare module "react-semaphor/data-app-sdk" {',
    '  export const semaphor: any;',
    '  export type SemaphorInputReference = any;',
    '  export type SemaphorQueryRuntimeOptions = any;',
    '  export type SemaphorInputHandle = any;',
    '  export type SemaphorFieldRef = any;',
    '  export type SemaphorResultColumn = any;',
    '}',
    '',
  ].join('\n'));
  const result = spawnSync(process.execPath, [
    tscPath,
    '--noEmit',
    '--strict',
    '--target',
    'ES2020',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    ...generatedFiles,
    stubPath,
  ], {
    cwd: workspaceDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Generated TypeScript did not typecheck:\n${result.stdout}\n${result.stderr}`);
  }
}

function findTypeScriptCompiler() {
  const candidates = [
    process.env.TSC_BIN,
    path.resolve(pluginRoot, 'node_modules/typescript/bin/tsc'),
    path.resolve(pluginRoot, '../../node_modules/typescript/bin/tsc'),
    path.resolve(pluginRoot, '../../../node_modules/typescript/bin/tsc'),
    path.resolve(pluginRoot, '../../../react-semaphor/node_modules/typescript/bin/tsc'),
    path.resolve(pluginRoot, '../../../semaphor-app/node_modules/typescript/bin/tsc'),
    path.resolve(pluginRoot, '../../../semaphor-data-app-starter/node_modules/typescript/bin/tsc'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function validSummary() {
  const sourceKey = 'semantic:domain:sales';
  const source = {
    sourceKey,
    kind: 'semantic',
    domainId: 'domain',
    datasetName: 'sales',
  };
  const dateField = {
    name: 'sale_date',
    label: 'Sale Date',
    role: 'date',
    dataType: 'date',
    sourceKey,
  };
  const salesField = {
    name: 'sales_value',
    label: 'Sales Value',
    role: 'measure',
    dataType: 'number',
    aggregate: 'SUM',
    sourceKey,
  };
  const marginField = {
    name: 'margin_value',
    label: 'Margin Value',
    role: 'measure',
    dataType: 'number',
    aggregate: 'SUM',
    sourceKey,
  };
  const facilityIdField = {
    name: 'facility_id',
    label: 'Facility ID',
    role: 'id',
    dataType: 'number',
    sourceKey,
  };
  const facilityNameField = {
    name: 'facility_name',
    label: 'Facility Name',
    role: 'dimension',
    dataType: 'string',
    sourceKey,
  };

  return {
    schemaVersion: 'semaphor-data-app-codegen-summary/v1',
    title: 'Generator Fixture',
    purpose: 'Exercise generated metadata helpers.',
    sources: [source],
    inputs: [
      {
        id: 'date_range',
        label: 'Date range',
        type: 'date_range',
        serverSide: true,
        fieldRef: dateField,
        optionQuery: {
          builder: 'semaphor.inputOptions',
          sourceKey,
          valueFieldRef: facilityIdField,
          labelFieldRef: facilityNameField,
        },
        appliesToViewIds: ['sales_kpi'],
        bindings: [
          {
            appliesToViewIds: ['sales_kpi'],
            fieldRef: dateField,
          },
        ],
      },
    ],
    views: [
      {
        id: 'sales_kpi',
        title: 'Sales KPI',
        visual: 'kpi',
        queryKind: 'records',
        sdkBuilder: 'semaphor.records',
        fields: [salesField],
        sdkSpec: {
          builder: 'semaphor.records',
          spec: {
            id: 'sales_kpi',
            source,
            fields: [salesField],
            limit: 1,
          },
        },
      },
      {
        id: 'margin_kpi',
        title: 'Margin KPI',
        visual: 'kpi',
        queryKind: 'records',
        sdkBuilder: 'semaphor.records',
        fields: [marginField],
        sdkSpec: {
          builder: 'semaphor.records',
          spec: {
            id: 'margin_kpi',
            source,
            fields: [marginField],
            limit: 1,
          },
        },
      },
      {
        id: 'sales_analysis',
        title: 'Sales Analysis',
        visual: 'table',
        queryKind: 'analysis',
        sdkBuilder: 'semaphor.analysis',
        fields: [salesField],
        sdkSpec: {
          builder: 'semaphor.analysis',
          spec: {
            id: 'sales_analysis',
            source,
            measures: [salesField],
            driverMode: 'all',
            includePopulation: true,
          },
        },
      },
    ],
    filterContracts: [
      {
        inputId: 'date_range',
        label: 'Date range',
        type: 'date_range',
        serverSide: true,
        fieldRef: dateField,
        bindings: [
          {
            viewId: 'sales_kpi',
            fieldRef: dateField,
          },
        ],
        appliesToViewIds: ['sales_kpi'],
        notAppliedToViewIds: ['margin_kpi', 'sales_analysis'],
      },
    ],
    implementationChecklist: {
      requiredDevtools: {
        mountRootDevtools: true,
        panelPosition: 'right',
      },
      requiredInputOptions: [],
      filterScopeByInput: [],
      bindingsByView: {},
      validationCommands: ['node scripts/validate-semaphor-data-app.mjs'],
      browserSmokeChecks: ['DevTools opens'],
    },
  };
}
