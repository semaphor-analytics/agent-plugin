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
import {
  CANONICAL_DATA_APP_AUTHORING_TOOLS,
} from "./data-app-authoring-surface.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(scriptDir, "semaphor-mcp-remote.mjs");
const dataAppCliPath = path.join(scriptDir, "semaphor-data-app.mjs");
const requiredServerTools = [...CANONICAL_DATA_APP_AUTHORING_TOOLS];

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

function projectTokenForMcpUrl(mcpUrl) {
  return projectTokenForApiServiceUrl(mcpUrl.replace(/\/api\/mcp\/?$/u, ""));
}

function projectTokenForApiServiceUrl(apiServiceUrl) {
  const payload = Buffer.from(JSON.stringify({ apiServiceUrl }), "utf8")
    .toString("base64url");
  return `test.${payload}.signature`;
}

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
  await assertDataAppCliMaterializeContractWritesCompactOutput();
  await assertDataAppCliForwardsAuthOptionsToBridge();
  await assertDataAppCliFailsOnMcpToolErrors();
  await assertDataAppCliInspectStatePreservesValidationToolErrors();
  await assertDataAppCliInspectStateReadsCustomOutputDir();
  await assertDataAppCliRejectsApiBaseUrlOverride();
  await assertDataAppCliRejectsMaterializeOutputDirOverride();
  await assertAuthenticatedMaterializeUsesTokenApiServiceUrl();
  await assertAuthenticatedToolsListProxiesLiveSurface();
  await assertAuthenticatedToolsListPreservesLiveErrors();
  await assertWorkspaceDirAuthWorksForBootstrapDataAppTools();
  await assertMaterializeResponseFilesAreMaterializedLocally();
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
  await assertInspectStateValidatesAndReturnsCurrentAuthoringState();
  await assertInspectStateBlocksOnValidationToolErrors();
  await assertInspectStateReadsCustomOutputDir();
  await assertInspectStateRejectsSymlinkedUiSource();
  await assertPlanChangeWorkspaceDirInjectsCurrentManifest();
  await assertPlanChangeWithoutWorkspaceDirDoesNotInferPwdManifest();
  await assertPlanChangeStripsOutputDirWithProvidedCurrentState();
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
    assert.deepEqual(toolNames, CANONICAL_DATA_APP_AUTHORING_TOOLS);
    const createTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_create_data_app_contract"
    );
    assert.equal(createTool.inputSchema.properties.workspaceDir.type, "string");
    const planChangeTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_plan_data_app_change"
    );
    assert.equal(planChangeTool.inputSchema.properties.workspaceDir.type, "string");
    assert.equal(planChangeTool.inputSchema.properties.outputDir.type, "string");
    const materializeTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_materialize_data_app_contract"
    );
    assert.equal(
      materializeTool.inputSchema.properties
        .generatedContractMaterializationToken.type,
      "string",
    );
    const proposeRepairTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_propose_semantic_model_change"
    );
    assert.equal(
      proposeRepairTool.inputSchema.properties.workspaceDir.type,
      "string",
    );
    const applyRepairTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_apply_semantic_model_patch"
    );
    assert.equal(applyRepairTool.inputSchema.properties.workspaceDir.type, "string");
  } finally {
    await bridge.stop();
  }
}

