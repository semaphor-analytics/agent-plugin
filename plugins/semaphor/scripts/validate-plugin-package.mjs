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
  if (!pkg?.scripts?.["validate:data-app"]) {
    issues.push("package.json: missing validate:data-app script");
  }
  if (!pkg?.scripts?.["test:generator"]) {
    issues.push("package.json: missing test:generator script");
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
    for (const requiredFallbackTool of [
      "semaphor_get_analysis_context",
      "semaphor_list_semantic_domains",
      "semaphor_get_dataset_schema",
      "semaphor_plan_data_app",
    ]) {
      const fallbackToolPattern = new RegExp(
        `name:\\s*['"]${requiredFallbackTool}['"]`,
      );
      if (!fallbackToolPattern.test(launcherText)) {
        issues.push(
          `scripts/semaphor-mcp-remote.mjs: no-token fallback tools/list must expose ${requiredFallbackTool} so agents can retry first-class calls with workspaceDir`,
        );
      }
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
  if (!bridgeText.includes("semaphor_validate_data_app_contract")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: must expose semaphor_validate_data_app_contract as a first-class local MCP tool",
    );
  }
  if (!bridgeText.includes("semaphor_generate_data_app_contract")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: must expose semaphor_generate_data_app_contract as a first-class local MCP tool",
    );
  }
  if (!bridgeText.includes("semaphor_create_data_app_contract")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: must expose semaphor_create_data_app_contract for eval paths or explicitly approved one-step builds",
    );
  }
  if (
    !bridgeText.includes(
      "Normal interactive greenfield builds should call semaphor_plan_data_app first",
    )
  ) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: create-contract tool description must preserve the plan-first interactive workflow",
    );
  }
  if (!bridgeText.includes("targetViewIds: [...]")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: fix_warnings operationIntent description must document required targetViewIds",
    );
  }
  if (!bridgeText.includes("semaphor_update_data_app_contract")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: must expose semaphor_update_data_app_contract for generated app changes",
    );
  }
  if (!bridgeText.includes("migrationReport")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: update tool must return a migrationReport for presentation edits",
    );
  }
  if (!bridgeText.includes("filterEffectReportPath")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: validation tool must expose filterEffectReportPath for browser filter QA",
    );
  }
  if (!bridgeText.includes("generate-data-app-contract.mjs")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: local generation tool must call scripts/generate-data-app-contract.mjs",
    );
  }
  if (!bridgeText.includes("validate-semaphor-data-app.mjs")) {
    issues.push(
      "scripts/semaphor-mcp-remote.mjs: local validation tool must call scripts/validate-semaphor-data-app.mjs",
    );
  }
  const generatorPath = path.join(
    root,
    "scripts/generate-data-app-contract.mjs",
  );
  const summaryValidationPath = path.join(
    root,
    "scripts/data-app-codegen-summary-validation.mjs",
  );
  if (fs.existsSync(generatorPath)) {
    const generatorText = fs.readFileSync(generatorPath, "utf8");
    if (!generatorText.includes("contract.manifest.json")) {
      issues.push(
        "scripts/generate-data-app-contract.mjs: generator must write contract.manifest.json for iterative planning and drift detection",
      );
    }
    if (!generatorText.includes("codegenSummaryHash")) {
      issues.push(
        "scripts/generate-data-app-contract.mjs: generator must write codegenSummaryHash so manifest payload drift is detectable",
      );
    }
    const summaryValidationText = fs.existsSync(summaryValidationPath)
      ? fs.readFileSync(summaryValidationPath, "utf8")
      : "";
    if (
      !summaryValidationText.includes("semaphor-data-app-codegen-summary/v1")
    ) {
      issues.push(
        "scripts/data-app-codegen-summary-validation.mjs: must enforce semaphor-data-app-codegen-summary/v1",
      );
    }
    for (const requiredExport of [
      "generatedQueryViewIds",
      "generatedInputOptionQueryIds",
      "filterContractsForView",
      "inputsForViewId",
      "queryOptionsForViewId",
    ]) {
      if (!generatorText.includes(requiredExport)) {
        issues.push(
          `scripts/generate-data-app-contract.mjs: generated contract must expose ${requiredExport}`,
        );
      }
    }
  }
  const validatorPath = path.join(
    root,
    "scripts/validate-semaphor-data-app.mjs",
  );
  if (fs.existsSync(validatorPath)) {
    const validatorText = fs.readFileSync(validatorPath, "utf8");
    if (!validatorText.includes("contract.manifest.json")) {
      issues.push(
        "scripts/validate-semaphor-data-app.mjs: validator must require contract.manifest.json",
      );
    }
    if (!validatorText.includes("generatedContentHash")) {
      issues.push(
        "scripts/validate-semaphor-data-app.mjs: validator must verify generatedContentHash to catch generated-contract drift",
      );
    }
    if (!validatorText.includes("codegenSummaryHash")) {
      issues.push(
        "scripts/validate-semaphor-data-app.mjs: validator must verify codegenSummaryHash to catch manifest payload drift",
      );
    }
    if (!validatorText.includes("validateFilterEffectReport")) {
      issues.push(
        "scripts/validate-semaphor-data-app.mjs: validator must support filter-effect report validation",
      );
    }
    if (!validatorText.includes("--filter-effect-report")) {
      issues.push(
        "scripts/validate-semaphor-data-app.mjs: validator CLI must expose --filter-effect-report",
      );
    }
  }
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
requireFile("scripts/data-app-codegen-summary-validation.mjs");
requireFile("scripts/detect-react-app.mjs");
requireFile("scripts/generate-data-app-contract.mjs");
requireFile("scripts/init-semaphor-data-app.mjs");
requireFile("scripts/semaphor-data-app.mjs");
requireFile("scripts/test-generate-data-app-contract.mjs");
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
