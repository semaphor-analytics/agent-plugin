#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const generatorPath = path.join(scriptDir, "generate-data-app-contract.mjs");
const validatorPath = path.join(scriptDir, "validate-semaphor-data-app.mjs");

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "semaphor-generator-fixture-"),
);

// Keep this suite focused on plugin-owned wrapper behavior. Deep SDK/codegen
// semantics are covered by react-semaphor/src/data-app-codegen and
// react-semaphor/src/shared/analytics-protocol tests.
try {
  await runSharedCodegenLoaderFixture();
  runGeneratedFilePathSafetyFixture();
  runValidPartialScopeFixture();
  runMalformedSummaryFixture();
  runRootLevelSummaryIssuePathFixture();
  runMalformedManifestFixture();
  runStructuredValidationFixtures();
  await runLiveFilterEffectSuccessValidationFixture();
  await runLiveGeneratedViewsSuccessValidationFixture();
  runLiveGeneratedViewsMissingTokenValidationFixture();
  runLiveGeneratedViewsFetchFailureValidationFixture();
  console.log("Semaphor generator fixture tests passed.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runGeneratedFilePathSafetyFixture() {
  const workspaceDir = path.join(tempRoot, "generated-file-path-safety");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify({ type: "module" }, null, 2),
  );
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ schemaVersion: "fixture" }, null, 2));
  const modulePath = path.join(workspaceDir, "malicious-codegen.mjs");
  fs.writeFileSync(
    modulePath,
    [
      "export function generateSemaphorDataAppContract() {",
      "  return {",
      '    schemaVersion: "fixture",',
      '    files: { "../escaped.ts": "escape", "sources.ts": "safe" },',
      '    manifest: { generatedContentHash: "sha256:fixture" },',
      '    contentHash: "sha256:fixture",',
      "    stats: {",
      "      inputCount: 0,",
      "      executableViewCount: 0,",
      "      presentationViewCount: 0,",
      "      queryCount: 0,",
      "      optionQueryCount: 0",
      "    },",
      '    usageExample: "",',
      "    warnings: []",
      "  };",
      "}",
      "",
    ].join("\n"),
  );
  const result = runGenerator({
    workspaceDir,
    summaryPath,
    env: {
      ...process.env,
      SEMAPHOR_DATA_APP_CODEGEN_MODULE: modulePath,
    },
  });
  if (result.status === 0) {
    throw new Error(
      `Expected generated file path safety fixture to fail:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  if (
    parsed.ok !== false ||
    !String(parsed.error || "").includes("must be a file name, not a path")
  ) {
    throw new Error(
      `Expected generated file path safety issue, saw:\n${result.stdout}\n${result.stderr}`,
    );
  }
  const escapedPath = path.join(workspaceDir, "src/semaphor/escaped.ts");
  if (fs.existsSync(escapedPath)) {
    throw new Error(`Generator wrote outside outputDir: ${escapedPath}`);
  }
}

async function runSharedCodegenLoaderFixture() {
  const workspaceDir = path.join(tempRoot, "shared-codegen-loader");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const moduleOnePath = path.join(workspaceDir, "codegen-one.mjs");
  const moduleTwoPath = path.join(workspaceDir, "codegen-two.mjs");
  fs.writeFileSync(
    moduleOnePath,
    [
      'export function validateCodegenSummary() { return ["from-one"]; }',
      'export function assertValidCodegenSummary() { throw new Error("from-one"); }',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    moduleTwoPath,
    [
      'export function validateCodegenSummary() { return ["from-two"]; }',
      'export function assertValidCodegenSummary() { throw new Error("from-two"); }',
      "",
    ].join("\n"),
  );
  const wrapperUrl = `${pathToFileURL(
    path.join(scriptDir, "shared-codegen-loader.mjs"),
  ).href}?fixture=${Date.now()}`;
  const previousModulePath = process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE;
  try {
    process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE = moduleOnePath;
    const wrapper = await import(wrapperUrl);
    let assertionMessage = "";
    try {
      await wrapper.assertValidCodegenSummary({});
    } catch (error) {
      assertionMessage = error instanceof Error ? error.message : String(error);
    }
    if (!assertionMessage.includes("from-one")) {
      throw new Error(
        `Expected shared codegen loader to call first module assertion, saw: ${assertionMessage}`,
      );
    }

    process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE = moduleTwoPath;
    const secondIssues = await wrapper.validateCodegenSummary({});
    if (secondIssues.join("|") !== "from-two") {
      throw new Error(
        `Expected wrapper to resolve and cache by module path, saw: ${secondIssues.join("|")}`,
      );
    }
  } finally {
    if (previousModulePath === undefined) {
      delete process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE;
    } else {
      process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE = previousModulePath;
    }
  }
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
  runMissingSharedCodegenValidationFixture();
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

function runMissingSharedCodegenValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-missing-shared-codegen",
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
      `Expected missing-shared-codegen fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  const env = { ...process.env };
  env.SEMAPHOR_DATA_APP_CODEGEN_MODULE = path.join(
    workspaceDir,
    "missing-codegen-module.mjs",
  );
  const result = runValidatorJson({ workspaceDir, env });
  if (result.status === 0) {
    throw new Error(
      "Expected missing-shared-codegen validation fixture to fail.",
    );
  }
  const parsed = parseValidationJson(result);
  assertIssueCode(
    parsed,
    "invalid_contract_manifest",
    result,
    "missing-shared-codegen validation",
  );
  const manifestIssue = parsed.issues.find(
    (issue) => issue.code === "invalid_contract_manifest",
  );
  if (
    !manifestIssue ||
    !String(manifestIssue.message || "").includes(
      "could not load react-semaphor/data-app-codegen/node",
    )
  ) {
    throw new Error(
      `Expected missing-shared-codegen validation to preserve structured load failure:\n${result.stdout}\n${result.stderr}`,
    );
  }
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

async function runLiveGeneratedViewsSuccessValidationFixture() {
  const workspaceDir = path.join(
    tempRoot,
    "validation-live-generated-views-success",
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
  const summaryPath = path.join(workspaceDir, "codegen-summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  const generatorResult = runGenerator({ workspaceDir, summaryPath });
  if (generatorResult.status !== 0) {
    throw new Error(
      `Expected live generated-views success fixture generation to pass:\n${generatorResult.stdout}\n${generatorResult.stderr}`,
    );
  }
  writeMinimalRuntimeApp(workspaceDir);

  const server = await startFixtureExecuteServer(() => ({
    records: [{ value: 1 }],
    rowCount: 1,
  }));
  try {
    const env = liveValidationEnv(server.url);
    const result = await runValidatorJsonAsync({
      workspaceDir,
      extraArgs: ["--live-generated-views"],
      env,
    });
    if (result.status !== 0) {
      throw new Error(
        `Expected live generated-views success validation to pass:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const parsed = parseValidationJson(result);
    if (parsed.ok !== true) {
      throw new Error(
        `Expected live generated-views success validation to return ok true:\n${result.stdout}\n${result.stderr}`,
      );
    }
    if (server.requests.length !== summary.views.length) {
      throw new Error(
        `Expected one live generated-view request per generated query, saw ${server.requests.length}.`,
      );
    }
    for (const request of server.requests) {
      if (
        request.method !== "POST" ||
        request.url !== "/api/v1/data-app/execute"
      ) {
        throw new Error(
          `Unexpected live generated-view request target: ${request.method} ${request.url}`,
        );
      }
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

function runGenerator({ workspaceDir, summaryPath, env = process.env }) {
  return spawnSync(
    process.execPath,
    [generatorPath, "--dir", workspaceDir, "--plan", summaryPath, "--json"],
    {
      cwd: pluginRoot,
      encoding: "utf8",
      env,
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
      '  export type SemaphorDataType = "string" | "number" | "boolean" | "date" | "datetime" | "unknown";',
      "  export type SemaphorFieldRef = { name: string; source?: SemaphorSourceRef; sourceKey?: string; label?: string; role?: string; dataType?: SemaphorDataType; aggregate?: string; [key: string]: unknown };",
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
