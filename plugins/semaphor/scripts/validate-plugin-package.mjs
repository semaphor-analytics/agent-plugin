#!/usr/bin/env node
// Validates the installable Semaphor plugin package. Run from plugins/semaphor
// (npm run validate:plugin, or validate:codex-plugin from the repo root).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const issues = [];
const HOSTED_MCP_URL = "https://semaphor.cloud/api/mcp";
const ANALYTICS_SKILL = "skills/semaphor-analytics";
const ANALYTICS_SKILL_REFERENCES = [
  "answering-questions.md",
  "dashboard-audits.md",
  "semantic-model.md",
  "sql-escape-hatch.md",
  "access-and-tools.md",
  "golden-workflows.md",
];

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
    issues.push("package.json: engines.node must be >=18");
  }
  for (const scriptName of Object.keys(pkg?.scripts || {})) {
    if (/data-app|publish|bridge|call:mcp|detect/.test(scriptName)) {
      issues.push(
        `package.json: script "${scriptName}" belongs to the removed Data App workflow`,
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
    issues.push(".codex-plugin/plugin.json: mcpServers must point to ./.mcp.json");
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
    issues.push(".codex-plugin/plugin.json: interface.logo must point to ./assets/logo.png");
  }
  if (!Array.isArray(manifest?.interface?.defaultPrompt) || manifest.interface.defaultPrompt.length === 0) {
    issues.push(".codex-plugin/plugin.json: interface.defaultPrompt must list starter prompts");
  }
  for (const [fieldName, value] of Object.entries(manifest?.interface || {})) {
    if (typeof value === "string" && /icon|logo/i.test(fieldName) && value.includes("..")) {
      issues.push(
        `.codex-plugin/plugin.json: interface.${fieldName} must not contain ".."; assets must resolve under the plugin root`,
      );
    }
  }
}

function validateClaudeManifest() {
  const manifest = readJson(".claude-plugin/plugin.json");
  for (const field of ["name", "version", "description", "homepage", "repository", "license"]) {
    requireString(manifest, field, ".claude-plugin/plugin.json");
  }
  if (manifest?.skills !== "./skills/") {
    issues.push(".claude-plugin/plugin.json: skills must point to ./skills/");
  }
  if (manifest?.mcpServers !== "./.mcp.json") {
    issues.push(".claude-plugin/plugin.json: mcpServers must point to ./.mcp.json");
  }
  if (manifest?.displayName !== "Semaphor") {
    issues.push(".claude-plugin/plugin.json: displayName must be Semaphor");
  }
  if (manifest?.license !== "MIT") {
    issues.push(".claude-plugin/plugin.json: license must be MIT");
  }
  if (!manifest?.author?.url || !manifest?.author?.email) {
    issues.push(".claude-plugin/plugin.json: author needs url and email");
  }
  if (!Array.isArray(manifest?.keywords) || manifest.keywords.length === 0) {
    issues.push(".claude-plugin/plugin.json: keywords must be a non-empty list");
  }
}

function validateVersionSync() {
  const pkg = readJson("package.json");
  const expectedVersion = pkg?.version;
  if (!expectedVersion) return;

  for (const [label, actualVersion] of [
    [".codex-plugin/plugin.json", readJson(".codex-plugin/plugin.json")?.version],
    [".claude-plugin/plugin.json", readJson(".claude-plugin/plugin.json")?.version],
  ]) {
    if (actualVersion && actualVersion !== expectedVersion) {
      issues.push(`${label}: version ${actualVersion} must match package.json version ${expectedVersion}`);
    }
  }

  const repoRootPackageJsonPath = path.resolve(root, "../..", "package.json");
  if (fs.existsSync(repoRootPackageJsonPath)) {
    const repoRootPackageJson = JSON.parse(fs.readFileSync(repoRootPackageJsonPath, "utf8"));
    if (repoRootPackageJson?.version !== expectedVersion) {
      issues.push(
        `../../package.json: version ${repoRootPackageJson?.version} must match package.json version ${expectedVersion}`,
      );
    }
  }

  const repoRootPackageLockPath = path.resolve(root, "../..", "package-lock.json");
  if (fs.existsSync(repoRootPackageLockPath)) {
    const repoRootPackageLock = JSON.parse(fs.readFileSync(repoRootPackageLockPath, "utf8"));
    if (repoRootPackageLock?.version !== expectedVersion) {
      issues.push(
        `../../package-lock.json: version ${repoRootPackageLock?.version} must match package.json version ${expectedVersion}`,
      );
    }
    const rootPackageVersion = repoRootPackageLock?.packages?.[""]?.version;
    if (rootPackageVersion !== expectedVersion) {
      issues.push(
        `../../package-lock.json: packages[""].version ${rootPackageVersion} must match package.json version ${expectedVersion}`,
      );
    }
  }

  const claudeMarketplacePath = path.resolve(root, "..", "..", ".claude-plugin", "marketplace.json");
  if (fs.existsSync(claudeMarketplacePath)) {
    const marketplace = JSON.parse(fs.readFileSync(claudeMarketplacePath, "utf8"));
    const entry = marketplace?.plugins?.find((plugin) => plugin?.name === pkg.name);
    if (entry?.version && entry.version !== expectedVersion) {
      issues.push(
        `.claude-plugin/marketplace.json: semaphor version ${entry.version} must match package.json version ${expectedVersion}`,
      );
    }
  }
}

/** Exactly one server: the hosted Semaphor MCP over HTTP. */
function validateMcpConfig() {
  const config = readJson(".mcp.json");
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== "object") {
    issues.push('.mcp.json: must keep the "mcpServers" wrapper');
    return;
  }
  const names = Object.keys(servers);
  if (names.length !== 1 || names[0] !== "semaphor") {
    issues.push(`.mcp.json: must declare exactly one server, "semaphor" (found: ${names.join(", ") || "none"})`);
  }
  const server = servers.semaphor;
  if (server?.type !== "http") {
    issues.push('.mcp.json: mcpServers.semaphor.type must be "http"');
  }
  if (server?.url !== HOSTED_MCP_URL) {
    issues.push(`.mcp.json: mcpServers.semaphor.url must be ${HOSTED_MCP_URL}`);
  }
  for (const localField of ["command", "args", "cwd", "env"]) {
    if (server && localField in server) {
      issues.push(`.mcp.json: mcpServers.semaphor must not set ${localField}; the plugin ships no local server`);
    }
  }
}

