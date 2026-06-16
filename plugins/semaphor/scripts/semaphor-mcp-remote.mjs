#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  evaluateContractUpdatePolicy,
  generatedContractTypescriptFiles,
  validateGeneratedContract,
} from "./shared-codegen-loader.mjs";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const CLIENT_REQUEST_TIMEOUT_MS = 2000;
const CHILD_PROCESS_OUTPUT_MAX_BUFFER = 64 * 1024 * 1024;
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
const LOCAL_TOOLS = [
  {
    name: "semaphor_create_data_app_contract",
    description:
      "One-step Data App contract creation for eval paths or explicit user-approved builds that skip separate plan review. Normal interactive greenfield builds should call semaphor_plan_data_app first, present the plan, wait for approval, then call semaphor_generate_data_app_contract.",
    annotations: {
      title: "Create Data App Contract",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: {
          ...WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
          description:
            "Required React app root where generated files should be written.",
        },
        domainId: {
          type: "string",
          description:
            "Selected semantic domain id for the greenfield Data App plan.",
        },
        goal: {
          type: "string",
          description: "User-approved business goal for the Data App.",
        },
        preferences: {
          type: "object",
          description:
            "Optional planner preferences such as maxViews, tableMode, allowSqlFallback, includeMatrix, and measureAggregateOverrides. Use measureAggregateOverrides only for explicit user-requested caller aggregates, e.g. [{ fieldName: \"expected_yield_pct\", aggregate: \"AVG\" }]; do not infer overrides from field names.",
          additionalProperties: true,
        },
        datasetName: {
          type: "string",
          description: "Optional single dataset name to prioritize.",
        },
        datasetNames: {
          type: "array",
          description: "Optional dataset names to prioritize.",
          items: { type: "string" },
        },
        requestedDatasetNames: {
          type: "array",
          description:
            "Optional requested dataset names when the scenario names specific sources.",
          items: { type: "string" },
        },
        outputDir: {
          type: "string",
          description:
            "Output directory relative to workspaceDir. Defaults to src/semaphor/generated.",
        },
        allowEmptyContract: {
          type: "boolean",
          description:
            "Escape hatch for explicit model-gap report apps only. Normal dashboard builds must leave this false so zero-executable-view plans stop before writing generated files.",
        },
      },
      required: ["workspaceDir", "domainId", "goal"],
      additionalProperties: false,
    },
  },
  {
    name: "semaphor_generate_data_app_contract",
    description:
      "Materialize the accepted semaphor_plan_data_app codegenSummary into deterministic local TypeScript analytics contract files under src/semaphor/generated. Call this after planning is accepted and before editing UI code so agents import generated sources, fields, inputs, queries, and filter bindings instead of hand-rolling analytics wiring. Zero-executable-view plans are rejected by default because a blocked plan is not an implementation plan. If generation fails twice, stop and report the generator/tooling failure instead of manually recreating generated files.",
    annotations: {
      title: "Generate Data App Contract",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: {
          ...WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
          description:
            "Required React app root where generated files should be written.",
        },
        planArtifactPath: {
          type: "string",
          description:
            "Canonical semaphor-data-app-codegen-summary/v1 JSON file from an accepted semaphor_plan_data_app result. Relative paths resolve from workspaceDir.",
        },
        codegenSummary: {
          type: "object",
          description:
            "Fallback only: inline canonical semaphor-data-app-codegen-summary/v1 object when no artifact path exists. The bridge writes it as a short-lived OS temp file before running the file-based generator. Do not pass a hand-condensed full plan or wrapper object.",
          additionalProperties: true,
        },
        outputDir: {
          type: "string",
          description:
            "Output directory relative to workspaceDir. Defaults to src/semaphor/generated.",
        },
        allowEmptyContract: {
          type: "boolean",
          description:
            "Escape hatch for explicit model-gap report apps only. Normal dashboard builds must leave this false so zero-executable-view plans stop before writing generated files.",
        },
      },
      required: ["workspaceDir"],
      additionalProperties: false,
    },
  },
  {
    name: "semaphor_update_data_app_contract",
    description:
      "Update an existing generated Semaphor Data App analytics contract. Reads src/semaphor/generated/contract.manifest.json as the durable current plan, calls semaphor_plan_data_app_change, and regenerates the same deterministic contract files. Use this for iterative app changes instead of editing generated analytics wiring or reconstructing current state from App.tsx.",
    annotations: {
      title: "Update Data App Contract",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: {
          ...WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
          description:
            "Required React app root containing src/semaphor/generated/contract.manifest.json.",
        },
        goal: {
          type: "string",
          description:
            "User-approved change goal for the existing generated Data App.",
        },
        operationIntent: {
          type: "object",
          description:
            'Structured change intent. Supports add, edit, remove, and deterministic diagnostic fixes. Use { kind: "fix_warnings", targetViewIds: [...] } for Inspector/runtime warning cleanup. For explicit metric aggregate repairs, use { kind: "edit", targetViewIds: [...], measureAggregateOverrides: [{ fieldName: "expected_yield_pct", aggregate: "AVG" }] } so unrelated views, inputs, and filter scopes are rejected before files are regenerated.',
          additionalProperties: true,
        },
        domainId: {
          type: "string",
          description:
            "Optional semantic domain id. Required only if the current manifest contains multiple domains.",
        },
        preferences: {
          type: "object",
          description:
            "Optional planner preferences for candidate views. Does not accept measureAggregateOverrides; explicit metric aggregate repairs must put measureAggregateOverrides on operationIntent so the deterministic update policy can preserve unrelated views, inputs, and filters.",
          additionalProperties: true,
        },
        datasetName: {
          type: "string",
          description:
            "Optional single dataset name to prioritize for the change.",
        },
        datasetNames: {
          type: "array",
          description: "Optional dataset names to prioritize for the change.",
          items: { type: "string" },
        },
        outputDir: {
          type: "string",
          description:
            "Generated contract directory relative to workspaceDir. Defaults to src/semaphor/generated.",
        },
        allowEmptyContract: {
          type: "boolean",
          description:
            "Escape hatch for explicit model-gap report apps only. Normal updates must leave this false.",
        },
      },
      required: ["workspaceDir", "goal"],
      additionalProperties: false,
    },
  },
  {
    name: "semaphor_validate_data_app_contract",
    description:
      "Run deterministic local Data App preflight: React/react-semaphor package setup, public SDK availability, root provider/DevTools wiring, generated contract completeness, generated contract hygiene, optional typecheck/build, optional live generated view execution checks, and optional live generated filter-effect checks.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceDir: WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
        runBuild: {
          type: "boolean",
          description:
            "Whether to also run the app typecheck/build scripts when present. Defaults to false for a fast contract check.",
        },
        strict: {
          type: "boolean",
          description:
            "Treat all validation advisories as failures in addition to hard contract issues.",
        },
        devtoolsSnapshotPath: {
          type: "string",
          description:
            "Optional path, relative to workspaceDir, to a captured Semaphor DevTools bridge JSON snapshot. When provided, validation requires generated query and input option traces to be present.",
        },
        filterEffectReportPath: {
          type: "string",
          description:
            "Optional path, relative to workspaceDir, to a browser smoke report proving each generated filter reran or changed at least one subscribed generated query.",
        },
        liveFilterEffectCheck: {
          type: "boolean",
          description:
            "When true, execute generated option-backed filters against Semaphor with the app runtime token and fail if sampled subscribed queries error or return empty/all-zero results.",
        },
        liveGeneratedViewsCheck: {
          type: "boolean",
          description:
            "When true, execute every generated executable view through Semaphor with the app runtime token and fail before browser runtime if a generated SDK spec or governed query fails.",
        },
      },
      additionalProperties: false,
    },
  },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

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
          version: "0.1.1",
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
        tools: [...FALLBACK_TOOLS, ...LOCAL_TOOLS],
      },
    };
  }

  if (message.method === "tools/call") {
    if (message.params?.name === "semaphor_create_data_app_contract") {
      return createLocalDataAppContract(message);
    }
    if (message.params?.name === "semaphor_generate_data_app_contract") {
      return generateLocalDataAppContract(message);
    }
    if (message.params?.name === "semaphor_update_data_app_contract") {
      return updateLocalDataAppContract(message);
    }
    if (message.params?.name === "semaphor_validate_data_app_contract") {
      return validateLocalDataAppContract(message);
    }
    const toolArguments = message.params?.arguments;
    const context = await resolveSemaphorContext({
      allowMissing: false,
      includeClientRoots: true,
      toolArguments,
    });
    if (!context?.token) {
      return missingSemaphorAuthResponse(message);
    }
    const response = await postMcpJsonRpc(
      stripBridgeOnlyToolArguments(message),
      context,
    );
    const normalized = normalizeJsonRpcResponse(message, response);
    return maybePersistDataAppPlanArtifact(message, normalized);
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
  const tools = Array.isArray(normalized?.result?.tools)
    ? normalized.result.tools.map(exposeBridgeWorkspaceHint)
    : FALLBACK_TOOLS;
  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      ...(normalized?.result || {}),
      tools: appendLocalTools(tools),
    },
  };
}

