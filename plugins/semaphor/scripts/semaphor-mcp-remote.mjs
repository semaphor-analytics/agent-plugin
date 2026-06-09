#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const CLIENT_REQUEST_TIMEOUT_MS = 2000;
const WORKSPACE_HINT_SCHEMA = {
  type: 'object',
  properties: {
    workspaceDir: {
      type: 'string',
      description:
        'Optional React app root. Use this when the Semaphor project token is stored in the target app .env.local.',
    },
  },
  additionalProperties: true,
};
const FALLBACK_TOOLS = [
  {
    name: 'semaphor_get_access_context',
    description:
      'Diagnose Semaphor auth setup. If no token is configured, pause data-bearing app work and ask the user to use the current host MCP OAuth login flow for the semaphor server, or add VITE_SEMAPHOR_PROJECT_TOKEN to the target React app .env.local, then resume when they say try again. In Codex, the OAuth command is codex mcp login semaphor. Do not scaffold placeholder analytics when auth is unavailable.',
  },
  {
    name: 'semaphor_get_analysis_context',
    description:
      'Bootstrap Semaphor analytics context for the active project. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_list_semantic_domains',
    description:
      'List semantic domains available to the active project. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_list_datasets',
    description:
      'List datasets in a semantic domain. Requires domainId. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_get_dataset_schema',
    description:
      'Return grounded semantic dataset fields. Pass domainId, datasetName, and workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_get_domain_relationships',
    description:
      'Return semantic-domain relationships. Requires domainId. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_plan_data_app',
    description:
      'Plan a Semaphor-backed React Data App from a selected semantic domain. Requires domainId and goal. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_plan_data_app_change',
    description:
      'Plan a preserve-by-default change to an existing Semaphor-backed React Data App. Requires goal. In project-token mode, pass workspaceDir when the token lives in the target React app .env.local.',
  },
  {
    name: 'semaphor_get_data_app_runtime_token',
    description:
      'Mint a scoped project runtime token in authenticated sessions. If project-token auth is unavailable, use hosted OAuth first.',
  },
].map((tool) => ({
  ...tool,
  inputSchema: WORKSPACE_HINT_SCHEMA,
}));
const LOCAL_TOOLS = [
  {
    name: 'semaphor_generate_data_app_contract',
    description:
      'Materialize the accepted semaphor_plan_data_app codegenSummary into deterministic local TypeScript analytics contract files under src/semaphor/generated. Call this after planning is accepted and before editing UI code so agents import generated sources, fields, inputs, queries, and filter bindings instead of hand-rolling analytics wiring. Zero-executable-view plans are rejected by default because a blocked plan is not an implementation plan. If generation fails twice, stop and report the generator/tooling failure instead of manually recreating generated files.',
    annotations: {
      title: 'Generate Data App Contract',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        workspaceDir: {
          ...WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
          description:
            'Required React app root where generated files should be written.',
        },
        planArtifactPath: {
          type: 'string',
          description:
            'Normal path: JSON plan artifact or planner capture containing codegenSummary. Relative paths resolve from workspaceDir. Prefer this over inline codegenSummary.',
        },
        codegenSummary: {
          type: 'object',
          description:
            'Fallback only: inline semaphor_plan_data_app codegenSummary when no plan artifact path exists. The bridge writes it as a short-lived input file inside the target output directory before running the file-based generator. Do not pass a hand-condensed full plan.',
          additionalProperties: true,
        },
        outputDir: {
          type: 'string',
          description:
            'Output directory relative to workspaceDir. Defaults to src/semaphor/generated.',
        },
        allowEmptyContract: {
          type: 'boolean',
          description:
            'Escape hatch for explicit model-gap report apps only. Normal dashboard builds must leave this false so zero-executable-view plans stop before writing generated files.',
        },
      },
      required: ['workspaceDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'semaphor_validate_data_app_contract',
    description:
      'Validate the local React Data App source against Semaphor SDK contract requirements: root DevTools, provider debug bridge, stable query ids, inputOptions for dropdown choices, shared filter handles, card filter affordances, and modular query/spec organization. Run this after initial SDK wiring and before reporting completion.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceDir: WORKSPACE_HINT_SCHEMA.properties.workspaceDir,
        runBuild: {
          type: 'boolean',
          description:
            'Whether to also run the app typecheck/build scripts when present. Defaults to false for a fast contract check.',
        },
        strict: {
          type: 'boolean',
          description:
            'Treat all validation advisories as failures in addition to hard contract issues.',
        },
      },
      additionalProperties: false,
    },
  },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');

let stdinBuffer = Buffer.alloc(0);
let shuttingDown = false;
let nextClientRequestId = 1000;
const pendingClientRequests = new Map();