function validateAnalyticsSkill() {
  const skillPath = `${ANALYTICS_SKILL}/SKILL.md`;
  requireFile(skillPath);
  const fullPath = path.join(root, skillPath);
  if (fs.existsSync(fullPath)) {
    const text = fs.readFileSync(fullPath, "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    if (!/^name:\s*semaphor-analytics\s*$/m.test(frontmatter)) {
      issues.push(`${skillPath}: frontmatter must set name: semaphor-analytics`);
    }
    if (!/^description:\s*\S/m.test(frontmatter)) {
      issues.push(`${skillPath}: frontmatter must set a description`);
    }
  }
  for (const reference of ANALYTICS_SKILL_REFERENCES) {
    requireFile(`${ANALYTICS_SKILL}/references/${reference}`);
  }
  const skills = fs.existsSync(path.join(root, "skills"))
    ? fs.readdirSync(path.join(root, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  for (const entry of skills) {
    if (entry.name !== "semaphor-analytics") {
      issues.push(`skills/${entry.name}: the plugin ships only the semaphor-analytics skill`);
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
    // Removed with the Data App workflow (Analytics MCP focus, Phase 1.3b).
    /semaphor-mcp-remote|semaphor-data-app\.mjs|VITE_SEMAPHOR_PROJECT_TOKEN|semaphor_get_data_app_runtime_token/,
    // Argument names the server removed and now rejects (CONTRACTS section 12.1).
    /\bresponse_format\b|\binclude_template\b|\binclude_query_inputs\b|\bmax_cards\b/,
  ];
  const textFiles = collectFiles(root).filter((filePath) => /\.(json|md|mjs|txt|example)$/.test(filePath));
  for (const filePath of textFiles) {
    const relativePath = path.relative(root, filePath);
    if (relativePath === "package-lock.json") continue;
    if (relativePath === "scripts/validate-plugin-package.mjs") continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        issues.push(`${relativePath}: contains forbidden distribution text matching ${pattern}`);
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
requireFile("LICENSE");
requireFile(".codex-plugin/plugin.json");
requireFile(".claude-plugin/plugin.json");
requireFile(".mcp.json");
requireFile("assets/composer-icon.png");
requireFile("assets/logo.png");
requireFile("assets/logo-source.png");
requireFile("docs/INSTALLATION_AND_AUTH.md");
requireFile("docs/TROUBLESHOOTING.md");
requireDirectory("skills");

validatePackageJson();
validateCodexManifest();
validateClaudeManifest();
validateVersionSync();
validateMcpConfig();
validateAnalyticsSkill();
scanDistributionText();

if (issues.length > 0) {
  console.error("Semaphor Agent Plugin package validation failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Semaphor Agent Plugin package validation passed.");