function maybePersistDataAppPlanArtifact(message, normalized) {
  if (message.params?.name !== "semaphor_plan_data_app") {
    return normalized;
  }

  const args =
    message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
  const workspaceDir = firstString(
    args.workspaceDir,
    args.workspaceRoot,
    args.projectDir,
    args.repoRoot,
    args.appDir,
  );
  const codegenSummary = normalized?.result?.structuredContent?.codegenSummary;
  if (!workspaceDir || !codegenSummary || typeof codegenSummary !== "object") {
    return normalized;
  }

  try {
    const artifactDir = path.resolve(workspaceDir, ".semaphor");
    fs.mkdirSync(artifactDir, { recursive: true });
    const artifactPath = path.join(
      artifactDir,
      "data-app-codegen-summary.latest.json",
    );
    fs.writeFileSync(
      artifactPath,
      `${JSON.stringify(codegenSummary, null, 2)}\n`,
      "utf8",
    );
    const relativeArtifactPath = path.relative(
      path.resolve(workspaceDir),
      artifactPath,
    );
    const note =
      `Saved Semaphor codegen summary artifact to ${relativeArtifactPath}. ` +
      "Pass this path as planArtifactPath to semaphor_generate_data_app_contract.";
    return appendPlannerArtifactResult(normalized, {
      workspaceDir: path.resolve(workspaceDir),
      planArtifactPath: relativeArtifactPath,
      codegenSummaryArtifactPath: relativeArtifactPath,
      note,
    });
  } catch (error) {
    const warning =
      `Semaphor plan succeeded, but the local bridge could not persist the codegen summary artifact: ` +
      redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      );
    return appendPlannerArtifactResult(normalized, {
      workspaceDir: path.resolve(workspaceDir),
      artifactWarning: warning,
      note: warning,
    });
  }
}

