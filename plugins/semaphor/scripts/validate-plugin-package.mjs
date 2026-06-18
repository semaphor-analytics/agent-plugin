#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const issues = [];

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    issues.push(`${relativePath}: ${error.message}`);
    return null;
  }
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    issues.push(`Missing required file: ${relativePath}`);
  }
}

function requireDirectory(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    issues.push(`Missing required directory: ${relativePath}`);
  }
}

function requireString(object, field, relativePath) {
  if (!object || typeof object[field] !== "string" || !object[field].trim()) {
    issues.push(`${relativePath}: missing string field "${field}"`);
  }
}

function validatePackageJson() {
  const pkg = readJson("package.json");
  requireString(pkg, "name", "package.json");
  requireString(pkg, "version", "package.json");
  if (pkg?.engines?.node !== ">=18") {
    issues.push(
      "package.json: engines.node must be >=18 because plugin scripts use modern Node runtime APIs such as fetch",
    );
  }
  for (const forbiddenScript of [
    "validate:data-app",
    "test:generator",
  ]) {
    if (pkg?.scripts?.[forbiddenScript]) {
      issues.push(
        `package.json: hard migration forbids ${forbiddenScript}; use server-owned MCP contract tools instead`,
      );
    }
  }

  const repoRootPackageJsonPath = path.resolve(root, "../..", "package.json");
  if (fs.existsSync(repoRootPackageJsonPath)) {
    const repoRootPackageJson = JSON.parse(
      fs.readFileSync(repoRootPackageJsonPath, "utf8"),
    );
    if (repoRootPackageJson?.scripts?.["validate:data-app"]) {
      issues.push(
        "../../package.json: hard migration forbids validate:data-app root wrapper; use server-owned MCP contract validation tools instead",
      );
    }
  }
}

function validateCodexManifest() {
  const manifest = readJson(".codex-plugin/plugin.json");
  requireString(manifest, "name", ".codex-plugin/plugin.json");
  requireString(manifest, "version", ".codex-plugin/plugin.json");
  requireString(manifest, "description", ".codex-plugin/plugin.json");
  if (manifest?.skills !== "./skills/") {
    issues.push(".codex-plugin/plugin.json: skills must point to ./skills/");
  }
  if (manifest?.mcpServers !== "./.mcp.json") {
    issues.push(
      ".codex-plugin/plugin.json: mcpServers must point to ./.mcp.json",
    );
  }
  if (!manifest?.interface?.displayName) {
    issues.push(".codex-plugin/plugin.json: missing interface.displayName");
  }
  if (manifest?.interface?.composerIcon !== "./assets/composer-icon.png") {
    issues.push(
      ".codex-plugin/plugin.json: interface.composerIcon must point to ./assets/composer-icon.png",
    );
  }
  if (manifest?.interface?.logo !== "./assets/logo.png") {
    issues.push(
      ".codex-plugin/plugin.json: interface.logo must point to ./assets/logo.png",
    );
  }
  const forbiddenIconFields = [
    "icon_small",
    "icon_large",
    "iconSmall",
    "iconLarge",
  ];
  for (const fieldName of forbiddenIconFields) {
    const value = manifest?.interface?.[fieldName];
    if (value !== undefined) {
      issues.push(
        `.codex-plugin/plugin.json: interface.${fieldName} is not supported by this package; use interface.composerIcon and interface.logo under ./assets/ instead`,
      );
    }
  }
  for (const [fieldName, value] of Object.entries(manifest?.interface || {})) {
    if (
      typeof value === "string" &&
      /icon|logo/i.test(fieldName) &&
      value.includes("..")
    ) {
      issues.push(
        `.codex-plugin/plugin.json: interface.${fieldName} must not contain ".."; icon and logo assets must resolve under the plugin asset root`,
      );
    }
  }
}

function validateClaudeManifest() {
  const manifest = readJson(".claude-plugin/plugin.json");
  requireString(manifest, "name", ".claude-plugin/plugin.json");
  requireString(manifest, "version", ".claude-plugin/plugin.json");
  requireString(manifest, "description", ".claude-plugin/plugin.json");
  if (manifest?.skills !== "./skills/") {
    issues.push(".claude-plugin/plugin.json: skills must point to ./skills/");
  }
  if (manifest?.mcpServers !== "./.mcp.json") {
    issues.push(
      ".claude-plugin/plugin.json: mcpServers must point to ./.mcp.json",
    );
  }
  if (manifest?.displayName !== "Semaphor") {
    issues.push(".claude-plugin/plugin.json: displayName must be Semaphor");
  }
}

