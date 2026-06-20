#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const CLIENT_REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR = "src/semaphor/generated";
const GENERATED_CONTRACT_MATERIALIZATION_TOOLS = new Set([
  "semaphor_materialize_data_app_contract",
]);
const GENERATED_CONTRACT_PAYLOAD_TOOLS = new Set([
  "semaphor_create_data_app_contract",
  "semaphor_generate_data_app_contract",
  "semaphor_update_data_app_contract",
  "semaphor_materialize_data_app_contract",
]);
const WORKSPACE_HINT_SCHEMA = {
  type: "object",
  properties: {
    workspaceDir: {
      type: "string",
      description:
        "Optional React app root. Use this when the Semaphor project token is stored in the target app .env.local.",
    },
  },
  additionalProperties: true,
};
const OUTPUT_DIR_HINT_SCHEMA = {
  type: "string",
  description:
    "Optional generated contract output directory under src/semaphor/generated. Use this for validation when generation wrote to a generated subdirectory.",
};
const MATERIALIZATION_TOKEN_HINT_SCHEMA = {
  type: "string",
  description:
    "Short-lived materialization token returned with generatedContractArtifactId by semaphor_generate_data_app_contract.",
};
const FALLBACK_TOOLS = [
  {
    name: "semaphor_get_access_context",
    description:
      "Diagnose Semaphor auth setup. If no token is configured, pause data-bearing app work and ask the user to use the current host MCP OAuth login flow for the semaphor server, or add VITE_SEMAPHOR_PROJECT_TOKEN to the target React app .env.local, then resume when they say try again. In Codex, the OAuth command is codex mcp login semaphor. Do not scaffold placeholder analytics when auth is unavailable.",
  },
].map((tool) => ({
  ...tool,
  inputSchema: tool.inputSchema || WORKSPACE_HINT_SCHEMA,
}));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const pluginVersion = readPluginVersion();

let stdinBuffer = Buffer.alloc(0);
let shuttingDown = false;
let nextClientRequestId = 1000;
const pendingClientRequests = new Map();

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  for (;;) {
    const parsed = readMcpMessage(stdinBuffer);
    if (!parsed) {
      return;
    }
    stdinBuffer = parsed.remaining;
    void handleClientMessage(parsed.message);
  }
});

process.stdin.on("end", () => {
  shuttingDown = true;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shuttingDown = true;
    process.exit(0);
  });
}

async function handleClientMessage(message) {
  if (shuttingDown || !message || typeof message !== "object") {
    return;
  }

  if (message.id !== undefined && message.method === undefined) {
    resolveClientRequest(message);
    return;
  }

  if (message.id === undefined) {
    await forwardNotification(message);
    return;
  }

  try {
    const response = await forwardRequest(message);
    writeMcpMessage(process.stdout, response);
  } catch (error) {
    writeMcpMessage(process.stdout, {
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        ),
      },
    });
  }
}

async function forwardRequest(message) {
  if (message.method === "initialize") {
    const requestedProtocolVersion =
      typeof message.params?.protocolVersion === "string"
        ? message.params.protocolVersion
        : MCP_PROTOCOL_VERSION;
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: requestedProtocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "semaphor",
          version: pluginVersion,
        },
      },
    };
  }

  if (message.method === "tools/list") {
    const context = await resolveSemaphorContext({
      allowMissing: true,
      includeClientRoots: true,
    });
    if (context?.token) {
      const response = await postMcpJsonRpc(message, context);
      return normalizeToolsListResponse(message, response);
    }
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: FALLBACK_TOOLS,
      },
    };
  }

  if (message.method === "tools/call") {
    const toolArguments = message.params?.arguments;
    const context = await resolveSemaphorContext({
      allowMissing: false,
      includeClientRoots: true,
      toolArguments,
    });
    if (!context?.token) {
      return missingSemaphorAuthResponse(message);
    }
    const response = await postMcpJsonRpc(await prepareToolCallMessage(message), context);
    const normalized = normalizeJsonRpcResponse(message, response);
    return materializeGeneratedContractResponse(message, normalized);
  }

  return {
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: `Unsupported Semaphor MCP bridge method: ${message.method}`,
    },
  };
}