function appendPlannerArtifactResult(normalized, details) {
  const result =
    normalized?.result && typeof normalized.result === "object"
      ? normalized.result
      : {};
  const structuredContent =
    result.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : {};
  const content = Array.isArray(result.content) ? result.content : [];
  return {
    ...normalized,
    result: {
      ...result,
      structuredContent: {
        ...structuredContent,
        planArtifactPath: details.planArtifactPath,
        codegenSummaryArtifactPath: details.codegenSummaryArtifactPath,
        workspaceDir: details.workspaceDir,
        artifactWarning: details.artifactWarning,
      },
      content: [
        ...content,
        {
          type: "text",
          text: details.note,
        },
      ],
    },
  };
}

function appendLocalTools(tools) {
  const seen = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  return [...tools, ...LOCAL_TOOLS.filter((tool) => !seen.has(tool.name))];
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
            "If hosted OAuth tools are not exposed, the OAuth app connection requires reauthentication, or the semaphor MCP is not logged in, ask the user to use the current host MCP OAuth login or reauthentication flow for the server named semaphor, then say try again. In Codex, the command is codex mcp login semaphor; in Claude Code or another host, use that host MCP server authentication UI or command. Mention a fresh agent session only if the host does not expose refreshed OAuth tools in the current session.",
            "For deterministic project-token mode, add VITE_SEMAPHOR_PROJECT_TOKEN to the React app .env.local, or export SEMAPHOR_PROJECT_TOKEN before launching the agent.",
            "If the token is already in .env.local, retry the Semaphor tool call with workspaceDir set to the React app root.",
            "For local development, add SEMAPHOR_SERVER_URL=http://localhost:3000 to the same .env.local. Hosted Semaphor defaults to https://semaphor.cloud.",
          ].join(" "),
        },
      ],
    },
  };
}

function validateLocalDataAppContract(message) {
  const args =
    message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
  const workspaceDir = firstString(
    args.workspaceDir,
    args.workspaceRoot,
    args.projectDir,
    args.repoRoot,
    args.appDir,
    process.cwd(),
  );
  const validatorPath = path.join(
    pluginRoot,
    "scripts/validate-semaphor-data-app.mjs",
  );
  const commandArgs = [validatorPath, "--dir", workspaceDir, "--json"];
  if (!args.runBuild) {
    commandArgs.push("--no-run");
  }
  if (args.strict) {
    commandArgs.push("--strict");
  }
  if (
    typeof args.devtoolsSnapshotPath === "string" &&
    args.devtoolsSnapshotPath.trim()
  ) {
    commandArgs.push("--devtools-snapshot", args.devtoolsSnapshotPath.trim());
  }
  if (
    typeof args.filterEffectReportPath === "string" &&
    args.filterEffectReportPath.trim()
  ) {
    commandArgs.push(
      "--filter-effect-report",
      args.filterEffectReportPath.trim(),
    );
  }
  if (args.liveFilterEffectCheck) {
    commandArgs.push("--live-filter-effect");
  }
  if (args.liveGeneratedViewsCheck) {
    commandArgs.push("--live-generated-views");
  }
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: workspaceDir,
    encoding: "utf8",
    env: process.env,
    maxBuffer: CHILD_PROCESS_OUTPUT_MAX_BUFFER,
  });
  const stdout = redactSensitiveText(result.stdout || "");
  const stderr = redactSensitiveText(result.stderr || "");
  const parsedValidation = parseValidationJson(stdout);
  const ok = parsedValidation?.ok === true && result.status === 0;
  const text = [
    ok
      ? "Semaphor Data App contract validation passed."
      : "Semaphor Data App contract validation failed.",
    formatValidationSummary(parsedValidation) || stdout.trim(),
    stderr.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const structuredContent =
    parsedValidation && typeof parsedValidation === "object"
      ? {
          ...parsedValidation,
          ok,
          workspaceDir,
          runBuild: Boolean(args.runBuild),
          strict: Boolean(args.strict),
          exitCode: result.status,
          signal: result.signal || null,
          stdout,
          stderr,
        }
      : {
          ok,
          workspaceDir,
          runBuild: Boolean(args.runBuild),
          strict: Boolean(args.strict),
          exitCode: result.status,
          signal: result.signal || null,
          stdout,
          stderr,
          issues: ok
            ? []
            : [
                {
                  code: "validation_process_failed",
                  severity: "error",
                  message: "Validation process did not return structured JSON.",
                  repairHint:
                    "Run validate-semaphor-data-app.mjs locally and inspect stdout/stderr.",
                },
              ],
          advisories: [],
        };

  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      isError: !ok,
      structuredContent,
      content: [
        {
          type: "text",
          text,
        },
      ],
    },
  };
}

function parseValidationJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function formatValidationSummary(validation) {
  if (!validation || typeof validation !== "object") return "";
  const lines = [
    `Checked ${validation.sourceFileCount ?? 0} source files.`,
    `SDK import files: ${validation.sdkImportFileCount ?? 0}`,
  ];
  if (
    Array.isArray(validation.advisories) &&
    validation.advisories.length > 0
  ) {
    lines.push("", "Validation advisories:");
    for (const advisory of validation.advisories) {
      lines.push(
        `- [${advisory.code || "validation_advisory"}] ${advisory.message || advisory.code}`,
      );
    }
  }
  if (Array.isArray(validation.issues) && validation.issues.length > 0) {
    lines.push("", "Validation issues:");
    for (const issue of validation.issues) {
      lines.push(
        `- [${issue.code || "validation_issue"}] ${issue.message || issue.code}`,
      );
      if (issue.repairHint) {
        lines.push(`  Repair: ${issue.repairHint}`);
      }
    }
  }
  if (validation.ok) {
    lines.push("Semaphor data app preflight passed.");
  }
  return lines.join("\n");
}

async function createLocalDataAppContract(message) {
  const args =
    message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
  const workspaceDir = firstString(
    args.workspaceDir,
    args.workspaceRoot,
    args.projectDir,
    args.repoRoot,
    args.appDir,
    process.cwd(),
  );
  const domainId = firstString(args.domainId);
  const goal = firstString(args.goal);

  if (!workspaceDir || !domainId || !goal) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          error: "Pass workspaceDir, domainId, and goal.",
        },
        content: [
          {
            type: "text",
            text: "Semaphor Data App contract creation requires workspaceDir, domainId, and goal.",
          },
        ],
      },
    };
  }

  const context = await resolveSemaphorContext({
    allowMissing: false,
    includeClientRoots: true,
    toolArguments: args,
  });
  if (!context?.token) {
    return missingSemaphorAuthResponse(message);
  }

  const plannerArguments = plannerArgumentsForCreateContract(args);
  const plannerMessage = {
    jsonrpc: "2.0",
    id: message.id,
    method: "tools/call",
    params: {
      name: "semaphor_plan_data_app",
      arguments: plannerArguments,
    },
  };
  const plannerResponse = await postMcpJsonRpc(plannerMessage, context);
  const normalizedPlannerResponse = normalizeJsonRpcResponse(
    plannerMessage,
    plannerResponse,
  );
  if (normalizedPlannerResponse?.error) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: normalizedPlannerResponse.error,
    };
  }
  if (normalizedPlannerResponse?.result?.isError) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: normalizedPlannerResponse.result,
    };
  }

  const codegenSummary =
    normalizedPlannerResponse?.result?.structuredContent?.codegenSummary;
  if (!codegenSummary || typeof codegenSummary !== "object") {
    const contentText = contentTextFromResult(
      normalizedPlannerResponse?.result,
    );
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          plannerTool: "semaphor_plan_data_app",
          error:
            "Planner response did not include structuredContent.codegenSummary.",
        },
        content: [
          {
            type: "text",
            text: [
              "Semaphor Data App planning succeeded, but the response did not include codegenSummary.",
              'Retry planning with responseFormat="codegen_summary"; do not reconstruct analytics wiring from prose.',
              contentText,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      },
    };
  }

  const generation = runDataAppContractGenerator({
    workspaceDir,
    outputDir: firstString(args.outputDir, "src/semaphor/generated"),
    codegenSummary,
    allowEmptyContract: args.allowEmptyContract === true,
  });
  const ok = generation.ok;
  const planSummary = compactCodegenSummary(codegenSummary);
  const text = [
    ok
      ? "Semaphor Data App plan accepted and analytics contract generated."
      : "Semaphor Data App plan was produced, but analytics contract generation failed.",
    JSON.stringify(
      {
        plan: planSummary,
        generated: generation.parsed || null,
        error: generation.parsed?.error || null,
      },
      null,
      2,
    ),
    generation.stderr.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      isError: !ok,
      structuredContent: {
        ok,
        workspaceDir: path.resolve(workspaceDir),
        plannerTool: "semaphor_plan_data_app",
        generatorTool: "semaphor_generate_data_app_contract",
        plan: planSummary,
        exitCode: generation.exitCode,
        signal: generation.signal,
        ...(generation.parsed || {}),
        stdout: generation.stdout,
        stderr: generation.stderr,
      },
      content: [
        {
          type: "text",
          text,
        },
      ],
    },
  };
}

function plannerArgumentsForCreateContract(args) {
  const {
    workspaceDir: _workspaceDir,
    workspaceRoot: _workspaceRoot,
    projectDir: _projectDir,
    repoRoot: _repoRoot,
    appDir: _appDir,
    outputDir: _outputDir,
    allowEmptyContract: _allowEmptyContract,
    responseFormat: _responseFormat,
    ...plannerArguments
  } = args;
  return {
    ...plannerArguments,
    responseFormat: "codegen_summary",
  };
}

