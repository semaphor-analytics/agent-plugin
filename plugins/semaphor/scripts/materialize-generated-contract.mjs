import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR = "src/semaphor/generated";

export function assertGeneratedContractArtifactDigest(payload) {
  const expectedDigest = typeof payload?.generatedContractArtifactDigest === "string"
    ? payload.generatedContractArtifactDigest
    : "";
  if (!expectedDigest) {
    return;
  }
  const actualDigest = digestGeneratedContractArtifactPayload(payload);
  if (actualDigest !== expectedDigest) {
    throw new Error("Generated contract artifact digest did not match fetched payload.");
  }
}

export function writeGeneratedContractFiles({ workspaceDir, files, filePaths, manifest, outputDir }) {
  const workspaceRoot = realWorkspaceRoot(workspaceDir);
  const normalizedOutputDir = normalizeGeneratedContractOutputDir(outputDir);
  const generatedRoot = path.resolve(workspaceRoot, normalizedOutputDir);
  if (!isPathInside(generatedRoot, workspaceRoot)) {
    throw new Error("Generated contract outputDir must be inside workspaceDir.");
  }
  const filesToWrite = filesWithGeneratedFilePathManifest({
    files,
    filePaths,
    manifest,
  });
  const writeEntries = preflightGeneratedContractWrites({
    files: filesToWrite,
    filePaths,
    workspaceRoot,
    generatedRoot,
    outputDir: normalizedOutputDir,
  });
  const written = [];
  for (const { outputPath, relativePath, content, fileName } of writeEntries) {
    assertNoSymlinkWorkspacePath(outputPath, workspaceRoot, {
      leafKind: "file",
      label: `Generated contract file path for ${fileName}`,
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    assertNoSymlinkWorkspacePath(outputPath, workspaceRoot, {
      leafKind: "file",
      label: `Generated contract file path for ${fileName}`,
    });
    fs.writeFileSync(outputPath, content, "utf8");
    written.push(relativePath);
  }
  return {
    schemaVersion: "semaphor-bridge-local-write/v1",
    workspaceDir: workspaceRoot,
    fileCount: written.length,
    filePaths: written.sort(),
  };
}

export function readGeneratedContractValidationPayload(workspaceDir, outputDir) {
  const workspaceRoot = realWorkspaceRoot(workspaceDir);
  const generatedRoot = path.resolve(workspaceRoot, DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR);
  if (!isPathInside(generatedRoot, workspaceRoot)) {
    throw new Error("Generated contract directory must be inside workspaceDir.");
  }
  assertNoSymlinkWorkspacePath(generatedRoot, workspaceRoot, {
    leafKind: "directory",
    label: "Generated contract directory",
  });
  if (!fs.existsSync(generatedRoot) || !fs.statSync(generatedRoot).isDirectory()) {
    throw new Error(
      "Expected generated Semaphor contract files under src/semaphor/generated before validation.",
    );
  }

  const generatedDir = resolveGeneratedContractValidationDirectory({
    workspaceRoot,
    generatedRoot,
    outputDir,
  });
  const manifestPath = path.join(generatedDir, "contract.manifest.json");
  assertNoSymlinkWorkspacePath(manifestPath, workspaceRoot, {
    leafKind: "file",
    label: "Generated contract manifest",
  });
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    throw new Error(
      `Expected ${toAppRelativePath(workspaceRoot, manifestPath)} before validation.`,
    );
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const generatedFiles = {};
  const generatedFilePaths = generatedFilePathsFromManifest(manifest);
  const generatedDirRelative = toAppRelativePath(workspaceRoot, generatedDir);
  for (const [fileName, relativePath] of Object.entries(generatedFilePaths)) {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Generated contract manifest path for ${fileName} must be app-relative.`);
    }
    const filePath = path.resolve(workspaceRoot, relativePath);
    if (!isPathInside(filePath, workspaceRoot)) {
      throw new Error(`Generated contract manifest path for ${fileName} escapes workspaceDir.`);
    }
    if (!isPathInside(filePath, generatedDir)) {
      throw new Error(
        `Generated contract manifest path for ${fileName} must stay under ${generatedDirRelative}.`,
      );
    }
    assertNoSymlinkWorkspacePath(filePath, workspaceRoot, {
      leafKind: "file",
      label: `Generated contract manifest path for ${fileName}`,
    });
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(
        `Expected generated TypeScript file listed by contract manifest: ${relativePath}`,
      );
    }
    generatedFiles[fileName] = fs.readFileSync(filePath, "utf8");
  }

  if (Object.keys(generatedFiles).length === 0) {
    throw new Error(
      "Expected generated TypeScript files under src/semaphor/generated before validation.",
    );
  }

  return { manifest, generatedFiles };
}

function preflightGeneratedContractWrites({
  files,
  filePaths,
  workspaceRoot,
  generatedRoot,
  outputDir,
}) {
  const entries = [];
  for (const [fileName, content] of Object.entries(files)) {
    if (typeof content !== "string") {
      throw new Error(`Generated contract file ${fileName} must have string content.`);
    }
    const relativePath = filePaths[fileName];
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error(`Generated contract file ${fileName} is missing filePaths entry.`);
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Generated contract file path for ${fileName} must be app-relative.`);
    }
    const outputPath = path.resolve(workspaceRoot, relativePath);
    if (!isPathInside(outputPath, workspaceRoot)) {
      throw new Error(`Generated contract file path for ${fileName} escapes workspaceDir.`);
    }
    if (!isPathInside(outputPath, generatedRoot)) {
      throw new Error(
        `Generated contract file path for ${fileName} must stay under ${outputDir}.`,
      );
    }
    assertNoSymlinkWorkspacePath(outputPath, workspaceRoot, {
      leafKind: "file",
      label: `Generated contract file path for ${fileName}`,
    });
    entries.push({ fileName, content, relativePath, outputPath });
  }
  return entries;
}

