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

function hasEmptyState(content) {
  return /(?:records|rows|data|items)\.length|rowCount|No (?:data|rows?|results?)|empty state|isEmpty|\bEmpty\b/i.test(
    content,
  );
}

function scanSourceQuality(root, sourceFiles) {
  const advisories = [];
  let usesDataAppSdkHooks = false;
  let hasProvider = false;
  let hasRootDevtools = false;
  let hasProviderDebugBridge = false;
  let sqlQueryCount = 0;
  let governedQueryCount = 0;
  let totalSemaphorSpecCount = 0;
  let semaphorModuleSpecCount = 0;
  let nonSemaphorModuleSpecCount = 0;
  let visibleFilterSpecCount = 0;
  let hasCardFilterAffordance = false;
  let hasNativeDateInput = false;
  const recordsQueryNames = collectRecordsQueryNames(sourceFiles);
  const hasDatePickerStack =
    fs.existsSync(path.join(root, "src", "components", "ui", "calendar.tsx")) ||
    fs.existsSync(path.join(root, "components", "ui", "calendar.tsx"));

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const location = formatLocation(root, filePath);
    sqlQueryCount += countMatches(content, /\bsemaphor\.sql\s*\(/g);
    governedQueryCount += countMatches(
      content,
      /\bsemaphor\.(?:metric|records|analysis|matrix)\s*\(/g,
    );
    const semaphorSpecCount = countMatches(
      content,
      /\bsemaphor\.(?:metric|records|analysis|matrix|inputOptions|sql|filter|control|sqlParam)(?:<[^>()]+>)?\s*\(/g,
    );
    totalSemaphorSpecCount += semaphorSpecCount;
    visibleFilterSpecCount += countMatches(
      content,
      /\bsemaphor\.(?:filter|control|sqlParam)(?:<[^>()]+>)?\s*\(/g,
    );
    if (
      /\b(?:Filtered by|filters? applied|appliedFilters?|activeFilters?|filterChips?|Affects)\b/i.test(
        content,
      )
    ) {
      hasCardFilterAffordance = true;
    }
    if (/\btype\s*=\s*["']date["']/.test(content)) {
      hasNativeDateInput = true;
    }
    if (/^src[/\\]semaphor[/\\]/.test(location)) {
      semaphorModuleSpecCount += semaphorSpecCount;
    } else {
      nonSemaphorModuleSpecCount += semaphorSpecCount;
    }

    for (const missingId of semaphorBuilderCallsMissingId(content)) {
      advisories.push(
        `${location}: semaphor.${missingId.builder}(...) query specs should include a stable id so DevTools, validation, and reviewer traces can map runtime queries back to generated views.`,
      );
    }

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
    const recordsOptionQuery = recordsQueryUsedForOptionDerivation(
      content,
      recordsQueryNames,
    );
    if (recordsOptionQuery) {
      advisories.push(
        `${location}: ${recordsOptionQuery} appears to use semaphor.records(...) as hidden filter option data. Use semaphor.inputOptions(...) for remote select/combobox choices, or document the SDK gap if records are required.`,
      );
    }
    if (content.includes("SemaphorDataAppProvider")) {
      hasProvider = true;
      if (/\bdebug\s*=\s*\{[^}]*exposeWindowBridge/s.test(content)) {
        hasProviderDebugBridge = true;
      }
      const usesServerUrlOverride =
        /\bVITE_SEMAPHOR_SERVER_URL\b/.test(content) ||
        /\bSEMAPHOR_SERVER_URL\b/.test(content);
      if (
        (!usesServerUrlOverride && /\bapiBaseUrl\s*=/.test(content)) ||
        /\bVITE_SEMAPHOR_API_BASE_URL\b/.test(content) ||
        /\bSEMAPHOR_API_BASE_URL\b/.test(content)
      ) {
        advisories.push(
          `${location}: generated apps should rely on SemaphorDataAppProvider token URL inference by default. Pass apiBaseUrl only for explicit local or self-hosted routing overrides.`,
        );
      }
    }
    if (/<SemaphorDevtools\b/.test(content)) {
      hasRootDevtools = true;
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
      if (!hasEmptyState(content)) {
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

    if (
      /\b(?:BarChart|PieChart|Bar\b|Pie\b|Donut|RadialBarChart)\b/.test(
        content,
      ) &&
      /\buseSemaphorQuery\b/.test(content) &&
      /\b(?:result\.)?records\b/.test(content)
    ) {
      advisories.push(
        `${location}: category bar/pie chart appears to render directly from records. Make sure the backing Semaphor query is grouped/aggregate-shaped for the chart, not a bounded raw-row detail query.`,
      );
    }
  }

  if (usesDataAppSdkHooks && !hasProvider) {
    advisories.push(
      "Data App SDK queries were found, but no SemaphorDataAppProvider import/usage was found. Queries stay idle without a runtime/provider unless the app supplies one through its own wrapper.",
    );
  }

  if (usesDataAppSdkHooks && hasProvider && !hasRootDevtools) {
    advisories.push(
      "Generated local/dev Data Apps should mount one root <SemaphorDevtools /> under SemaphorDataAppProvider so authors and agents can inspect query and input traces. Do not add per-card wrappers.",
    );
  }

  if (usesDataAppSdkHooks && hasProvider && !hasProviderDebugBridge) {
    advisories.push(
      "Generated local/dev Data Apps should pass SemaphorDataAppProvider debug={enableDevtools ? { exposeWindowBridge: true } : false} so browser/eval agents can inspect window.__SEMAPHOR_DEVTOOLS__.snapshot(). Keep this gated to local development or author preview.",
    );
  }

  if (visibleFilterSpecCount > 0 && !hasCardFilterAffordance) {
    advisories.push(
      "Visible filters were found, but no card-level applied-filter affordance was detected. Cards/charts should show compact active filter chips or muted text for filters actually applied to that card's query.",
    );
  }

  if (hasNativeDateInput && hasDatePickerStack) {
    advisories.push(
      "Native date inputs were found even though a host date-picker/calendar component appears available. Prefer the app's real dashboard date-range control unless the user explicitly chose native date fields.",
    );
  }

  if (sqlQueryCount > 0 && governedQueryCount === 0) {
    advisories.push(
      "The app uses semaphor.sql(...) but no governed semaphor.metric(...), semaphor.records(...), semaphor.analysis(...), or semaphor.matrix(...) queries. For dashboards, try the governed semantic path first and keep SQL only for explicitly unsupported views with documented fallback reasons.",
    );
  }

  if (totalSemaphorSpecCount >= 4 && semaphorModuleSpecCount === 0) {
    advisories.push(
      "Broad Data Apps define several Semaphor specs but no src/semaphor/* module. Move sources, field refs, shared filters, input options, and query specs into src/semaphor/* so DevTools traces and reviewers can map visuals back to query contracts.",
    );
  }

  if (totalSemaphorSpecCount >= 4 && nonSemaphorModuleSpecCount > 2) {
    advisories.push(
      `Broad Data Apps should not keep ${nonSemaphorModuleSpecCount} Semaphor specs outside src/semaphor/* modules. Components should import specs and own hook wiring/rendering, not source/query definitions.`,
    );
  }

  return { advisories };
}

function collectRecordsQueryNames(sourceFiles) {
  const names = new Set();
  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const match of content.matchAll(
      /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*semaphor\.records\s*\(/g,
    )) {
      names.add(match[1]);
    }
  }
  return names;
}

function recordsQueryUsedForOptionDerivation(content, recordsQueryNames) {
  if (!recordsQueryNames.size || !/\buseSemaphorQuery\s*\(/.test(content)) {
    return undefined;
  }
  const optionContext =
    /\b(?:Select|Combobox|MultiSelect|Command|Popover)\b/.test(content) ||
    /\b[A-Za-z_$][\w$]*(?:Options|Items)\b/.test(content) ||
    /\b(?:options|items)\s*=\s*useMemo\b/.test(content);
  if (!optionContext) {
    return undefined;
  }
  for (const name of recordsQueryNames) {
    if (
      new RegExp(
        `\\buseSemaphorQuery\\s*\\(\\s*${escapeRegExp(name)}\\b`,
      ).test(content)
    ) {
      return name;
    }
  }
  return undefined;
}

function semaphorBuilderCallsMissingId(content) {
  const missing = [];
  const pattern =
    /\bsemaphor\.(metric|records|analysis|matrix|inputOptions|sql)(?:<[^>()]+>)?\s*\(\s*\{/g;
  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = content.indexOf("});", start);
    const body = content.slice(start, end === -1 ? start + 1200 : end);
    if (!/\bid\s*:/.test(body)) {
      missing.push({ builder: match[1] });
    }
  }
  return missing;
}

function countMatches(content, pattern) {
  return Array.from(content.matchAll(pattern)).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