function generateLocalDataAppContract(message) {
  const args =
    message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
  const workspaceDir = firstString(
    args.workspaceDir,
    args.workspaceRoot,
    args.projectDir,
    args.repoRoot,
    args.appDir,
    process.cwd(),
  );
  const outputDir = firstString(args.outputDir, "src/semaphor/generated");
  if (
    !args.planArtifactPath &&
    !(args.codegenSummary && typeof args.codegenSummary === "object")
  ) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          error: "Pass planArtifactPath or inline codegenSummary.",
        },
        content: [
          {
            type: "text",
            text: "Semaphor Data App contract generation requires planArtifactPath or inline codegenSummary from semaphor_plan_data_app.",
          },
        ],
      },
    };
  }

  const generation = runDataAppContractGenerator({
    workspaceDir,
    outputDir,
    planArtifactPath: args.planArtifactPath,
    codegenSummary: args.codegenSummary,
    allowEmptyContract: args.allowEmptyContract === true,
  });
  const text = [
    generation.ok
      ? "Semaphor Data App analytics contract generated."
      : "Semaphor Data App analytics contract generation failed.",
    generation.parsed
      ? JSON.stringify(generation.parsed, null, 2)
      : generation.stdout.trim(),
    generation.stderr.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      isError: !generation.ok,
      structuredContent: {
        ok: generation.ok,
        workspaceDir,
        exitCode: generation.exitCode,
        signal: generation.signal,
        ...(generation.parsed || {}),
        stdout: generation.stdout,
        stderr: generation.stderr,
      },
      content: [
        {
          type: "text",
          text,
        },
      ],
    },
  };
}

async function updateLocalDataAppContract(message) {
  const args =
    message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
  const workspaceDir = firstString(
    args.workspaceDir,
    args.workspaceRoot,
    args.projectDir,
    args.repoRoot,
    args.appDir,
    process.cwd(),
  );
  const outputDir = firstString(args.outputDir, "src/semaphor/generated");
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!workspaceDir || !goal) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          error: "Pass workspaceDir and goal.",
        },
        content: [
          {
            type: "text",
            text: "Semaphor Data App contract update requires workspaceDir and goal.",
          },
        ],
      },
    };
  }

  let manifest;
  try {
    manifest = await readGeneratedContractManifest({ workspaceDir, outputDir });
  } catch (error) {
    const text = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          outputDir,
          error: text,
        },
        content: [{ type: "text", text }],
      },
    };
  }

  const currentSummary = manifest.codegenSummary;
  const domainResolution = resolveDomainIdFromCurrentSummary({
    domainId: args.domainId,
    currentSummary,
  });
  if (!domainResolution.ok) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          outputDir,
          error: domainResolution.error,
        },
        content: [{ type: "text", text: domainResolution.error }],
      },
    };
  }

  const operationIntent =
    args.operationIntent && typeof args.operationIntent === "object"
      ? args.operationIntent
      : {
          kind: "add",
          reason:
            "Default generated Data App update intent: add governed views/filters while preserving existing generated contract entries.",
        };
  const hasUpdatePreferenceAggregateOverrides =
    args.preferences &&
    typeof args.preferences === "object" &&
    Array.isArray(args.preferences.measureAggregateOverrides);
  if (hasUpdatePreferenceAggregateOverrides) {
    const text =
      "Update metric aggregate repairs must use operationIntent.measureAggregateOverrides with kind: \"edit\" and targetViewIds. Do not pass measureAggregateOverrides under preferences for semaphor_update_data_app_contract.";
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          outputDir,
          issues: [
            {
              code: "invalid_update_preferences",
              path: "preferences.measureAggregateOverrides",
              message: text,
            },
          ],
          error: text,
        },
        content: [{ type: "text", text }],
      },
    };
  }

  const context = await resolveSemaphorContext({
    allowMissing: false,
    includeClientRoots: true,
    toolArguments: args,
  });
  if (!context?.token) {
    return missingSemaphorAuthResponse(message);
  }

  const changeArguments = {
    domainId: domainResolution.domainId,
    goal,
    operationIntent,
    target: {
      kind: "data_app",
      appPath: workspaceDir,
      currentPlan: currentSummary,
      existingViewIds: Array.isArray(currentSummary.views)
        ? currentSummary.views.map((view) => view?.id).filter(Boolean)
        : [],
    },
    ...(args.preferences ? { preferences: args.preferences } : {}),
    ...(args.datasetName ? { datasetName: args.datasetName } : {}),
    ...(args.datasetNames ? { datasetNames: args.datasetNames } : {}),
    includeCalculatedFields: args.includeCalculatedFields,
  };
  const plannerMessage = {
    jsonrpc: "2.0",
    id: message.id,
    method: "tools/call",
    params: {
      name: "semaphor_plan_data_app_change",
      arguments: changeArguments,
    },
  };
  const plannerResponse = await postMcpJsonRpc(plannerMessage, context);
  const normalizedPlannerResponse = normalizeJsonRpcResponse(
    plannerMessage,
    plannerResponse,
  );
  if (normalizedPlannerResponse?.error) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: normalizedPlannerResponse.error,
    };
  }
  if (normalizedPlannerResponse?.result?.isError) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: normalizedPlannerResponse.result,
    };
  }

  const codegenSummary =
    normalizedPlannerResponse?.result?.structuredContent?.codegenSummary;
  const changePlan =
    normalizedPlannerResponse?.result?.structuredContent?.changePlan;
  if (
    changePlan?.validation?.status === "blocked" ||
    changePlan?.nextStep === "ask_user"
  ) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          plannerTool: "semaphor_plan_data_app_change",
          changePlan,
          plan: codegenSummary ? compactCodegenSummary(codegenSummary) : null,
          error:
            "Change planner did not return a buildable update. Generated analytics contract was not modified.",
        },
        content: [
          {
            type: "text",
            text: [
              "Semaphor Data App change planning is blocked or requires user input.",
              "The generated analytics contract was not modified.",
              JSON.stringify(compactChangePlan(changePlan), null, 2),
            ].join("\n\n"),
          },
        ],
      },
    };
  }
  if (!codegenSummary || typeof codegenSummary !== "object") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          plannerTool: "semaphor_plan_data_app_change",
          error:
            "Change planner response did not include structuredContent.codegenSummary.",
        },
        content: [
          {
            type: "text",
            text: "Semaphor Data App change planning succeeded, but did not return an updated codegenSummary. Do not edit generated analytics files by hand.",
          },
        ],
      },
    };
  }

  const migrationReport = buildContractMigrationReport({
    before: currentSummary,
    after: codegenSummary,
    changePlan,
  });
  const updatePolicy = await evaluateContractUpdatePolicy({
    beforeSummary: currentSummary,
    afterSummary: codegenSummary,
    migrationReport,
    operationIntent: changeArguments.operationIntent,
    preferences: changeArguments.preferences,
  }, {
    workspaceDir,
  });
  if (!updatePolicy.ok) {
    const text = [
      "Semaphor Data App change plan was rejected by the deterministic update policy. Generated analytics contract was not modified.",
      JSON.stringify(
        {
          change: compactChangePlan(changePlan),
          updatePolicy,
          migrationReport,
        },
        null,
        2,
      ),
    ].join("\n\n");

    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          plannerTool: "semaphor_plan_data_app_change",
          changePlan,
          updatePolicy,
          migrationReport,
          plan: compactCodegenSummary(codegenSummary),
          error:
            "Change planner proposed updates outside the allowed generated-contract scope. Generated analytics contract was not modified.",
        },
        content: [{ type: "text", text }],
      },
    };
  }

  const generation = runDataAppContractGenerator({
    workspaceDir,
    outputDir,
    codegenSummary,
    allowEmptyContract: args.allowEmptyContract === true,
  });
  const text = [
    generation.ok
      ? "Semaphor Data App change plan accepted and analytics contract regenerated."
      : "Semaphor Data App change plan was produced, but analytics contract regeneration failed.",
    JSON.stringify(
      {
        change: compactChangePlan(changePlan),
        migrationReport,
        generated: generation.parsed || null,
        error: generation.parsed?.error || null,
      },
      null,
      2,
    ),
    generation.stderr.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    jsonrpc: "2.0",
    id: message.id,
    result: {
      isError: !generation.ok,
      structuredContent: {
        ok: generation.ok,
        workspaceDir,
        plannerTool: "semaphor_plan_data_app_change",
        generatorTool: "semaphor_generate_data_app_contract",
        changePlan,
        updatePolicy,
        migrationReport,
        plan: compactCodegenSummary(codegenSummary),
        exitCode: generation.exitCode,
        signal: generation.signal,
        ...(generation.parsed || {}),
        stdout: generation.stdout,
        stderr: generation.stderr,
      },
      content: [{ type: "text", text }],
    },
  };
}