function resolveGeneratedContractValidationDirectory({
  workspaceRoot,
  generatedRoot,
  outputDir,
}) {
  if (typeof outputDir === "string" && outputDir.trim()) {
    const normalizedOutputDir = normalizeGeneratedContractOutputDir(outputDir);
    const generatedDir = path.resolve(workspaceRoot, normalizedOutputDir);
    if (!isPathInside(generatedDir, generatedRoot) && generatedDir !== generatedRoot) {
      throw new Error(
        `Generated contract outputDir must stay under ${DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR}.`,
      );
    }
    return generatedDir;
  }

  const manifestPaths = findGeneratedContractManifestPaths(generatedRoot);
  if (manifestPaths.length === 1) {
    return path.dirname(manifestPaths[0]);
  }
  if (manifestPaths.length > 1) {
    throw new Error(
      "Multiple generated contract manifests found under src/semaphor/generated. Pass outputDir to semaphor_validate_data_app_contract so the bridge can validate the intended contract.",
    );
  }
  return generatedRoot;
}

function findGeneratedContractManifestPaths(root) {
  const manifests = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    assertNoSymlinkWorkspacePath(current, root, {
      leafKind: "directory",
      label: "Generated contract directory",
      allowRoot: true,
    });
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Generated contract directory must not contain symlinks.");
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === "contract.manifest.json") {
        manifests.push(entryPath);
      }
    }
  }
  return manifests.sort();
}

function realWorkspaceRoot(workspaceDir) {
  const workspaceRoot = path.resolve(workspaceDir);
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    throw new Error("workspaceDir must be an existing directory.");
  }
  return fs.realpathSync(workspaceRoot);
}

function normalizeGeneratedContractOutputDir(outputDir) {
  let normalized = (typeof outputDir === "string" && outputDir.trim()
    ? outputDir
    : DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR)
    .trim()
    .split("\\")
    .join("/");
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Generated contract outputDir must be a safe relative path.");
  }
  if (
    normalized !== DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR &&
    !normalized.startsWith(`${DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR}/`)
  ) {
    throw new Error(
      `Generated contract outputDir must be ${DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR} or a subdirectory.`,
    );
  }
  return normalized;
}

