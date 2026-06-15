#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildGeneratedActiveInput,
  buildGeneratedInputOptionIntent,
  buildGeneratedViewExecutionRequest,
  buildGeneratedViewExecutionRequests,
  validateGeneratedContract,
} from "./data-app-codegen-summary-validation.mjs";

const GENERATED_CONTRACT_DIR = path.join("src", "semaphor", "generated");
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
const SCRIPT_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;

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
    json: false,
    liveFilterEffect: false,
    liveGeneratedViews: false,
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
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--devtools-snapshot") {
      args.devtoolsSnapshotPath = argv[index + 1];
      index += 1;
    } else if (arg === "--filter-effect-report") {
      args.filterEffectReportPath = argv[index + 1];
      index += 1;
    } else if (arg === "--live-filter-effect") {
      args.liveFilterEffect = true;
    } else if (arg === "--live-generated-views") {
      args.liveGeneratedViews = true;
    } else if (arg === "--filter-effect-samples") {
      args.filterEffectSamples = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function issue(code, message, details = {}) {
  return diagnostic({ code, severity: "error", message, ...details });
}

function advisory(code, message, details = {}) {
  return diagnostic({ code, severity: "advisory", message, ...details });
}

function diagnostic({
  code,
  severity,
  message,
  filePath,
  path: issuePath,
  repairHint,
  details,
}) {
  return {
    code,
    severity,
    message,
    ...(filePath ? { filePath } : {}),
    ...(issuePath ? { path: issuePath } : {}),
    ...(repairHint ? { repairHint } : {}),
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

function normalizeDiagnostic(
  value,
  { severity, defaultCode = "validation_issue" } = {},
) {
  if (value && typeof value === "object" && typeof value.code === "string") {
    return {
      severity,
      ...value,
      severity: value.severity || severity,
      message: String(value.message || value.code),
    };
  }
  const message = String(value || "");
  return diagnostic({
    code: inferIssueCode(message, defaultCode),
    severity,
    message,
    ...parseMessageLocation(message),
    repairHint: inferRepairHint(message),
  });
}

function promoteAdvisoryToIssue(value) {
  const normalized = normalizeDiagnostic(value, {
    severity: "error",
    defaultCode: "strict_advisory",
  });
  return {
    ...normalized,
    code:
      normalized.code === "validation_advisory"
        ? "strict_advisory"
        : normalized.code,
    severity: "error",
  };
}

function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.filePath || "",
      diagnostic.path || "",
      diagnostic.message || "",
    ].join("\u0000");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function emitValidationOutput(output, args) {
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    renderHumanValidationOutput(output);
  }
}

function exitWithValidationIssues(args, root, issues) {
  const output = {
    ok: false,
    workspaceDir: root,
    runBuild: Boolean(args.runBuild),
    strict: Boolean(args.strict),
    sourceFileCount: 0,
    sdkImportFileCount: 0,
    sdkImportFiles: [],
    issues: issues.map((item) =>
      normalizeDiagnostic(item, {
        severity: "error",
        defaultCode: "validation_issue",
      }),
    ),
    advisories: [],
  };
  emitValidationOutput(output, args);
  process.exit(1);
}

function parseMessageLocation(message) {
  const match = message.match(/^([^:\n]+):(?:\d+:)?\s/);
  if (!match) return {};
  return { filePath: match[1] };
}

function inferIssueCode(message, defaultCode) {
  const lower = message.toLowerCase();
  if (lower.includes("semaphordatappprovider")) return "missing_provider";
  if (
    lower.includes("semaphordevtools") ||
    lower.includes("debug window bridge")
  ) {
    return "missing_devtools_bridge";
  }
  if (lower.includes("generated semaphor contract is incomplete"))
    return "missing_generated_contract";
  if (lower.includes("contract.manifest.json"))
    return "invalid_contract_manifest";
  if (
    lower.includes("devtools snapshot is missing generated input option trace")
  ) {
    return "missing_option_traces";
  }
  if (lower.includes("devtools snapshot is missing generated query trace")) {
    return "missing_query_traces";
  }
  if (lower.includes("filter-effect report")) return "filter_effect_failed";
  if (lower.includes("generated view execution"))
    return "generated_view_execution_failed";
  if (lower.includes("missing react dependency"))
    return "missing_react_dependency";
  if (lower.includes("missing react-semaphor dependency"))
    return "missing_react_semaphor_dependency";
  if (lower.includes("react-semaphor/data-app-sdk"))
    return "sdk_export_unavailable";
  return defaultCode;
}

function inferRepairHint(message) {
  const lower = message.toLowerCase();
  if (lower.includes("semaphordatappprovider")) {
    return "Wrap the app root in SemaphorDataAppProvider from react-semaphor/data-app-sdk.";
  }
  if (lower.includes("semaphordevtools")) {
    return "Mount one root SemaphorDevtools under SemaphorDataAppProvider for local/authoring validation.";
  }
  if (lower.includes("debug window bridge")) {
    return "Enable the provider debug window bridge behind a local or authoring gate.";
  }
  if (lower.includes("generated semaphor contract is incomplete")) {
    return "Regenerate the Data App contract with semaphor_generate_data_app_contract.";
  }
  if (lower.includes("contract.manifest.json")) {
    return "Regenerate the generated contract instead of hand-editing manifest or generated files.";
  }
  if (lower.includes("filter-effect report")) {
    return "Run a browser smoke that selects the generated filter and records rerun or changed subscribed view ids.";
  }
  if (lower.includes("generated view execution")) {
    return "Run live generated-view validation with a valid Semaphor token and fix generated executable view specs before runtime.";
  }
  return "";
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
  return formatLocation(root, filePath).startsWith(
    `${GENERATED_CONTRACT_DIR}/`,
  );
}

async function scanDataAppPreflight(root, sources) {
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
    advisories.push(
      advisory(
        "no_sdk_imports",
        "No imports from react-semaphor/data-app-sdk were found.",
      ),
    );
    if (hasGeneratedContract) {
      issues.push(...(await scanGeneratedContract(root, generatedDir)));
    }
    return { issues, advisories, sdkSources, hasGeneratedContract };
  }

  if (
    usesDataAppRuntime &&
    !sourceContains(sources, "SemaphorDataAppProvider")
  ) {
    issues.push(
      issue(
        "missing_provider",
        "Data App SDK usage was found, but no SemaphorDataAppProvider usage was found.",
        {
          repairHint:
            "Wrap the app root in SemaphorDataAppProvider from react-semaphor/data-app-sdk.",
        },
      ),
    );
  }

  if (usesDataAppRuntime && !sourceContains(sources, "SemaphorDevtools")) {
    issues.push(
      issue(
        "missing_devtools_bridge",
        "Generated local/dev Data Apps should mount one root <SemaphorDevtools /> under SemaphorDataAppProvider.",
        {
          repairHint:
            "Mount one root SemaphorDevtools under SemaphorDataAppProvider for local/authoring validation.",
        },
      ),
    );
  }

  if (usesDataAppRuntime && !sourceContains(sources, "exposeWindowBridge")) {
    issues.push(
      issue(
        "missing_devtools_bridge",
        "Generated local/dev Data Apps should enable the provider debug window bridge behind a local/authoring gate.",
        {
          repairHint:
            "Enable the provider debug window bridge behind a local or authoring gate.",
        },
      ),
    );
  }

  if (hasGeneratedContract) {
    issues.push(...(await scanGeneratedContract(root, generatedDir)));
    if (!importsGeneratedContract(root, sources)) {
      issues.push(
        issue(
          "generated_contract_not_imported",
          "src/semaphor/generated exists, but app UI files do not import it. Import generated sources, fields, inputs, queries, and bindings instead of hand-rolling analytics wiring.",
          {
            repairHint:
              "Import generated sources, fields, inputs, queries, and bindings from src/semaphor/generated in UI code.",
          },
        ),
      );
    }
  } else if (
    sourceMatches(
      sdkSources,
      /\bsemaphor\.(?:metric|records|analysis|matrix|sql|filter|inputOptions)\s*\(/,
    )
  ) {
    advisories.push(
      advisory(
        "manual_sdk_specs",
        "Semaphor SDK builders were found without src/semaphor/generated. For broad planner-generated apps, prefer semaphor_generate_data_app_contract and import the generated contract.",
      ),
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
      advisory(
        "manual_specs_outside_generated_contract",
        `Found Semaphor specs outside ${GENERATED_CONTRACT_DIR} in ${manualSpecFiles.length} files. Keep broad generated app analytics specs in the generated contract and keep UI files focused on rendering.`,
      ),
    );
  }

  return { issues, advisories, sdkSources, hasGeneratedContract };
}

function importsGeneratedContract(root, sources) {
  return sources
    .filter((source) => !isGeneratedFile(root, source.filePath))
    .some(
      (source) =>
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

async function scanGeneratedContract(root, generatedDir) {
  const issues = [];
  for (const fileName of REQUIRED_GENERATED_FILES) {
    const filePath = path.join(generatedDir, fileName);
    if (!fs.existsSync(filePath)) {
      issues.push(
        issue(
          "missing_generated_contract",
          `Generated Semaphor contract is incomplete: missing ${GENERATED_CONTRACT_DIR}/${fileName}.`,
          {
            filePath: `${GENERATED_CONTRACT_DIR}/${fileName}`,
            repairHint:
              "Regenerate the Data App contract with semaphor_generate_data_app_contract.",
          },
        ),
      );
    }
  }
  issues.push(...(await validateGeneratedContractManifest(root, generatedDir)));

  for (const filePath of collectSourceFiles(generatedDir)) {
    const location = formatLocation(root, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/\bany\b|@ts-(?:ignore|expect-error)\b/.test(line)) {
        issues.push(
          issue(
            "generated_contract_hygiene",
            `${location}:${index + 1}: generated contract files must be fully typed; regenerate instead of using any or TypeScript suppression comments.`,
            {
              filePath: location,
              path: `${location}:${index + 1}`,
              repairHint:
                "Regenerate generated contract files instead of hand-editing them.",
            },
          ),
        );
      }
      if (
        /semaphor\.(?:metric|records|analysis|matrix|sql)\s*\(\s*\{\s*["']id["']\s*:/.test(
          line,
        ) &&
        /["']id["']\s*:[^,\n]+,\s*["']kind["']\s*:/.test(line)
      ) {
        issues.push(
          issue(
            "generated_contract_hygiene",
            `${location}:${index + 1}: generated query specs must not include top-level kind inside semaphor.* builder options.`,
            {
              filePath: location,
              path: `${location}:${index + 1}`,
              repairHint:
                "Regenerate generated query specs from the accepted codegenSummary.",
            },
          ),
        );
      }
      if (/relationshipsUsed\s*:/.test(line)) {
        issues.push(
          issue(
            "generated_contract_hygiene",
            `${location}:${index + 1}: generated runtime bindings must not pass relationshipsUsed into the SDK. Emit relationshipHint for semaphor.bindInput and keep relationshipsUsed as metadata/evidence only.`,
            {
              filePath: location,
              path: `${location}:${index + 1}`,
              repairHint:
                "Regenerate runtime bindings so relationship evidence stays in metadata.",
            },
          ),
        );
      }
    }
  }
  return issues;
}

async function validateGeneratedContractManifest(root, generatedDir) {
  const manifestPath = path.join(generatedDir, "contract.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  const manifestRead = readGeneratedContractManifest(root, manifestPath);
  if (manifestRead.issues.length > 0) {
    return manifestRead.issues;
  }
  try {
    const result = await validateGeneratedContract({
      manifest: manifestRead.manifest,
      generatedFiles: readGeneratedContractFiles(generatedDir),
    }, {
      workspaceDir: root,
    });
    return (result.issues || []).map((validationIssue) =>
      diagnostic({
        code: "invalid_contract_manifest",
        severity: "error",
        message: `${formatLocation(root, manifestPath)}: ${validationIssue.message}`,
        filePath: formatLocation(root, manifestPath),
        path: validationIssue.path,
        repairHint:
          validationIssue.repairHint ||
          "Regenerate the generated contract from a valid Data App codegenSummary.",
      }),
    );
  } catch (error) {
    return [
      diagnostic({
        code: "invalid_contract_manifest",
        severity: "error",
        message: `${formatLocation(root, manifestPath)}: could not load react-semaphor/data-app-codegen/node to validate generated contract manifest.`,
        filePath: formatLocation(root, manifestPath),
        path: "codegenSummary",
        repairHint:
          "Install or link a react-semaphor version that exposes react-semaphor/data-app-codegen/node, then rerun validation.",
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      }),
    ];
  }
}

function readGeneratedContractManifest(root, manifestPath) {
  try {
    return { manifest: readJson(manifestPath), issues: [] };
  } catch (error) {
    return {
      manifest: null,
      issues: [
        issue(
          "invalid_contract_manifest",
          `${formatLocation(root, manifestPath)}: could not parse generated contract manifest: ${error instanceof Error ? error.message : String(error)}`,
          {
            filePath: formatLocation(root, manifestPath),
            repairHint:
              "Regenerate the generated contract instead of hand-editing the manifest.",
          },
        ),
      ],
    };
  }
}

function readGeneratedContractFiles(generatedDir) {
  return Object.fromEntries(
    REQUIRED_GENERATED_FILES
      .filter((fileName) => fileName.endsWith(".ts"))
      .filter((fileName) => fs.existsSync(path.join(generatedDir, fileName)))
      .map((fileName) => [
        fileName,
        fs.readFileSync(path.join(generatedDir, fileName), "utf8"),
      ]),
  );
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
  const packagePath = path.join(
    root,
    "node_modules",
    "react-semaphor",
    "package.json",
  );
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
        advisory(
          "sdk_export_available",
          `Installed react-semaphor${pkg.version ? `@${pkg.version}` : ""} exposes react-semaphor/data-app-sdk.`,
        ),
      );
    }
    advisories.push(...detectDuplicateReactCopies(root));
    advisories.push(...detectViteReactDedupeAdvisories(root));
  } catch (error) {
    issues.push(
      `Could not inspect installed react-semaphor package: ${error.message}`,
    );
  }
  return { issues, advisories };
}

function detectDuplicateReactCopies(root) {
  const advisories = [];
  const duplicateChecks = [
    {
      packageName: "react",
      appPackagePath: path.join(root, "node_modules", "react", "package.json"),
      linkedPackagePath: path.join(
        root,
        "node_modules",
        "react-semaphor",
        "node_modules",
        "react",
        "package.json",
      ),
    },
    {
      packageName: "react-dom",
      appPackagePath: path.join(
        root,
        "node_modules",
        "react-dom",
        "package.json",
      ),
      linkedPackagePath: path.join(
        root,
        "node_modules",
        "react-semaphor",
        "node_modules",
        "react-dom",
        "package.json",
      ),
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
        'For Vite apps, add resolve.alias for react/react-dom to the app root node_modules and resolve.dedupe: ["react", "react-dom"].',
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
  if (
    config.includes("dedupe") &&
    config.includes("react") &&
    config.includes("react-dom")
  ) {
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

function redactSensitiveText(value) {
  return String(value || "")
    .replace(
      /(VITE_SEMAPHOR_PROJECT_TOKEN|SEMAPHOR_PROJECT_TOKEN)=([^\s]+)/g,
      "$1=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    );
}

function renderHumanValidationOutput(output) {
  console.log(`Checked ${output.sourceFileCount} source files.`);
  console.log(`SDK import files: ${output.sdkImportFileCount}`);
  for (const filePath of output.sdkImportFiles) {
    console.log(`- ${filePath}`);
  }

  if (output.advisories.length > 0) {
    console.log("");
    console.log(
      output.strict
        ? "Validation strict advisories:"
        : "Validation advisories:",
    );
    for (const item of output.advisories) {
      console.log(`- [${item.code}] ${item.message}`);
      if (item.repairHint) {
        console.log(`  Repair: ${item.repairHint}`);
      }
    }
  }

  if (output.issues.length > 0) {
    console.log("");
    console.log("Validation issues:");
    for (const item of output.issues) {
      console.log(`- [${item.code}] ${item.message}`);
      if (item.repairHint) {
        console.log(`  Repair: ${item.repairHint}`);
      }
    }
    return;
  }

  console.log("Semaphor data app preflight passed.");
}

function runScript(root, packageManager, scriptName, { echo = true } = {}) {
  const command =
    packageManager === "pnpm"
      ? ["pnpm", [scriptName]]
      : packageManager === "yarn"
        ? ["yarn", [scriptName]]
        : packageManager === "bun"
          ? ["bun", ["run", scriptName]]
          : ["npm", ["run", scriptName]];

  const commandText = `${command[0]} ${command[1].join(" ")}`;
  if (echo) {
    console.log(`Running ${commandText}...`);
  }
  const result = spawnSync(command[0], command[1], {
    cwd: root,
    encoding: "utf8",
    stdio: echo ? "inherit" : ["ignore", "pipe", "pipe"],
    shell: false,
    maxBuffer: SCRIPT_OUTPUT_MAX_BUFFER,
  });
  const ok = result.status === 0;
  return {
    ok,
    diagnostic: ok
      ? null
      : issue(
          scriptName === "typecheck" ? "typecheck_failed" : "build_failed",
          `${scriptName} script failed: ${commandText}`,
          {
            repairHint:
              scriptName === "typecheck"
                ? "Fix TypeScript errors reported by the target app typecheck script."
                : "Fix build errors reported by the target app build script.",
            details: {
              command: commandText,
              exitCode: result.status,
              signal: result.signal || null,
              stdout: redactSensitiveText(result.stdout || ""),
              stderr: redactSensitiveText(result.stderr || ""),
            },
          },
        ),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      "Usage: validate-semaphor-data-app.mjs [--dir <path>] [--no-run] [--strict] [--json] [--devtools-snapshot <path>] [--filter-effect-report <path>] [--live-filter-effect] [--live-generated-views] [--filter-effect-samples <n>]",
    );
    process.exit(0);
  }

  const root = path.resolve(args.dir);
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    exitWithValidationIssues(args, root, [
      issue("missing_package_json", "No package.json found.", {
        filePath: "package.json",
        repairHint:
          "Run validation from the Data App workspace root or create package.json for the app.",
        details: { expectedPath: packageJsonPath },
      }),
    ]);
  }

  let pkg;
  try {
    pkg = readJson(packageJsonPath);
  } catch (error) {
    exitWithValidationIssues(args, root, [
      issue("invalid_package_json", "package.json is not valid JSON.", {
        filePath: "package.json",
        repairHint: "Fix package.json so it parses as valid JSON.",
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      }),
    ]);
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const issues = [];
  const advisories = [];

  if (!deps.react) {
    issues.push(
      issue("missing_react_dependency", "Missing react dependency.", {
        filePath: "package.json",
        repairHint: "Install react in the target app.",
      }),
    );
  }
  if (!deps["react-semaphor"]) {
    issues.push(
      issue(
        "missing_react_semaphor_dependency",
        "Missing react-semaphor dependency.",
        {
          filePath: "package.json",
          repairHint: "Install react-semaphor in the target app.",
        },
      ),
    );
  }

  const sourceFiles = collectSourceFiles(root);
  const sources = readSources(sourceFiles);
  const preflight = await scanDataAppPreflight(root, sources);
  const sdkCompatibility = deps["react-semaphor"]
    ? checkReactSemaphorCompatibility(root)
    : { issues: [], advisories: [] };

  issues.push(...preflight.issues, ...sdkCompatibility.issues);
  advisories.push(...preflight.advisories, ...sdkCompatibility.advisories);
  if (args.devtoolsSnapshotPath) {
    issues.push(
      ...validateDevtoolsSnapshot({
        root,
        snapshotPath: args.devtoolsSnapshotPath,
      }),
    );
  }
  if (args.filterEffectReportPath) {
    issues.push(
      ...validateFilterEffectReport({
        root,
        reportPath: args.filterEffectReportPath,
      }),
    );
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
  if (args.liveGeneratedViews) {
    const liveViewsResult = await validateLiveGeneratedViews({ root });
    issues.push(...liveViewsResult.issues);
    advisories.push(...liveViewsResult.advisories);
  }

  const normalizedAdvisories = dedupeDiagnostics(
    advisories.map((item) =>
      normalizeDiagnostic(item, {
        severity: "advisory",
        defaultCode: "validation_advisory",
      }),
    ),
  );
  const normalizedIssues = dedupeDiagnostics(
    issues.map((item) =>
      normalizeDiagnostic(item, {
        severity: "error",
        defaultCode: "validation_issue",
      }),
    ),
  );
  const finalIssues = dedupeDiagnostics(
    args.strict
      ? [
          ...normalizedIssues,
          ...normalizedAdvisories.map(promoteAdvisoryToIssue),
        ]
      : [...normalizedIssues],
  );

  if (args.runBuild) {
    const packageManager = detectPackageManager(root);
    if (scripts.typecheck) {
      const result = runScript(root, packageManager, "typecheck", {
        echo: !args.json,
      });
      if (!result.ok && result.diagnostic) {
        finalIssues.push(result.diagnostic);
      }
    }
    if (scripts.build) {
      const result = runScript(root, packageManager, "build", {
        echo: !args.json,
      });
      if (!result.ok && result.diagnostic) {
        finalIssues.push(result.diagnostic);
      }
    }
  }

  const output = {
    ok: finalIssues.length === 0,
    workspaceDir: root,
    runBuild: Boolean(args.runBuild),
    strict: Boolean(args.strict),
    sourceFileCount: sourceFiles.length,
    sdkImportFileCount: preflight.sdkSources.length,
    sdkImportFiles: preflight.sdkSources
      .slice(0, 20)
      .map((source) => formatLocation(root, source.filePath)),
    issues: finalIssues,
    advisories: normalizedAdvisories,
  };

  emitValidationOutput(output, args);

  if (!output.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

function validateDevtoolsSnapshot({ root, snapshotPath }) {
  const issues = [];
  const manifestPath = path.join(
    root,
    GENERATED_CONTRACT_DIR,
    "contract.manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    return [
      issue(
        "missing_generated_contract",
        "DevTools snapshot validation requires src/semaphor/generated/contract.manifest.json.",
        {
          filePath: `${GENERATED_CONTRACT_DIR}/contract.manifest.json`,
          repairHint:
            "Generate the Data App contract before validating DevTools traces.",
        },
      ),
    ];
  }
  const resolvedSnapshotPath = path.resolve(root, snapshotPath);
  if (!fs.existsSync(resolvedSnapshotPath)) {
    return [
      issue(
        "missing_devtools_snapshot",
        `DevTools snapshot file was not found: ${formatLocation(root, resolvedSnapshotPath)}.`,
        {
          filePath: formatLocation(root, resolvedSnapshotPath),
          repairHint:
            "Capture window.__SEMAPHOR_DEVTOOLS__?.snapshot() during a browser smoke run and pass its path.",
        },
      ),
    ];
  }
  let snapshot;
  try {
    snapshot = readJson(resolvedSnapshotPath);
  } catch (error) {
    return [
      issue(
        "invalid_devtools_snapshot",
        `DevTools snapshot file could not be parsed: ${error.message}`,
        {
          filePath: formatLocation(root, resolvedSnapshotPath),
          repairHint:
            "Write the DevTools snapshot as valid JSON before validation.",
        },
      ),
    ];
  }
  const manifestRead = readGeneratedContractManifest(root, manifestPath);
  if (manifestRead.issues.length > 0) {
    return manifestRead.issues;
  }
  const manifest = manifestRead.manifest;
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
      issues.push(
        issue(
          "missing_query_traces",
          `DevTools snapshot is missing generated query trace "${queryId}".`,
          {
            path: `queries.${queryId}`,
            repairHint:
              "Render the generated view in the browser and capture a fresh Semaphor DevTools snapshot.",
          },
        ),
      );
    }
  }
  for (const queryId of expectedOptionQueryIds) {
    if (!observedIds.has(queryId)) {
      issues.push(
        issue(
          "missing_option_traces",
          `DevTools snapshot is missing generated input option trace "${queryId}".`,
          {
            path: `inputOptions.${queryId}`,
            repairHint:
              "Render the generated filter control and capture a fresh Semaphor DevTools snapshot.",
          },
        ),
      );
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
  if (
    typeof value.inputOptionQueryId === "string" &&
    value.inputOptionQueryId.trim()
  ) {
    ids.add(value.inputOptionQueryId.trim());
  }
  for (const item of Object.values(value)) {
    collectDevtoolsTraceIds(item, ids);
  }
  return ids;
}

function validateFilterEffectReport({ root, reportPath }) {
  const manifestPath = path.join(
    root,
    GENERATED_CONTRACT_DIR,
    "contract.manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    return [
      issue(
        "missing_generated_contract",
        "Filter-effect report validation requires src/semaphor/generated/contract.manifest.json.",
        {
          filePath: `${GENERATED_CONTRACT_DIR}/contract.manifest.json`,
          repairHint:
            "Generate the Data App contract before validating filter-effect reports.",
        },
      ),
    ];
  }
  const resolvedReportPath = path.resolve(root, reportPath);
  if (!fs.existsSync(resolvedReportPath)) {
    return [
      issue(
        "filter_effect_failed",
        `Filter-effect report file was not found: ${formatLocation(root, resolvedReportPath)}.`,
        {
          filePath: formatLocation(root, resolvedReportPath),
          repairHint:
            "Run the browser filter-effect smoke and pass the generated report path.",
        },
      ),
    ];
  }
  let report;
  try {
    report = readJson(resolvedReportPath);
  } catch (error) {
    return [
      issue(
        "filter_effect_failed",
        `Filter-effect report file could not be parsed: ${error.message}`,
        {
          filePath: formatLocation(root, resolvedReportPath),
          repairHint: "Write the filter-effect report as valid JSON.",
        },
      ),
    ];
  }
  const manifestRead = readGeneratedContractManifest(root, manifestPath);
  if (manifestRead.issues.length > 0) {
    return manifestRead.issues;
  }
  const manifest = manifestRead.manifest;
  const filterContracts = manifest.codegenSummary?.filterContracts || [];
  const checks = Array.isArray(report?.checks)
    ? report.checks
    : Array.isArray(report?.filterEffects)
      ? report.filterEffects
      : [];
  const checksByInputId = new Map(
    checks
      .filter((check) => typeof check?.inputId === "string")
      .map((check) => [check.inputId, check]),
  );
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
        issue(
          "filter_effect_failed",
          `Filter-effect report is missing generated input "${filterContract.inputId}".`,
          {
            path: `filterContracts.${filterContract.inputId}`,
            repairHint:
              "Select this generated filter in the browser smoke and include its effect evidence in the report.",
          },
        ),
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
      evidenceViewIds.has(viewId),
    );
    if (check.passed !== true && !hasSubscribedEvidence) {
      issues.push(
        issue(
          "filter_effect_failed",
          `Filter-effect report for "${filterContract.inputId}" must show a subscribed generated query reran or changed.`,
          {
            path: `filterContracts.${filterContract.inputId}`,
            repairHint:
              "The report must include changedQueryIds, reranQueryIds, affectedViewIds, or changedViewIds for at least one subscribed view.",
          },
        ),
      );
    }
  }
  return issues;
}

function liveFilterEffectIssue(message, details = {}) {
  return issue("filter_effect_failed", message, {
    repairHint:
      "Fix live filter-effect validation setup, generated option queries, or generated filter bindings, then rerun --live-filter-effect.",
    ...details,
  });
}

function liveGeneratedViewIssue(message, details = {}) {
  return issue("generated_view_execution_failed", message, {
    repairHint:
      "Fix generated executable view specs or runtime token/server setup, then rerun --live-generated-views.",
    ...details,
  });
}

function resolveLiveDataAppExecutionContext({
  root,
  issueFactory,
  missingTokenMessage,
  missingExecuteUrlMessage,
}) {
  const env = readLocalEnv(root);
  const token =
    env.VITE_SEMAPHOR_PROJECT_TOKEN ||
    env.SEMAPHOR_PROJECT_TOKEN ||
    process.env.VITE_SEMAPHOR_PROJECT_TOKEN ||
    process.env.SEMAPHOR_PROJECT_TOKEN;
  if (!token) {
    return {
      ok: false,
      issues: [
        issueFactory(missingTokenMessage, {
          repairHint:
            "Set VITE_SEMAPHOR_PROJECT_TOKEN or SEMAPHOR_PROJECT_TOKEN before running live Data App validation.",
        }),
      ],
    };
  }
  const executeUrl = resolveDataAppExecuteUrl({ env, token });
  if (!executeUrl) {
    return {
      ok: false,
      issues: [
        issueFactory(missingExecuteUrlMessage, {
          repairHint:
            "Set SEMAPHOR_SERVER_URL or use a runtime token that includes apiServiceUrl.",
        }),
      ],
    };
  }

  return {
    ok: true,
    context: {
      executeUrl,
      token,
    },
  };
}

async function validateLiveGeneratedViews({ root }) {
  const manifestPath = path.join(
    root,
    GENERATED_CONTRACT_DIR,
    "contract.manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    return {
      issues: [
        issue(
          "missing_generated_contract",
          "Live generated view execution validation requires src/semaphor/generated/contract.manifest.json.",
          {
            filePath: `${GENERATED_CONTRACT_DIR}/contract.manifest.json`,
            repairHint:
              "Generate the Data App contract before validating generated view execution.",
          },
        ),
      ],
      advisories: [],
    };
  }

  const manifestRead = readGeneratedContractManifest(root, manifestPath);
  if (manifestRead.issues.length > 0) {
    return { issues: manifestRead.issues, advisories: [] };
  }
  const summary = manifestRead.manifest.codegenSummary || {};
  let requestResult;
  try {
    requestResult = await buildGeneratedViewExecutionRequests(summary, {
      workspaceDir: root,
    });
  } catch (error) {
    return {
      issues: [
        liveGeneratedViewIssue(
          "Live generated view execution validation could not load shared SDK request shaping.",
          {
            path: "codegenSummary.views",
            repairHint:
              "Install or link a react-semaphor version that exposes generated-view request shaping, then rerun validation.",
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
        ),
      ],
      advisories: [],
    };
  }
  if (requestResult.requests.length === 0 && requestResult.issues.length === 0) {
    return {
      issues: [],
      advisories: [
        advisory(
          "live_generated_views_skipped",
          "Live generated view execution validation skipped because no executable generated views were found.",
        ),
      ],
    };
  }

  const setup = resolveLiveDataAppExecutionContext({
    root,
    issueFactory: liveGeneratedViewIssue,
    missingTokenMessage:
      "Live generated view execution validation requires VITE_SEMAPHOR_PROJECT_TOKEN or SEMAPHOR_PROJECT_TOKEN in the environment or the app's .env.local.",
    missingExecuteUrlMessage:
      "Live generated view execution validation could not resolve the Semaphor execute URL. Set SEMAPHOR_SERVER_URL or use a runtime token that includes apiServiceUrl.",
  });
  if (!setup.ok) {
    return { issues: setup.issues, advisories: [] };
  }

  const { context } = setup;
  const issues = requestResult.issues.map((requestIssue) =>
    liveGeneratedViewIssue(requestIssue.message, {
      path: requestIssue.path,
      repairHint:
        "Regenerate the Data App contract so each executable view has a valid SDK spec.",
      details: requestIssue.viewId ? { viewId: requestIssue.viewId } : undefined,
    }),
  );
  const advisories = [];
  for (const viewRequest of requestResult.requests) {
    const result = await executeDataAppIntent({
      context,
      ...viewRequest,
      activeInputs: [],
    });
    if (!result.ok) {
      issues.push(
        liveGeneratedViewIssue(
          `Generated view execution failed for "${viewRequest.viewId}"${formatExecutionFailureClassification(result.error)}: ${result.error}`,
          {
            path: `views.${viewRequest.viewId}.sdkSpec`,
            details: {
              viewId: viewRequest.viewId,
              status: result.status,
              error: String(result.error || ""),
            },
          },
        ),
      );
    }
  }

  if (issues.length === 0) {
    advisories.push(
      advisory(
        "live_generated_views_passed",
        `Live generated view execution validation passed against ${context.executeUrl} for ${requestResult.requests.length} executable view(s).`,
      ),
    );
  }
  return { issues, advisories };
}

async function validateLiveFilterEffects({ root, sampleCount }) {
  const manifestPath = path.join(
    root,
    GENERATED_CONTRACT_DIR,
    "contract.manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    return {
      issues: [
        issue(
          "missing_generated_contract",
          "Live filter-effect validation requires src/semaphor/generated/contract.manifest.json.",
          {
            filePath: `${GENERATED_CONTRACT_DIR}/contract.manifest.json`,
            repairHint:
              "Generate the Data App contract before validating live filter effects.",
          },
        ),
      ],
      advisories: [],
    };
  }

  const manifestRead = readGeneratedContractManifest(root, manifestPath);
  if (manifestRead.issues.length > 0) {
    return { issues: manifestRead.issues, advisories: [] };
  }
  const manifest = manifestRead.manifest;
  const summary = manifest.codegenSummary || {};
  const optionInputs = (summary.inputs || []).filter(
    (input) => input?.optionQuery,
  );
  const filterContracts = summary.filterContracts || [];
  if (optionInputs.length === 0 || filterContracts.length === 0) {
    return {
      issues: [],
      advisories: [
        "Live filter-effect validation skipped because no generated option-backed filters were found.",
      ],
    };
  }

  const setup = resolveLiveDataAppExecutionContext({
    root,
    issueFactory: liveFilterEffectIssue,
    missingTokenMessage:
      "Live filter-effect validation requires VITE_SEMAPHOR_PROJECT_TOKEN or SEMAPHOR_PROJECT_TOKEN in the environment or the app's .env.local.",
    missingExecuteUrlMessage:
      "Live filter-effect validation could not resolve the Semaphor execute URL. Set SEMAPHOR_SERVER_URL or use a runtime token that includes apiServiceUrl.",
  });
  if (!setup.ok) {
    return { issues: setup.issues, advisories: [] };
  }

  const { context } = setup;
  const issues = [];
  const advisories = [];

  for (const filterContract of filterContracts) {
    const input = optionInputs.find(
      (candidate) => candidate.id === filterContract.inputId,
    );
    const appliesToViewIds = Array.isArray(filterContract.appliesToViewIds)
      ? filterContract.appliesToViewIds
      : [];
    if (!input || appliesToViewIds.length === 0) {
      continue;
    }
    let optionIntent;
    try {
      optionIntent = await buildGeneratedInputOptionIntent(
        input,
        filterContract,
        summary,
        { workspaceDir: root },
      );
    } catch (error) {
      issues.push(
        liveFilterEffectIssue(
          `Live filter-effect validation could not load shared option-query request shaping for "${filterContract.inputId}".`,
          {
            path: `filterContracts.${filterContract.inputId}`,
            repairHint:
              "Install or link a react-semaphor version that exposes generated option-query request shaping, then rerun validation.",
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
        ),
      );
      continue;
    }
    if (!optionIntent) {
      issues.push(
        liveFilterEffectIssue(
          `Live filter-effect validation could not build option query for "${filterContract.inputId}".`,
          {
            path: `filterContracts.${filterContract.inputId}`,
            repairHint:
              "Regenerate the Data App contract so this option-backed input has a valid option query and binding.",
          },
        ),
      );
      continue;
    }

    const optionsResult = await executeDataAppIntent({
      context,
      intent: optionIntent,
      activeInputs: [],
    });
    if (!optionsResult.ok) {
      issues.push(
        liveFilterEffectIssue(
          `Input "${filterContract.inputId}" option query failed${formatExecutionFailureClassification(optionsResult.error)}: ${optionsResult.error}`,
          {
            path: `inputOptions.${filterContract.inputId}`,
            details: { error: String(optionsResult.error || "") },
          },
        ),
      );
      continue;
    }
    const options = extractOptions(optionsResult.data).slice(0, sampleCount);
    if (options.length === 0) {
      issues.push(
        liveFilterEffectIssue(
          `Input "${filterContract.inputId}" option query returned no usable options.`,
          {
            path: `inputOptions.${filterContract.inputId}`,
            repairHint:
              "Check that the generated option query returns option objects with non-null value fields for sampled data.",
          },
        ),
      );
      continue;
    }

    const checkedViewIds = [];
    const usefulViewIds = [];
    const errors = [];
    const bindings = (filterContract.bindings || [])
      .filter(
        (binding) =>
          binding?.viewId && appliesToViewIds.includes(binding.viewId),
      )
      .slice(0, 3);

    for (const binding of bindings) {
      const view = (summary.views || []).find(
        (candidate) => candidate?.id === binding.viewId,
      );
      let viewRequest;
      try {
        viewRequest = await buildGeneratedViewExecutionRequest(
          view,
          summary,
          { workspaceDir: root },
        );
      } catch (error) {
        errors.push(
          `${binding.viewId} request shaping failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      if (!viewRequest) {
        continue;
      }
      checkedViewIds.push(binding.viewId);
      const baseline = await executeDataAppIntent({
        context,
        ...viewRequest,
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
        let activeInput;
        try {
          activeInput = await buildGeneratedActiveInput({
            input,
            filterContract,
            binding,
            option,
            codegenSummary: summary,
          }, { workspaceDir: root });
        } catch (error) {
          errors.push(
            `${binding.viewId} active input shaping failed for ${filterContract.inputId}=${String(option.value)}: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        const filtered = await executeDataAppIntent({
          context,
          ...viewRequest,
          activeInputs: [activeInput],
        });
        if (!filtered.ok) {
          errors.push(
            `${binding.viewId} with ${filterContract.inputId}=${String(option.value)} failed${formatExecutionFailureClassification(filtered.error)}: ${filtered.error}`,
          );
          continue;
        }
        const filteredSummary = summarizeResultData(filtered.data);
        if (
          filterEffectLooksUseful({
            baseline: baselineSummary,
            filtered: filteredSummary,
          })
        ) {
          usefulViewIds.push(binding.viewId);
          break;
        }
      }
    }

    if (checkedViewIds.length === 0) {
      issues.push(
        liveFilterEffectIssue(
          `Input "${filterContract.inputId}" has no executable subscribed views for live filter-effect validation.`,
          {
            path: `filterContracts.${filterContract.inputId}`,
            repairHint:
              "Bind this generated filter to at least one executable generated view before running live filter-effect validation.",
          },
        ),
      );
      continue;
    }
    if (usefulViewIds.length === 0) {
      issues.push(
        liveFilterEffectIssue(
          `Input "${filterContract.inputId}" did not produce a non-empty/non-zero result for sampled subscribed views (${checkedViewIds.join(", ")}). ${errors.join(" ")}`.trim(),
          {
            path: `filterContracts.${filterContract.inputId}`,
            details: {
              checkedViewIds,
              errors,
            },
          },
        ),
      );
    }
  }

  if (issues.length === 0) {
    advisories.push(
      `Live filter-effect validation passed against ${context.executeUrl} for ${optionInputs.length} option-backed input(s).`,
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
    message.includes("nodename nor servname provided") ||
    message.includes("enotfound") ||
    message.includes("getaddrinfo")
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

async function executeDataAppIntent({
  context,
  intent,
  activeInputs,
  resultShape,
  analysisOptions,
}) {
  let response;
  try {
    response = await fetch(context.executeUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${context.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        intent,
        activeInputs,
        resultShape: resultShape || intent.kind,
        ...(analysisOptions ? { analysisOptions } : {}),
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      data: null,
    };
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Invalid JSON response: ${error instanceof Error ? error.message : String(error)}`,
        data: null,
      };
    }
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
    ? data.options.filter(
        (option) =>
          option &&
          Object.prototype.hasOwnProperty.call(option, "value") &&
          option.value !== null &&
          option.value !== undefined,
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