function validateVersionSync() {
  const pkg = readJson("package.json");
  const codexManifest = readJson(".codex-plugin/plugin.json");
  const claudeManifest = readJson(".claude-plugin/plugin.json");
  const expectedVersion = pkg?.version;
  if (!expectedVersion) return;

  for (const [label, actualVersion] of [
    [".codex-plugin/plugin.json", codexManifest?.version],
    [".claude-plugin/plugin.json", claudeManifest?.version],
  ]) {
    if (actualVersion && actualVersion !== expectedVersion) {
      issues.push(
        `${label}: version ${actualVersion} must match package.json version ${expectedVersion}`,
      );
    }
  }

  for (const relativePath of [
    "scripts/call-semaphor-tool.mjs",
    "scripts/semaphor-mcp-remote.mjs",
  ]) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    const versionMatches = [...text.matchAll(/\bversion:\s*['"]([^'"]+)['"]/g)];
    if (versionMatches.length === 0) {
      issues.push(`${relativePath}: missing helper-reported MCP version`);
      continue;
    }
    for (const match of versionMatches) {
      if (match[1] !== expectedVersion) {
        issues.push(
          `${relativePath}: helper-reported MCP version ${match[1]} must match package.json version ${expectedVersion}`,
        );
      }
    }
    if (/new URL\(import\.meta\.url\)\.pathname/.test(text)) {
      issues.push(
        `${relativePath}: use fileURLToPath(import.meta.url) instead of URL.pathname so packaged scripts resolve correctly on Windows`,
      );
    }
  }

  const claudeMarketplacePath = path.resolve(
    root,
    "..",
    "..",
    ".claude-plugin",
    "marketplace.json",
  );
  if (fs.existsSync(claudeMarketplacePath)) {
    const marketplace = JSON.parse(
      fs.readFileSync(claudeMarketplacePath, "utf8"),
    );
    const entry = marketplace?.plugins?.find(
      (plugin) => plugin?.name === pkg.name,
    );
    if (entry?.version && entry.version !== expectedVersion) {
      issues.push(
        `.claude-plugin/marketplace.json: semaphor version ${entry.version} must match package.json version ${expectedVersion}`,
      );
    }
  }
}

