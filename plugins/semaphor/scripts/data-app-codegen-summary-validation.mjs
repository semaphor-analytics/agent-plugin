import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const monorepoRoot = path.resolve(pluginRoot, "..", "..", "..");
const monorepoCodegenDist = path.join(
  monorepoRoot,
  "react-semaphor",
  "dist",
  "data-app-codegen",
  "index.js",
);

const cachedSharedCodegenByPath = new Map();

export const CODEGEN_SUMMARY_SCHEMA_VERSION =
  "semaphor-data-app-codegen-summary/v1";

export const CODEGEN_SUMMARY_VALIDATOR_VERSION =
  "semaphor-data-app-codegen-summary-validator/v2";

export async function validateCodegenSummary(value, options = {}) {
  const sharedCodegen = await importSharedCodegen(options);
  if (typeof sharedCodegen.validateCodegenSummary === "function") {
    return sharedCodegen.validateCodegenSummary(value);
  }
  const result = sharedCodegen.validateSemaphorDataAppCodegenSummary(value);
  return Array.isArray(result?.issues) ? result.issues : [];
}

export async function assertValidCodegenSummary(value, options = {}) {
  const sharedCodegen = await importSharedCodegen(options);
  if (typeof sharedCodegen.assertValidCodegenSummary === "function") {
    sharedCodegen.assertValidCodegenSummary(value);
    return;
  }
  const issues = await validateCodegenSummary(value, options);
  if (issues.length > 0) {
    throw new Error(`Invalid Semaphor codegenSummary:\n- ${issues.join("\n- ")}`);
  }
}

export async function importSharedCodegen(options = {}) {
  const explicitPath = process.env.SEMAPHOR_DATA_APP_CODEGEN_MODULE;
  if (explicitPath) {
    return importSharedCodegenFromPath(path.resolve(explicitPath));
  }

  const errors = [];
  for (const baseDir of candidatePackageBases(options)) {
    try {
      const { createRequire } = await import("node:module");
      const baseRequire = createRequire(path.join(baseDir, "package.json"));
      const resolved = resolveReactSemaphorDataAppCodegenImport(baseRequire);
      return importSharedCodegenFromPath(resolved);
    } catch (error) {
      errors.push(`${baseDir}: ${error.message}`);
    }
  }

  if (fs.existsSync(monorepoCodegenDist)) {
    return importSharedCodegenFromPath(monorepoCodegenDist);
  }

  throw new Error(
    [
      "Could not resolve react-semaphor/data-app-codegen.",
      "Install or link a react-semaphor version that exposes the data-app-codegen subpath.",
      "For local monorepo plugin validation, build react-semaphor first.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}

async function importSharedCodegenFromPath(modulePath) {
  const resolvedPath = path.resolve(modulePath);
  if (!cachedSharedCodegenByPath.has(resolvedPath)) {
    cachedSharedCodegenByPath.set(
      resolvedPath,
      import(pathToFileURL(resolvedPath).href),
    );
  }
  return cachedSharedCodegenByPath.get(resolvedPath);
}

function candidatePackageBases(options = {}) {
  const candidates = [
    options.workspaceDir,
    workspaceDirFromArgv(process.argv),
    process.cwd(),
    pluginRoot,
  ];
  return Array.from(
    new Set(
      candidates
        .filter((candidate) => typeof candidate === "string" && candidate.trim())
        .map((candidate) => path.resolve(candidate)),
    ),
  );
}

function workspaceDirFromArgv(argv) {
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (
      arg === "--dir" ||
      arg === "--workspaceDir" ||
      arg === "--workspace-dir" ||
      arg === "--workspaceRoot" ||
      arg === "--workspace-root"
    ) {
      return argv[index + 1];
    }
    if (arg.startsWith("--dir=")) {
      return arg.slice("--dir=".length);
    }
    if (arg.startsWith("--workspaceDir=")) {
      return arg.slice("--workspaceDir=".length);
    }
    if (arg.startsWith("--workspace-dir=")) {
      return arg.slice("--workspace-dir=".length);
    }
    if (arg.startsWith("--workspaceRoot=")) {
      return arg.slice("--workspaceRoot=".length);
    }
    if (arg.startsWith("--workspace-root=")) {
      return arg.slice("--workspace-root=".length);
    }
  }
  return undefined;
}

function resolveReactSemaphorDataAppCodegenImport(baseRequire) {
  const packageRoot = findPackageRoot(
    baseRequire.resolve("react-semaphor"),
    "react-semaphor",
  );
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const exportTarget = packageJson.exports?.["./data-app-codegen"]?.import;
  if (typeof exportTarget !== "string" || !exportTarget.trim()) {
    throw new Error(
      "Installed react-semaphor does not expose react-semaphor/data-app-codegen.",
    );
  }
  return path.resolve(packageRoot, exportTarget);
}

function findPackageRoot(startPath, expectedName) {
  let current = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (packageJson.name === expectedName) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find ${expectedName} package root.`);
    }
    current = parent;
  }
}
