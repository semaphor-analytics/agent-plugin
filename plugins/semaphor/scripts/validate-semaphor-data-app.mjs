#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  validateCodegenSummary,
} from "./data-app-codegen-summary-validation.mjs";

const GENERATED_CONTRACT_DIR = path.join("src", "semaphor", "generated");
const CONTRACT_MANIFEST_SCHEMA_VERSION = "semaphor-generated-data-app-contract-manifest/v1";
const REQUIRED_GENERATED_FILES = [
  "sources.ts",
  "fields.ts",
  "inputs.ts",
  "queries.ts",
  "bindings.ts",
  "accessors.ts",
  "metadata.ts",
  "index.ts",
  "contract.manifest.json",
];

const SKIPPED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".vite",
  "coverage",
]);

function parseArgs(argv) {
  const args = {
    dir: process.cwd(),
    runBuild: true,
    strict: false,
    liveFilterEffect: false,
    filterEffectSamples: 2,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir") {
      args.dir = argv[index + 1];
      index += 1;
    } else if (arg === "--no-run") {
      args.runBuild = false;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--devtools-snapshot") {
      args.devtoolsSnapshotPath = argv[index + 1];
      index += 1;
    } else if (arg === "--filter-effect-report") {
      args.filterEffectReportPath = argv[index + 1];
      index += 1;
    } else if (arg === "--live-filter-effect") {
      args.liveFilterEffect = true;
    } else if (arg === "--filter-effect-samples") {
      args.filterEffectSamples = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectSourceFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        collectSourceFiles(root, path.join(current, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && /\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      files.push(path.join(current, entry.name));
    }
  }
  return files;
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  return "npm";
}

function formatLocation(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function readSources(files) {
  return files.map((filePath) => ({
    filePath,
    content: fs.readFileSync(filePath, "utf8"),
  }));
}

function sourceContains(sources, needle) {
  return sources.some((source) => source.content.includes(needle));
}

function sourceMatches(sources, pattern) {
  return sources.some((source) => pattern.test(source.content));
}

function isGeneratedFile(root, filePath) {
  return formatLocation(root, filePath).startsWith(`${GENERATED_CONTRACT_DIR}/`);
}

function scanDataAppPreflight(root, sources) {
  const issues = [];
  const advisories = [];

  const sdkSources = sources.filter((source) =>
    source.content.includes("react-semaphor/data-app-sdk"),
  );
  const usesSdk = sdkSources.length > 0;
  const generatedDir = path.join(root, GENERATED_CONTRACT_DIR);
  const hasGeneratedContract =
    fs.existsSync(generatedDir) &&
    REQUIRED_GENERATED_FILES.some((fileName) =>
      fs.existsSync(path.join(generatedDir, fileName)),
    );
  const usesDataAppRuntime =
    hasGeneratedContract ||
    sourceMatches(
      sdkSources,
      /\b(?:useSemaphorQuery|useSemaphorInputs)\s*\(|\bsemaphor\.(?:metric|records|analysis|matrix|sql|filter|inputOptions)\s*\(/,
    );

  if (!usesSdk) {
    advisories.push("No imports from react-semaphor/data-app-sdk were found.");
    if (hasGeneratedContract) {
      issues.push(...scanGeneratedContract(root, generatedDir));
    }
    return { issues, advisories, sdkSources, hasGeneratedContract };
  }

  if (usesDataAppRuntime && !sourceContains(sources, "SemaphorDataAppProvider")) {
    issues.push(
      "Data App SDK usage was found, but no SemaphorDataAppProvider usage was found.",
    );
  }

  if (usesDataAppRuntime && !sourceContains(sources, "SemaphorDevtools")) {
    issues.push(
      "Generated local/dev Data Apps should mount one root <SemaphorDevtools /> under SemaphorDataAppProvider.",
    );
  }

  if (usesDataAppRuntime && !sourceContains(sources, "exposeWindowBridge")) {
    issues.push(
      "Generated local/dev Data Apps should enable the provider debug window bridge behind a local/authoring gate.",
    );
  }

  if (hasGeneratedContract) {
    issues.push(...scanGeneratedContract(root, generatedDir));
    if (!importsGeneratedContract(root, sources)) {
      issues.push(
        "src/semaphor/generated exists, but app UI files do not import it. Import generated sources, fields, inputs, queries, and bindings instead of hand-rolling analytics wiring.",
      );
    }
  } else if (sourceMatches(sdkSources, /\bsemaphor\.(?:metric|records|analysis|matrix|sql|filter|inputOptions)\s*\(/)) {
    advisories.push(
      "Semaphor SDK builders were found without src/semaphor/generated. For broad planner-generated apps, prefer semaphor_generate_data_app_contract and import the generated contract.",
    );
  }

  const manualSpecFiles = sources.filter(
    (source) =>
      !isGeneratedFile(root, source.filePath) &&
      /\bsemaphor\.(?:source|metric|records|analysis|matrix|sql|filter|inputOptions)\s*\(/.test(
        source.content,
      ),
  );
  if (manualSpecFiles.length > 2 && hasGeneratedContract) {
    advisories.push(
      `Found Semaphor specs outside ${GENERATED_CONTRACT_DIR} in ${manualSpecFiles.length} files. Keep broad generated app analytics specs in the generated contract and keep UI files focused on rendering.`,
    );
  }

  return { issues, advisories, sdkSources, hasGeneratedContract };
}

function importsGeneratedContract(root, sources) {
  return sources
    .filter((source) => !isGeneratedFile(root, source.filePath))
    .some((source) =>
      /from\s+["'][^"']*(?:src\/)?semaphor\/generated(?:\/index)?["']/.test(
        source.content,
      ) ||
      /from\s+["'][^"']*\/semaphor\/generated(?:\/index)?["']/.test(
        source.content,
      ) ||
      /from\s+["'][.@/][^"']*semaphor\/generated(?:\/index)?["']/.test(
        source.content,
      ),
    );
}

function scanGeneratedContract(root, generatedDir) {
  const issues = [];
  for (const fileName of REQUIRED_GENERATED_FILES) {
    const filePath = path.join(generatedDir, fileName);
    if (!fs.existsSync(filePath)) {
      issues.push(`Generated Semaphor contract is incomplete: missing ${GENERATED_CONTRACT_DIR}/${fileName}.`);
    }
  }
  issues.push(...validateGeneratedContractManifest(root, generatedDir));

  for (const filePath of collectSourceFiles(generatedDir)) {
    const location = formatLocation(root, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/\bany\b|@ts-(?:ignore|expect-error)\b/.test(line)) {
        issues.push(
          `${location}:${index + 1}: generated contract files must be fully typed; regenerate instead of using any or TypeScript suppression comments.`,
        );
      }
      if (
        /semaphor\.(?:metric|records|analysis|matrix|sql)\s*\(\s*\{\s*["']id["']\s*:/.test(line) &&
        /["']id["']\s*:[^,\n]+,\s*["']kind["']\s*:/.test(line)
      ) {
        issues.push(
          `${location}:${index + 1}: generated query specs must not include top-level kind inside semaphor.* builder options.`,
        );
      }
      if (/relationshipsUsed\s*:/.test(line)) {
        issues.push(
          `${location}:${index + 1}: generated runtime bindings must not pass relationshipsUsed into the SDK. Emit relationshipHint for semaphor.bindInput and keep relationshipsUsed as metadata/evidence only.`,
        );
      }
    }
  }
  return issues;
}

function validateGeneratedContractManifest(root, generatedDir) {
  const issues = [];
  const manifestPath = path.join(generatedDir, "contract.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return issues;
  }
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    return [`${formatLocation(root, manifestPath)}: could not parse generated contract manifest: ${error.message}`];
  }
  if (manifest?.schemaVersion !== CONTRACT_MANIFEST_SCHEMA_VERSION) {
    issues.push(
      `${formatLocation(root, manifestPath)}: schemaVersion must be ${CONTRACT_MANIFEST_SCHEMA_VERSION}. Regenerate the contract with semaphor_create_data_app_contract.`,
    );
  }
  for (const issue of validateCodegenSummary(manifest?.codegenSummary)) {
    issues.push(`${formatLocation(root, manifestPath)}: codegenSummary.${issue}`);
  }
  if (typeof manifest?.codegenSummaryHash !== "string") {
    issues.push(`${formatLocation(root, manifestPath)}: codegenSummaryHash is required.`);
  } else if (manifest?.codegenSummary && typeof manifest.codegenSummary === "object") {
    const expectedSummaryHash = hashCanonicalJson(manifest.codegenSummary);
    if (manifest.codegenSummaryHash !== expectedSummaryHash) {
      issues.push(
        `${formatLocation(root, manifestPath)}: codegenSummaryHash does not match codegenSummary. Regenerate the contract instead of editing the manifest.`,
      );
    }
  }
  const inputIds = new Set((manifest?.codegenSummary?.inputs || [])
    .map((input) => input?.id)
    .filter((id) => typeof id === "string" && id.length > 0));
  const viewIds = new Set((manifest?.codegenSummary?.views || [])
    .map((view) => view?.id)
    .filter((id) => typeof id === "string" && id.length > 0));
  for (const [index, filterContract] of (manifest?.codegenSummary?.filterContracts || []).entries()) {
    if (!filterContract?.inputId || !inputIds.has(filterContract.inputId)) {
      issues.push(
        `${formatLocation(root, manifestPath)}: codegenSummary.filterContracts.${index}.inputId must reference a generated input.`,
      );
    }
    if (!Array.isArray(filterContract?.bindings)) {
      continue;
    }
    for (const [bindingIndex, binding] of (filterContract?.bindings || []).entries()) {
      if (!binding?.viewId || !viewIds.has(binding.viewId)) {
        issues.push(
          `${formatLocation(root, manifestPath)}: codegenSummary.filterContracts.${index}.bindings.${bindingIndex}.viewId must reference a generated view.`,
        );
      }
      if (!binding?.fieldRef?.name) {
        issues.push(
          `${formatLocation(root, manifestPath)}: codegenSummary.filterContracts.${index}.bindings.${bindingIndex}.fieldRef is required.`,
        );
      }
    }
  }
  const expectedHash = hashGeneratedFiles(generatedDir);
  if (manifest?.generatedContentHash !== expectedHash) {
    issues.push(
      `${formatLocation(root, manifestPath)}: generatedContentHash does not match generated TypeScript files. Regenerate the contract instead of hand-editing generated files.`,
    );
  }
  return issues;
}

function hashGeneratedFiles(generatedDir) {
  const hash = crypto.createHash("sha256");
  const fileNames = REQUIRED_GENERATED_FILES
    .filter((fileName) => fileName.endsWith(".ts"))
    .sort();
  for (const fileName of fileNames) {
    const filePath = path.join(generatedDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    hash.update(fileName);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath, "utf8"));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function hashCanonicalJson(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function checkReactSemaphorCompatibility(root) {
  const issues = [];
  const advisories = [];
  const packagePath = path.join(root, "node_modules", "react-semaphor", "package.json");
  if (!fs.existsSync(packagePath)) {
    advisories.push(
      "react-semaphor is listed as a dependency, but node_modules/react-semaphor was not found. Run install before relying on SDK export compatibility checks.",
    );
    return { issues, advisories };
  }

  try {
    const pkg = readJson(packagePath);
    const exportsMap = pkg.exports || {};
    if (!Object.prototype.hasOwnProperty.call(exportsMap, "./data-app-sdk")) {
      issues.push(
        `Installed react-semaphor${pkg.version ? `@${pkg.version}` : ""} does not expose react-semaphor/data-app-sdk. Update react-semaphor or relink the local package before generating Data App SDK code.`,
      );
    } else {
      advisories.push(
        `Installed react-semaphor${pkg.version ? `@${pkg.version}` : ""} exposes react-semaphor/data-app-sdk.`,
      );
    }
    advisories.push(...detectDuplicateReactCopies(root));
    advisories.push(...detectViteReactDedupeAdvisories(root));
  } catch (error) {
    issues.push(`Could not inspect installed react-semaphor package: ${error.message}`);
  }
  return { issues, advisories };
}

function detectDuplicateReactCopies(root) {
  const advisories = [];
  const duplicateChecks = [
    {
      packageName: "react",
      appPackagePath: path.join(root, "node_modules", "react", "package.json"),
      linkedPackagePath: path.join(root, "node_modules", "react-semaphor", "node_modules", "react", "package.json"),
    },
    {
      packageName: "react-dom",
      appPackagePath: path.join(root, "node_modules", "react-dom", "package.json"),
      linkedPackagePath: path.join(root, "node_modules", "react-semaphor", "node_modules", "react-dom", "package.json"),
    },
  ];

  for (const check of duplicateChecks) {
    const appRealPath = realpathIfExists(check.appPackagePath);
    const linkedRealPath = realpathIfExists(check.linkedPackagePath);
    if (!appRealPath || !linkedRealPath || appRealPath === linkedRealPath) {
      continue;
    }
    const appVersion = readPackageVersion(check.appPackagePath);
    const linkedVersion = readPackageVersion(check.linkedPackagePath);
    advisories.push(
      [
        `Possible duplicate ${check.packageName} copies detected between the app and linked react-semaphor.`,
        `App ${check.packageName}${appVersion ? `@${appVersion}` : ""}: ${path.dirname(appRealPath)}.`,
        `react-semaphor nested ${check.packageName}${linkedVersion ? `@${linkedVersion}` : ""}: ${path.dirname(linkedRealPath)}.`,
        "This usually happens with npm link/local repo development and can cause invalid hook call or useMemo dispatcher errors in published bundles.",
        "For Vite apps, add resolve.alias for react/react-dom to the app root node_modules and resolve.dedupe: [\"react\", \"react-dom\"].",
      ].join(" "),
    );
  }

  return advisories;
}

function detectViteReactDedupeAdvisories(root) {
  const packageJsonPath = path.join(root, "package.json");
  const pkg = fs.existsSync(packageJsonPath) ? readJson(packageJsonPath) : {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (!deps.vite) {
    return [];
  }
  const configPath = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
  ]
    .map((fileName) => path.join(root, fileName))
    .find((filePath) => fs.existsSync(filePath));
  if (!configPath) {
    return [];
  }
  const config = fs.readFileSync(configPath, "utf8");
  if (config.includes("dedupe") && config.includes("react") && config.includes("react-dom")) {
    return [];
  }
  return [
    `${formatLocation(root, configPath)} does not appear to dedupe react and react-dom. If this app uses linked/local react-semaphor during development, add Vite resolve.dedupe for react/react-dom to avoid duplicate React hook-dispatcher errors.`,
  ];
}

function realpathIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.realpathSync(filePath) : "";
  } catch {
    return "";
  }
}

function readPackageVersion(packagePath) {
  try {
    return readJson(packagePath).version || "";
  } catch {
    return "";
  }
}

function runScript(root, packageManager, scriptName) {
  const command =
    packageManager === "pnpm"
      ? ["pnpm", [scriptName]]
      : packageManager === "yarn"
        ? ["yarn", [scriptName]]
        : packageManager === "bun"
          ? ["bun", ["run", scriptName]]
          : ["npm", ["run", scriptName]];

  console.log(`Running ${command[0]} ${command[1].join(" ")}...`);
  const result = spawnSync(command[0], command[1], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  return result.status === 0;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: validate-semaphor-data-app.mjs [--dir <path>] [--no-run] [--strict] [--devtools-snapshot <path>] [--filter-effect-report <path>] [--live-filter-effect] [--filter-effect-samples <n>]");
    process.exit(0);
  }

  const root = path.resolve(args.dir);
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`No package.json found at ${packageJsonPath}`);
    process.exit(1);
  }

  const pkg = readJson(packageJsonPath);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const issues = [];
  const advisories = [];

  if (!deps.react) issues.push("Missing react dependency.");
  if (!deps["react-semaphor"]) issues.push("Missing react-semaphor dependency.");

  const sourceFiles = collectSourceFiles(root);
  const sources = readSources(sourceFiles);
  const preflight = scanDataAppPreflight(root, sources);
  const sdkCompatibility = deps["react-semaphor"]
    ? checkReactSemaphorCompatibility(root)
    : { issues: [], advisories: [] };

  issues.push(...preflight.issues, ...sdkCompatibility.issues);
  advisories.push(...preflight.advisories, ...sdkCompatibility.advisories);
  if (args.devtoolsSnapshotPath) {
    issues.push(...validateDevtoolsSnapshot({
      root,
      snapshotPath: args.devtoolsSnapshotPath,
    }));
  }
  if (args.filterEffectReportPath) {
    issues.push(...validateFilterEffectReport({
      root,
      reportPath: args.filterEffectReportPath,
    }));
  }
  if (args.liveFilterEffect) {
    const liveFilterResult = await validateLiveFilterEffects({
      root,
      sampleCount: Number.isFinite(args.filterEffectSamples)
        ? Math.max(1, args.filterEffectSamples)
        : 2,
    });
    issues.push(...liveFilterResult.issues);
    advisories.push(...liveFilterResult.advisories);
  }

  console.log(`Checked ${sourceFiles.length} source files.`);
  console.log(`SDK import files: ${preflight.sdkSources.length}`);
  for (const source of preflight.sdkSources.slice(0, 20)) {
    console.log(`- ${formatLocation(root, source.filePath)}`);
  }

  if (advisories.length > 0) {
    console.log("");
    console.log(args.strict ? "Validation strict issues:" : "Validation advisories:");
    for (const advisory of advisories) {
      console.log(`- ${advisory}`);
    }
  }
  if (args.strict) {
    issues.push(...advisories);
  }

  if (issues.length > 0) {
    console.log("");
    console.log("Validation issues:");
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
  }

  let scriptsOk = true;
  if (args.runBuild) {
    const packageManager = detectPackageManager(root);
    if (scripts.typecheck) {
      scriptsOk = runScript(root, packageManager, "typecheck") && scriptsOk;
    }
    if (scripts.build) {
      scriptsOk = runScript(root, packageManager, "build") && scriptsOk;
    }
  }

  if (issues.length > 0 || !scriptsOk) {
    process.exit(1);
  }
  console.log("Semaphor data app preflight passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function validateDevtoolsSnapshot({ root, snapshotPath }) {
  const issues = [];
  const manifestPath = path.join(root, GENERATED_CONTRACT_DIR, "contract.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return [
      "DevTools snapshot validation requires src/semaphor/generated/contract.manifest.json.",
    ];
  }
  const resolvedSnapshotPath = path.resolve(root, snapshotPath);
  if (!fs.existsSync(resolvedSnapshotPath)) {
    return [`DevTools snapshot file was not found: ${formatLocation(root, resolvedSnapshotPath)}.`];
  }
  let snapshot;
  try {
    snapshot = readJson(resolvedSnapshotPath);
  } catch (error) {
    return [`DevTools snapshot file could not be parsed: ${error.message}`];
  }
  const manifest = readJson(manifestPath);
  const expectedQueryIds = (manifest.codegenSummary?.views || [])
    .filter((view) => view?.sdkSpec?.builder && view?.sdkSpec?.spec)
    .map((view) => view.id)
    .filter(Boolean);
  const expectedOptionQueryIds = (manifest.codegenSummary?.inputs || [])
    .filter((input) => input?.optionQuery)
    .map((input) => input.optionQuery.id || `${input.id}-options`)
    .filter(Boolean);
  const observedIds = collectDevtoolsTraceIds(snapshot);
  for (const queryId of expectedQueryIds) {
    if (!observedIds.has(queryId)) {
      issues.push(`DevTools snapshot is missing generated query trace "${queryId}".`);
    }
  }
  for (const queryId of expectedOptionQueryIds) {
    if (!observedIds.has(queryId)) {
      issues.push(`DevTools snapshot is missing generated input option trace "${queryId}".`);
    }
  }
  return issues;
}

function collectDevtoolsTraceIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") {
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDevtoolsTraceIds(item, ids);
    }
    return ids;
  }
  if (typeof value.queryId === "string" && value.queryId.trim()) {
    ids.add(value.queryId.trim());
  }
  if (typeof value.inputOptionQueryId === "string" && value.inputOptionQueryId.trim()) {
    ids.add(value.inputOptionQueryId.trim());
  }
  for (const item of Object.values(value)) {
    collectDevtoolsTraceIds(item, ids);
  }
  return ids;
}

function validateFilterEffectReport({ root, reportPath }) {
  const manifestPath = path.join(root, GENERATED_CONTRACT_DIR, "contract.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return [
      "Filter-effect report validation requires src/semaphor/generated/contract.manifest.json.",
    ];
  }
  const resolvedReportPath = path.resolve(root, reportPath);
  if (!fs.existsSync(resolvedReportPath)) {
    return [`Filter-effect report file was not found: ${formatLocation(root, resolvedReportPath)}.`];
  }
  let report;
  try {
    report = readJson(resolvedReportPath);
  } catch (error) {
    return [`Filter-effect report file could not be parsed: ${error.message}`];
  }
  const manifest = readJson(manifestPath);
  const filterContracts = manifest.codegenSummary?.filterContracts || [];
  const checks = Array.isArray(report?.checks)
    ? report.checks
    : Array.isArray(report?.filterEffects)
      ? report.filterEffects
      : [];
  const checksByInputId = new Map(checks
    .filter((check) => typeof check?.inputId === "string")
    .map((check) => [check.inputId, check]));
  const issues = [];
  for (const filterContract of filterContracts) {
    const appliesToViewIds = Array.isArray(filterContract?.appliesToViewIds)
      ? filterContract.appliesToViewIds
      : [];
    if (appliesToViewIds.length === 0) {
      continue;
    }
    const check = checksByInputId.get(filterContract.inputId);
    if (!check) {
      issues.push(
        `Filter-effect report is missing generated input "${filterContract.inputId}".`,
      );
      continue;
    }
    const evidenceViewIds = new Set([
      ...arrayStrings(check.changedQueryIds),
      ...arrayStrings(check.reranQueryIds),
      ...arrayStrings(check.affectedViewIds),
      ...arrayStrings(check.changedViewIds),
    ]);
    const hasSubscribedEvidence = appliesToViewIds.some((viewId) =>
      evidenceViewIds.has(viewId)
    );
    if (check.passed !== true && !hasSubscribedEvidence) {
      issues.push(
        `Filter-effect report for "${filterContract.inputId}" must show a subscribed generated query reran or changed.`,
      );
    }
  }
  return issues;
}

async function validateLiveFilterEffects({ root, sampleCount }) {
  const manifestPath = path.join(root, GENERATED_CONTRACT_DIR, "contract.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      issues: [
        "Live filter-effect validation requires src/semaphor/generated/contract.manifest.json.",
      ],
      advisories: [],
    };
  }

  const manifest = readJson(manifestPath);
  const summary = manifest.codegenSummary || {};
  const optionInputs = (summary.inputs || []).filter((input) => input?.optionQuery);
  const filterContracts = summary.filterContracts || [];
  if (optionInputs.length === 0 || filterContracts.length === 0) {
    return {
      issues: [],
      advisories: [
        "Live filter-effect validation skipped because no generated option-backed filters were found.",
      ],
    };
  }

  const env = readLocalEnv(root);
  const token =
    env.VITE_SEMAPHOR_PROJECT_TOKEN ||
    env.SEMAPHOR_PROJECT_TOKEN ||
    process.env.VITE_SEMAPHOR_PROJECT_TOKEN ||
    process.env.SEMAPHOR_PROJECT_TOKEN;
  if (!token) {
    return {
      issues: [
        "Live filter-effect validation requires VITE_SEMAPHOR_PROJECT_TOKEN or SEMAPHOR_PROJECT_TOKEN in the environment or the app's .env.local.",
      ],
      advisories: [],
    };
  }
  const executeUrl = resolveDataAppExecuteUrl({ env, token });
  if (!executeUrl) {
    return {
      issues: [
        "Live filter-effect validation could not resolve the Semaphor execute URL. Set SEMAPHOR_SERVER_URL or use a runtime token that includes apiServiceUrl.",
      ],
      advisories: [],
    };
  }

  const context = {
    executeUrl,
    token,
    sourcesByKey: new Map((summary.sources || [])
      .filter((source) => typeof source?.sourceKey === "string")
      .map((source) => [source.sourceKey, stripSourceKey(source)])),
  };
  const issues = [];
  const advisories = [];

  for (const filterContract of filterContracts) {
    const input = optionInputs.find((candidate) => candidate.id === filterContract.inputId);
    const appliesToViewIds = Array.isArray(filterContract.appliesToViewIds)
      ? filterContract.appliesToViewIds
      : [];
    if (!input || appliesToViewIds.length === 0) {
      continue;
    }
    const optionIntent = buildInputOptionIntent(input, filterContract, context);
    if (!optionIntent) {
      issues.push(`Live filter-effect validation could not build option query for "${filterContract.inputId}".`);
      continue;
    }

    const optionsResult = await executeDataAppIntent({
      context,
      intent: optionIntent,
      activeInputs: [],
    });
    if (!optionsResult.ok) {
      issues.push(
        `Input "${filterContract.inputId}" option query failed${formatExecutionFailureClassification(optionsResult.error)}: ${optionsResult.error}`,
      );
      continue;
    }
    const options = extractOptions(optionsResult.data).slice(0, sampleCount);
    if (options.length === 0) {
      issues.push(`Input "${filterContract.inputId}" option query returned no usable options.`);
      continue;
    }

    const checkedViewIds = [];
    const usefulViewIds = [];
    const errors = [];
    const bindings = (filterContract.bindings || [])
      .filter((binding) => binding?.viewId && appliesToViewIds.includes(binding.viewId))
      .slice(0, 3);

    for (const binding of bindings) {
      const view = (summary.views || []).find((candidate) => candidate?.id === binding.viewId);
      const viewIntent = buildViewIntent(view, context);
      if (!viewIntent) {
        continue;
      }
      checkedViewIds.push(binding.viewId);
      const baseline = await executeDataAppIntent({
        context,
        intent: viewIntent,
        activeInputs: [],
      });
      if (!baseline.ok) {
        errors.push(
          `${binding.viewId} baseline failed${formatExecutionFailureClassification(baseline.error)}: ${baseline.error}`,
        );
        continue;
      }
      const baselineSummary = summarizeResultData(baseline.data);

      for (const option of options) {
        const filtered = await executeDataAppIntent({
          context,
          intent: viewIntent,
          activeInputs: [
            buildActiveInput({
              input,
              filterContract,
              binding,
              option,
              context,
            }),
          ],
        });
        if (!filtered.ok) {
          errors.push(
            `${binding.viewId} with ${filterContract.inputId}=${String(option.value)} failed${formatExecutionFailureClassification(filtered.error)}: ${filtered.error}`,
          );
          continue;
        }
        const filteredSummary = summarizeResultData(filtered.data);
        if (filterEffectLooksUseful({ baseline: baselineSummary, filtered: filteredSummary })) {
          usefulViewIds.push(binding.viewId);
          break;
        }
      }
    }

    if (checkedViewIds.length === 0) {
      issues.push(`Input "${filterContract.inputId}" has no executable subscribed views for live filter-effect validation.`);
      continue;
    }
    if (usefulViewIds.length === 0) {
      issues.push(
        `Input "${filterContract.inputId}" did not produce a non-empty/non-zero result for sampled subscribed views (${checkedViewIds.join(", ")}). ${errors.join(" ")}`.trim(),
      );
    }
  }

  if (issues.length === 0) {
    advisories.push(
      `Live filter-effect validation passed against ${executeUrl} for ${optionInputs.length} option-backed input(s).`,
    );
  }
  return { issues, advisories };
}

