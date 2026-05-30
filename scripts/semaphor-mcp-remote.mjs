#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const localEnv = readLocalEnv(process.cwd());
const token = firstEnvValue(
  process.env.SEMAPHOR_PROJECT_TOKEN,
  localEnv.SEMAPHOR_PROJECT_TOKEN,
  localEnv.VITE_SEMAPHOR_PROJECT_TOKEN,
);
const explicitMcpUrl = firstEnvValue(
  process.env.SEMAPHOR_MCP_URL,
  localEnv.SEMAPHOR_MCP_URL,
);

if (!token) {
  console.error(
    'SEMAPHOR_PROJECT_TOKEN or VITE_SEMAPHOR_PROJECT_TOKEN is required to start the Semaphor MCP server.',
  );
  process.exit(1);
}

const mcpUrl = explicitMcpUrl || inferMcpUrlFromProjectToken(token);
if (!mcpUrl) {
  console.error(
    'Unable to infer the Semaphor MCP URL from the project token. Set SEMAPHOR_MCP_URL as an override.',
  );
  process.exit(1);
}

const child = spawn(
  'npx',
  [
    '-y',
    'mcp-remote',
    mcpUrl,
    '--transport',
    'http-only',
    '--header',
    `Authorization:Bearer ${token}`,
  ],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(`Failed to start Semaphor MCP server: ${error.message}`);
  process.exit(1);
});

function inferMcpUrlFromProjectToken(projectToken) {
  const apiServiceUrl = readProjectTokenApiServiceUrl(projectToken);
  if (!apiServiceUrl) {
    return '';
  }
  return `${normalizeAppBaseUrl(apiServiceUrl)}/api/mcp`;
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
  for (const value of [startDir, process.env.INIT_CWD, process.env.PWD]) {
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