function readPluginVersion() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"),
  );
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("plugins/semaphor/package.json is missing a version");
  }
  return packageJson.version;
}

function normalizeJsonRpcResponse(message, response) {
  if (response === undefined || response === null || response === "") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {},
    };
  }

  if (Array.isArray(response)) {
    const matching = response.find((item) => item?.id === message.id);
    return (
      matching || response[0] || { jsonrpc: "2.0", id: message.id, result: {} }
    );
  }

  if (response.id === undefined) {
    return {
      ...response,
      jsonrpc: response.jsonrpc || "2.0",
      id: message.id,
    };
  }

  return response;
}

function normalizeToolsListResponse(message, response) {
  const normalized = normalizeJsonRpcResponse(message, response);
  if (normalized?.error) {
    return normalized;
  }
  const tools = Array.isArray(normalized?.result?.tools)
    ? normalized.result.tools.map(exposeBridgeWorkspaceHint)
    : FALLBACK_TOOLS;
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      ...(normalized?.result || {}),
      tools,
    },
  };
}

function missingSemaphorAuthResponse(message) {
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "Semaphor project token was not found for this workspace.",
            "This is a recoverable setup step for Semaphor data-bearing work, not a denial of the user request.",
            "Pause, preserve the task context, and ask the user to authenticate before continuing.",
            "Do not create a placeholder dashboard shell, static mock analytics, or generic query integration point.",
            "If hosted OAuth tools are exposed, use the MCP server named semaphor and call semaphor_list_projects.",
            "If hosted OAuth tools are not exposed, the OAuth app connection requires reauthentication, or the semaphor MCP is not logged in, ask the user to use the current host MCP OAuth login or reauthentication flow for the server named semaphor, then say try again. In Codex, the command is codex mcp login semaphor; in Claude Code or another host, use that host MCP server authentication UI or command. Also mention that this thread may not detect the refreshed MCP login; if try again still reports missing auth, start a new thread after logging in.",
            "For deterministic project-token mode, add VITE_SEMAPHOR_PROJECT_TOKEN to the React app .env.local, or export SEMAPHOR_PROJECT_TOKEN before launching the agent.",
            "If the token is already in the React app .env.local, launch the agent from that app root or call semaphor_get_access_context with workspaceDir set to the React app root.",
            "The Semaphor MCP endpoint is derived from the project token's apiServiceUrl.",
          ].join(" "),
        },
      ],
    },
  };
}

function exposeBridgeWorkspaceHint(tool) {
  const description = tool?.description || "";
  const bridgeDescription = GENERATED_CONTRACT_MATERIALIZATION_TOOLS.has(tool?.name)
    ? " In installed Semaphor Agent Plugin runs, pass workspaceDir; the bridge materializes this generated contract artifact under that workspace after the server-owned tool call succeeds."
    : tool?.name === "semaphor_validate_data_app_contract"
      ? " In installed Semaphor Agent Plugin runs, pass workspaceDir to validate generated files already written under src/semaphor/generated without hand-assembling manifest or generatedFiles payloads."
      : "";
  return {
    ...tool,
    description: bridgeDescription ? `${description}${bridgeDescription}` : tool?.description,
    inputSchema: exposeBridgeLocalArtifactInputs(tool),
  };
}