function formatExecutionFailureClassification(error) {
  const classification = classifyExecutionFailure(error);
  return classification ? ` [${classification}]` : "";
}

function classifyExecutionFailure(error) {
  const message = String(error || "").toLowerCase();
  if (
    message.includes("nameresolutionerror") ||
    message.includes("failed to resolve") ||
    message.includes("nodename nor servname provided")
  ) {
    return "warehouse_unreachable";
  }
  if (
    message.includes("econnrefused") ||
    message.includes("connection refused") ||
    message.includes("fetch failed")
  ) {
    return "local_runtime_unhealthy";
  }
  return "";
}

function readLocalEnv(root) {
  const values = { ...process.env };
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) {
    return values;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("export ")) {
      trimmed = trimmed.slice("export ".length).trim();
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripUnquotedInlineComment(
      trimmed.slice(separatorIndex + 1).trim(),
    );
    values[key] = unquoteEnvValue(value);
  }
  return values;
}

function stripUnquotedInlineComment(value) {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === '"' || character === "'") && value[index - 1] !== "\\") {
      quote = quote === character ? "" : quote || character;
      continue;
    }
    if (!quote && character === "#" && /\s/.test(value[index - 1] || "")) {
      return value.slice(0, index).trim();
    }
  }
  return value;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveDataAppExecuteUrl({ env, token }) {
  const explicitServerUrl =
    env.SEMAPHOR_SERVER_URL ||
    env.VITE_SEMAPHOR_SERVER_URL ||
    env.NEXT_PUBLIC_SEMAPHOR_SERVER_URL;
  if (explicitServerUrl) {
    return joinExecutePath(explicitServerUrl);
  }
  const explicitApiUrl =
    env.VITE_SEMAPHOR_API_SERVICE_URL ||
    env.SEMAPHOR_API_SERVICE_URL ||
    env.NEXT_PUBLIC_API_SERVICE_URL;
  if (explicitApiUrl) {
    return joinExecutePath(explicitApiUrl);
  }
  const payload = decodeJwtPayload(token);
  return typeof payload?.apiServiceUrl === "string"
    ? joinExecutePath(payload.apiServiceUrl)
    : "";
}

