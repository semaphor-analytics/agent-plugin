#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const CLIENT_REQUEST_TIMEOUT_MS = 2000;
const BOOTSTRAP_TOOLS = [
  {
    name: 'semaphor_list_dashboards',
    description: 'List dashboards available to the current Semaphor project token.',
  },
  {
    name: 'semaphor_get_dashboard_details',
    description: 'Inspect a specific Semaphor dashboard and optionally include its template.',
  },
  {
    name: 'semaphor_get_dashboard_analysis_context',
    description:
      'Return compact card, filter, source, metric, dimension, and query context for an existing dashboard.',
  },
  {
    name: 'semaphor_get_access_context',
    description:
      'Inspect the current Semaphor project-token scope, organization/project identity, and enabled capabilities.',
  },
  {
    name: 'semaphor_list_connections',
    description:
      'List physical database connections when semantic context is absent or insufficient.',
  },
  {
    name: 'semaphor_list_databases',
    description: 'List databases or catalogs for a Semaphor connection.',
  },
  {
    name: 'semaphor_list_schemas',
    description: 'List schemas for a Semaphor connection and database/catalog.',
  },
  {
    name: 'semaphor_list_tables',
    description: 'List or find physical tables for a Semaphor connection scope.',
  },
  {
    name: 'semaphor_get_analysis_context',
    description:
      'Return a compact Semaphor analysis context for the current project, including useful domains and datasets.',
  },
  {
    name: 'semaphor_list_semantic_domains',
    description: 'List semantic domains available to the current Semaphor project token.',
  },
  {
    name: 'semaphor_list_datasets',
    description: 'List governed datasets for a semantic domain in the current Semaphor project.',
  },
  {
    name: 'semaphor_get_dataset_schema',
    description: 'Inspect fields, measures, dimensions, dates, and relationships for a governed dataset.',
  },
  {
    name: 'semaphor_get_domain_relationships',
    description: 'Return semantic-domain relationships for governed join-aware analysis.',
  },
  {
    name: 'semaphor_plan_dashboard',
    description: 'Plan a dashboard from a selected dataset without persisting changes.',
  },
  {
    name: 'semaphor_create_dashboard_from_plan',
    description: 'Create a private dashboard from an approved structured dashboard plan.',
  },
  {
    name: 'semaphor_plan_dashboard_change',
    description: 'Plan a non-destructive refinement for an existing editable dashboard.',
  },
  {
    name: 'semaphor_apply_dashboard_change',
    description: 'Apply an approved structured non-destructive dashboard change plan.',
  },
  {
    name: 'semaphor_plan_analytics_recovery',
    description:
      'Plan governed analytics recovery calls from typed intent and grounded schema evidence.',
  },
  {
    name: 'semaphor_analyze',
    description:
      'Run governed semantic BI analysis through Semaphor and return typed execution results for app authoring.',
  },
  {
    name: 'semaphor_matrix',
    description:
      'Plan or execute governed matrix/pivot-style analysis through the shared Semaphor analytics spine.',
  },
  {
    name: 'semaphor_query_sql_advanced',
    description:
      'Run read-only SQL-first analysis through governed Semaphor execution when semantic intents are not enough.',
  },
].map((tool) => ({
  ...tool,
  inputSchema: {
    type: 'object',
    additionalProperties: true,
  },
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
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
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
    const context = await resolveSemaphorContext({ allowMissing: true, includeClientRoots: false });
    if (!context?.token) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: BOOTSTRAP_TOOLS,
        },
      };
    }
    const response = await postMcpJsonRpc(message, context);
    return normalizeJsonRpcResponse(message, response);
  }

  if (message.method === 'tools/call') {
    const context = await resolveSemaphorContext({ allowMissing: false, includeClientRoots: true });
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
                'Add VITE_SEMAPHOR_PROJECT_TOKEN to the React app .env.local, or export SEMAPHOR_PROJECT_TOKEN before launching the agent.',
                'For local development, add SEMAPHOR_SERVER_URL=http://localhost:3000 to the same .env.local. Hosted Semaphor defaults to https://semaphor.cloud.',
              ].join(' '),
            },
          ],
        },
      };
    }
    const response = await postMcpJsonRpc(message, context);
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

async function resolveSemaphorContext({ allowMissing, includeClientRoots }) {
  const env = await readWorkspaceEnv({ includeClientRoots });
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

async function readWorkspaceEnv({ includeClientRoots }) {
  const directories = [
    process.env.SEMAPHOR_WORKSPACE,
    process.env.INIT_CWD,
    process.env.PWD,
    ...(includeClientRoots ? await listClientRootDirectories() : []),
    process.cwd(),
    pluginRoot,
  ];
  return readLocalEnvFromDirectories(directories);
}

async function listClientRootDirectories() {
  try {
    const response = await requestClient('roots/list', {});
    const roots = Array.isArray(response?.roots) ? response.roots : [];
    return roots
      .map((root) => fileUriToPath(root?.uri))
      .filter(Boolean);
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
  const body = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
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