async function assertDataAppCliMaterializeContractWritesCompactOutput() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-materialize-"));
  const calls = [];
  const server = await startMockMcpServer(calls, {
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_cli_test",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "export const generatedFromCliArtifact = true;\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
      materialization: {
        mode: "payload_only",
        status: "not_written",
      },
    }),
  });
  try {
    const artifactBaseUrl = server.url.replace(/\/api\/mcp$/u, "");
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "materialize-contract",
        "--dir",
        appDir,
        "--artifact-id",
        "dap_contract_cli_test",
        "--materialization-token",
        "dap_contract_materialize_cli_test",
        "--artifact-base-url",
        artifactBaseUrl,
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const output = JSON.parse(child.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.generatedContractArtifactBaseUrl, undefined);
    assert.equal(output.materialization.mode, "local_write");
    assert.equal(output.materialization.status, "written");
    assert.equal(output.localMaterialization.status, "written");
    assert.equal(output.files, undefined);
    assert.equal(output.result, undefined);
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const generatedFromCliArtifact = true;\n",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].authorization, undefined);
    assert.equal(calls[0].materializationToken, "dap_contract_materialize_cli_test");
    assert.equal(calls[0].url, "/api/v1/data-app/generated-contract-artifact/dap_contract_cli_test");
  } finally {
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliForwardsAuthOptionsToBridge() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-auth-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const inputPath = path.join(appDir, "update-input.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      goal: "Remove one view",
      operationIntent: {
        kind: "analytics_remove",
        targetViewIds: ["revenue_trend"],
      },
      currentManifest: {
        generatedContentHash: "stale-input-file-hash",
      },
    }),
    "utf8",
  );
  const calls = [];
  const server = await startMockMcpServer(calls);
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "update-contract",
        "--dir",
        appDir,
        "--input-file",
        "update-input.json",
        "--token",
        projectTokenForMcpUrl(server.url),
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
        SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const toolCall = calls.find((call) =>
      call.body?.method === "tools/call" &&
      call.body?.params?.name === "semaphor_update_data_app_contract"
    );
    assert.ok(toolCall, "expected update-contract to call the bridge MCP tool");
    assert.equal(toolCall.authorization, `Bearer ${projectTokenForMcpUrl(server.url)}`);
    assert.equal(toolCall.body.params.arguments.goal, "Remove one view");
    assert.equal(
      toolCall.body.params.arguments.currentManifest.generatedContentHash,
      "inspectable-test-hash",
    );
    assert.equal(
      toolCall.body.params.arguments.target.beforeCurrentAuthoringState.inspection.status,
      "inspected",
    );
  } finally {
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliFailsOnMcpToolErrors() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-tool-error-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const inputPath = path.join(appDir, "update-input.json");
  await writeFile(
    inputPath,
    JSON.stringify({ planArtifactId: "dap_plan_invalid" }),
    "utf8",
  );
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: (parsed) =>
      parsed.params?.name === "semaphor_validate_data_app_contract"
        ? {
            isError: false,
            structuredContent: { ok: true, validation: { status: "ready" } },
            content: [],
          }
        : {
            isError: true,
            content: [
              {
                type: "text",
                text: "Invalid plan artifact.",
              },
            ],
          },
  });
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "update-contract",
        "--dir",
        appDir,
        "--input-file",
        "update-input.json",
        "--token",
        projectTokenForMcpUrl(server.url),
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /semaphor_update_data_app_contract failed: Invalid plan artifact\./);
    assert.equal(calls.length, 2);
  } finally {
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliInspectStatePreservesValidationToolErrors() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-inspect-validation-error-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: true,
      content: [{
        type: "text",
        text: "Generated contract drift detected.",
      }],
    },
  });
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "inspect-state",
        "--dir",
        appDir,
        "--token",
        projectTokenForMcpUrl(server.url),
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const output = JSON.parse(child.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.currentAuthoringState.inspection.status, "blocked");
    assert.equal(
      output.currentAuthoringState.inspection.issues[0].code,
      "validation_tool_error",
    );
    assertMessageIncludes(
      output.currentAuthoringState.inspection.issues[0].message,
      "Generated contract drift detected.",
    );
  } finally {
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliInspectStateReadsCustomOutputDir() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-inspect-output-dir-"));
  await writeInspectableGeneratedContractFixture(appDir, "src/semaphor/generated/custom");
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        validation: { status: "ready" },
      },
      content: [],
    },
  });
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "inspect-state",
        "--dir",
        appDir,
        "--output-dir",
        "src/semaphor/generated/custom",
        "--token",
        projectTokenForMcpUrl(server.url),
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const output = JSON.parse(child.stdout);
    assert.equal(output.ok, true);
    assert.equal(
      output.currentAuthoringState.inspection.generatedContract.outputDir,
      "src/semaphor/generated/custom",
    );
    assert.equal(
      output.currentAuthoringState.inspection.generatedContract.manifestPath,
      "src/semaphor/generated/custom/contract.manifest.json",
    );
    assert.equal(
      calls[0].body.params.arguments.manifest.generatedFilePaths["index.ts"],
      "src/semaphor/generated/custom/index.ts",
    );
  } finally {
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliRejectsApiBaseUrlOverride() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-api-base-"));
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "materialize-contract",
        "--dir",
        appDir,
        "--artifact-id",
        "dap_contract_cli_api_base_test",
        "--materialization-token",
        "dap_contract_materialize_cli_api_base_test",
        "--api-base-url",
        "http://127.0.0.1:3000",
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /--api-base-url is not supported/);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertDataAppCliRejectsMaterializeOutputDirOverride() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-cli-output-dir-"));
  try {
    const child = await runDataAppCli(
      process.execPath,
      [
        dataAppCliPath,
        "materialize-contract",
        "--dir",
        appDir,
        "--artifact-id",
        "dap_contract_cli_output_dir_test",
        "--materialization-token",
        "dap_contract_materialize_cli_output_dir_test",
        "--output-dir",
        "src/semaphor/generated/custom",
        "--json",
      ],
      appDir,
      {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        TMPDIR: process.env.TMPDIR || "",
      },
    );
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /--output-dir is not supported by materialize-contract/);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertAuthenticatedMaterializeUsesTokenApiServiceUrl() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-project-token-api-url-"));
  const calls = [];
  const server = await startMockMcpServer(calls, {
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_self_hosted",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "export const selfHosted = true;\n",
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
    [
      `VITE_SEMAPHOR_PROJECT_TOKEN=${projectTokenForMcpUrl(server.url)}`,
      "",
    ].join("\n"),
  );
  const bridge = startBridge({});
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "semaphor_materialize_data_app_contract",
        arguments: {
          workspaceDir: appDir,
          generatedContractArtifactId: "dap_contract_self_hosted",
          generatedContractMaterializationToken: "dap_contract_materialize_test",
        },
      },
    });
    assert.equal(response.result.isError, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.method, "tools/call");
    assert.equal(calls[0].authorization, `Bearer ${projectTokenForMcpUrl(server.url)}`);
    assert.equal(
      calls[0].body.params.arguments.generatedContractArtifactId,
      "dap_contract_self_hosted",
    );
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const selfHosted = true;\n",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertAuthenticatedToolsListProxiesLiveSurface() {
  const calls = [];
  const server = await startMockMcpServer(calls);
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    assert.equal(calls[0].authorization, `Bearer ${projectTokenForMcpUrl(server.url)}`);
    assert.equal(calls[0].body.method, "tools/list");
    for (const tool of response.result.tools) {
      const shouldExposeWorkspaceDir = [
        "semaphor_get_access_context",
        "semaphor_materialize_data_app_contract",
        "semaphor_validate_data_app_contract",
        "semaphor_inspect_data_app_state",
        "semaphor_plan_data_app_change",
        "semaphor_propose_semantic_model_change",
        "semaphor_apply_semantic_model_patch",
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
    const inspectTool = response.result.tools.find((tool) =>
      tool.name === "semaphor_inspect_data_app_state"
    );
    assert.equal(
      inspectTool.inputSchema.properties.outputDir.type,
      "string",
      "inspect-state tool should expose bridge-local outputDir hint",
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
  const projectToken = projectTokenForMcpUrl(server.url);
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectToken,
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
    assert.equal(calls[0].authorization, `Bearer ${projectToken}`);
  } finally {
    await bridge.stop();
    await server.stop();
  }
}

async function assertWorkspaceDirAuthWorksForBootstrapDataAppTools() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-workspace-auth-"));
  const calls = [];
  const server = await startMockMcpServer(calls);
  const projectToken = projectTokenForMcpUrl(server.url);
  await writeFile(
    path.join(appDir, ".env.local"),
    `VITE_SEMAPHOR_PROJECT_TOKEN=${projectToken}\n`,
    "utf8",
  );
  const bridge = startBridge({});
  try {
    const accessResponse = await bridge.request({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "semaphor_get_access_context",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assert.equal(accessResponse.result.isError, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, `Bearer ${projectToken}`);

    const generateResponse = await bridge.request({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "semaphor_generate_data_app_contract",
        arguments: {
          planArtifactId: "dap_plan_workspace_auth_test",
          workspaceDir: appDir,
        },
      },
    });
    assert.equal(generateResponse.result.isError, false);
    assert.equal(
      calls.length,
      2,
      "generator should use workspaceDir for auth discovery and then forward to Semaphor",
    );
    assert.equal(calls[1].authorization, `Bearer ${projectToken}`);
    assert.equal(
      calls[1].body.params.arguments.workspaceDir,
      undefined,
      "workspaceDir is a bridge auth hint and must not be forwarded",
    );

    const repairResponse = await bridge.request({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "semaphor_propose_semantic_model_change",
        arguments: {
          workspaceDir: appDir,
          domainId: "retail_ops",
          reason: "missing_relationship",
          candidate: {
            source: {
              kind: "semantic",
              domainId: "retail_ops",
              datasetName: "fact_order",
            },
            sourceFields: [{ name: "warehouse_id" }],
            target: {
              kind: "semantic",
              domainId: "retail_ops",
              datasetName: "dim_warehouse",
            },
            targetFields: [{ name: "warehouse_id" }],
          },
        },
      },
    });
    assert.equal(repairResponse.result.isError, false);
    assert.equal(
      calls.length,
      3,
      "semantic repair should use workspaceDir for auth discovery and then forward to Semaphor",
    );
    assert.equal(calls[2].authorization, `Bearer ${projectToken}`);
    assert.equal(
      calls[2].body.params.arguments.workspaceDir,
      undefined,
      "workspaceDir is a bridge auth hint and must not be forwarded for semantic repair",
    );
    assert.equal(
      calls[2].body.params.name,
      "semaphor_propose_semantic_model_change",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertMaterializeResponseFilesAreMaterializedLocally() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-bridge-write-"));

  const calls = [];
  const server = await startMockMcpServer(calls, {
    artifactPayload: generatedContractArtifactPayload({
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
    }),
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    assert.equal(
      response.result.structuredContent.generatedContractArtifactId,
      "dap_contract_test",
    );
    assert.equal(
      response.result.structuredContent.localWrite.schemaVersion,
      "semaphor-bridge-local-write/v1",
    );
    assert.equal(response.result.structuredContent.localWrite.fileCount, 2);
    assert.equal(response.result.structuredContent.materialization.mode, "local_write");
    assert.equal(response.result.structuredContent.materialization.status, "written");
    assert.equal(response.result.structuredContent.materialization.fileCount, 2);
    assert.equal(response.result.structuredContent.localMaterialization.required, false);
    assert.equal(response.result.structuredContent.localMaterialization.status, "written");
    assert.equal(
      response.result.structuredContent.localMaterialization.officialCommand.argsByName.artifactId,
      "dap_contract_test",
    );
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/index.ts"), "utf8"),
      "export const generated = true;\n",
    );
    assert.equal(
      await readFile(path.join(appDir, "src/semaphor/generated/contract.manifest.json"), "utf8"),
      "{\n  \"schemaVersion\": \"semaphor-data-app-generated-contract-manifest/v1\",\n  \"generatedFilePaths\": {\n    \"index.ts\": \"src/semaphor/generated/index.ts\"\n  }\n}\n",
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
        generatedContractMaterializationToken: "dap_contract_materialize_test",
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    assert.equal(response.result.structuredContent.files, undefined);
    assert.equal(response.result.structuredContent.filePaths, undefined);
    assert.equal(response.result.structuredContent.manifest, undefined);
    assert.equal(response.result.structuredContent.materialization.filePaths, undefined);
    assert.equal(response.result.structuredContent.localMaterialization.required, true);
    assert.equal(response.result.structuredContent.localMaterialization.status, "not_written");
    assert.deepEqual(
      response.result.structuredContent.localMaterialization.officialCommand.args,
      [
        "run",
        "data-app",
        "--",
        "materialize-contract",
        "--dir",
        "${workspaceDir}",
        "--artifact-id",
        "dap_contract_test",
        "--materialization-token",
        "dap_contract_materialize_test",
        "--artifact-base-url",
        "https://semaphor.cloud",
      ],
    );
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
  const server = await startMockMcpServer(calls);
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    assertMessageIncludes(
      response.error?.message,
      "did not return a generated contract payload",
    );
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_test",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
      },
      files: {
        "index.ts": "export const partial = true;\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
    }),
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
          generatedContractMaterializationToken: "dap_contract_materialize_test",
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
    artifactPayload: generatedContractArtifactPayload({
      generatedContractArtifactId: "dap_contract_test",
      outputDir: "src/semaphor/generated",
      filePaths: {
        "index.ts": "package.json",
        "contract.manifest.json": "src/semaphor/generated/contract.manifest.json",
      },
      files: {
        "index.ts": "{\"name\":\"overwritten\"}\n",
        "contract.manifest.json": "{\n  \"ok\": true\n}\n",
      },
    }),
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
          generatedContractMaterializationToken: "dap_contract_materialize_test",
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
    artifactPayload: generatedContractArtifactPayload({
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
    }),
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
          generatedContractMaterializationToken: "dap_contract_materialize_test",
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
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

async function writeInspectableGeneratedContractFixture(
  appDir,
  outputDir = "src/semaphor/generated",
) {
  await mkdir(path.join(appDir, outputDir), { recursive: true });
  await writeFile(
    path.join(appDir, outputDir, "contract.manifest.json"),
    JSON.stringify({
      schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
      generatedFilePaths: {
        "index.ts": `${outputDir}/index.ts`,
      },
      codegenSummary: minimalCodegenSummary(),
      generatedContentHash: "inspectable-test-hash",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(appDir, outputDir, "index.ts"),
    "export const queries = {};\n",
    "utf8",
  );
}

async function assertInspectStateValidatesAndReturnsCurrentAuthoringState() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-inspect-state-"));
  await mkdir(path.join(appDir, "src/semaphor/generated"), { recursive: true });
  await mkdir(path.join(appDir, "src/components"), { recursive: true });
  const summary = minimalCodegenSummary();
  summary.views.push({
    ...summary.views[0],
    id: "unrelated_view",
    title: "Unrelated View",
    visualSpec: { visualType: "line_chart", title: "Unrelated View" },
  });
  await writeFile(
    path.join(appDir, "src/semaphor/generated/contract.manifest.json"),
    JSON.stringify({
      schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
      generatedFilePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
      },
      codegenSummary: summary,
      generatedContentHash: "inspect-state-test-hash",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(appDir, "src/semaphor/generated/index.ts"),
    "export const queries = {};\n",
    "utf8",
  );
  await writeFile(
    path.join(appDir, "src/components/Dashboard.tsx"),
    [
      'import { semaphorInputMarkerProps, semaphorViewMarkerProps } from "../semaphor/generated";',
      '<section {...semaphorViewMarkerProps("revenue_trend")} {...semaphorInputMarkerProps("region_filter")} />',
      '<SemaphorViewCard viewId="revenue_trend" title="Revenue Trend" />',
      '<HostWidget viewId="unrelated_view" />',
      '',
    ].join("\n"),
    "utf8",
  );
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        validation: { status: "ready" },
      },
      content: [],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "semaphor_inspect_data_app_state",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    const state = response.result.structuredContent.currentAuthoringState;
    assert.equal(state.inspection.status, "inspected");
    assert.equal(state.views[0].viewId, "revenue_trend");
    assert.deepEqual(state.views[0].metricBindingKeys, [
      "semantic:retail_ops:datasetId:orders:SUM:net_revenue",
    ]);
    assert.deepEqual(state.views[0].uiMapping.componentPaths, [
      "src/components/Dashboard.tsx",
    ]);
    assert.deepEqual(state.views[1].uiMapping.componentPaths, []);
    assert.equal(
      state.inspection.warnings.some((warning) =>
        warning.code === "unmapped_view_component" &&
        warning.path === "views.unrelated_view"
      ),
      true,
      "generic host component viewId props must not satisfy Semaphor view mapping",
    );
    assert.equal(state.inputs[0].inputId, "region_filter");
    assert.equal(
      calls.some((call) =>
        call.body?.params?.name === "semaphor_validate_data_app_contract" &&
        call.body.params.arguments.manifest?.codegenSummary?.title === "Retail Dashboard"
      ),
      true,
      "inspect-state should validate local generated contract payload through Semaphor",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertInspectStateBlocksOnValidationToolErrors() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-inspect-validation-error-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: true,
      content: [{
        type: "text",
        text: "Generated contract drift detected.",
      }],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "semaphor_inspect_data_app_state",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    const state = response.result.structuredContent.currentAuthoringState;
    assert.equal(state.inspection.status, "blocked");
    assert.equal(
      state.inspection.issues[0].code,
      "validation_tool_error",
    );
    assertMessageIncludes(
      state.inspection.issues[0].message,
      "Generated contract drift detected.",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertInspectStateReadsCustomOutputDir() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-inspect-output-dir-"));
  await writeInspectableGeneratedContractFixture(appDir, "src/semaphor/generated/custom");
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        ok: true,
        validation: { status: "ready" },
      },
      content: [],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "semaphor_inspect_data_app_state",
        arguments: {
          workspaceDir: appDir,
          outputDir: "src/semaphor/generated/custom",
        },
      },
    });
    const state = response.result.structuredContent.currentAuthoringState;
    assert.equal(state.inspection.status, "inspected");
    assert.equal(
      state.inspection.generatedContract.outputDir,
      "src/semaphor/generated/custom",
    );
    assert.equal(
      state.inspection.generatedContract.manifestPath,
      "src/semaphor/generated/custom/contract.manifest.json",
    );
    assert.equal(
      calls[0].body.params.arguments.manifest.generatedFilePaths["index.ts"],
      "src/semaphor/generated/custom/index.ts",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertInspectStateRejectsSymlinkedUiSource() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-inspect-symlink-"));
  const outsideDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-data-app-inspect-outside-"));
  await mkdir(path.join(appDir, "src/semaphor/generated"), { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  const summary = minimalCodegenSummary();
  await writeFile(
    path.join(appDir, "src/semaphor/generated/contract.manifest.json"),
    JSON.stringify({
      schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
      generatedFilePaths: {
        "index.ts": "src/semaphor/generated/index.ts",
      },
      codegenSummary: summary,
      generatedContentHash: "inspect-state-test-hash",
    }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(appDir, "src/semaphor/generated/index.ts"),
    "export const queries = {};\n",
    "utf8",
  );
  try {
    await symlink(outsideDir, path.join(appDir, "src/components"), "dir");
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
        ok: true,
        validation: { status: "ready" },
      },
      content: [],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "semaphor_inspect_data_app_state",
        arguments: {
          workspaceDir: appDir,
        },
      },
    });
    assertMessageIncludes(response.error?.message, "must not contain symlinks");
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
}

async function assertPlanChangeWorkspaceDirInjectsCurrentManifest() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-plan-change-manifest-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: (parsed) => {
      if (parsed.params?.name === "semaphor_validate_data_app_contract") {
        return {
          isError: false,
          structuredContent: {
            ok: true,
            kind: "data_app_contract_validation",
            issues: [],
          },
          content: [],
        };
      }
      return {
        isError: false,
        structuredContent: {
          validation: { status: "ready" },
          planArtifactId: "dap_plan_change_manifest_test",
        },
        content: [],
      };
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    const tools = await bridge.request({
      jsonrpc: "2.0",
      id: 61,
      method: "tools/list",
    });
    const planChangeTool = tools.result.tools.find((tool) =>
      tool.name === "semaphor_plan_data_app_change"
    );
    assert.equal(planChangeTool.inputSchema.properties.workspaceDir.type, "string");
    assert.equal(planChangeTool.inputSchema.properties.outputDir.type, "string");

    const response = await bridge.request({
      jsonrpc: "2.0",
      id: 62,
      method: "tools/call",
      params: {
        name: "semaphor_plan_data_app_change",
        arguments: {
          workspaceDir: appDir,
          outputDir: "src/semaphor/generated",
          goal: "Remove revenue trend",
          operationIntent: {
            kind: "analytics_remove",
            targetViewIds: ["revenue_trend"],
          },
          target: { kind: "data_app" },
        },
      },
    });
    assert.equal(response.result.structuredContent.planArtifactId, "dap_plan_change_manifest_test");
    const toolCall = calls.find((call) =>
      call.body?.method === "tools/call" &&
      call.body?.params?.name === "semaphor_plan_data_app_change"
    );
    assert.ok(toolCall, "expected bridge to forward plan change call");
    assert.equal(toolCall.body.params.arguments.workspaceDir, undefined);
    assert.equal(toolCall.body.params.arguments.outputDir, undefined);
    assert.equal(
      toolCall.body.params.arguments.target.currentManifest.generatedContentHash,
      "inspectable-test-hash",
    );
    assert.equal(
      toolCall.body.params.arguments.target.currentManifest.codegenSummary.views[0].id,
      "revenue_trend",
    );
    assert.equal(
      toolCall.body.params.arguments.target.beforeCurrentAuthoringState
        .inspection.status,
      "inspected",
    );
    assert.equal(
      toolCall.body.params.arguments.target.beforeCurrentAuthoringState
        .inspection.generatedContract.digest,
      "inspectable-test-hash",
    );
    assert.deepEqual(
      toolCall.body.params.arguments.target.beforeCurrentAuthoringState.views
        .map((view) => view.viewId),
      ["revenue_trend"],
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertPlanChangeWithoutWorkspaceDirDoesNotInferPwdManifest() {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "semaphor-plan-change-no-pwd-"));
  await writeInspectableGeneratedContractFixture(appDir);
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        validation: { status: "blocked" },
        nextStep: "ask_user",
      },
      content: [],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
    PWD: appDir,
  });
  try {
    await bridge.request({
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: {
        name: "semaphor_plan_data_app_change",
        arguments: {
          outputDir: "src/semaphor/generated/custom",
          goal: "Remove revenue trend",
          operationIntent: {
            kind: "analytics_remove",
            targetViewIds: ["revenue_trend"],
          },
          target: {
            kind: "data_app",
            beforeCurrentAuthoringState: {
              inspection: { status: "inspected" },
            },
          },
        },
      },
    });
    const toolCall = calls.find((call) =>
      call.body?.method === "tools/call" &&
      call.body?.params?.name === "semaphor_plan_data_app_change"
    );
    assert.ok(toolCall, "expected bridge to forward plan change call");
    assert.equal(
      toolCall.body.params.arguments.outputDir,
      undefined,
      "bridge must strip outputDir before forwarding plan-change calls even when local context is not injected",
    );
    assert.equal(
      toolCall.body.params.arguments.target.currentManifest,
      undefined,
      "bridge must not attach a generated manifest from PWD without explicit workspaceDir or a single client root",
    );
  } finally {
    await bridge.stop();
    await server.stop();
    await rm(appDir, { recursive: true, force: true });
  }
}

