#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, '..');
const localEnv = readLocalEnv(process.cwd());
const token = firstEnvValue(
  process.env.SEMAPHOR_PROJECT_TOKEN,
  process.env.VITE_SEMAPHOR_PROJECT_TOKEN,
  localEnv.SEMAPHOR_PROJECT_TOKEN,
  localEnv.VITE_SEMAPHOR_PROJECT_TOKEN,
);
const explicitMcpUrl = firstEnvValue(
  process.env.SEMAPHOR_MCP_URL,
  localEnv.SEMAPHOR_MCP_URL,
);
const explicitServerUrl = firstEnvValue(
  process.env.SEMAPHOR_SERVER_URL,
  localEnv.SEMAPHOR_SERVER_URL,
);

if (!token) {
  console.error(
    'SEMAPHOR_PROJECT_TOKEN or VITE_SEMAPHOR_PROJECT_TOKEN is required to start the Semaphor MCP server.',
  );
  process.exit(1);
}

const mcpUrl =
  explicitMcpUrl ||
  inferMcpUrlFromServerUrl(explicitServerUrl) ||
  inferMcpUrlFromProjectToken(token) ||
  'https://semaphor.cloud/api/mcp';
if (!mcpUrl) {
  console.error(
    'Unable to infer the Semaphor MCP URL. Set SEMAPHOR_SERVER_URL or SEMAPHOR_MCP_URL as an override.',
  );
  process.exit(1);
}

let stdinBuffer = Buffer.alloc(0);
let shuttingDown = false;

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
  const response = await postMcpJsonRpc(message);
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
  try {
    await postMcpJsonRpc(message);
  } catch (error) {
    const text = redactSensitiveText(error instanceof Error ? error.message : String(error));
    if (process.env.SEMAPHOR_MCP_VERBOSE === 'true') {
      process.stderr.write(`${text}\n`);
    }
  }
}

async function postMcpJsonRpc(message) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
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
  const separator = buffer.indexOf('\r\n\r\n');
  if (separator === -1) {
    return null;
  }

  const header = buffer.subarray(0, separator).toString('utf8');
  const match = header.match(/content-length:\s*(\d+)/i);
  if (!match) {
    throw new Error(`Invalid MCP message header: ${header}`);
  }

  const length = Number(match[1]);
  const bodyStart = separator + 4;
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

function readLocalEnv(startDir) {
  const env = {};
  for (const directory of candidateEnvDirectories(startDir)) {
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
    if (Object.keys(env).length > 0) {
      return env;
    }
  }
  return env;
}

function candidateEnvDirectories(startDir) {
  const directories = [];
  const seen = new Set();
  for (const value of [startDir, process.env.INIT_CWD, process.env.PWD, pluginRoot]) {
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
  process.stderr.write(`Semaphor MCP bridge connected to ${mcpUrl}\n`);
  process.stderr.write(`Semaphor MCP bridge protocol ${MCP_PROTOCOL_VERSION}\n`);
}