function validateMcpConfig() {
  const config = readJson(".mcp.json");
  const oauthServer = config?.mcpServers?.semaphor;
  if (!oauthServer) {
    issues.push(".mcp.json: missing mcpServers.semaphor hosted OAuth server");
  } else if (oauthServer.url !== "https://semaphor.cloud/api/mcp") {
    issues.push(
      ".mcp.json: mcpServers.semaphor must point to hosted Semaphor OAuth MCP",
    );
  }

  const server = config?.mcpServers?.["semaphor-project"];
  if (!server) {
    issues.push(
      ".mcp.json: missing mcpServers.semaphor-project project-token bridge",
    );
    return;
  }
  if (server.command !== "node") {
    issues.push(
      ".mcp.json: semaphor-project server must use the packaged MCP bridge",
    );
  }
  if (
    !Array.isArray(server.args) ||
    !server.args.includes("scripts/semaphor-mcp-remote.mjs")
  ) {
    issues.push(
      ".mcp.json: semaphor-project server args must use scripts/semaphor-mcp-remote.mjs",
    );
  }
  if (JSON.stringify(server).includes("${SEMAPHOR_PROJECT_TOKEN}")) {
    issues.push(
      ".mcp.json: do not pass a literal SEMAPHOR_PROJECT_TOKEN placeholder; the launcher reads real env and target app env files",
    );
  }

  const launcherPath = path.join(root, "scripts/semaphor-mcp-remote.mjs");
  if (fs.existsSync(launcherPath)) {
    const launcherText = fs.readFileSync(launcherPath, "utf8");
    if (
      /\bnpx\b/.test(launcherText) ||
      /mcp-remote['"\s,]/.test(launcherText)
    ) {
      issues.push(
        "scripts/semaphor-mcp-remote.mjs: launcher must be self-contained and must not shell out to npx mcp-remote",
      );
    }
    if (
      /readCachedWorkspaceDirectories|rememberBridgeWorkspaceDirectories|\.semaphor-agent-plugin|workspaces\.json/.test(
        launcherText,
      )
    ) {
      issues.push(
        "scripts/semaphor-mcp-remote.mjs: do not cache or reuse workspace directories for token lookup; tokens must come from the current process env or explicit/current workspace only",
      );
    }
    if (
      /roots\/list/.test(launcherText) &&
      !/directories\.length !== 1/.test(launcherText)
    ) {
      issues.push(
        "scripts/semaphor-mcp-remote.mjs: client roots must be ignored unless exactly one root is reported; multi-root sessions must require explicit workspaceDir",
      );
    }
    if (!/name:\s*['"]semaphor_get_access_context['"]/.test(launcherText)) {
      issues.push(
        "scripts/semaphor-mcp-remote.mjs: no-token fallback tools/list must expose semaphor_get_access_context for auth/project setup guidance",
      );
    }
  }
}

function validateSkillStructure() {
  const skillPath = path.join(root, "skills/semaphor-data-apps/SKILL.md");
  if (!fs.existsSync(skillPath)) {
    issues.push("Missing required file: skills/semaphor-data-apps/SKILL.md");
    return;
  }

  const skillText = fs.readFileSync(skillPath, "utf8");
  const lineCount = skillText.split(/\r?\n/).length;
  if (lineCount > 500) {
    issues.push(
      `skills/semaphor-data-apps/SKILL.md: ${lineCount} lines exceeds 500-line progressive disclosure limit`,
    );
  }
  if (
    !/Auth preflight is step zero/i.test(skillText) ||
    !/semaphor_get_access_context/i.test(skillText) ||
    !/before local repo inspection/i.test(skillText)
  ) {
    issues.push(
      "skills/semaphor-data-apps/SKILL.md: must require Semaphor auth/project preflight with semaphor_get_access_context before local repo inspection",
    );
  }

  const requiredReferences = [
    "onboarding.md",
    "mcp-authoring.md",
    "sdk-contract.md",
    "derived-fields.md",
    "matrix.md",
    "planning-workflow.md",
    "sql.md",
    "filters-and-inputs.md",
    "tables.md",
    "shadcn-dashboard.md",
    "publish-lifecycle.md",
    "validation.md",
  ];

  for (const fileName of requiredReferences) {
    const relativePath = `skills/semaphor-data-apps/references/${fileName}`;
    if (!fs.existsSync(path.join(root, relativePath))) {
      issues.push(`Missing required Semaphor skill reference: ${relativePath}`);
    }
    if (!skillText.includes(`references/${fileName}`)) {
      issues.push(
        `skills/semaphor-data-apps/SKILL.md: missing link to references/${fileName}`,
      );
    }
  }
}

function validateDataAppInitializer() {
  const initPath = path.join(root, "scripts/init-semaphor-data-app.mjs");
  if (!fs.existsSync(initPath)) {
    return;
  }
  const initText = fs.readFileSync(initPath, "utf8");
  if (!initText.includes("SemaphorDevtools")) {
    issues.push(
      "scripts/init-semaphor-data-app.mjs: starter provider must mount one root SemaphorDevtools for local authoring inspection",
    );
  }
  if (!/exposeWindowBridge\s*:\s*true/.test(initText)) {
    issues.push(
      "scripts/init-semaphor-data-app.mjs: starter provider must enable exposeWindowBridge behind a local/dev debug gate",
    );
  }
}

function validateMcpBridge() {
  const bridgePath = path.join(root, "scripts/semaphor-mcp-remote.mjs");
  if (!fs.existsSync(bridgePath)) {
    return;
  }
  const bridgeText = fs.readFileSync(bridgePath, "utf8");
  for (const forbidden of [
    "const LOCAL_TOOLS",
    "createLocalDataAppContract",
    "generateLocalDataAppContract",
    "updateLocalDataAppContract",
    "validateLocalDataAppContract",
    "runDataAppContractGenerator",
    "generate-data-app-contract.mjs",
    "validate-semaphor-data-app.mjs",
    "codegenSummaryPath",
    "bridgeArtifactDirectories",
  ]) {
    if (bridgeText.includes(forbidden)) {
      issues.push(
        `scripts/semaphor-mcp-remote.mjs: hard migration forbids plugin-local Data App contract MCP handling (${forbidden}); proxy live Semaphor MCP tools instead`,
      );
    }
  }
  if (bridgeText.includes("fs.readdirSync(generatedDir)")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: generated contract manifest validation must not hash unrelated .ts files from the generated directory",
    );
  }
  for (const forbidden of [
    "SEMANTIC_RELATIONSHIP_SOURCE_SCHEMA",
    "SEMANTIC_RELATIONSHIP_FIELD_SCHEMA",
    "RELATIONSHIP_CANDIDATE_SCHEMA",
    "SEMANTIC_REPAIR_DIAGNOSTIC_SCHEMA",
    "SEMANTIC_REPAIR_PATCH_SCHEMA",
  ]) {
    if (bridgeText.includes(forbidden)) {
      issues.push(
        `scripts/semaphor-mcp-remote.mjs: must not duplicate server-owned MCP semantic schemas in plugin fallback (${forbidden})`,
      );
    }
  }
  const fallbackToolsText = textBetween(
    bridgeText,
    "const FALLBACK_TOOLS = [",
    "const scriptDir =",
  );
  for (const serverOwnedTool of [
    "semaphor_get_analysis_context",
    "semaphor_list_semantic_domains",
    "semaphor_list_datasets",
    "semaphor_get_dataset_schema",
    "semaphor_get_domain_relationships",
    "semaphor_propose_semantic_model_change",
    "semaphor_apply_semantic_model_patch",
    "semaphor_plan_data_app",
    "semaphor_plan_data_app_change",
    "semaphor_get_data_app_runtime_token",
    "semaphor_create_data_app_contract",
    "semaphor_generate_data_app_contract",
    "semaphor_update_data_app_contract",
    "semaphor_validate_data_app_contract",
  ]) {
    const fallbackToolNamePattern = new RegExp(
      `\\bname\\s*:\\s*["']${escapeRegExp(serverOwnedTool)}["']`,
    );
    if (fallbackToolNamePattern.test(fallbackToolsText)) {
      issues.push(
        `scripts/semaphor-mcp-remote.mjs: fallback tools must not advertise server-owned MCP tool schema ${serverOwnedTool}; use live tools/list from semaphor-app`,
      );
    }
  }
  for (const forbiddenPath of [
    "scripts/generate-data-app-contract.mjs",
    "scripts/shared-codegen-loader.mjs",
    "scripts/test-generate-data-app-contract.mjs",
    "scripts/validate-semaphor-data-app.mjs",
    "scripts/data-app-codegen-summary-validation.mjs",
    "scripts/data-app-contract-update-policy.mjs",
    "scripts/generated-contract-files.mjs",
  ]) {
    if (fs.existsSync(path.join(root, forbiddenPath))) {
      issues.push(
        `${forbiddenPath}: hard migration forbids plugin-local Data App contract generator/validator wrappers; use server-owned MCP contract tools instead`,
      );
    }
  }
}

function textBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const contentStart = startIndex + start.length;
  const endIndex = text.indexOf(end, contentStart);
  if (endIndex < 0) return text.slice(contentStart);
  return text.slice(contentStart, endIndex);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scanDistributionText() {
  const forbidden = [
    /\/Users\/rohit\//,
    /semaphor-codex-plugin/,
    /CODEX_PLUGIN/,
    /support@sema4\.cloud/,
    /Semaphor LLC/,
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  ];
  const textFiles = collectFiles(root).filter((filePath) =>
    /\.(json|md|mjs|txt|example)$/.test(filePath),
  );
  for (const filePath of textFiles) {
    const relativePath = path.relative(root, filePath);
    if (relativePath === "package-lock.json") continue;
    if (relativePath === "scripts/validate-plugin-package.mjs") continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        issues.push(
          `${relativePath}: contains forbidden distribution text matching ${pattern}`,
        );
      }
    }
  }
}

function collectFiles(current, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.name === ".env" || entry.name.startsWith(".env.")) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

requireFile("README.md");
requireFile("AGENTS.md");
requireFile(".codex-plugin/plugin.json");
requireFile(".claude-plugin/plugin.json");
requireFile(".mcp.json");
requireFile("assets/composer-icon.png");
requireFile("assets/logo.png");
requireFile("assets/logo-source.png");
requireFile("scripts/call-semaphor-tool.mjs");
requireFile("scripts/detect-react-app.mjs");
requireFile("scripts/init-semaphor-data-app.mjs");
requireFile("scripts/semaphor-data-app.mjs");
requireFile("scripts/test-mcp-bridge.mjs");
requireDirectory("skills");
requireDirectory("scripts");
requireDirectory("docs");

validatePackageJson();
validateCodexManifest();
validateClaudeManifest();
validateVersionSync();
validateMcpConfig();
validateSkillStructure();
validateDataAppInitializer();
validateMcpBridge();
scanDistributionText();

if (issues.length > 0) {
  console.error("Semaphor Agent Plugin package validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Semaphor Agent Plugin package validation passed.");