function exposeBridgeLocalArtifactInputs(tool) {
  if (
    tool?.name !== "semaphor_get_access_context" &&
    !GENERATED_CONTRACT_MATERIALIZATION_TOOLS.has(tool?.name) &&
    tool?.name !== "semaphor_validate_data_app_contract"
  ) {
    return tool?.inputSchema;
  }
  const schema = mergeWorkspaceHint(tool?.inputSchema);
  if (GENERATED_CONTRACT_MATERIALIZATION_TOOLS.has(tool?.name)) {
    return {
      ...schema,
      properties: {
        ...(schema.properties || {}),
        generatedContractMaterializationToken:
          MATERIALIZATION_TOKEN_HINT_SCHEMA,
      },
    };
  }
  if (tool?.name !== "semaphor_validate_data_app_contract") {
    return schema;
  }
  return {
    ...schema,
    properties: {
      ...(schema.properties || {}),
      outputDir: OUTPUT_DIR_HINT_SCHEMA,
    },
  };
}

function mergeWorkspaceHint(inputSchema) {
  if (
    !inputSchema ||
    typeof inputSchema !== "object" ||
    inputSchema.type !== "object"
  ) {
    return WORKSPACE_HINT_SCHEMA;
  }
  return {
    ...inputSchema,
    properties: {
      ...(inputSchema.properties || {}),
      workspaceDir: WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
    },
    additionalProperties:
      inputSchema.additionalProperties === undefined
        ? true
        : inputSchema.additionalProperties,
  };
}

async function forwardNotification(message) {
  if (message.method === "notifications/initialized") {
    return;
  }

  try {
    const context = await resolveSemaphorContext({
      allowMissing: true,
      includeClientRoots: false,
    });
    if (!context?.token) {
      return;
    }
    await postMcpJsonRpc(message, context);
  } catch (error) {
    const text = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    if (process.env.SEMAPHOR_MCP_VERBOSE === "true") {
      process.stderr.write(`${text}\n`);
    }
  }
}

