#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
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
  "semaphor_materialize_data_app_contract",
  "semaphor_validate_data_app_contract",
];

const serverOwnedToolResponse = requiredServerTools.map((name) => ({
  name,
  description: `${name} from mocked live Semaphor MCP`,
  inputSchema: {
    type: "object",
    properties: name === "semaphor_generate_data_app_contract"
      ? { planArtifactId: { type: "string" } }
      : name === "semaphor_materialize_data_app_contract"
        ? {
          generatedContractArtifactId: { type: "string" },
          generatedContractMaterializationToken: { type: "string" },
        }
      : {},
    ...(name === "semaphor_generate_data_app_contract"
      ? { required: ["planArtifactId"] }
      : name === "semaphor_materialize_data_app_contract"
        ? {
          required: [
            "generatedContractArtifactId",
            "generatedContractMaterializationToken",
          ],
        }
      : {}),
    additionalProperties: false,
  },
}));

function assertMessageIncludes(message, expected) {
  assert.ok(
    String(message || "").includes(expected),
    `Expected message to include "${expected}", got "${message}"`,
  );
}

async function assertFileMissing(filePath) {
  try {
    await readFile(filePath, "utf8");
  } catch (error) {
    assert.equal(error?.code, "ENOENT");
    return;
  }
  assert.fail(`Expected file to be missing: ${filePath}`);
}

async function main() {
  await assertUnauthenticatedFallbackTools();
  await assertUnauthenticatedMaterializeFetchesArtifactAndWritesLocally();
  await assertUnauthenticatedMaterializeIgnoresWorkspaceHostOverrides();
  await assertAuthenticatedToolsListProxiesLiveSurface();
  await assertAuthenticatedToolsListPreservesLiveErrors();
  await assertMaterializeResponseFilesAreMaterializedLocally();
  await assertTextOnlyMaterializeResponseFilesAreMaterializedLocally();
  await assertGeneratorResponseWithoutWorkspaceDirIsMarkedPayloadOnly();
  await assertUpdateResponseWithoutWorkspaceDirPointsToMaterializeTool();
  await assertMaterializeWithWorkspaceDirFailsWhenPayloadCannotMaterialize();
  await assertNonContractToolPayloadDoesNotMaterializeLocally();
  await assertGeneratorPreflightsBeforeWritingFiles();
  await assertGeneratorRejectsProjectFileOverwrite();
  await assertGeneratorRejectsSymlinkedGeneratedDirectory();
  await assertValidatorWorkspaceDirReadsGeneratedFilesLocally();
  await assertValidatorStripsOutputDirWithProvidedPayload();
  await assertValidatorWorkspaceDirFindsCustomOutputDir();
  await assertValidatorRejectsAmbiguousGeneratedManifests();
  await assertValidatorOutputDirSelectsNestedManifest();
  console.log("Semaphor MCP bridge tests passed.");
}

async function assertUnauthenticatedFallbackTools() {
  const bridge = startBridge({});
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const toolNames = toolNamesFromResponse(response);
    assert.deepEqual(toolNames, [
      "semaphor_get_access_context",
      "semaphor_materialize_data_app_contract",
    ]);
  } finally {
    await bridge.stop();
  }
}