process.stdin.on('data', (chunk) => {
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

process.stdin.on('end', () => {
  shuttingDown = true;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    process.exit(0);
  });
}

async function handleClientMessage(message) {
  if (shuttingDown || !message || typeof message !== 'object') {
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
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32000,
        message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      },
    });
  }
}

async function forwardRequest(message) {
  if (message.method === 'initialize') {
    const requestedProtocolVersion =
      typeof message.params?.protocolVersion === 'string'
        ? message.params.protocolVersion
        : MCP_PROTOCOL_VERSION;
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: requestedProtocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'semaphor',
          version: '0.1.1',
        },
      },
    };
  }

  if (message.method === 'tools/list') {
    const context = await resolveSemaphorContext({
      allowMissing: true,
      includeClientRoots: true,
    });
    if (context?.token) {
      const response = await postMcpJsonRpc(message, context);
      return normalizeToolsListResponse(message, response);
    }
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [...FALLBACK_TOOLS, ...LOCAL_TOOLS],
      },
    };
  }

  if (message.method === 'tools/call') {
    if (message.params?.name === 'semaphor_generate_data_app_contract') {
      return generateLocalDataAppContract(message);
    }
    if (message.params?.name === 'semaphor_validate_data_app_contract') {
      return validateLocalDataAppContract(message);
    }
    const toolArguments = message.params?.arguments;
    const context = await resolveSemaphorContext({
      allowMissing: false,
      includeClientRoots: true,
      toolArguments,
    });
    if (!context?.token) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: [
                'Semaphor project token was not found for this workspace.',
                'This is a recoverable setup step for Semaphor data-bearing work, not a denial of the user request.',
                'Pause, preserve the task context, and ask the user to authenticate before continuing.',
                'Do not create a placeholder dashboard shell, static mock analytics, or generic query integration point.',
                'If hosted OAuth tools are exposed, use the MCP server named semaphor and call semaphor_list_projects.',
                'If hosted OAuth tools are not exposed, the OAuth app connection requires reauthentication, or the semaphor MCP is not logged in, ask the user to use the current host MCP OAuth login or reauthentication flow for the server named semaphor, then say try again. In Codex, the command is codex mcp login semaphor; in Claude Code or another host, use that host MCP server authentication UI or command. Mention a fresh agent session only if the host does not expose refreshed OAuth tools in the current session.',
                'For deterministic project-token mode, add VITE_SEMAPHOR_PROJECT_TOKEN to the React app .env.local, or export SEMAPHOR_PROJECT_TOKEN before launching the agent.',
                'If the token is already in .env.local, retry the Semaphor tool call with workspaceDir set to the React app root.',
                'For local development, add SEMAPHOR_SERVER_URL=http://localhost:3000 to the same .env.local. Hosted Semaphor defaults to https://semaphor.cloud.',
              ].join(' '),
            },
          ],
        },
      };
    }
    const response = await postMcpJsonRpc(stripBridgeOnlyToolArguments(message), context);
    return normalizeJsonRpcResponse(message, response);
  }

  return {
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: -32601,
      message: `Unsupported Semaphor MCP bridge method: ${message.method}`,
    },
  };
}

function normalizeJsonRpcResponse(message, response) {
  if (response === undefined || response === null || response === '') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {},
    };
  }

  if (Array.isArray(response)) {
    const matching = response.find((item) => item?.id === message.id);
    return matching || response[0] || { jsonrpc: '2.0', id: message.id, result: {} };
  }

  if (response.id === undefined) {
    return {
      ...response,
      jsonrpc: response.jsonrpc || '2.0',
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
    jsonrpc: '2.0',
    id: message.id,
    result: {
      ...(normalized?.result || {}),
      tools: appendLocalTools(tools),
    },
  };
}

function appendLocalTools(tools) {
  const seen = new Set(tools.map((tool) => tool?.name).filter(Boolean));
  return [
    ...tools,
    ...LOCAL_TOOLS.filter((tool) => !seen.has(tool.name)),
  ];
}

function validateLocalDataAppContract(message) {
  const args = message.params?.arguments && typeof message.params.arguments === 'object'
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
  const validatorPath = path.join(pluginRoot, 'scripts/validate-semaphor-data-app.mjs');
  const commandArgs = [
    validatorPath,
    '--dir',
    workspaceDir,
  ];
  if (!args.runBuild) {
    commandArgs.push('--no-run');
  }
  if (args.strict) {
    commandArgs.push('--strict');
  }
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = redactSensitiveText(result.stdout || '');
  const stderr = redactSensitiveText(result.stderr || '');
  const ok = result.status === 0;
  const text = [
    ok
      ? 'Semaphor Data App contract validation passed.'
      : 'Semaphor Data App contract validation failed.',
    stdout.trim(),
    stderr.trim(),
  ].filter(Boolean).join('\n\n');

  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      isError: !ok,
      structuredContent: {
        ok,
        workspaceDir,
        runBuild: Boolean(args.runBuild),
        strict: Boolean(args.strict),
        exitCode: result.status,
        signal: result.signal || null,
        stdout,
        stderr,
      },
      content: [
        {
          type: 'text',
          text,
        },
      ],
    },
  };
}