async function postMcpJsonRpc(message, context) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DEFAULT_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(context.mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "X-Semaphor-Agent-Plugin-Bridge": "1",
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(formatHttpError(response, body));
    }

    if (!body.trim()) {
      return undefined;
    }

    return parseMcpHttpBody(body, response.headers.get("content-type") || "");
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        `Timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms calling Semaphor MCP.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveSemaphorContext({
  allowMissing,
  includeClientRoots,
  toolArguments,
}) {
  const env = await readWorkspaceEnv({ includeClientRoots, toolArguments });
  const token = firstEnvValue(
    process.env.SEMAPHOR_PROJECT_TOKEN,
    process.env.VITE_SEMAPHOR_PROJECT_TOKEN,
    env.SEMAPHOR_PROJECT_TOKEN,
    env.VITE_SEMAPHOR_PROJECT_TOKEN,
  );
  if (!token) {
    return allowMissing ? null : { token: "", mcpUrl: "" };
  }

  const mcpUrl = inferMcpUrlFromProjectToken(token);
  if (!mcpUrl) {
    throw new Error(
      "Semaphor project token is missing apiServiceUrl. Mint a fresh project token from the target Semaphor environment.",
    );
  }

  return { token, mcpUrl };
}

async function readWorkspaceEnv({ includeClientRoots, toolArguments }) {
  const directories = [
    ...bridgeWorkspaceDirectories(toolArguments),
    process.env.SEMAPHOR_WORKSPACE,
    process.env.INIT_CWD,
    process.env.PWD,
    ...(includeClientRoots ? await listClientRootDirectories() : []),
    process.cwd(),
    pluginRoot,
  ];
  return readLocalEnvFromDirectories(directories);
}

function bridgeWorkspaceDirectories(toolArguments) {
  if (!toolArguments || typeof toolArguments !== "object") {
    return [];
  }
  return [
    toolArguments.workspaceDir,
    toolArguments.workspaceRoot,
    toolArguments.projectDir,
    toolArguments.repoRoot,
    toolArguments.appDir,
  ].filter((value) => typeof value === "string" && value.trim());
}

async function prepareToolCallMessage(message) {
  const withExpandedValidation = await expandBridgeLocalValidationArguments(message);
  return stripBridgeOnlyToolArguments(withExpandedValidation);
}

async function expandBridgeLocalValidationArguments(message) {
  if (message.params?.name === "semaphor_validate_data_app_contract") {
    return expandBridgeGeneratedContractValidationArguments(message);
  }
  return message;
}

async function expandBridgeGeneratedContractValidationArguments(message) {
  const originalArguments = message.params?.arguments;
  if (!originalArguments || typeof originalArguments !== "object") {
    return message;
  }
  const { outputDir, ...forwardedOriginalArguments } = originalArguments;
  if (
    originalArguments.generatedContractPayload ||
    originalArguments.manifest ||
    originalArguments.generatedFiles
  ) {
    return {
      ...message,
      params: {
        ...message.params,
        arguments: forwardedOriginalArguments,
      },
    };
  }

  const workspaceDir = firstBridgeWorkspaceDirectory(originalArguments);
  if (!workspaceDir) {
    return message;
  }

  const { manifest, generatedFiles } =
    readGeneratedContractValidationPayload(workspaceDir, originalArguments.outputDir);
  return {
    ...message,
    params: {
      ...message.params,
      arguments: {
        ...forwardedOriginalArguments,
        manifest,
        generatedFiles,
      },
    },
  };
}

function isPathInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function stripBridgeOnlyToolArguments(message) {
  const originalArguments = message.params?.arguments;
  if (!originalArguments || typeof originalArguments !== "object") {
    return message;
  }

  const {
    workspaceDir,
    workspaceRoot,
    projectDir,
    repoRoot,
    appDir,
    ...forwardedArguments
  } = originalArguments;
  return {
    ...message,
    params: {
      ...message.params,
      arguments: forwardedArguments,
    },
  };
}

function materializeGeneratedContractResponse(message, normalized) {
  if (
    message.method !== "tools/call" ||
    !GENERATED_CONTRACT_PAYLOAD_TOOLS.has(message.params?.name) ||
    normalized?.error ||
    normalized?.result?.isError
  ) {
    return normalized;
  }

  if (!GENERATED_CONTRACT_MATERIALIZATION_TOOLS.has(message.params?.name)) {
    annotateGeneratedContractPayloadOnly(normalized.result, message.params?.name);
    return normalized;
  }

  const workspaceDir = firstBridgeWorkspaceDirectory(message.params?.arguments);
  if (!workspaceDir) {
    annotateGeneratedContractPayloadOnly(normalized.result, message.params?.name);
    return normalized;
  }

  const payload = generatedContractPayloadFromResult(normalized.result);
  if (payload?.kind !== "generated_data_app_contract") {
    throw new Error(
      [
        `${message.params?.name} was called with workspaceDir, but Semaphor did not return a generated contract payload.`,
        "Local Data App builds require installed-bridge materialization before UI edits.",
        "Do not reconstruct generated files from tool text; materialize the returned artifact through the installed bridge tool or npm run data-app -- materialize-contract.",
      ].join(" "),
    );
  }
  if (!payload.files || !payload.filePaths) {
    throw new Error(
      [
        `${message.params?.name} returned a generated contract payload without files/filePaths, so the installed bridge cannot materialize src/semaphor/generated.`,
        "Do not reconstruct generated files from a large or truncated response; materialize the short-lived artifact through npm run data-app -- materialize-contract or report a materialization failure.",
      ].join(" "),
    );
  }

  const writeSummary = writeGeneratedContractFiles({
    workspaceDir,
    files: payload.files,
    filePaths: payload.filePaths,
    manifest: payload.manifest,
    outputDir: payload.outputDir,
  });

  normalized.result.structuredContent = {
    ...(normalized.result.structuredContent &&
    typeof normalized.result.structuredContent === "object"
      ? normalized.result.structuredContent
      : payload),
    localWrite: writeSummary,
    materialization: {
      mode: "local_write",
      status: "written",
      workspaceDir: writeSummary.workspaceDir,
      outputDir: payload.outputDir || DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
      fileCount: writeSummary.fileCount,
      filePaths: writeSummary.filePaths,
    },
    localMaterialization: localMaterializationCommand({
      generatedContractArtifactId: payload.generatedContractArtifactId,
      generatedContractMaterializationToken:
        payload.generatedContractMaterializationToken,
      status: "written",
      required: false,
    }),
    nextAgentAction:
      "Import from src/semaphor/generated, then run Semaphor validation, typecheck, build, and browser smoke checks.",
  };

  return normalized;
}

function annotateGeneratedContractPayloadOnly(result, toolName) {
  const payload = generatedContractPayloadFromResult(result);
  if (payload?.kind !== "generated_data_app_contract") {
    return;
  }
  const retryToolName = typeof toolName === "string" && toolName.trim()
    ? toolName
    : "the same generated-contract tool";
  result.structuredContent = {
    ...payloadOnlyGeneratedContractMetadata(
      result.structuredContent && typeof result.structuredContent === "object"
        ? result.structuredContent
        : payload,
    ),
    materialization: {
      mode: "payload_only",
      status: "not_written",
      reason:
        "No workspaceDir was provided, so generated files were not written locally.",
      outputDir: payload.outputDir || DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
      fileCount: payload.files && typeof payload.files === "object"
        ? Object.keys(payload.files).length
        : undefined,
    },
    localMaterialization:
      payload.localMaterialization ||
      localMaterializationCommand({
        generatedContractArtifactId: payload.generatedContractArtifactId,
        generatedContractMaterializationToken:
          payload.generatedContractMaterializationToken,
        status: "not_written",
        required: true,
      }),
    nextAgentAction:
      retryToolName === "semaphor_materialize_data_app_contract"
        ? "Materialize through the installed Semaphor Agent Plugin bridge with workspaceDir, or run npm run data-app -- materialize-contract --dir <react-app-root> --artifact-id <generatedContractArtifactId> --materialization-token <generatedContractMaterializationToken>. Require materialization.status=\"written\" before UI edits; do not hand-write generated files."
        : "Call semaphor_materialize_data_app_contract with generatedContractArtifactId, generatedContractMaterializationToken, and workspaceDir through the installed bridge, or run npm run data-app -- materialize-contract with the returned artifact id and token. Require materialization.status=\"written\" before UI edits; do not hand-write generated files.",
  };
}

function localMaterializationCommand(input) {
  const workspaceDir = "${workspaceDir}";
  const semaphorPluginRoot = "${semaphorPluginRoot}";
  const artifactId =
    typeof input.generatedContractArtifactId === "string" &&
    input.generatedContractArtifactId.trim()
      ? input.generatedContractArtifactId
      : "<generatedContractArtifactId>";
  const materializationToken =
    typeof input.generatedContractMaterializationToken === "string" &&
    input.generatedContractMaterializationToken.trim()
      ? input.generatedContractMaterializationToken
      : "<generatedContractMaterializationToken>";
  return {
    required: Boolean(input.required),
    status: input.status,
    officialCommand: {
      command: "npm",
      args: [
        "run",
        "data-app",
        "--",
        "materialize-contract",
        "--dir",
        workspaceDir,
        "--artifact-id",
        artifactId,
        "--materialization-token",
        materializationToken,
      ],
      cwd: semaphorPluginRoot,
      packageScript: "data-app",
      subcommand: "materialize-contract",
      placeholders: {
        workspaceDir,
        semaphorPluginRoot,
      },
      argsByName: {
        dir: workspaceDir,
        artifactId,
        materializationToken,
      },
    },
  };
}

function payloadOnlyGeneratedContractMetadata(payload) {
  const metadata = { ...(payload || {}) };
  delete metadata.files;
  delete metadata.filePaths;
  delete metadata.manifest;
  delete metadata.manifestPath;
  delete metadata.localWrite;
  return metadata;
}

function firstBridgeWorkspaceDirectory(toolArguments) {
  return bridgeWorkspaceDirectories(toolArguments)
    .map((directory) => path.resolve(directory))
    .find((directory) => fs.existsSync(directory) && fs.statSync(directory).isDirectory());
}

function generatedContractPayloadFromResult(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  return null;
}

function writeGeneratedContractFiles({ workspaceDir, files, filePaths, manifest, outputDir }) {
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

function readGeneratedContractValidationPayload(workspaceDir, outputDir) {
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
  const generatedFilePaths = generatedTypeScriptFilePathsFromManifest(manifest);
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
  manifestRecord.generatedFilePaths = generatedTypeScriptFilePathEntries(filePaths);
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

function generatedTypeScriptFilePathEntries(filePaths) {
  return Object.fromEntries(
    Object.entries(filePaths)
      .filter(([fileName, relativePath]) =>
        fileName.endsWith(".ts") &&
        typeof relativePath === "string" &&
        relativePath.trim() &&
        !path.isAbsolute(relativePath)
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function generatedTypeScriptFilePathsFromManifest(manifest) {
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
    if (!fileName.endsWith(".ts")) {
      continue;
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
      "Generated contract manifest generatedFilePaths must include generated TypeScript files.",
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

async function listClientRootDirectories({ requireSingleRoot = true } = {}) {
  try {
    const response = await requestClient("roots/list", {});
    const roots = Array.isArray(response?.roots) ? response.roots : [];
    const directories = roots
      .map((root) => fileUriToPath(root?.uri))
      .filter(Boolean);
    if (requireSingleRoot && directories.length !== 1) {
      return [];
    }
    return directories;
  } catch {
    return [];
  }
}

function fileUriToPath(uri) {
  if (typeof uri !== "string") {
    return "";
  }
  if (!uri.startsWith("file://")) {
    return "";
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return "";
  }
}

function requestClient(method, params) {
  const id = nextClientRequestId;
  nextClientRequestId += 1;
  writeMcpMessage(process.stdout, {
    jsonrpc: "2.0",
    id,
    method,
    params,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingClientRequests.delete(id);
      reject(new Error(`Timed out waiting for client ${method} response.`));
    }, CLIENT_REQUEST_TIMEOUT_MS);

    pendingClientRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
  });
}

function resolveClientRequest(message) {
  const entry = pendingClientRequests.get(message.id);
  if (!entry) {
    return;
  }
  pendingClientRequests.delete(message.id);
  if (message.error) {
    entry.reject(new Error(formatJsonRpcError(message.error)));
    return;
  }
  entry.resolve(message.result);
}

function parseMcpHttpBody(body, contentType) {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    contentType.includes("text/event-stream") ||
    trimmed.startsWith("event:")
  ) {
    return parseEventStreamJson(trimmed);
  }

  return JSON.parse(trimmed);
}

function parseEventStreamJson(text) {
  const messages = [];
  let dataLines = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    if (line.trim() === "") {
      if (dataLines.length > 0) {
        messages.push(JSON.parse(dataLines.join("\n")));
        dataLines = [];
      }
    }
  }

  if (dataLines.length > 0) {
    messages.push(JSON.parse(dataLines.join("\n")));
  }

  if (messages.length === 0) {
    throw new Error(
      "Semaphor MCP returned an event-stream response without JSON data.",
    );
  }

  return messages.length === 1 ? messages[0] : messages;
}

function formatHttpError(response, body) {
  const trimmed = redactSensitiveText(body).trim();
  const suffix = trimmed ? `: ${trimmed.slice(0, 1000)}` : "";
  return `Semaphor MCP HTTP ${response.status} ${response.statusText}${suffix}`;
}

function readMcpMessage(buffer) {
  const firstNonWhitespace = buffer.findIndex(
    (byte) => ![9, 10, 13, 32].includes(byte),
  );
  if (firstNonWhitespace > 0) {
    buffer = buffer.subarray(firstNonWhitespace);
  }

  if (buffer[0] === 123) {
    const lineEnd = buffer.indexOf("\n");
    if (lineEnd === -1) {
      return null;
    }
    const line = buffer.subarray(0, lineEnd).toString("utf8").trim();
    if (!line) {
      return {
        message: null,
        remaining: buffer.subarray(lineEnd + 1),
      };
    }
    return {
      message: JSON.parse(line),
      remaining: buffer.subarray(lineEnd + 1),
    };
  }

  let separator = buffer.indexOf("\r\n\r\n");
  let separatorLength = 4;
  if (separator === -1) {
    separator = buffer.indexOf("\n\n");
    separatorLength = 2;
  }
  if (separator === -1) {
    return null;
  }

  const header = buffer.subarray(0, separator).toString("utf8");
  const match = header.match(/content-length:\s*(\d+)/i);
  if (!match) {
    throw new Error(`Invalid MCP message header: ${header}`);
  }

  const length = Number(match[1]);
  const bodyStart = separator + separatorLength;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) {
    return null;
  }

  const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
  return {
    message: JSON.parse(body),
    remaining: buffer.subarray(bodyEnd),
  };
}

function writeMcpMessage(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}

function inferMcpUrlFromProjectToken(projectToken) {
  const apiServiceUrl = readProjectTokenApiServiceUrl(projectToken);
  if (!apiServiceUrl) {
    return "";
  }
  return `${normalizeAppBaseUrl(apiServiceUrl)}/api/mcp`;
}

function readProjectTokenApiServiceUrl(projectToken) {
  const [, payloadSegment] = projectToken.split(".");
  if (!payloadSegment) {
    return "";
  }

  try {
    const normalizedPayload = payloadSegment
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(payloadSegment.length / 4) * 4, "=");
    const payload = JSON.parse(
      Buffer.from(normalizedPayload, "base64").toString("utf8"),
    );
    return typeof payload.apiServiceUrl === "string"
      ? payload.apiServiceUrl
      : "";
  } catch {
    return "";
  }
}

function normalizeAppBaseUrl(value) {
  const trimmed = normalizeEnvValue(value).replace(/\/+$/, "");
  if (trimmed.endsWith("/api")) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

function normalizeEnvValue(value) {
  if (!value || value.startsWith("${")) {
    return "";
  }
  return value.trim();
}

function firstEnvValue(...values) {
  for (const value of values) {
    const normalized = normalizeEnvValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function readLocalEnvFromDirectories(directories) {
  const env = {};
  for (const directory of candidateEnvDirectories(directories)) {
    for (const fileName of [
      ".env.local",
      ".env.development.local",
      ".env.development",
      ".env",
    ]) {
      for (const [key, value] of Object.entries(
        readEnvFile(path.join(directory, fileName)),
      )) {
        if (env[key] === undefined) {
          env[key] = value;
        }
      }
    }
  }
  return env;
}

function candidateEnvDirectories(values) {
  const directories = [];
  const seen = new Set();
  for (const value of values) {
    const directory = normalizeEnvValue(value);
    if (!directory) {
      continue;
    }
    const resolved = path.resolve(directory);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      directories.push(resolved);
    }
  }
  return directories;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/,
    );
    if (!match) {
      continue;
    }
    const [, key, rawValue = ""] = match;
    parsed[key] = parseEnvValue(rawValue);
  }
  return parsed;
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.indexOf(" #");
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

function firstString(...values) {
  return (
    values.find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) || ""
  );
}

function formatJsonRpcError(error) {
  return typeof error?.message === "string"
    ? error.message
    : JSON.stringify(error);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(
      /((?:Authorization|authorization)(?:"?\s*[:=]\s*"?|:\s*)Bearer\s*)[A-Za-z0-9._-]+/g,
      "$1[REDACTED]",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    );
}

if (process.env.SEMAPHOR_MCP_VERBOSE === "true") {
  process.stderr.write("Semaphor MCP bridge started.\n");
  process.stderr.write(
    `Semaphor MCP bridge protocol ${MCP_PROTOCOL_VERSION}\n`,
  );
}