async function assertUnauthenticatedMaterializeFetchesArtifactAndWritesLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-oauth-artifact-"));
  const calls = [];
  const server = await startMockMcpServer(calls, {
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_oauth_test",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "export const generatedFromOauthArtifact = true;\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
      materialization: {
        mode: "payload_only",
        status: "not_written",
      },
    }),
  });
  const bridge = startBridge({
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_oauth_test",
          generatedContractMaterializationToken: "dap_contract_materialize_test",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.materialization.mode, "local_write");
    assert.equal(response.result.structuredContent.materialization.status, "written");
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const generatedFromOauthArtifact = true;\n",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(
      calls[0].url,
      "/api/v1/data-app/generated-contract-artifact/dap_contract_oauth_test",
    );
    assert.equal(
      calls[0].materializationToken,
      "dap_contract_materialize_test",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertUnauthenticatedMaterializeIgnoresWorkspaceHostOverrides() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-oauth-host-"));
  const trustedCalls = [];
  const attackerCalls = [];
  const trustedServer = await startMockMcpServer(trustedCalls, {
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_trusted_host",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "export const trustedHost = true;\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
      materialization: {
        mode: "payload_only",
        status: "not_written",
      },
    }),
  });
  const attackerServer = await startMockMcpServer(attackerCalls, {
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_trusted_host",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "export const attackerHost = true;\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
      materialization: {
        mode: "payload_only",
        status: "not_written",
      },
    }),
  });
  await writeFile(
    path.join(appDir, ".env.local"),
    `SEMAPHOR_SERVER_URL=${attackerServer.url.replace(/\/api\/mcp$/u, "")}\n`,
  );
  const bridge = startBridge({
    SEMAPHOR_MCP_URL: trustedServer.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_trusted_host",
          generatedContractMaterializationToken: "dap_contract_materialize_test",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(trustedCalls.length, 1);
    assert.equal(attackerCalls.length, 0);
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const trustedHost = true;\n",
    );
  } finally {
    await bridge.stop();
    await trustedServer.stop();
    await attackerServer.stop();
    await rm(appDir, { recursive: true, force: true });
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
      const shouldExposeWorkspaceDir = [
        "semaphor_get_access_context",
        "semaphor_materialize_data_app_contract",
        "semaphor_validate_data_app_contract",
      ].includes(tool.name);
      assert.equal(
        tool.inputSchema.properties.workspaceDir?.type,
        shouldExposeWorkspaceDir ? "string" : undefined,
        `${tool.name} workspaceDir exposure should match bridge-local artifact behavior`,
      );
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} should preserve server additionalProperties`,
      );
    }
    const generatorTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_generate_data_app_contract"
    );
    assert.equal(
      generatorTool.inputSchema.properties.planArtifactId.type,
      "string",
      "generator tool should expose server-owned planArtifactId",
    );
    assert.equal(
      generatorTool.inputSchema.required?.includes("planArtifactId"),
      true,
      "generator tool should require planArtifactId",
    );
    assert.equal(
      generatorTool.inputSchema.properties.codegenSummaryPath,
      undefined,
      "generator tool should not expose legacy codegenSummaryPath",
    );
    assert.equal(
      generatorTool.inputSchema.properties.workspaceDir,
      undefined,
      "generator tool should not expose bridge-local workspaceDir after materialize-tool migration",
    );
    const materializeTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_materialize_data_app_contract"
    );
    assert.equal(
      materializeTool.inputSchema.properties.generatedContractArtifactId.type,
      "string",
      "materialize tool should expose server-owned generatedContractArtifactId",
    );
    assert.equal(
      materializeTool.inputSchema.properties.workspaceDir.type,
      "string",
      "materialize tool should expose bridge-local workspaceDir hint",
    );
    assert.equal(
      materializeTool.inputSchema.properties.generatedContractMaterializationToken.type,
      "string",
      "materialize tool should accept bridge-local materialization token for OAuth artifact handoff",
    );
    const validatorTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_validate_data_app_contract"
    );
    assert.equal(
      validatorTool.inputSchema.properties.outputDir.type,
      "string",
      "validator tool should expose bridge-local outputDir hint",
    );
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

async function assertMaterializeResponseFilesAreMaterializedLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-write-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        generatedContractArtifactId: "dap_contract_test",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "export const generated = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
        materialization: {
          mode: "payload_only",
          status: "not_written",
        },
        nextAgentAction:
          "Call semaphor_materialize_data_app_contract with generatedContractArtifactId and generatedContractMaterializationToken.",
      },
      content: [{ type: "text", text: "Generated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
          generatedContractMaterializationToken: "dap_contract_materialize_test",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(
      calls[0].body.params.arguments.generatedContractArtifactId,
      "dap_contract_test",
    );
    assert.equal(
      calls[0].body.params.arguments.generatedContractMaterializationToken,
      "dap_contract_materialize_test",
    );
    assert.equal(calls[0].body.params.arguments.workspaceDir, undefined);
    assert.equal(
      response.result.structuredContent.localWrite.schemaVersion,
      "semaphor-bridge-local-write/v1",
    );
    assert.equal(response.result.structuredContent.localWrite.fileCount, 2);
    assert.equal(response.result.structuredContent.materialization.mode, "local_write");
    assert.equal(response.result.structuredContent.materialization.status, "written");
    assert.equal(response.result.structuredContent.materialization.fileCount, 2);
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const generated = true;\n",
    );
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/contract.manifest.json"), "utf8"),
      "{\n  \"ok\": true,\n  \"generatedFilePaths\": {\n    \"index.ts\": \"src/semaphor/generated/index.ts\"\n  }\n}\n",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertTextOnlyMaterializeResponseFilesAreMaterializedLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-text-write-"));
  const payload = {
    kind: "generated_data_app_contract",
    outputDir: "src/semaphor/generated",
    filePaths: {
      "index.ts": "src/semaphor/generated/index.ts",
      "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
    },
    files: {
      "index.ts": "export const generatedFromText = true;\n",
      "contract.manifest.json": "{\n  \"ok\": true\n}\n",
    },
  };

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      content: [{ type: "text", text: JSON.stringify(payload) }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
        },
      },
    });
    assert.equal(response.result.structuredContent.materialization.mode, "local_write");
    assert.equal(response.result.structuredContent.materialization.status, "written");
    assert.equal(response.result.structuredContent.localWrite.fileCount, 2);
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const generatedFromText = true;\n",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertGeneratorResponseWithoutWorkspaceDirIsMarkedPayloadOnly() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-payload-only-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        generatedContractArtifactId: "dap_contract_test",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "export const generated = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
        materialization: {
          mode: "payload_only",
          status: "not_written",
        },
        nextAgentAction:
          "Call semaphor_materialize_data_app_contract with generatedContractArtifactId and generatedContractMaterializationToken.",
      },
      content: [{ type: "text", text: "Generated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "semaphor_generate_data_app_contract",
        arguments: {
          planArtifactId: "dap_plan_test",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.localWrite, undefined);
    assert.equal(response.result.structuredContent.materialization.mode, "payload_only");
    assert.equal(response.result.structuredContent.materialization.status, "not_written");
    assertMessageIncludes(
      response.result.structuredContent.nextAgentAction,
      "semaphor_materialize_data_app_contract",
    );
    await assertFileMissing(path.join(appDir, "src/semaphor/generated/index.ts"));
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertUpdateResponseWithoutWorkspaceDirPointsToMaterializeTool() {
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        generatedContractArtifactId: "dap_contract_change_test",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "export const updated = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
        materialization: {
          mode: "payload_only",
          status: "not_written",
        },
        nextAgentAction:
          "Call semaphor_materialize_data_app_contract with generatedContractArtifactId and generatedContractMaterializationToken.",
      },
      content: [{ type: "text", text: "Updated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "semaphor_update_data_app_contract",
        arguments: {
          planArtifactId: "dap_plan_change_test",
        },
      },
    });
    assert.equal(response.result.structuredContent.materialization.status, "not_written");
    assertMessageIncludes(
      response.result.structuredContent.nextAgentAction,
      "semaphor_materialize_data_app_contract",
    );
    assert.ok(
      !response.result.structuredContent.nextAgentAction.includes(
        "semaphor_generate_data_app_contract",
      ),
      "update recovery guidance should not point at the generate tool",
    );
  } finally {
    await bridge.stop();
    await server.stop();
  }
}

async function assertMaterializeWithWorkspaceDirFailsWhenPayloadCannotMaterialize() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-no-files-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        outputDir: "src/semaphor/generated",
      },
      content: [{ type: "text", text: "Generated payload omitted files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
        },
      },
    });
    assertMessageIncludes(response.error?.message, "cannot materialize");
    assertMessageIncludes(response.error?.message, "Do not reconstruct generated files");
    await assertFileMissing(path.join(appDir, "src/semaphor/generated/index.ts"));
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertNonContractToolPayloadDoesNotMaterializeLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-non-contract-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "export const shouldNotWrite = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
      },
      content: [{ type: "text", text: "Unexpected generated payload." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "semaphor_get_data_app_sdk_guidance",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(response.result.structuredContent.localWrite, undefined);
    await assertFileMissing(path.join(appDir, "src/semaphor/generated/index.ts"));
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertGeneratorPreflightsBeforeWritingFiles() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-preflight-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
        },
        files: {
          "index.ts": "export const partial = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
      },
      content: [{ type: "text", text: "Generated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
        },
      },
    });
    assertMessageIncludes(
      response.error?.message,
      "contract.manifest.json is missing filePaths entry",
    );
    await assertFileMissing(path.join(appDir, "src/semaphor/generated/index.ts"));
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertGeneratorRejectsProjectFileOverwrite() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-overwrite-"));
  const packageJsonPath = path.join(appDir, "package.json");
  await writeFile(packageJsonPath, "{\"name\":\"safe-app\"}\n", "utf8");

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "package.json",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "{\"name\":\"overwritten\"}\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
      },
      content: [{ type: "text", text: "Generated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
        },
      },
    });
    assertMessageIncludes(response.error?.message, "must stay under src/semaphor/generated");
    assert.equal(await readFile(packageJsonPath, "utf8"), "{\"name\":\"safe-app\"}\n");
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertGeneratorRejectsSymlinkedGeneratedDirectory() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-symlink-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-outside-"));
  await mkdir(path.join(appDir, "src/semaphor"), { recursive: true });
  try {
    await symlink(outsideDir, path.join(appDir, "src/semaphor/generated"), "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      await rm(appDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
      return;
    }
    throw error;
  }

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        kind: "generated_data_app_contract",
        outputDir: "src/semaphor/generated",
        filePaths: {
          "index.ts": "src/semaphor/generated/index.ts",
          "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
        },
        files: {
          "index.ts": "export const generated = true;\n",
          "contract.manifest.json": "{\n  \"ok\": true\n}\n",
        },
      },
      content: [{ type: "text", text: "Generated 2 files." }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_test",
        },
      },
    });
    assertMessageIncludes(response.error?.message, "must not contain symlinks");
    await assertFileMissing(path.join(outsideDir, "index.ts"));
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
}

async function assertValidatorWorkspaceDirReadsGeneratedFilesLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-validate-"));
  const generatedDir = path.join(appDir, "src/semaphor/generated");
  await mkdir(generatedDir, { recursive: true });
  const manifest = {
    schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
    generatedContentHash: "test-hash",
    generatedFilePaths: {
      "index.ts": "src/semaphor/generated/index.ts",
      "metadata.ts": "src/semaphor/generated/metadata.ts",
      "future-contract.ts": "src/semaphor/generated/future-contract.ts",
    },
  };
  await writeFile(
    path.join(generatedDir, "contract.manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "index.ts"),
    "export const generated = true;\n",
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "metadata.ts"),
    "export const metadata = {} as const;\n",
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "future-contract.ts"),
    "export const future = true;\n",
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "stale-helper.ts"),
    "export const stale = true;\n",
    "utf8",
  );

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        kind: "data_app_contract_validation",
        issues: [],
      },
      content: [{ type: "text", text: "valid" }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "semaphor_validate_data_app_contract",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.method, "tools/call");
    assert.deepEqual(calls[0].body.params.arguments.manifest, manifest);
    assert.deepEqual(calls[0].body.params.arguments.generatedFiles, {
      "future-contract.ts": "export const future = true;\n",
      "index.ts": "export const generated = true;\n",
      "metadata.ts": "export const metadata = {} as const;\n",
    });
    assert.equal(
      calls[0].body.params.arguments.generatedFiles["stale-helper.ts"],
      undefined,
      "validation should not forward unrelated TypeScript files from src/semaphor/generated",
    );
    assert.equal(calls[0].body.params.arguments.workspaceDir, undefined);
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertValidatorStripsOutputDirWithProvidedPayload() {
  const manifest = {
    schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
    generatedContentHash: "test-hash",
    generatedFilePaths: {
      "index.ts": "src/semaphor/generated/foo/index.ts",
    },
  };
  const generatedFiles = {
    "index.ts": "export const generated = true;\n",
  };

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        kind: "data_app_contract_validation",
        issues: [],
      },
      content: [{ type: "text", text: "valid" }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 14,
      method: "tools/call",
      params: {
        name: "semaphor_validate_data_app_contract",
        arguments: {
          outputDir: "src/semaphor/generated/foo",
          manifest,
          generatedFiles,
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.deepEqual(calls[0].body.params.arguments.manifest, manifest);
    assert.deepEqual(calls[0].body.params.arguments.generatedFiles, generatedFiles);
    assert.equal(calls[0].body.params.arguments.outputDir, undefined);
  } finally {
    await bridge.stop();
    await server.stop();
  }
}

async function assertValidatorWorkspaceDirFindsCustomOutputDir() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-validate-custom-"));
  const generatedDir = path.join(appDir, "src/semaphor/generated/foo");
  await mkdir(generatedDir, { recursive: true });
  const manifest = {
    schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
    generatedContentHash: "test-hash",
    generatedFilePaths: {
      "index.ts": "src/semaphor/generated/foo/index.ts",
    },
  };
  await writeFile(
    path.join(generatedDir, "contract.manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "index.ts"),
    "export const generated = true;\n",
    "utf8",
  );

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        kind: "data_app_contract_validation",
        issues: [],
      },
      content: [{ type: "text", text: "valid" }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "semaphor_validate_data_app_contract",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.deepEqual(calls[0].body.params.arguments.manifest, manifest);
    assert.deepEqual(calls[0].body.params.arguments.generatedFiles, {
      "index.ts": "export const generated = true;\n",
    });
    assert.equal(calls[0].body.params.arguments.workspaceDir, undefined);
    assert.equal(calls[0].body.params.arguments.outputDir, undefined);
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertValidatorRejectsAmbiguousGeneratedManifests() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-ambiguous-"));
  await writeGeneratedContractFixture({
    appDir,
    outputDir: "src/semaphor/generated",
    exportName: "defaultGenerated",
  });
  await writeGeneratedContractFixture({
    appDir,
    outputDir: "src/semaphor/generated/foo",
    exportName: "nestedGenerated",
  });

  const calls = [];
  const server = await startMockMcpServer(calls);
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 15,
      method: "tools/call",
      params: {
        name: "semaphor_validate_data_app_contract",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assertMessageIncludes(response.error?.message, "Multiple generated contract manifests");
    assert.equal(calls.length, 0);
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertValidatorOutputDirSelectsNestedManifest() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-select-nested-"));
  await writeGeneratedContractFixture({
    appDir,
    outputDir: "src/semaphor/generated",
    exportName: "defaultGenerated",
  });
  const nestedManifest = await writeGeneratedContractFixture({
    appDir,
    outputDir: "src/semaphor/generated/foo",
    exportName: "nestedGenerated",
  });

  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        kind: "data_app_contract_validation",
        issues: [],
      },
      content: [{ type: "text", text: "valid" }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: "test-project-token",
    SEMAPHOR_MCP_URL: server.url,
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: {
        name: "semaphor_validate_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          outputDir: "src/semaphor/generated/foo",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.deepEqual(calls[0].body.params.arguments.manifest, nestedManifest);
    assert.deepEqual(calls[0].body.params.arguments.generatedFiles, {
      "index.ts": "export const nestedGenerated = true;\n",
    });
    assert.equal(calls[0].body.params.arguments.workspaceDir, undefined);
    assert.equal(calls[0].body.params.arguments.outputDir, undefined);
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function writeGeneratedContractFixture({ appDir, outputDir, exportName }) {
  const generatedDir = path.join(appDir, outputDir);
  await mkdir(generatedDir, { recursive: true });
  const manifest = {
    schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
    generatedContentHash: "test-hash",
    generatedFilePaths: {
      "index.ts": `${outputDir}/index.ts`,
    },
  };
  await writeFile(
    path.join(generatedDir, "contract.manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(generatedDir, "index.ts"),
    `export const ${exportName} = true;\n`,
    "utf8",
  );
  return manifest;
}

function generatedContractArtifactPayload(input) {
  const payload = {
    ok: true,
    kind: "generated_data_app_contract",
    schemaVersion: "semaphor-generated-data-app-contract/v1",
    manifestPath: `${input.outputDir}/contract.manifest.json`,
    manifest: { schemaVersion: "semaphor-data-app-generated-contract-manifest/v1" },
    contentHash: "test-content-hash",
    ...input,
  };
  return {
    ...payload,
    generatedContractArtifactDigest: digestGeneratedContractArtifactPayload(payload),
  };
}

function digestGeneratedContractArtifactPayload(payload) {
  return hashStableJson({
    outputDir: payload.outputDir,
    manifestPath: payload.manifestPath,
    filePaths: payload.filePaths,
    files: payload.files,
    manifest: payload.manifest,
    contentHash: payload.contentHash,
    generatedSchemaVersion: payload.schemaVersion,
  });
}

function hashStableJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortKeysDeep(entry)]),
    );
  }
  return value;
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
    if (request.method === "GET") {
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        materializationToken:
          request.headers["x-semaphor-generated-contract-materialization-token"],
      });
      if (options.artifactPayload) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(options.artifactPayload));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Artifact not found." }));
      return;
    }

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
          : parsed.method === "tools/call"
            ? { result: options.callResult || { isError: false, content: [] } }
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
