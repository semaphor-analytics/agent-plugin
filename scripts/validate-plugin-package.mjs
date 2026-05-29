#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const issues = [];

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
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
  if (!object || typeof object[field] !== 'string' || !object[field].trim()) {
    issues.push(`${relativePath}: missing string field "${field}"`);
  }
}

function validatePackageJson() {
  const pkg = readJson('package.json');
  requireString(pkg, 'name', 'package.json');
  requireString(pkg, 'version', 'package.json');
  if (!pkg?.scripts?.['validate:data-app']) {
    issues.push('package.json: missing validate:data-app script');
  }
}

function validateCodexManifest() {
  const manifest = readJson('.codex-plugin/plugin.json');
  requireString(manifest, 'name', '.codex-plugin/plugin.json');
  requireString(manifest, 'version', '.codex-plugin/plugin.json');
  requireString(manifest, 'description', '.codex-plugin/plugin.json');
  if (manifest?.skills !== './skills/') {
    issues.push('.codex-plugin/plugin.json: skills must point to ./skills/');
  }
  if (manifest?.mcpServers !== './.mcp.json') {
    issues.push('.codex-plugin/plugin.json: mcpServers must point to ./.mcp.json');
  }
  if (!manifest?.interface?.displayName) {
    issues.push('.codex-plugin/plugin.json: missing interface.displayName');
  }
}

function validateClaudeManifest() {
  const manifest = readJson('.claude-plugin/plugin.json');
  requireString(manifest, 'name', '.claude-plugin/plugin.json');
  requireString(manifest, 'version', '.claude-plugin/plugin.json');
  requireString(manifest, 'description', '.claude-plugin/plugin.json');
  if (manifest?.skills !== './skills/') {
    issues.push('.claude-plugin/plugin.json: skills must point to ./skills/');
  }
  if (manifest?.mcpServers !== './.mcp.json') {
    issues.push('.claude-plugin/plugin.json: mcpServers must point to ./.mcp.json');
  }
}

function validateMcpConfig() {
  const config = readJson('.mcp.json');
  const server = config?.mcpServers?.semaphor;
  if (!server) {
    issues.push('.mcp.json: missing mcpServers.semaphor');
    return;
  }
  if (!Array.isArray(server.args) || !server.args.includes('${SEMAPHOR_MCP_URL}')) {
    issues.push('.mcp.json: semaphor server args must use SEMAPHOR_MCP_URL');
  }
  if (!JSON.stringify(server).includes('${SEMAPHOR_PROJECT_TOKEN}')) {
    issues.push('.mcp.json: semaphor server must use SEMAPHOR_PROJECT_TOKEN');
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
    if (relativePath === 'package-lock.json') continue;
    if (relativePath === 'scripts/validate-plugin-package.mjs') continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        issues.push(`${relativePath}: contains forbidden distribution text matching ${pattern}`);
      }
    }
  }
}

function collectFiles(current, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    if (entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

requireFile('README.md');
requireFile('AGENTS.md');
requireFile('.env.example');
requireFile('.codex-plugin/plugin.json');
requireFile('.claude-plugin/plugin.json');
requireFile('.mcp.json');
requireDirectory('skills');
requireDirectory('scripts');
requireDirectory('docs');

validatePackageJson();
validateCodexManifest();
validateClaudeManifest();
validateMcpConfig();
scanDistributionText();

if (issues.length > 0) {
  console.error('Semaphor Agent Plugin package validation failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('Semaphor Agent Plugin package validation passed.');
