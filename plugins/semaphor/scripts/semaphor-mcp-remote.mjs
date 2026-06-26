#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertGeneratedContractArtifactDigest,
  DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
  readGeneratedContractValidationPayload,
  writeGeneratedContractFiles,
} from "./materialize-generated-contract.mjs";
import {
  inspectGeneratedDataAppAuthoringState,
} from "./inspect-generated-contract.mjs";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const CLIENT_REQUEST_TIMEOUT_MS = 2000;
const GENERATED_CONTRACT_MATERIALIZATION_TOOLS = new Set([
  "semaphor_materialize_data_app_contract",
]);
const DATA_APP_LOCAL_INSPECTION_TOOLS = new Set([
  "semaphor_inspect_data_app_state",
]);
const DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS = new Set([
  "semaphor_plan_data_app_change",
]);
const GENERATED_CONTRACT_PAYLOAD_TOOLS = new Set([
  "semaphor_create_data_app_contract",
  "semaphor_generate_data_app_contract",
  "semaphor_update_data_app_contract",
  "semaphor_materialize_data_app_contract",
]);
const DATA_APP_SERVER_AUTH_CONTEXT_TOOLS = new Set([
  "semaphor_get_data_app_sdk_guidance",
  "semaphor_plan_data_app",
  ...GENERATED_CONTRACT_PAYLOAD_TOOLS,
]);
const WORKSPACE_CONTEXT_TOOLS = new Set([
  "semaphor_get_access_context",
  "semaphor_validate_data_app_contract",
  ...DATA_APP_SERVER_AUTH_CONTEXT_TOOLS,
  ...GENERATED_CONTRACT_MATERIALIZATION_TOOLS,
  ...DATA_APP_LOCAL_INSPECTION_TOOLS,
  ...DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS,
]);
const WORKSPACE_HINT_SCHEMA = {
  type: "object",
  properties: {
    workspaceDir: {
      type: "string",
      description:
        "Optional React app root for installed-bridge access-context token discovery and local file operations such as materialization, validation, and inspect-state. It is not forwarded to hosted Semaphor tools.",
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
  {
    name: "semaphor_get_data_app_sdk_guidance",
    description:
      "Fetch Semaphor Data App SDK guidance. In installed bridge runs, pass workspaceDir so the bridge can resolve target-app project-token auth before forwarding to Semaphor.",
  },
  {
    name: "semaphor_plan_data_app",
    description:
      "Plan a new governed Semaphor Data App and return a planArtifactId. In installed bridge runs, pass workspaceDir so target-app project-token auth can be resolved before forwarding to Semaphor.",
  },
  {
    name: "semaphor_plan_data_app_change",
    description:
      "Plan an analytical change for an existing generated Semaphor Data App. In installed bridge runs, pass workspaceDir; the bridge inspects and validates local src/semaphor/generated files, then forwards currentManifest and beforeCurrentAuthoringState.",
  },
  {
    name: "semaphor_generate_data_app_contract",
    description:
      "Generate a governed Data App contract from a greenfield planArtifactId. Returns a generatedContractArtifactId and materialization token; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_create_data_app_contract",
    description:
      "Create a governed Data App contract in one server-owned call. In installed bridge runs, workspaceDir may be used only as a bridge-local auth hint and is stripped before forwarding; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_update_data_app_contract",
    description:
      "Generate an updated governed Data App contract from a change planArtifactId. Returns a generatedContractArtifactId and materialization token; local files are written by semaphor_materialize_data_app_contract.",
  },
  {
    name: "semaphor_materialize_data_app_contract",
    description:
      "Materialize a generated Data App contract artifact into local src/semaphor/generated files. In installed bridge runs, pass generatedContractArtifactId, generatedContractMaterializationToken, and workspaceDir.",
  },
  {
    name: "semaphor_validate_data_app_contract",
    description:
      "Validate generated Data App contract files. In installed bridge runs, pass workspaceDir to read local src/semaphor/generated without hand-assembling manifest or generatedFiles payloads.",
  },
  {
    name: "semaphor_inspect_data_app_state",
    description:
      "Inspect and validate local generated Data App authoring state before iterative edits. In installed bridge runs, pass workspaceDir.",
  },
].map((tool) => ({
  ...tool,
  inputSchema: bootstrapToolInputSchema(tool.name),
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
    const contextToolArguments =
      shouldUseToolArgumentsForContext(message.params?.name)
        ? toolArguments
        : undefined;
    const context = await resolveSemaphorContext({
      allowMissing: false,
      includeClientRoots: true,
      toolArguments: contextToolArguments,
    });
    if (!context?.token) {
      return missingSemaphorAuthResponse(message);
    }
    if (message.params?.name === "semaphor_inspect_data_app_state") {
      return inspectDataAppStateResponse(message, context);
    }
    const response = await postMcpJsonRpc(
      await prepareToolCallMessage(message, context),
      context,
    );
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

function shouldUseToolArgumentsForContext(toolName) {
  return WORKSPACE_CONTEXT_TOOLS.has(toolName);
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

function bootstrapToolInputSchema(toolName) {
  const schema = {
    type: "object",
    properties: {
      workspaceDir: WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
    },
    additionalProperties: true,
  };
  if (
    DATA_APP_LOCAL_INSPECTION_TOOLS.has(toolName) ||
    DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS.has(toolName) ||
    toolName === "semaphor_validate_data_app_contract"
  ) {
    schema.properties.outputDir = OUTPUT_DIR_HINT_SCHEMA;
  }
  if (GENERATED_CONTRACT_MATERIALIZATION_TOOLS.has(toolName)) {
    schema.properties.generatedContractArtifactId = {
      type: "string",
      description: "Generated contract artifact id returned by the generator or updater.",
    };
    schema.properties.generatedContractMaterializationToken =
      MATERIALIZATION_TOKEN_HINT_SCHEMA;
  }
  return schema;
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
            "If the token is already in the React app .env.local, launch the agent from that app root or pass workspaceDir only to installed-bridge bootstrap tools that advertise it. The bridge uses workspaceDir only for target-app auth discovery or local generated-file reads/writes, strips it before forwarding to Semaphor, and never treats it as a server generator/update input.",
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
    : DATA_APP_LOCAL_INSPECTION_TOOLS.has(tool?.name)
      ? " In installed Semaphor Agent Plugin runs, pass workspaceDir; the bridge inspects and validates local src/semaphor/generated files and returns currentAuthoringState."
    : DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS.has(tool?.name)
      ? " In installed Semaphor Agent Plugin runs, pass workspaceDir; the bridge inspects and validates local src/semaphor/generated files, then forwards currentManifest and beforeCurrentAuthoringState so the server can return planArtifactId for semaphor_update_data_app_contract."
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
    !DATA_APP_LOCAL_INSPECTION_TOOLS.has(tool?.name) &&
    !DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS.has(tool?.name) &&
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
  if (
    !DATA_APP_LOCAL_INSPECTION_TOOLS.has(tool?.name) &&
    !DATA_APP_LOCAL_PLAN_CONTEXT_TOOLS.has(tool?.name) &&
    tool?.name !== "semaphor_validate_data_app_contract"
  ) {
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

async function prepareToolCallMessage(message, context) {
  const withExpandedContractContext =
    await expandBridgeLocalContractContextArguments(message, context);
  const withExpandedValidation =
    await expandBridgeLocalValidationArguments(withExpandedContractContext);
  return stripBridgeOnlyToolArguments(withExpandedValidation);
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

  if (
    workspaceDir === undefined &&
    workspaceRoot === undefined &&
    projectDir === undefined &&
    repoRoot === undefined &&
    appDir === undefined
  ) {
    return message;
  }

  return {
    ...message,
    params: {
      ...message.params,
      arguments: forwardedArguments,
    },
  };
}

async function expandBridgeLocalValidationArguments(message) {
  if (message.params?.name === "semaphor_validate_data_app_contract") {
    return expandBridgeGeneratedContractValidationArguments(message);
  }
  return message;
}

async function expandBridgeLocalContractContextArguments(message, context) {
  if (message.params?.name !== "semaphor_plan_data_app_change") {
    return message;
  }
  const originalArguments = message.params?.arguments;
  if (!originalArguments || typeof originalArguments !== "object") {
    return message;
  }
  const { outputDir, ...forwardedOriginalArguments } = originalArguments;
  const messageWithoutOutputDir =
    outputDir === undefined
      ? message
      : {
          ...message,
          params: {
            ...message.params,
            arguments: forwardedOriginalArguments,
          },
        };
  const originalTarget =
    originalArguments.target && typeof originalArguments.target === "object"
      ? originalArguments.target
      : {};
  if (originalTarget.currentManifest && originalTarget.beforeCurrentAuthoringState) {
    return messageWithoutOutputDir;
  }

  const localContext = await readBridgeGeneratedContractContext(
    originalArguments,
    context,
    message,
  );
  if (!localContext?.manifest && !localContext?.beforeCurrentAuthoringState) {
    return messageWithoutOutputDir;
  }
  return {
    ...message,
    params: {
      ...message.params,
      arguments: {
        ...forwardedOriginalArguments,
        target: {
          ...originalTarget,
          ...(localContext.manifest && !originalTarget.currentManifest
            ? { currentManifest: localContext.manifest }
            : {}),
          ...(localContext.beforeCurrentAuthoringState &&
            !originalTarget.beforeCurrentAuthoringState
            ? {
                beforeCurrentAuthoringState:
                  localContext.beforeCurrentAuthoringState,
              }
            : {}),
        },
      },
    },
  };
}

async function readBridgeGeneratedContractContext(toolArguments, context, message) {
  const workspaceDir = await bridgeLocalContractWorkspaceDirectory(toolArguments);
  if (!workspaceDir) {
    return undefined;
  }
  const localInspection = await inspectLocalDataAppStateWithValidation({
    workspaceDir,
    outputDir: toolArguments.outputDir,
    context,
    message,
  });
  if (localInspection.errorResponse) {
    throw new Error(
      localInspection.errorResponse.error?.message ||
        "Failed to validate the local generated Data App contract.",
    );
  }
  return {
    manifest: localInspection.inspection.validationPayload?.manifest,
    beforeCurrentAuthoringState:
      localInspection.inspection.currentAuthoringState,
  };
}

async function readBridgeGeneratedContractManifest(toolArguments) {
  const workspaceDir = await bridgeLocalContractWorkspaceDirectory(toolArguments);
  if (!workspaceDir) {
    return undefined;
  }
  return readGeneratedContractValidationPayload(
    workspaceDir,
    toolArguments.outputDir,
  ).manifest;
}

async function bridgeLocalContractWorkspaceDirectory(toolArguments) {
  const explicitWorkspaceDir = firstBridgeWorkspaceDirectory(toolArguments);
  if (explicitWorkspaceDir) {
    return explicitWorkspaceDir;
  }
  const clientRootDirectories = await listClientRootDirectories();
  if (clientRootDirectories.length !== 1) {
    return undefined;
  }
  const [clientRootDirectory] = clientRootDirectories;
  if (!clientRootDirectory) {
    return undefined;
  }
  return clientRootDirectory;
}

function uniqueStrings(values) {
  return Array.from(new Set(
    values.filter((value) => typeof value === "string" && value.trim()),
  ));
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

async function inspectDataAppStateResponse(message, context) {
  const originalArguments = message.params?.arguments || {};
  const workspaceDir = firstBridgeWorkspaceDirectory(originalArguments);
  if (!workspaceDir) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        content: [{
          type: "text",
          text:
            "semaphor_inspect_data_app_state requires workspaceDir in installed bridge runs so the bridge can read local src/semaphor/generated files.",
        }],
      },
    };
  }
  const { inspection, validation, errorResponse } =
    await inspectLocalDataAppStateWithValidation({
      workspaceDir,
      outputDir: originalArguments.outputDir,
      context,
      message,
    });
  if (!inspection.validationPayload) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        structuredContent: {
          currentAuthoringState: inspection.currentAuthoringState,
          nextAgentAction:
            "Regenerate and materialize the Semaphor contract before planning iterative edits.",
        },
        content: [{
          type: "text",
          text:
            "Generated Data App inspection is blocked because the local generated contract manifest is missing or invalid.",
        }],
      },
    };
  }
  if (errorResponse) {
    return errorResponse;
  }
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      structuredContent: {
        currentAuthoringState: inspection.currentAuthoringState,
        validation,
        nextAgentAction:
          "For analytical edits, call semaphor_plan_data_app_change with workspaceDir; the installed bridge attaches the validated currentManifest and beforeCurrentAuthoringState. For UI-only edits, patch presentation code without changing src/semaphor/generated.",
      },
      content: [{
        type: "text",
        text:
          inspection.currentAuthoringState.inspection.status === "inspected"
            ? "Generated Data App state inspected and validated."
            : "Generated Data App state inspection is blocked by validation issues.",
      }],
    },
  };
}

async function inspectLocalDataAppStateWithValidation({
  workspaceDir,
  outputDir,
  context,
  message,
}) {
  const initialInspection = inspectGeneratedDataAppAuthoringState({
    workspaceDir,
    outputDir,
  });
  if (!initialInspection.validationPayload) {
    return { inspection: initialInspection };
  }
  const validationMessage = {
    jsonrpc: "2.0",
    id: message.id,
    method: "tools/call",
    params: {
      name: "semaphor_validate_data_app_contract",
      arguments: {
        manifest: initialInspection.validationPayload.manifest,
        generatedFiles: initialInspection.validationPayload.generatedFiles,
      },
    },
  };
  const validationResponse = normalizeJsonRpcResponse(
    validationMessage,
    await postMcpJsonRpc(validationMessage, context),
  );
  if (validationResponse.error) {
    return {
      inspection: initialInspection,
      errorResponse: validationResponse,
    };
  }
  const validation = validationFromMcpToolResult(validationResponse.result);
  const inspection = inspectGeneratedDataAppAuthoringState({
    workspaceDir,
    outputDir,
    validation,
  });
  return {
    inspection,
    validation,
  };
}

function validationFromMcpToolResult(result) {
  if (result?.isError) {
    return {
      ok: false,
      issues: [{
        code: "validation_tool_error",
        message: textFromMcpContent(result.content) ||
          "semaphor_validate_data_app_contract returned an MCP tool error.",
      }],
    };
  }
  return result?.structuredContent || result || {};
}

function textFromMcpContent(content) {
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join(" ");
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
  assertGeneratedContractArtifactDigest(payload);

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
      generatedContractArtifactBaseUrl: payload.generatedContractArtifactBaseUrl,
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
        generatedContractArtifactBaseUrl: payload.generatedContractArtifactBaseUrl,
        status: "not_written",
        required: true,
      }),
    nextAgentAction:
      retryToolName === "semaphor_materialize_data_app_contract"
        ? "Materialize through the installed Semaphor Agent Plugin bridge with workspaceDir, or run npm run data-app -- materialize-contract --dir <react-app-root> --artifact-id <generatedContractArtifactId> --materialization-token <generatedContractMaterializationToken> --artifact-base-url <generatedContractArtifactBaseUrl>. Require materialization.status=\"written\" before UI edits; do not hand-write generated files."
        : "Call semaphor_materialize_data_app_contract with generatedContractArtifactId, generatedContractMaterializationToken, and workspaceDir through the installed bridge, or run npm run data-app -- materialize-contract with the returned artifact id, materialization token, and artifact base URL. Require materialization.status=\"written\" before UI edits; do not hand-write generated files.",
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
  const artifactBaseUrl =
    typeof input.generatedContractArtifactBaseUrl === "string" &&
    input.generatedContractArtifactBaseUrl.trim()
      ? input.generatedContractArtifactBaseUrl
      : "https://semaphor.cloud";
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
        "--artifact-base-url",
        artifactBaseUrl,
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
        artifactBaseUrl,
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
