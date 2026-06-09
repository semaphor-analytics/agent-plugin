#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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
  } catch (error) {
    issues.push(`Could not inspect installed react-semaphor package: ${error.message}`);
  }
  return { issues, advisories };
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
    console.log("Usage: validate-semaphor-data-app.mjs [--dir <path>] [--no-run] [--strict]");
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