function runDataAppContractGenerator({
  workspaceDir,
  outputDir,
  planArtifactPath,
  codegenSummary,
  allowEmptyContract,
}) {
  const generatorPath = path.join(
    pluginRoot,
    "scripts/generate-data-app-contract.mjs",
  );
  const commandArgs = [
    generatorPath,
    "--dir",
    workspaceDir,
    "--output",
    outputDir,
    "--json",
  ];
  let tempDir = "";
  try {
    if (planArtifactPath) {
      commandArgs.push("--plan", planArtifactPath);
    } else if (codegenSummary && typeof codegenSummary === "object") {
      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "semaphor-data-app-contract-"),
      );
      const tempPlanPath = path.join(tempDir, "codegen-summary.json");
      fs.writeFileSync(tempPlanPath, JSON.stringify(codegenSummary), "utf8");
      commandArgs.push("--plan", tempPlanPath);
    } else {
      throw new Error("Pass planArtifactPath or inline codegenSummary.");
    }
    if (allowEmptyContract === true) {
      commandArgs.push("--allow-empty");
    }

    const result = spawnSync(process.execPath, commandArgs, {
      cwd: workspaceDir,
      encoding: "utf8",
      env: process.env,
      maxBuffer: CHILD_PROCESS_OUTPUT_MAX_BUFFER,
    });
    const stdout = redactSensitiveText(result.stdout || "");
    const stderr = redactSensitiveText(result.stderr || "");
    const parsed = parseGeneratedToolResult(stdout);
    return {
      ok: result.status === 0 && parsed?.ok === true,
      exitCode: result.status,
      signal: result.signal || null,
      stdout,
      stderr,
      parsed,
    };
  } catch (error) {
    const message = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: message,
      parsed: {
        ok: false,
        error: message,
      },
    };
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function compactCodegenSummary(summary) {
  const views = Array.isArray(summary?.views) ? summary.views : [];
  const inputs = Array.isArray(summary?.inputs) ? summary.inputs : [];
  const sources = Array.isArray(summary?.sources) ? summary.sources : [];
  return {
    title: summary?.title || "",
    sourceCount: sources.length,
    inputCount: inputs.length,
    viewCount: views.length,
    executableViewCount: views.filter(
      (view) => view?.sdkSpec?.builder && view?.sdkSpec?.spec,
    ).length,
    presentationViewCount: views.filter((view) =>
      isPlannerPresentationView(view),
    ).length,
    views: views.slice(0, 30).map((view) => ({
      id: view?.id || "",
      title: view?.title || "",
      visualType: view?.visualSpec?.type || view?.visualType || "",
      queryKind: view?.sdkSpec?.builder || view?.queryKind || "",
      sourceKeys: Array.isArray(view?.sourceKeys) ? view.sourceKeys : [],
    })),
    inputs: inputs.slice(0, 30).map((input) => ({
      id: input?.id || "",
      label: input?.label || "",
      type: input?.type || input?.kind || "",
      appliesToViewIds: Array.isArray(input?.appliesToViewIds)
        ? input.appliesToViewIds
        : [],
      optionQueryId: input?.optionQuery?.id || "",
    })),
  };
}