function generateLocalDataAppContract(message) {
  const args = message.params?.arguments && typeof message.params.arguments === 'object'
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
  const generatorPath = path.join(pluginRoot, 'scripts/generate-data-app-contract.mjs');
  const outputDir = firstString(args.outputDir, 'src/semaphor/generated');
  const commandArgs = [
    generatorPath,
    '--dir',
    workspaceDir,
    '--output',
    outputDir,
    '--json',
  ];

  let tempPlanPath = '';
  if (args.planArtifactPath) {
    commandArgs.push('--plan', args.planArtifactPath);
  } else if (args.codegenSummary && typeof args.codegenSummary === 'object') {
    const outputPath = path.resolve(workspaceDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    tempPlanPath = path.join(
      outputPath,
      `.codegen-summary.input.${Date.now()}-${process.pid}.json`,
    );
    fs.writeFileSync(tempPlanPath, JSON.stringify(args.codegenSummary), 'utf8');
    commandArgs.push('--plan', tempPlanPath);
  } else {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        isError: true,
        structuredContent: {
          ok: false,
          workspaceDir,
          error: 'Pass planArtifactPath or inline codegenSummary.',
        },
        content: [
          {
            type: 'text',
            text: 'Semaphor Data App contract generation requires planArtifactPath or inline codegenSummary from semaphor_plan_data_app.',
          },
        ],
      },
    };
  }
  if (args.allowEmptyContract === true) {
    commandArgs.push('--allow-empty');
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: process.env,
  });
  if (tempPlanPath) {
    fs.rmSync(tempPlanPath, { force: true });
  }
  const stdout = redactSensitiveText(result.stdout || '');
  const stderr = redactSensitiveText(result.stderr || '');
  const parsed = parseGeneratedToolResult(stdout);
  const ok = result.status === 0 && parsed?.ok === true;
  const text = [
    ok
      ? 'Semaphor Data App analytics contract generated.'
      : 'Semaphor Data App analytics contract generation failed.',
    parsed ? JSON.stringify(parsed, null, 2) : stdout.trim(),
    stderr.trim(),
  ].filter(Boolean).join('\n\n');

  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      isError: !ok,
      structuredContent: {
        ok,
        workspaceDir,
        exitCode: result.status,
        signal: result.signal || null,
        ...(parsed || {}),
        stdout,
        stderr,
      },
      content: [
        {
          type: 'text',
          text,
        },
      ],
    },
  };
}