function joinExecutePath(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  if (trimmed.endsWith("/api/v1")) {
    return `${trimmed}/data-app/execute`;
  }
  if (trimmed.endsWith("/api")) {
    return `${trimmed}/v1/data-app/execute`;
  }
  return `${trimmed}/api/v1/data-app/execute`;
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function stripSourceKey(source) {
  if (!source || typeof source !== "object") {
    return source;
  }
  const { sourceKey: _sourceKey, ...rest } = source;
  return rest;
}

function expandGeneratedRefs(value, context) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandGeneratedRefs(item, context));
  }
  if (
    typeof value.sourceKey === "string" &&
    typeof value.kind === "string" &&
    (typeof value.datasetName === "string" || typeof value.datasetId === "string")
  ) {
    return stripSourceKey(value);
  }
  const expanded = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "sourceKey") {
      expanded[key] = expandGeneratedRefs(item, context);
    }
  }
  if (typeof value.sourceKey === "string") {
    const source = context.sourcesByKey.get(value.sourceKey);
    if (source && !expanded.source) {
      expanded.source = source;
    }
  }
  return expanded;
}

function buildInputOptionIntent(input, filterContract, context) {
  const optionQuery = input.optionQuery || filterContract.optionQuery;
  if (!optionQuery) {
    return null;
  }
  const expanded = expandGeneratedRefs(optionQuery, context);
  const source = expanded.source || optionQuery.source;
  const valueField = expanded.valueFieldRef || expanded.valueField;
  const labelField = expanded.labelFieldRef || expanded.labelField;
  if (!source || !valueField || !labelField) {
    return null;
  }
  return {
    version: 1,
    kind: "inputOptions",
    id: optionQuery.id || `${input.id}-options`,
    inputId: input.id,
    source: stripSourceKey(source),
    valueField,
    labelField,
    ...(expanded.population ? { population: expanded.population } : {}),
    ...(expanded.dependencies ? { dependencies: expanded.dependencies } : {}),
    limit: optionQuery.limit || optionQuery.spec?.limit || 100,
  };
}