function compactChangePlan(changePlan) {
  const operations = Array.isArray(changePlan?.operations)
    ? changePlan.operations
    : [];
  return {
    operationCount: operations.length,
    operations: operations.slice(0, 30).map((operation) => ({
      op: operation?.op || "",
      targetViewId:
        operation?.targetViewId ||
        operation?.view?.id ||
        operation?.after?.id ||
        "",
      inputId: operation?.input?.id || "",
      affectedViewIds: Array.isArray(operation?.affectedViewIds)
        ? operation.affectedViewIds
        : [],
    })),
    nextStep: changePlan?.nextStep || "",
    validation: changePlan?.validation || null,
  };
}

function buildContractMigrationReport({ before, after, changePlan }) {
  const beforeViews = mapById(before?.views);
  const afterViews = mapById(after?.views);
  const beforeInputs = mapById(before?.inputs);
  const afterInputs = mapById(after?.inputs);
  const beforeFilters = mapById(before?.filterContracts, "inputId");
  const afterFilters = mapById(after?.filterContracts, "inputId");

  return {
    schemaVersion: "semaphor-generated-data-app-migration-report/v1",
    changeOperations: compactChangePlan(changePlan),
    views: diffRecords({
      before: beforeViews,
      after: afterViews,
      changedReason: viewChangeReason,
    }),
    inputs: diffRecords({
      before: beforeInputs,
      after: afterInputs,
      changedReason: inputChangeReason,
    }),
    filterContracts: diffRecords({
      before: beforeFilters,
      after: afterFilters,
      changedReason: filterContractChangeReason,
    }),
    agentAction:
      "Update presentation components for added/edited/removed view ids and input controls. Do not edit generated analytics files by hand.",
  };
}

function mapById(items, key = "id") {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.[key];
    if (typeof id === "string" && id.trim()) {
      map.set(id, item);
    }
  }
  return map;
}

function diffRecords({ before, after, changedReason }) {
  const ids = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  return {
    added: ids
      .filter((id) => !before.has(id) && after.has(id))
      .map((id) => ({ id })),
    removed: ids
      .filter((id) => before.has(id) && !after.has(id))
      .map((id) => ({ id })),
    changed: ids
      .filter((id) => before.has(id) && after.has(id))
      .map((id) => ({
        id,
        reasons: changedReason(before.get(id), after.get(id)),
      }))
      .filter((entry) => entry.reasons.length > 0),
    unchanged: ids.filter(
      (id) =>
        before.has(id) &&
        after.has(id) &&
        changedReason(before.get(id), after.get(id)).length === 0,
    ),
  };
}

function viewChangeReason(before, after) {
  const reasons = [];
  if (before?.title !== after?.title) reasons.push("title");
  if (before?.sdkBuilder !== after?.sdkBuilder) reasons.push("sdkBuilder");
  if (before?.queryKind !== after?.queryKind) reasons.push("queryKind");
  if (before?.visual !== after?.visual) reasons.push("visual");
  if (
    canonicalJson(before?.sdkSpec || null) !==
    canonicalJson(after?.sdkSpec || null)
  ) {
    reasons.push("sdkSpec");
  }
  if (
    canonicalJson(before?.fields || []) !== canonicalJson(after?.fields || [])
  ) {
    reasons.push("fields");
  }
  if (
    canonicalJson(before?.visualSpec || null) !==
    canonicalJson(after?.visualSpec || null)
  ) {
    reasons.push("visualSpec");
  }
  return reasons;
}

function inputChangeReason(before, after) {
  const reasons = [];
  if (before?.type !== after?.type) reasons.push("type");
  if (before?.label !== after?.label) reasons.push("label");
  if (
    canonicalJson(before?.fieldRef || null) !==
    canonicalJson(after?.fieldRef || null)
  ) {
    reasons.push("fieldRef");
  }
  if (
    canonicalJson(before?.appliesToViewIds || []) !==
    canonicalJson(after?.appliesToViewIds || [])
  ) {
    reasons.push("appliesToViewIds");
  }
  if (
    canonicalJson(before?.optionQuery || null) !==
    canonicalJson(after?.optionQuery || null)
  ) {
    reasons.push("optionQuery");
  }
  if (
    canonicalJson(before?.bindings || []) !==
    canonicalJson(after?.bindings || [])
  ) {
    reasons.push("bindings");
  }
  return reasons;
}

