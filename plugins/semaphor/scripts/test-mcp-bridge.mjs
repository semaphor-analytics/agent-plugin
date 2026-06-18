#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(scriptDir, "semaphor-mcp-remote.mjs");
const requiredServerTools = [
  "semaphor_get_access_context",
  "semaphor_get_data_app_sdk_guidance",
  "semaphor_plan_data_app",
  "semaphor_plan_data_app_change",
  "semaphor_create_data_app_contract",
  "semaphor_generate_data_app_contract",
  "semaphor_update_data_app_contract",
  "semaphor_validate_data_app_contract",
];

const serverOwnedToolResponse = requiredServerTools.map((name) => ({
  name,
  description: `${name} from mocked live Semaphor MCP`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
}));

async function main() {
  await assertUnauthenticatedFallbackOnly();
  await assertAuthenticatedToolsListProxiesLiveSurface();
  await assertAuthenticatedToolsListPreservesLiveErrors();
  console.log("Semaphor MCP bridge tests passed.");
}

async function assertUnauthenticatedFallbackOnly() {
  const bridge = startBridge({});
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const toolNames = toolNamesFromResponse(response);
    assert.deepEqual(toolNames, ["semaphor_get_access_context"]);
  } finally {
    await bridge.stop();
  }
}

async function assertAuthenticatedToolsListProxiesLiveSurface() {
  const calls = [];
  const server = await startMockMcpServer(calls);
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const toolNames = toolNamesFromResponse(response);
    assert.deepEqual(toolNames, requiredServerTools);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, "Bearer test-project-token");
    assert.equal(calls[0].body.method, "tools/list");
    for (const tool of response.result.tools) {
      assert.equal(
        tool.inputSchema.properties.workspaceDir.type,
        "string",
        `${tool.name} should include bridge workspaceDir hint`,
      );
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} should preserve server additionalProperties`,
      );
    }
  } finally {
    await bridge.stop();
    await server.stop();
  }
}

async function assertAuthenticatedToolsListPreservesLiveErrors() {
  const calls = [];
  const server = await startMockMcpServer(calls, {
    error: {
      code: -32001,
      message: "Project token expired.",
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "expired-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    });
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, 3);
    assert.deepEqual(response.error, {
      code: -32001,
      message: "Project token expired.",
    });
    assert.equal(response.result, undefined);
    assert.equal(calls.length, 1);
  } finally {
    await bridge.stop();
    await server.stop();
  }
}

function startBridge(extraEnv) {
  const child = spawn(process.execPath, [bridgePath], {
    cwd: scriptDir,
    env: {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      TMPDIR: process.env.TMPDIR || "",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderr = "";
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newlineIndex = stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      const message = JSON.parse(line);
      if (message.method === "roots/list") {
        writeJsonLine(child.stdin, {
          jsonrpc: "2.0",
          id: message.id,
          result: { roots: [] },
        });
        continue;
      }
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timeout);
        entry.resolve(message);
      }
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  child.on("exit", (code, signal) => {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timeout);
      entry.reject(
        new Error(
          `Bridge exited before response ${id}; code=${code} signal=${signal} stderr=${stderr}`,
        ),
      );
    }
  });

  return {
    request(message) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(message.id);
          reject(
            new Error(
              `Timed out waiting for bridge response ${message.id}; stderr=${stderr}`,
            ),
          );
        }, 5000);
        pending.set(message.id, { resolve, reject, timeout });
        writeJsonLine(child.stdin, message);
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, 500).unref();
      });
    },
  };
}

function writeJsonLine(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`);
}

async function startMockMcpServer(calls, options = {}) {
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      calls.push({
        authorization: request.headers.authorization,
        body: parsed,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        ...(options.error
          ? { error: options.error }
          : { result: { tools: serverOwnedToolResponse } }),
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/api/mcp`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

function toolNamesFromResponse(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(Array.isArray(response.result?.tools));
  return response.result.tools.map((tool) => tool.name);
}

await main();
