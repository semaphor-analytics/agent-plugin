#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = { dir: process.cwd(), runBuild: true, strict: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dir = argv[i + 1];
      i += 1;
    } else if (arg === "--no-run") {
      args.runBuild = false;
    } else if (arg === "--strict") {
      args.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  return "npm";
}

function collectFiles(root, files = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === ".next"
    ) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function formatLocation(root, filePath) {
  return path.relative(root, filePath);
}

function scanSourceQuality(root, sourceFiles) {
  const advisories = [];
  let usesDataAppSdkHooks = false;
  let hasProvider = false;

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const location = formatLocation(root, filePath);

    if (
      /useSemaphor(?:Analysis|Metric|Records|Input|Inputs|InputOptions|Query)\b/.test(
        content,
      ) ||
      /\bsemaphor\.(?:filter|control|sqlParam|metric|records|analysis|sql|inputOptions)\b/.test(
        content,
      )
    ) {
      usesDataAppSdkHooks = true;
    }
    if (
      /\buseSemaphor(?:Analysis|Metric|Records|InputOptions|Sql)\b/.test(
        content,
      )
    ) {
      advisories.push(
        `${location}: legacy query APIs are not part of the Data App contract; define queries with semaphor.* builders and execute them with useSemaphorQuery.`,
      );
    }
    if (/ReturnType\s*<\s*typeof\s+useSemaphorQuery\s*>/.test(content)) {
      advisories.push(
        `${location}: do not type helper components with ReturnType<typeof useSemaphorQuery>; import SemaphorQueryResult, SemaphorRecordsQueryResult, SemaphorRowsQueryResult, or SemaphorSqlQueryResult from react-semaphor/data-app-sdk.`,
      );
    }
    if (
      /\bsemaphor\.records\s*\(/.test(content) &&
      /(?:satisfies|:)\s*\[\s*SemaphorFieldRef\s*,\s*\.\.\.SemaphorFieldRef\[\]\s*\]/.test(
        content,
      )
    ) {
      advisories.push(
        `${location}: semaphor.records fields are typed as SemaphorFieldRef; use SemaphorRecordsField so every selected record field has a definite role.`,
      );
    }
    if (content.includes("SemaphorDataAppProvider")) {
      hasProvider = true;
    }

    const executesSemaphorQuery = /\buseSemaphorQuery\b/.test(content);
    const rendersTable =
      /<table\b/i.test(content) ||
      /<Table\b/.test(content) ||
      /\bTableHeader\b/.test(content);

    if (executesSemaphorQuery) {
      if (!/(isLoading|status\s*===\s*["']loading["']|\bLoading\b|Skeleton)/.test(content)) {
        advisories.push(
          `${location}: Semaphor query results should render a loading state so cards do not appear blank or zero-valued while data is fetching.`,
        );
      }
      if (!/(\.error\b|status\s*===\s*["']error["']|\bError\b|query failed)/i.test(content)) {
        advisories.push(
          `${location}: Semaphor query results should render an error state with enough context to debug failed execution.`,
        );
      }
      if (!/(records\.length|rowCount|No data|empty state|isEmpty|\bEmpty\b)/i.test(content)) {
        advisories.push(
          `${location}: Semaphor query views should handle empty results instead of rendering a blank chart or table.`,
        );
      }
    }

    if (rendersTable && /react-semaphor\/data-app-sdk|useSemaphorQuery|records\.map/.test(content)) {
      if (!/(sort|Sort|orderBy|aria-sort)/.test(content)) {
        advisories.push(
          `${location}: Semaphor-backed tables should provide a sorting affordance or document why sorting is server-owned elsewhere.`,
        );
      }
      if (!/(<tfoot\b|<TableFooter\b|totals?\s+row|grand\s+total|subtotal)/i.test(content)) {
        advisories.push(
          `${location}: Semaphor-backed tables with numeric columns should include a totals row for displayed rows, or use a separate aggregate query for all-data totals.`,
        );
      }

      const hasPagingUi =
        /\b(?:page|pageIndex|currentPage|pageSize|offset|nextPage|previousPage)\b/i.test(
          content,
        );
      const slicesRows = /\.slice\s*\(/.test(content);
      const usesServerPagination =
        /\bpagination\s*:\s*\{/.test(content) || /\.pagination\b/.test(content);
      if (hasPagingUi && slicesRows && !usesServerPagination) {
        advisories.push(
          `${location}: table pagination appears to slice Semaphor result rows client-side. For large or complete-dataset tables, request server pages with pagination: { page, pageSize } on semaphor.records(...) or semaphor.sql(...), then render controls from result.pagination.`,
        );
      }
    }

    if (
      /replace-with-|replace_with_|YOUR_SEMAPHOR|TODO_SEMAPHOR|<project token>/i.test(
        content,
      )
    ) {
      advisories.push(
        `${location}: placeholder Semaphor source or field references remain in source code.`,
      );
    }

    if (/row\s*\[\s*column\.label\s*\]/.test(content)) {
      advisories.push(
        `${location}: records are accessed with row[column.label]; use row[column.key] because labels are display-only.`,
      );
    }

    if (/row\s*\[\s*column\.name\s*\]/.test(content)) {
      advisories.push(
        `${location}: records are accessed with row[column.name]; use row[column.key] because result keys may be disambiguated.`,
      );
    }

    if (/row\s*\[\s*['"`][^'"`\]]*[\s()]+[^'"`\]]*['"`]\s*\]/.test(content)) {
      advisories.push(
        `${location}: records are accessed with a display-looking string key; render from result.columns and row[column.key].`,
      );
    }

    if (/Object\.entries\(\s*row\s*\)/.test(content)) {
      advisories.push(
        `${location}: Object.entries(row) renders raw result keys; prefer result.columns for labels and stable cell order.`,
      );
    }
  }

  if (usesDataAppSdkHooks && !hasProvider) {
    advisories.push(
      "Data App SDK queries were found, but no SemaphorDataAppProvider import/usage was found. Queries stay idle without a runtime/provider unless the app supplies one through its own wrapper.",
    );
  }

  return { advisories };
}

function runScript(root, packageManager, scriptName) {
  const command =
    packageManager === "pnpm"
      ? ["pnpm", [scriptName]]
      : packageManager === "yarn"
        ? ["yarn", [scriptName]]
        : packageManager === "bun"
          ? ["bun", ["run", scriptName]]
          : ["npm", ["run", scriptName]];

  console.log(`Running ${command[0]} ${command[1].join(" ")}...`);
  const result = spawnSync(command[0], command[1], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  return result.status === 0;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      "Usage: validate-semaphor-data-app.mjs [--dir <path>] [--no-run] [--strict]",
    );
    process.exit(0);
  }

  const root = path.resolve(args.dir);
  const packageJsonPath = path.join(root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`No package.json found at ${packageJsonPath}`);
    process.exit(1);
  }

  const pkg = readJson(packageJsonPath);
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const scripts = pkg.scripts || {};
  const issues = [];

  if (!deps.react) issues.push("Missing react dependency.");
  if (!deps["react-semaphor"])
    issues.push("Missing react-semaphor dependency.");

  const sourceFiles = collectFiles(root);
  const quality = scanSourceQuality(root, sourceFiles);
  const sdkImports = sourceFiles.filter((filePath) =>
    fs.readFileSync(filePath, "utf8").includes("react-semaphor/data-app-sdk"),
  );

  if (sdkImports.length === 0) {
    quality.advisories.push(
      "No imports from react-semaphor/data-app-sdk were found.",
    );
  }

  console.log(`Checked ${sourceFiles.length} source files.`);
  console.log(`SDK import files: ${sdkImports.length}`);
  for (const filePath of sdkImports.slice(0, 20)) {
    console.log(`- ${path.relative(root, filePath)}`);
  }

  if (quality.advisories.length > 0) {
    console.log("");
    console.log(
      args.strict ? "Validation strict issues:" : "Validation advisories:",
    );
    for (const advisory of quality.advisories) {
      console.log(`- ${advisory}`);
    }
  }

  if (args.strict) {
    issues.push(...quality.advisories);
  }

  if (issues.length > 0) {
    console.log("");
    console.log("Validation issues:");
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
  }

  let scriptsOk = true;
  if (args.runBuild) {
    const packageManager = detectPackageManager(root);
    if (scripts.typecheck) {
      scriptsOk = runScript(root, packageManager, "typecheck") && scriptsOk;
    }
    if (scripts.build) {
      scriptsOk = runScript(root, packageManager, "build") && scriptsOk;
    }
  }

  if (issues.length > 0 || !scriptsOk) {
    process.exit(1);
  }
  console.log("Semaphor data app validation passed.");
}

main();
