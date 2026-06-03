#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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
      'Diagnose Semaphor project-token setup. If no token is configured, this is an auth-blocking state for data-bearing app work: use the hosted OAuth MCP server named semaphor, ask the user to run codex mcp login semaphor, or add VITE_SEMAPHOR_PROJECT_TOKEN to the target React app .env.local. Do not scaffold placeholder analytics when auth is unavailable.',
  },
].map((tool) => ({
  ...tool,
  inputSchema: WORKSPACE_HINT_SCHEMA,
}));

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
        tools: FALLBACK_TOOLS,
      },
    };
  }

  if (message.method === 'tools/call') {
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
                'This is an auth-blocking state for Semaphor data-bearing work.',
                'Do not continue by creating a placeholder dashboard shell, static mock analytics, or generic query integration point.',
                'If hosted OAuth tools are exposed, use the MCP server named semaphor and call semaphor_list_projects.',
                'If hosted OAuth tools are not exposed or the semaphor MCP is not logged in, ask the user to run codex mcp login semaphor and restart/open a fresh agent session.',
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
      tools,
    },
  };
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
