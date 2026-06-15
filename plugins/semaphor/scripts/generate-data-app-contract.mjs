#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { importSharedCodegen } from './data-app-codegen-summary-validation.mjs';

const DEFAULT_OUTPUT_DIR = 'src/semaphor/generated';
const CODEGEN_SUMMARY_ROOT_FIELDS = new Set([
  'schemaVersion',
  'title',
  'purpose',
  'userGoal',
  'nextStep',
  'sources',
  'inputs',
  'views',
  'filterContracts',
  'implementationChecklist',
  'unsupportedInsights',
  'assumptions',
  'validation',
]);

const args = parseArgs(process.argv.slice(2));

try {
  const workspaceDir = path.resolve(firstString(args.dir, args.workspaceDir, process.cwd()));
  const outputDir = path.resolve(workspaceDir, firstString(args.output, args.outputDir, DEFAULT_OUTPUT_DIR));
  assertInsideDirectory({
    parentDir: workspaceDir,
    childPath: outputDir,
    label: 'outputDir',
  });
  const summary = readPlanArtifact({ args, workspaceDir });
  const sharedCodegen = await importSharedCodegen({ workspaceDir });
  if (typeof sharedCodegen.generateSemaphorDataAppContract !== 'function') {
    throw new Error(
      'Installed react-semaphor/data-app-codegen/node does not export generateSemaphorDataAppContract. Update or link a compatible react-semaphor build.',
    );
  }
  const generatedContract = sharedCodegen.generateSemaphorDataAppContract(summary, {
    allowEmpty:
      booleanArg(args.allowEmpty) ||
      booleanArg(args['allow-empty']) ||
      booleanArg(args.allowEmptyContract),
    generatorName: 'semaphor-agent-plugin',
    generatorVersion: readPluginPackageVersion(),
  });
  const files = generatedContract.files;
  const manifest = generatedContract.manifest;
  const generatedFileEntries = Object.entries(files).map(([fileName, content]) => ({
    fileName,
    filePath: resolveGeneratedFilePath({ outputDir, fileName }),
    content,
  }));

  fs.mkdirSync(outputDir, { recursive: true });
  for (const { filePath, content } of generatedFileEntries) {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  const generatedFiles = generatedFileEntries.map(({ filePath }) =>
    path.relative(workspaceDir, filePath),
  );
  const result = {
    ok: true,
    workspaceDir,
    outputDir: path.relative(workspaceDir, outputDir),
    schemaVersion: generatedContract.schemaVersion,
    manifestPath: path.relative(workspaceDir, path.join(outputDir, 'contract.manifest.json')),
    contentHash: generatedContract.contentHash || manifest.generatedContentHash,
    generatedFiles,
    inputCount: generatedContract.stats.inputCount,
    executableViewCount: generatedContract.stats.executableViewCount,
    presentationViewCount: generatedContract.stats.presentationViewCount,
    queryCount: generatedContract.stats.queryCount,
    optionQueryCount: generatedContract.stats.optionQueryCount,
    validationCommand:
      'semaphor_validate_data_app_contract(runBuild=true, strict=false)',
    usageExample: generatedContract.usageExample,
    warnings: generatedContract.warnings,
  };
  writeResult(result);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeResult({
    ok: false,
    error: message,
    issues: issuesForGenerationError(message),
  });
  process.exit(1);
}

function issuesForGenerationError(message) {
  if (!message.startsWith('Invalid Semaphor codegenSummary:')) {
    return [
      {
        code: 'contract_generation_failed',
        severity: 'error',
        message,
      },
    ];
  }
  return message
    .split(/\r?\n/)
    .map((line) => line.replace(/^- /, '').trim())
    .filter(Boolean)
    .filter((line) => line !== 'Invalid Semaphor codegenSummary:')
    .map((line) => ({
      code: codegenSummaryIssueCode(line),
      severity: 'error',
      message: line,
      path: codegenSummaryIssuePath(line),
      repairHint: codegenSummaryIssueRepairHint(line),
    }));
}

function codegenSummaryIssueCode(message) {
  if (
    /^unsupportedInsights\.\d+\.reason missing_relationship blocks contract generation/.test(message) ||
    /^views\.\d+\.computation\.reason missing_relationship blocks contract generation/.test(message)
  ) {
    return 'semantic_relationship_repair_required';
  }
  if (/^validation\.status blocked cannot be generated/.test(message)) {
    return 'blocked_codegen_summary';
  }
  if (/\.sdkSpec\.builder must match queryKind/.test(message)) {
    return 'sdk_builder_query_kind_mismatch';
  }
  if (/\.sdkSpec\.builder must match sdkBuilder/.test(message)) {
    return 'sdk_builder_declared_builder_mismatch';
  }
  if (/\.computation\.queryKind must match queryKind/.test(message)) {
    return 'computation_query_kind_mismatch';
  }
  if (/\.sdkSpec\.spec\.[^.]+ is not supported for this SDK builder/.test(message)) {
    return 'sdk_spec_unsupported_field';
  }
  if (/\.sdkSpec\.spec\./.test(message)) {
    return 'invalid_sdk_spec';
  }
  if (/^sources\.\d+/.test(message)) {
    return 'invalid_source_ref';
  }
  if (/^views\.\d+/.test(message)) {
    return 'invalid_codegen_view';
  }
  if (/^inputs\.\d+/.test(message)) {
    return 'invalid_codegen_input';
  }
  if (/^filterContracts\.\d+/.test(message)) {
    return 'invalid_filter_contract';
  }
  return 'invalid_codegen_summary';
}

function codegenSummaryIssuePath(message) {
  const match = message.match(
    /^([A-Za-z][A-Za-z0-9]*(?:\.\d+|\.[A-Za-z_][A-Za-z0-9_]*)*)\b/,
  );
  const candidate = match?.[1];
  if (!candidate) {
    return undefined;
  }
  const [rootField] = candidate.split('.');
  if (!CODEGEN_SUMMARY_ROOT_FIELDS.has(rootField)) {
    return undefined;
  }
  return candidate;
}

function codegenSummaryIssueRepairHint(message) {
  const code = codegenSummaryIssueCode(message);
  if (
    code === 'sdk_builder_query_kind_mismatch' ||
    code === 'sdk_builder_declared_builder_mismatch' ||
    code === 'computation_query_kind_mismatch'
  ) {
    return 'Keep view.queryKind, view.sdkBuilder, view.computation.queryKind, and view.sdkSpec.builder aligned to the same executable query family.';
  }
  if (code === 'sdk_spec_unsupported_field') {
    return 'Remove fields that are not part of the selected semaphor.* SDK builder spec, or change the builder/queryKind intentionally.';
  }
  if (code === 'invalid_sdk_spec') {
    return 'Regenerate the SDK spec from the accepted typed codegenSummary contract instead of hand-editing builder arguments.';
  }
  if (code === 'semantic_relationship_repair_required') {
    return 'Call semaphor_propose_semantic_model_change, apply an explicitly approved semantic model patch, then replan before generating local contract files.';
  }
  if (code === 'blocked_codegen_summary') {
    return 'Resolve the blocked Data App planning state and rerun planning before generating local contract files.';
  }
  return 'Regenerate or repair the codegenSummary before generating local contract files.';
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    if (key === 'stdin' || key === 'json') {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function readPlanArtifact({ args, workspaceDir }) {
  if (args.stdin) {
    const input = fs.readFileSync(0, 'utf8');
    if (!input.trim()) {
      throw new Error('No JSON was provided on stdin.');
    }
    return JSON.parse(input);
  }

  const planPath = firstString(args.plan, args.planArtifactPath, args.codegenSummaryPath);
  if (!planPath) {
    throw new Error(
      'Pass --plan <path> with a codegenSummary/plan artifact. --stdin is only a manual CLI fallback.',
    );
  }

  const resolvedPlanPath = path.resolve(workspaceDir, planPath);
  return JSON.parse(fs.readFileSync(resolvedPlanPath, 'utf8'));
}

function assertInsideDirectory({ parentDir, childPath, label }) {
  const relative = path.relative(parentDir, childPath);
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(`${label} must resolve inside workspaceDir.`);
}

function resolveGeneratedFilePath({ outputDir, fileName }) {
  if (
    typeof fileName !== 'string' ||
    !fileName.trim() ||
    fileName !== path.basename(fileName)
  ) {
    throw new Error(
      `Generated file ${JSON.stringify(fileName)} must be a file name, not a path.`,
    );
  }
  const filePath = path.resolve(outputDir, fileName);
  assertInsideDirectory({
    parentDir: outputDir,
    childPath: filePath,
    label: `Generated file ${JSON.stringify(fileName)}`,
  });
  return filePath;
}

function readPluginPackageVersion() {
  try {
    const packagePath = path.resolve(path.dirname(process.argv[1]), '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function booleanArg(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || '';
}

function writeResult(result) {
  const payload = JSON.stringify(result, null, 2);
  if (args.json || !result.ok) {
    process.stdout.write(`${payload}\n`);
    return;
  }
  process.stdout.write([
    result.ok
      ? 'Semaphor Data App contract generated.'
      : 'Semaphor Data App contract generation failed.',
    payload,
  ].join('\n'));
}
