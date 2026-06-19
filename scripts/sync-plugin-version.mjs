#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginPackagePath = "plugins/semaphor/package.json";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const nonFlagArgs = args.filter((arg) => !arg.startsWith("--"));

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (nonFlagArgs.length > 1) {
  fail(`Expected at most one version argument, received: ${nonFlagArgs.join(" ")}`);
}

const pluginPackage = readJson(pluginPackagePath);
const currentVersion = pluginPackage.version;
const targetVersion = checkOnly
  ? currentVersion
  : resolveTargetVersion(nonFlagArgs[0] || "sync", currentVersion);

const issues = [];
const changes = [];

const jsonVersionTargets = [
  {
    file: "package.json",
    read: (json) => json.version,
    write: (json) => {
      json.version = targetVersion;
    },
  },
  {
    file: "package-lock.json",
    read: (json) => json.version,
    write: (json) => {
      json.version = targetVersion;
      if (json.packages?.[""]) {
        json.packages[""].version = targetVersion;
      }
    },
    extraChecks: (json) => [["package-lock.json packages[\"\"]", json.packages?.[""]?.version]],
  },
  {
    file: pluginPackagePath,
    read: (json) => json.version,
    write: (json) => {
      json.version = targetVersion;
    },
  },
  {
    file: "plugins/semaphor/.codex-plugin/plugin.json",
    read: (json) => json.version,
    write: (json) => {
      json.version = targetVersion;
    },
  },
  {
    file: "plugins/semaphor/.claude-plugin/plugin.json",
    read: (json) => json.version,
    write: (json) => {
      json.version = targetVersion;
    },
  },
  {
    file: ".claude-plugin/marketplace.json",
    read: (json) => semaphorMarketplaceEntry(json)?.version,
    write: (json) => {
      const entry = semaphorMarketplaceEntry(json);
      if (!entry) {
        throw new Error('Missing "semaphor" entry in .claude-plugin/marketplace.json');
      }
      entry.version = targetVersion;
    },
  },
];

for (const target of jsonVersionTargets) {
  const json = readJson(target.file);
  const version = target.read(json);
  checkVersion(target.file, version);
  for (const [label, extraVersion] of target.extraChecks?.(json) || []) {
    checkVersion(label, extraVersion);
  }
  if (!checkOnly && version !== targetVersion) {
    target.write(json);
    writeJson(target.file, json);
    changes.push(`${target.file}: ${version} -> ${targetVersion}`);
  } else if (!checkOnly && target.file === "package-lock.json") {
    const before = JSON.stringify(json);
    target.write(json);
    if (JSON.stringify(json) !== before) {
      writeJson(target.file, json);
      changes.push(`${target.file}: nested package version -> ${targetVersion}`);
    }
  }
}

if (issues.length > 0) {
  console.error("Semaphor plugin versions are out of sync:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  console.error(`\nRun: npm run version:plugin -- sync`);
  process.exit(1);
}

if (checkOnly) {
  console.log(`Semaphor plugin versions are in sync at ${targetVersion}.`);
} else if (changes.length === 0) {
  console.log(`Semaphor plugin versions already set to ${targetVersion}.`);
} else {
  console.log(`Semaphor plugin versions set to ${targetVersion}:`);
  for (const change of changes) {
    console.log(`- ${change}`);
  }
}

function resolveTargetVersion(argument, version) {
  if (argument === "sync") {
    return version;
  }
  if (["major", "minor", "patch"].includes(argument)) {
    return bumpVersion(version, argument);
  }
  if (isSemver(argument)) {
    return argument;
  }
  fail(`Unsupported version argument "${argument}". Use major, minor, patch, sync, or an explicit x.y.z version.`);
}

function bumpVersion(version, part) {
  if (!isSemver(version)) {
    fail(`Cannot bump non-semver version "${version}"`);
  }
  const [major, minor, patch] = version.split(".").map(Number);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function writeJson(relativePath, json) {
  fs.writeFileSync(path.join(repoRoot, relativePath), `${JSON.stringify(json, null, 2)}\n`);
}

function semaphorMarketplaceEntry(json) {
  return json.plugins?.find((plugin) => plugin?.name === "semaphor");
}

function checkVersion(label, actualVersion) {
  if (checkOnly && actualVersion !== targetVersion) {
    issues.push(`${label}: ${actualVersion || "missing"} must match ${targetVersion}`);
  }
}

function fail(message) {
  console.error(message);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  npm run version:plugin -- patch
  npm run version:plugin -- minor
  npm run version:plugin -- major
  npm run version:plugin -- 0.2.0
  npm run version:plugin -- sync
  npm run version:plugin:check

Updates Semaphor plugin manifest and package version surfaces from plugins/semaphor/package.json.
Use sync to rewrite all versioned files to the current plugin package version.`);
}
