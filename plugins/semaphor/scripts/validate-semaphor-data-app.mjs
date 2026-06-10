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
  const args = { dir: process.cwd(), runBuild: true, strict: false };
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

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: validate-semaphor-data-app.mjs [--dir <path>] [--no-run] [--strict] [--devtools-snapshot <path>] [--filter-effect-report <path>]");
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

main();

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

function arrayStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim())
    : [];
}