function toAppRelativePath(rootPath, candidatePath) {
  return path.relative(rootPath, candidatePath).split(path.sep).join("/");
}

function filesWithGeneratedFilePathManifest({ files, filePaths, manifest }) {
  if (!files["contract.manifest.json"]) {
    return files;
  }
  const manifestRecord = manifest && typeof manifest === "object" && !Array.isArray(manifest)
    ? { ...manifest }
    : parseManifestFile(files["contract.manifest.json"]);
  if (!manifestRecord) {
    return files;
  }
  manifestRecord.generatedFilePaths = generatedFilePathEntries(filePaths);
  return {
    ...files,
    "contract.manifest.json": `${JSON.stringify(manifestRecord, null, 2)}\n`,
  };
}

function parseManifestFile(content) {
  if (typeof content !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...parsed }
      : null;
  } catch {
    return null;
  }
}

function generatedFilePathEntries(filePaths) {
  return Object.fromEntries(
    Object.entries(filePaths)
      .filter(([fileName, relativePath]) =>
        typeof fileName === "string" &&
        fileName.trim() &&
        fileName !== "contract.manifest.json" &&
        typeof relativePath === "string" &&
        relativePath.trim() &&
        !path.isAbsolute(relativePath)
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function digestGeneratedContractArtifactPayload(payload) {
  return hashStableJson({
    outputDir: payload.outputDir,
    manifestPath: payload.manifestPath,
    filePaths: payload.filePaths,
    files: payload.files,
    manifest: payload.manifest,
    contentHash: payload.contentHash,
    generatedSchemaVersion: payload.schemaVersion,
  });
}

function hashStableJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
}

function generatedFilePathsFromManifest(manifest) {
  const generatedFilePaths = manifest?.generatedFilePaths;
  if (
    !generatedFilePaths ||
    typeof generatedFilePaths !== "object" ||
    Array.isArray(generatedFilePaths)
  ) {
    throw new Error(
      "Generated contract manifest must include generatedFilePaths from semaphor_generate_data_app_contract. Regenerate the contract before validation.",
    );
  }
  const entries = {};
  for (const [fileName, relativePath] of Object.entries(generatedFilePaths)) {
    if (typeof fileName !== "string" || !fileName.trim()) {
      throw new Error("Generated contract manifest file names must be non-empty strings.");
    }
    if (typeof relativePath !== "string" || !relativePath.trim()) {
      throw new Error(
        `Generated contract manifest path for ${fileName} must be a non-empty app-relative path.`,
      );
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Generated contract manifest path for ${fileName} must be app-relative.`);
    }
    entries[fileName] = relativePath;
  }
  if (Object.keys(entries).length === 0) {
    throw new Error(
      "Generated contract manifest generatedFilePaths must include generated files.",
    );
  }
  return entries;
}

function assertNoSymlinkWorkspacePath(
  candidatePath,
  rootPath,
  { leafKind, label, allowRoot = false },
) {
  const relative = path.relative(rootPath, candidatePath);
  if ((!allowRoot && !relative) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes workspaceDir.`);
  }
  if (allowRoot && !relative) {
    return;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let current = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!fs.existsSync(current)) {
      break;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not contain symlinks inside workspaceDir.`);
    }
    const isLeaf = index === segments.length - 1;
    if (!isLeaf && !stat.isDirectory()) {
      throw new Error(`${label} parent path is not a directory.`);
    }
    if (isLeaf && leafKind === "directory" && !stat.isDirectory()) {
      throw new Error(`${label} must be a directory.`);
    }
    if (isLeaf && leafKind === "file" && !stat.isFile()) {
      throw new Error(`${label} must be a file.`);
    }
  }
}

function isPathInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