function buildViewIntent(view, context) {
  if (!view?.sdkSpec?.builder || !view?.sdkSpec?.spec) {
    return null;
  }
  const kind = String(view.sdkSpec.builder).replace("semaphor.", "");
  if (!["metric", "records", "analysis", "matrix", "sql"].includes(kind)) {
    return null;
  }
  const spec = expandGeneratedRefs(view.sdkSpec.spec, context);
  return {
    version: 1,
    ...spec,
    kind,
    id: view.id,
    label: view.visualSpec?.title || view.title || spec.label,
  };
}

function buildActiveInput({ input, filterContract, binding, option, context }) {
  const field = expandGeneratedRefs(binding.fieldRef || filterContract.fieldRef || input.fieldRef, context);
  const operator = filterContract.operator || input.operator || "in";
  const relationshipHint = relationshipHintForBinding(binding);
  return {
    inputId: filterContract.inputId || input.id,
    kind: "filter",
    operator,
    value: activeInputValueForOperator(operator, option.value),
    isActive: true,
    field,
    ...(relationshipHint ? { relationshipHint } : {}),
  };
}

function relationshipHintForBinding(binding) {
  if (binding.relationshipHint) {
    return binding.relationshipHint;
  }
  const relationshipIds = (binding.relationshipsUsed || [])
    .map((relationship) => relationship?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
  return relationshipIds.length > 0 ? { relationshipIds } : undefined;
}

function activeInputValueForOperator(operator, value) {
  if (operator === "in" || operator === "not_in") {
    return [value];
  }
  if (operator === "between") {
    return Array.isArray(value) ? value : [value, value];
  }
  return value;
}

async function executeDataAppIntent({ context, intent, activeInputs }) {
  const response = await fetch(context.executeUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${context.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      intent,
      activeInputs,
      resultShape: intent.kind,
    }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data?.error) {
    return {
      ok: false,
      status: response.status,
      error: data?.error || `HTTP ${response.status}`,
      data,
    };
  }
  return { ok: true, data };
}

function extractOptions(data) {
  return Array.isArray(data?.options)
    ? data.options.filter((option) =>
      option &&
      Object.prototype.hasOwnProperty.call(option, "value") &&
      option.value !== null &&
      option.value !== undefined
    )
    : [];
}

function summarizeResultData(data) {
  const records = Array.isArray(data?.records)
    ? data.records
    : Array.isArray(data?.rows)
      ? data.rows
      : [];
  const values = [];
  collectNumericValues(data?.value, values);
  collectNumericValues(data?.measures, values);
  collectNumericValues(records, values);
  return {
    hasRows: records.length > 0 || Number(data?.rowCount || 0) > 0,
    nonZeroNumericCount: values.filter((value) => value !== 0).length,
    numericCount: values.length,
    fingerprint: stableResultFingerprint(data),
  };
}

function stableResultFingerprint(data) {
  return canonicalJson({
    value: data?.value,
    measures: data?.measures,
    records: data?.records,
    rows: data?.rows,
    rowCount: data?.rowCount,
    columns: data?.columns,
    options: data?.options,
  });
}

function collectNumericValues(value, output) {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.push(value);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNumericValues(item, output));
    return;
  }
  Object.values(value).forEach((item) => collectNumericValues(item, output));
}

function filterEffectLooksUseful({ baseline, filtered }) {
  if (baseline.fingerprint === filtered.fingerprint) {
    return false;
  }
  if (filtered.nonZeroNumericCount > 0) {
    return true;
  }
  if (filtered.hasRows && baseline.numericCount === 0) {
    return true;
  }
  if (!baseline.hasRows && filtered.hasRows) {
    return true;
  }
  return baseline.nonZeroNumericCount === 0 && filtered.hasRows;
}

function arrayStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}