async function assertPlanChangeStripsOutputDirWithProvidedCurrentState() {
  const calls = [];
  const server = await startMockMcpServer(calls, {
    callResult: {
      isError: false,
      structuredContent: {
        validation: { status: "ready" },
        planArtifactId: "dap_plan_change_provided_state",
      },
      content: [],
    },
  });
  const bridge = startBridge({
    SEMAPHOR_PROJECT_TOKEN: projectTokenForMcpUrl(server.url),
  });
  try {
    await bridge.request({
      jsonrpc: "2.0",
      id: 64,
      method: "tools/call",
      params: {
        name: "semaphor_plan_data_app_change",
        arguments: {
          outputDir: "src/semaphor/generated/custom",
          goal: "Remove revenue trend",
          operationIntent: {
            kind: "analytics_remove",
            targetViewIds: ["revenue_trend"],
          },
          target: {
            kind: "data_app",
            currentManifest: {
              schemaVersion: "semaphor-data-app-generated-contract-manifest/v1",
              generatedContentHash: "provided-manifest-hash",
            },
            beforeCurrentAuthoringState: {
              inspection: { status: "inspected" },
              views: [{ viewId: "revenue_trend" }],
            },
          },
        },
      },
    });
    const toolCall = calls.find((call) =>
      call.body?.method === "tools/call" &&
      call.body?.params?.name === "semaphor_plan_data_app_change"
    );
    assert.ok(toolCall, "expected bridge to forward plan change call");
    assert.equal(toolCall.body.params.arguments.outputDir, undefined);
    assert.equal(
      toolCall.body.params.arguments.target.currentManifest.generatedContentHash,
      "provided-manifest-hash",
    );
  } finally {
    await bridge.stop();
    await server.stop();
  }
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

function minimalCodegenSummary() {
  const source = {
    kind: "semantic",
    domainId: "retail_ops",
    name: "fact_order",
    label: "Orders",
    sourceKey: "retail_ops__fact_order",
  };
  const fieldRef = {
    name: "net_revenue",
    label: "Net Revenue",
    role: "measure",
    dataType: "number",
    aggregate: "SUM",
    sourceKey: source.sourceKey,
  };
  return {
    schemaVersion: "semaphor-data-app-codegen-summary/v1",
    title: "Retail Dashboard",
    userGoal: "Inspect current state",
    sources: [source],
    views: [{
      id: "revenue_trend",
      title: "Revenue Trend",
      visual: "line_chart",
      visualSpec: { visualType: "line_chart", title: "Revenue Trend" },
      queryKind: "metric",
      sdkBuilder: "semaphor.metric",
      sdkSpec: {
        builder: "semaphor.metric",
        spec: {
          source,
          id: "revenue_trend",
          label: "Revenue Trend",
          measures: [fieldRef],
        },
      },
      fields: [fieldRef],
      metricBindingKeys: [
        "semantic:retail_ops:datasetId:orders:SUM:net_revenue",
      ],
      computation: {
        kind: "server_query",
        queryKind: "metric",
        sourceKeys: [source.sourceKey],
        fieldNames: ["net_revenue"],
      },
    }],
    inputs: [{
      id: "region_filter",
      label: "Region",
      type: "multi_select",
      serverSide: true,
      fieldRef: {
        name: "region",
        label: "Region",
        role: "dimension",
        dataType: "string",
        sourceKey: source.sourceKey,
      },
      appliesToViewIds: ["revenue_trend"],
    }],
    filterContracts: [],
    implementationChecklist: {
      requiredDevtools: { mountRootDevtools: true },
      requiredInputOptions: [],
      filterScopeByInput: [],
      bindingsByView: {},
      validationCommands: [],
      browserSmokeChecks: [],
    },
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

function runDataAppCli(command, args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        status: 1,
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on("exit", (status) => {
      resolve({
        status,
        stdout,
        stderr,
      });
    });
  });
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
      const callResult =
        parsed.method === "tools/call" &&
        parsed.params?.name === "semaphor_materialize_data_app_contract" &&
        options.artifactPayload
          ? {
            isError: false,
            structuredContent: options.artifactPayload,
            content: [],
          }
          : typeof options.callResult === "function"
            ? options.callResult(parsed)
            : options.callResult || { isError: false, content: [] };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        ...(options.error
          ? { error: options.error }
          : parsed.method === "tools/call"
            ? { result: callResult }
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
