#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  runMissingFilterInputIdFixture();
  runFilterBindingScopeConflictFixture();
  runPresentationFilterScopeFixture();
  runMalformedManifestFixture();
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
  if (parsed.ok !== true || parsed.executableViewCount !== 2) {
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
  summary.views.push({
    id: 'commentary',
    title: 'Commentary',
    visual: 'text_block',
    computation: { kind: 'presentation_only' },
  });
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
        notAppliedToViewIds: ['margin_kpi'],
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