function parseGeneratedToolResult(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonStart = trimmed.indexOf('{');
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
  if (!inputSchema || typeof inputSchema !== 'object' || inputSchema.type !== 'object') {
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
  if (message.method === 'notifications/initialized') {
    return;
  }

  try {
    const context = await resolveSemaphorContext({ allowMissing: true, includeClientRoots: false });
    if (!context?.token) {
      return;
    }
    await postMcpJsonRpc(message, context);
  } catch (error) {
    const text = redactSensitiveText(error instanceof Error ? error.message : String(error));
    if (process.env.SEMAPHOR_MCP_VERBOSE === 'true') {
      process.stderr.write(`${text}\n`);
    }
  }
}

async function postMcpJsonRpc(message, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(context.mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
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

    return parseMcpHttpBody(body, response.headers.get('content-type') || '');
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms calling Semaphor MCP.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveSemaphorContext({ allowMissing, includeClientRoots, toolArguments }) {
  const env = await readWorkspaceEnv({ includeClientRoots, toolArguments });
  const token = firstEnvValue(
    process.env.SEMAPHOR_PROJECT_TOKEN,
    process.env.VITE_SEMAPHOR_PROJECT_TOKEN,
    env.SEMAPHOR_PROJECT_TOKEN,
    env.VITE_SEMAPHOR_PROJECT_TOKEN,
  );
  if (!token) {
    return allowMissing ? null : { token: '', mcpUrl: '' };
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
    'https://semaphor.cloud/api/mcp';

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
  if (!toolArguments || typeof toolArguments !== 'object') {
    return [];
  }
  return [
    toolArguments.workspaceDir,
    toolArguments.workspaceRoot,
    toolArguments.projectDir,
    toolArguments.repoRoot,
    toolArguments.appDir,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function stripBridgeOnlyToolArguments(message) {
  const originalArguments = message.params?.arguments;
  if (!originalArguments || typeof originalArguments !== 'object') {
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
    const response = await requestClient('roots/list', {});
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
  if (typeof uri !== 'string') {
    return '';
  }
  if (!uri.startsWith('file://')) {
    return '';
  }
  try {
    return fileURLToPath(uri);
  } catch {
    return '';
  }
}

function requestClient(method, params) {
  const id = nextClientRequestId;
  nextClientRequestId += 1;
  writeMcpMessage(process.stdout, {
    jsonrpc: '2.0',
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

  if (contentType.includes('text/event-stream') || trimmed.startsWith('event:')) {
    return parseEventStreamJson(trimmed);
  }

  return JSON.parse(trimmed);
}

function parseEventStreamJson(text) {
  const messages = [];
  let dataLines = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    if (line.trim() === '') {
      if (dataLines.length > 0) {
        messages.push(JSON.parse(dataLines.join('\n')));
        dataLines = [];
      }
    }
  }

  if (dataLines.length > 0) {
    messages.push(JSON.parse(dataLines.join('\n')));
  }

  if (messages.length === 0) {
    throw new Error('Semaphor MCP returned an event-stream response without JSON data.');
  }

  return messages.length === 1 ? messages[0] : messages;
}

function formatHttpError(response, body) {
  const trimmed = redactSensitiveText(body).trim();
  const suffix = trimmed ? `: ${trimmed.slice(0, 1000)}` : '';
  return `Semaphor MCP HTTP ${response.status} ${response.statusText}${suffix}`;
}

function readMcpMessage(buffer) {
  const firstNonWhitespace = buffer.findIndex((byte) => ![9, 10, 13, 32].includes(byte));
  if (firstNonWhitespace > 0) {
    buffer = buffer.subarray(firstNonWhitespace);
  }

  if (buffer[0] === 123) {
    const lineEnd = buffer.indexOf('\n');
    if (lineEnd === -1) {
      return null;
    }
    const line = buffer.subarray(0, lineEnd).toString('utf8').trim();
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

  let separator = buffer.indexOf('\r\n\r\n');
  let separatorLength = 4;
  if (separator === -1) {
    separator = buffer.indexOf('\n\n');
    separatorLength = 2;
  }
  if (separator === -1) {
    return null;
  }

  const header = buffer.subarray(0, separator).toString('utf8');
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

  const body = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
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
    return '';
  }
  return `${normalizeAppBaseUrl(apiServiceUrl)}/api/mcp`;
}

function inferMcpUrlFromServerUrl(serverUrl) {
  const normalized = normalizeAppBaseUrl(serverUrl);
  return normalized ? `${normalized}/api/mcp` : '';
}

function readProjectTokenApiServiceUrl(projectToken) {
  const [, payloadSegment] = projectToken.split('.');
  if (!payloadSegment) {
    return '';
  }

  try {
    const normalizedPayload = payloadSegment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(normalizedPayload, 'base64').toString('utf8'));
    return typeof payload.apiServiceUrl === 'string' ? payload.apiServiceUrl : '';
  } catch {
    return '';
  }
}

function normalizeAppBaseUrl(value) {
  const trimmed = normalizeEnvValue(value).replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

function normalizeEnvValue(value) {
  if (!value || value.startsWith('${')) {
    return '';
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
  return '';
}

function readLocalEnvFromDirectories(directories) {
  const env = {};
  for (const directory of candidateEnvDirectories(directories)) {
    for (const fileName of [
      '.env.local',
      '.env.development.local',
      '.env.development',
      '.env',
    ]) {
      for (const [key, value] of Object.entries(readEnvFile(path.join(directory, fileName)))) {
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
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue = ''] = match;
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
  const commentIndex = trimmed.indexOf(' #');
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

function firstString(...values) {
  return values.find((value) =>
    typeof value === 'string' && value.trim().length > 0
  ) || '';
}

function formatJsonRpcError(error) {
  return typeof error?.message === 'string' ? error.message : JSON.stringify(error);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(
      /((?:Authorization|authorization)(?:"?\s*[:=]\s*"?|:\s*)Bearer\s*)[A-Za-z0-9._-]+/g,
      '$1[REDACTED]',
    )
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      '[REDACTED_JWT]',
    );
}

if (process.env.SEMAPHOR_MCP_VERBOSE === 'true') {
  process.stderr.write('Semaphor MCP bridge started.\n');
  process.stderr.write(`Semaphor MCP bridge protocol ${MCP_PROTOCOL_VERSION}\n`);
}
