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
  "data-app-codegen-node",
  "index.js",
);

const cachedSharedCodegenByPath = new Map();

export async function validateCodegenSummary(value, options = {}) {
  const validator = await sharedCodegenFunction(
    "validateCodegenSummary",
    options,
  );
  return validator(value);
}

export async function assertValidCodegenSummary(value, options = {}) {
  const assertion = await sharedCodegenFunction(
    "assertValidCodegenSummary",
    options,
  );
  assertion(value);
}

export async function validateGeneratedContract(input, options = {}) {
  const validator = await sharedCodegenFunction(
    "validateSemaphorGeneratedContract",
    options,
  );
  return validator(input);
}

export async function evaluateContractUpdatePolicy(input, options = {}) {
  const evaluator = await sharedCodegenFunction(
    "evaluateSemaphorDataAppContractUpdatePolicy",
    options,
  );
  return evaluator(input);
}

export async function buildGeneratedViewExecutionRequests(
  codegenSummary,
  options = {},
) {
  const builder = await sharedCodegenFunction(
    "buildSemaphorGeneratedViewExecutionRequests",
    options,
  );
  return builder(codegenSummary);
}

export async function buildGeneratedViewExecutionRequest(
  view,
  codegenSummary,
  options = {},
) {
  const builder = await sharedCodegenFunction(
    "buildSemaphorGeneratedViewExecutionRequest",
    options,
  );
  return builder(view, codegenSummary);
}

export async function buildGeneratedInputOptionIntent(
  input,
  filterContract,
  codegenSummary,
  options = {},
) {
  const builder = await sharedCodegenFunction(
    "buildSemaphorGeneratedInputOptionIntent",
    options,
  );
  return builder({ input, filterContract, codegenSummary });
}

export async function buildGeneratedActiveInput(
  { input, filterContract, binding, option, codegenSummary },
  options = {},
) {
  const builder = await sharedCodegenFunction(
    "buildSemaphorGeneratedActiveInput",
    options,
  );
  return builder({ input, filterContract, binding, option, codegenSummary });
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
      "Could not resolve react-semaphor/data-app-codegen/node.",
      "Install or link a react-semaphor version that exposes the data-app-codegen/node subpath.",
      "For local monorepo plugin validation, build react-semaphor first.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"),
  );
}

async function sharedCodegenFunction(exportName, options = {}) {
  const sharedCodegen = await importSharedCodegen(options);
  const candidate = sharedCodegen[exportName];
  if (typeof candidate !== "function") {
    throw new Error(
      `react-semaphor/data-app-codegen/node does not expose ${exportName}.`,
    );
  }
  return candidate;
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
  const exportTarget = packageJson.exports?.["./data-app-codegen/node"]?.import;
  if (typeof exportTarget !== "string" || !exportTarget.trim()) {
    throw new Error(
      "Installed react-semaphor does not expose react-semaphor/data-app-codegen/node.",
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