function filterContractChangeReason(before, after) {
  const reasons = [];
  if (
    canonicalJson(before?.appliesToViewIds || []) !==
    canonicalJson(after?.appliesToViewIds || [])
  ) {
    reasons.push("appliesToViewIds");
  }
  if (
    canonicalJson(before?.notAppliedToViewIds || []) !==
    canonicalJson(after?.notAppliedToViewIds || [])
  ) {
    reasons.push("notAppliedToViewIds");
  }
  if (
    canonicalJson(before?.bindings || []) !==
    canonicalJson(after?.bindings || [])
  ) {
    reasons.push("bindings");
  }
  if (
    canonicalJson(before?.optionQuery || null) !==
    canonicalJson(after?.optionQuery || null)
  ) {
    reasons.push("optionQuery");
  }
  return reasons;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

async function readGeneratedContractManifest({ workspaceDir, outputDir }) {
  const manifestPath = path.resolve(
    workspaceDir,
    outputDir,
    "contract.manifest.json",
  );
  if (!pathIsInside(path.resolve(workspaceDir), manifestPath)) {
    throw new Error("outputDir must resolve inside workspaceDir.");
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Missing generated contract manifest at ${path.relative(workspaceDir, manifestPath)}. Run semaphor_create_data_app_contract before update.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const validation = await validateGeneratedContract({
    manifest,
    generatedFiles: await readGeneratedContractFiles(
      path.resolve(workspaceDir, outputDir),
      { workspaceDir },
    ),
  }, { workspaceDir });
  if (Array.isArray(validation?.issues) && validation.issues.length > 0) {
    throw new Error(
      [
        `${path.relative(workspaceDir, manifestPath)} failed generated contract validation. Regenerate before iterative updates.`,
        ...validation.issues.map((issue) =>
          `- ${issue.path ? `${issue.path}: ` : ""}${issue.message}`,
        ),
      ].join("\n"),
    );
  }
  return manifest;
}

async function readGeneratedContractFiles(generatedDir, options = {}) {
  const generatedContractFiles = await generatedContractTypescriptFiles(options);
  const files = {};
  for (const fileName of generatedContractFiles) {
    const filePath = path.join(generatedDir, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    files[fileName] = fs.readFileSync(filePath, "utf8");
  }
  return files;
}

function pathIsInside(parentDir, childPath) {
  const relative = path.relative(parentDir, childPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveDomainIdFromCurrentSummary({ domainId, currentSummary }) {
  if (typeof domainId === "string" && domainId.trim()) {
    return { ok: true, domainId: domainId.trim() };
  }
  const domainIds = new Set();
  collectDomainIds(domainIds, currentSummary?.sources);
  collectDomainIds(domainIds, currentSummary?.inputs);
  collectDomainIds(domainIds, currentSummary?.views);
  const values = Array.from(domainIds);
  if (values.length === 1) {
    return { ok: true, domainId: values[0] };
  }
  if (values.length > 1) {
    return {
      ok: false,
      error: `Current generated contract contains multiple semantic domains (${values.join(", ")}). Pass domainId for this update.`,
    };
  }
  return {
    ok: false,
    error:
      "Current generated contract does not contain a semantic domainId. Regenerate the contract or pass domainId explicitly.",
  };
}

function collectDomainIds(target, value) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDomainIds(target, item);
    }
    return;
  }
  if (
    value.kind === "semantic" &&
    typeof value.domainId === "string" &&
    value.domainId.trim()
  ) {
    target.add(value.domainId.trim());
  }
  for (const item of Object.values(value)) {
    collectDomainIds(target, item);
  }
}

function isPlannerPresentationView(view) {
  return (
    view?.computation?.kind === "presentation_only" ||
    view?.kind === "presentation_only" ||
    view?.sdkSpec?.builder === "presentation_only"
  );
}

function contentTextFromResult(result) {
  return Array.isArray(result?.content)
    ? result.content
        .map((item) =>
          item?.type === "text" && typeof item.text === "string"
            ? item.text
            : "",
        )
        .filter(Boolean)
        .join("\n")
    : "";
}

function parseGeneratedToolResult(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart >= 0) {
      try {
        return JSON.parse(trimmed.slice(jsonStart));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function exposeBridgeWorkspaceHint(tool) {
  return {
    ...tool,
    inputSchema: mergeWorkspaceHint(tool?.inputSchema),
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

  const explicitMcpUrl = firstEnvValue(
    process.env.SEMAPHOR_MCP_URL,
    env.SEMAPHOR_MCP_URL,
  );
  const explicitServerUrl = firstEnvValue(
    process.env.SEMAPHOR_SERVER_URL,
    env.SEMAPHOR_SERVER_URL,
  );
  const mcpUrl =
    explicitMcpUrl ||
    inferMcpUrlFromServerUrl(explicitServerUrl) ||
    inferMcpUrlFromProjectToken(token) ||
    "https://semaphor.cloud/api/mcp";

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

async function listClientRootDirectories() {
  try {
    const response = await requestClient("roots/list", {});
    const roots = Array.isArray(response?.roots) ? response.roots : [];
    const directories = roots
      .map((root) => fileUriToPath(root?.uri))
      .filter(Boolean);
    if (directories.length !== 1) {
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

function inferMcpUrlFromServerUrl(serverUrl) {
  const normalized = normalizeAppBaseUrl(serverUrl);
  return normalized ? `${normalized}/api/mcp` : "";
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
