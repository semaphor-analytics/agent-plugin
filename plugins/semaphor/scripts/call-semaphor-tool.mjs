#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_TIMEOUT_MS = 30000;
const MCP_PROTOCOL_VERSION = '2024-11-05';

const options = parseArgs(process.argv);

if (options.help || (!options.toolName && !options.listTools)) {
  printHelp();
  process.exit(options.help ? 0 : 1);
}

try {
  const result = await callTool(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, options.compact ? 0 : 2)}\n`);
  } else {
    process.stdout.write(`${formatResult(result)}\n`);
  }
} catch (error) {
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: message }, null, options.compact ? 0 : 2)}\n`,
    );
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    dir: process.cwd(),
    input: {},
    json: true,
    compact: false,
    quiet: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--dir') {
      parsed.dir = requiredValue(args, index, arg);
      index += 1;
    } else if (arg === '--input') {
      parsed.input = JSON.parse(requiredValue(args, index, arg));
      index += 1;
    } else if (arg === '--input-file') {
      parsed.input = JSON.parse(fs.readFileSync(requiredValue(args, index, arg), 'utf8'));
      index += 1;
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number(requiredValue(args, index, arg));
      index += 1;
    } else if (arg === '--list-tools') {
      parsed.listTools = true;
    } else if (arg === '--text') {
      parsed.json = false;
    } else if (arg === '--pretty') {
      parsed.compact = false;
    } else if (arg === '--compact') {
      parsed.compact = true;
    } else if (arg === '--verbose') {
      parsed.quiet = false;
    } else if (!parsed.toolName) {
      parsed.toolName = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/call-semaphor-tool.mjs <tool-name> [--input '<json>'] [--dir <app>] [--json|--text]
  node scripts/call-semaphor-tool.mjs --list-tools [--dir <app>]

Examples:
  node scripts/call-semaphor-tool.mjs --list-tools --dir .
  node scripts/call-semaphor-tool.mjs semaphor_get_access_context --dir .
  node scripts/call-semaphor-tool.mjs semaphor_list_semantic_domains --input '{"response_format":"json"}'
  node scripts/call-semaphor-tool.mjs semaphor_analyze --input-file ./query.json --timeout-ms 60000

Options:
  --dir <path>          Target React app root. Defaults to cwd.
  --input <json>        Tool arguments as JSON. Defaults to {}.
  --input-file <path>   Tool arguments JSON file.
  --list-tools          List available Semaphor MCP tools instead of calling one.
  --timeout-ms <ms>     Total call timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --text                Print extracted text content instead of JSON.
  --compact             Print compact JSON.
  --verbose             Forward redacted bridge stderr.

The wrapper reads SEMAPHOR_PROJECT_TOKEN or VITE_SEMAPHOR_PROJECT_TOKEN from
shell env or the target app's local env files through semaphor-mcp-remote.mjs.
It is a fallback for debugging and evals. Normal agent hosts should expose the
Semaphor MCP server as first-class callable tools after plugin install.
`);
}

async function callTool(callOptions) {
  const child = spawn(process.execPath, [path.join(pluginRoot, 'scripts/semaphor-mcp-remote.mjs')], {
    cwd: path.resolve(callOptions.dir),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  const client = createMcpClient(child, callOptions);

  try {
    await client.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'semaphor-agent-plugin-cli',
        version: '0.1.0',
      },
    });
    client.notify('notifications/initialized', {});
    if (callOptions.listTools) {
      const response = await client.request('tools/list', {});
      return {
        ok: true,
        tools: (response?.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    }
    const response = await client.request('tools/call', {
      name: callOptions.toolName,
      arguments: callOptions.input,
    });
    return {
      ok: !response?.isError,
      tool: callOptions.toolName,
      result: normalizeToolResponse(response),
    };
  } finally {
    client.close();
  }
}

function createMcpClient(child, callOptions) {
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = '';
  const pending = new Map();
  let closed = false;

  const timeout = setTimeout(() => {
    const error = new Error(`Timed out after ${callOptions.timeoutMs}ms calling ${callOptions.toolName}`);
    rejectAll(error);
    child.kill('SIGTERM');
  }, callOptions.timeoutMs);

  child.stdout.on('data', (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    for (;;) {
      const parsed = readMcpMessage(stdoutBuffer);
      if (!parsed) {
        return;
      }
      stdoutBuffer = parsed.remaining;
      handleMessage(parsed.message);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const redacted = redactSensitiveText(chunk);
    stderrBuffer += redacted;
    if (!callOptions.quiet) {
      process.stderr.write(redacted);
    }
  });

  child.on('error', (error) => {
    rejectAll(error);
  });

  child.on('exit', (code, signal) => {
    closed = true;
    clearTimeout(timeout);
    if (pending.size > 0) {
      const suffix = stderrBuffer.trim() ? `\n${stderrBuffer.trim()}` : '';
      rejectAll(new Error(`Semaphor MCP bridge exited before completing the call (${signal || code}).${suffix}`));
    }
  });

  function request(method, params) {
    if (closed) {
      return Promise.reject(new Error('Semaphor MCP bridge is closed'));
    }
    const id = nextId;
    nextId += 1;
    writeMcpMessage(child.stdin, {
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  function notify(method, params) {
    if (closed) {
      return;
    }
    writeMcpMessage(child.stdin, {
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  function handleMessage(message) {
    if (message?.id === undefined) {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(formatJsonRpcError(message.error)));
      return;
    }
    entry.resolve(message.result);
  }

  function rejectAll(error) {
    clearTimeout(timeout);
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  function close() {
    clearTimeout(timeout);
    child.stdin.end();
    if (!closed) {
      child.kill('SIGTERM');
    }
  }

  return { request, notify, close };
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

function normalizeToolResponse(response) {
  const content = Array.isArray(response?.content) ? response.content : [];
  const text = content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
  return {
    isError: Boolean(response?.isError),
    structuredContent: response?.structuredContent,
    content,
    text,
    parsedText: parseJsonText(text),
  };
}

function parseJsonText(text) {
  const trimmed = text.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function formatResult(result) {
  return result?.result?.text || JSON.stringify(result, null, 2);
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
