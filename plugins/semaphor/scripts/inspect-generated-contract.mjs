import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
  readGeneratedContractValidationPayload,
} from "./materialize-generated-contract.mjs";

export function inspectGeneratedDataAppAuthoringState({
  workspaceDir,
  outputDir,
  validation,
}) {
  const workspaceRoot = path.resolve(workspaceDir);
  const { manifest, generatedFiles } =
    readGeneratedContractValidationPayload(workspaceRoot, outputDir);
  const generatedContract = {
    outputDir: outputDir || DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
    manifestPath: path.join(
      outputDir || DEFAULT_GENERATED_CONTRACT_OUTPUT_DIR,
      "contract.manifest.json",
    ),
    generatedFileCount: Object.keys(generatedFiles).length,
    digest: typeof manifest?.generatedContentHash === "string"
      ? manifest.generatedContentHash
      : undefined,
  };
  const codegenSummary = manifest?.codegenSummary;
  if (!isRecord(codegenSummary) || !Array.isArray(codegenSummary.views)) {
    return blockedState({
      generatedContract,
      issue: {
        code: "missing_codegen_summary",
        message:
          "Generated contract manifest must include codegenSummary before iterative authoring can inspect current app state.",
        path: "manifest.codegenSummary",
      },
    });
  }
  const uiMapping = scanUiMarkers(workspaceRoot, codegenSummary);
  const validationIssues = validation?.ok === false
    ? issueRecords(validation.issues, {
        code: "generated_contract_validation_failed",
        message: "Generated contract validation failed.",
      })
    : [];
  const validationWarnings = issueRecords(validation?.warnings, {
    code: "generated_contract_validation_warning",
    message: "Generated contract validation returned a warning.",
  });
  const currentAuthoringState = {
    schemaVersion: "semaphor-data-app-current-authoring-state/v1",
    inspection: {
      status: validationIssues.length > 0 ? "blocked" : "inspected",
      source: "generated_contract",
      generatedContract,
      issues: validationIssues,
      warnings: [
        ...validationWarnings,
        ...unmappedWarnings(codegenSummary, uiMapping),
      ],
    },
    app: {
      title: codegenSummary.title,
      ...(codegenSummary.purpose ? { purpose: codegenSummary.purpose } : {}),
      ...(codegenSummary.userGoal ? { userGoal: codegenSummary.userGoal } : {}),
    },
    sources: (codegenSummary.sources || []).map((source) => ({
      ...(source.sourceKey ? { sourceKey: source.sourceKey } : {}),
      kind: source.kind,
      ...(source.domainId ? { domainId: source.domainId } : {}),
      ...(source.name ? { datasetName: source.name } : {}),
      ...(source.label ? { label: source.label } : {}),
      ...(source.datasetRole ? { datasetRole: source.datasetRole } : {}),
    })),
    views: (codegenSummary.views || []).map((view) =>
      authoringView(view, uiMapping)
    ),
    inputs: (codegenSummary.inputs || []).map((input) =>
      authoringInput(input, uiMapping)
    ),
    unsupportedInsights: (codegenSummary.unsupportedInsights || []).map((insight) => ({
      title: insight.title,
      reason: insight.reason,
      suggestedModelingFix: insight.suggestedModelingFix,
    })),
    planning: {
      currentPlan: {
        sources: (codegenSummary.sources || []).map((source) => ({
          kind: source.kind,
          domainId: source.domainId,
        })),
        views: (codegenSummary.views || []).map((view) => ({ id: view.id })),
        inputs: (codegenSummary.inputs || []).map(planningInput),
      },
    },
  };
  return {
    currentAuthoringState,
    validationPayload: { manifest, generatedFiles },
  };
}

function blockedState({ generatedContract, issue }) {
  return {
    currentAuthoringState: {
      schemaVersion: "semaphor-data-app-current-authoring-state/v1",
      inspection: {
        status: "blocked",
        source: "generated_contract",
        generatedContract,
        issues: [issue],
        warnings: [],
      },
      app: {},
      sources: [],
      views: [],
      inputs: [],
      unsupportedInsights: [],
      planning: {
        currentPlan: { sources: [], views: [], inputs: [] },
      },
    },
    validationPayload: undefined,
  };
}

function planningInput(input) {
  return {
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(typeof input.serverSide === "boolean"
      ? { serverSide: input.serverSide }
      : {}),
    appliesToViewIds: input.appliesToViewIds || [],
    ...(input.fieldRef ? { fieldRef: input.fieldRef } : {}),
    ...(input.relationshipHint ? { relationshipHint: input.relationshipHint } : {}),
    ...(Array.isArray(input.bindings) && input.bindings.length
      ? {
          bindings: input.bindings.map((binding) => ({
            appliesToViewIds: binding.appliesToViewIds || [],
            fieldRef: binding.fieldRef,
            ...(binding.relationshipHint
              ? { relationshipHint: binding.relationshipHint }
              : {}),
          })),
        }
      : {}),
    ...(input.optionQuery ? { optionQuery: planningOptionQuery(input) } : {}),
  };
}

function planningOptionQuery(input) {
  const optionQuery = input.optionQuery;
  if (!optionQuery?.source || !optionQuery.valueFieldRef || !optionQuery.labelFieldRef) {
    return undefined;
  }
  const filterFieldRef = optionQuery.filterFieldRef || input.fieldRef;
  if (!filterFieldRef) {
    return undefined;
  }
  return {
    builder: "semaphor.inputOptions",
    source: optionQuery.source,
    filterFieldRef,
    valueFieldRef: optionQuery.valueFieldRef,
    labelFieldRef: optionQuery.labelFieldRef,
    ...(optionQuery.population ? { population: optionQuery.population } : {}),
    ...(optionQuery.dependencies ? { dependencies: optionQuery.dependencies } : {}),
    spec: {
      ...(optionQuery.spec || {}),
      kind: "inputOptions",
      inputId: optionQuery.spec?.inputId || input.id,
      source: optionQuery.source,
      labelField: optionQuery.labelFieldRef,
      valueField: optionQuery.valueFieldRef,
      ...(optionQuery.population ? { population: optionQuery.population } : {}),
      ...(optionQuery.dependencies ? { dependencies: optionQuery.dependencies } : {}),
      ...(typeof optionQuery.limit === "number" ? { limit: optionQuery.limit } : {}),
    },
  };
}

function authoringView(view, uiMapping) {
  const visualType = view.visualSpec?.visualType || view.visual;
  return {
    viewId: view.id,
    ...(view.title ? { title: view.title } : {}),
    ...(visualType ? { visualType } : {}),
    ...(view.queryKind ? { queryKind: view.queryKind } : {}),
    ...(view.sdkBuilder ? { sdkBuilder: view.sdkBuilder } : {}),
    sourceKeys: uniqueStrings([
      ...(view.sourcePresentation?.sourceKeys || []),
      ...(view.computation?.sourceKeys || []),
      sourceKeyFromSdkSpec(view),
    ]),
    fieldNames: uniqueStrings([
      ...(view.fields || []).map((field) => field.name),
      ...(view.computation?.fieldNames || []),
    ]),
    ...metricBindingKeysForView(view),
    ...(view.validation?.status ? { validationStatus: view.validation.status } : {}),
    aliases: aliasesForRecord({
      id: view.id,
      title: view.title,
      type: visualType,
    }),
    uiMapping: {
      componentPaths: uiMapping.viewComponentPaths[view.id] || [],
      markers: uiMapping.viewMarkers[view.id] || [],
    },
  };
}

function authoringInput(input, uiMapping) {
  return {
    inputId: input.id,
    ...(input.label ? { label: input.label } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(typeof input.serverSide === "boolean" ? { serverSide: input.serverSide } : {}),
    appliesToViewIds: input.appliesToViewIds || [],
    ...(input.fieldRef?.name ? { fieldName: input.fieldRef.name } : {}),
    ...(input.fieldRef?.sourceKey ? { sourceKey: input.fieldRef.sourceKey } : {}),
    ...(input.optionQuery?.id ? { optionQueryId: input.optionQuery.id } : {}),
    aliases: aliasesForRecord({
      id: input.id,
      title: input.label,
      type: input.type,
    }),
    uiMapping: {
      componentPaths: uiMapping.inputComponentPaths[input.id] || [],
      markers: uiMapping.inputMarkers[input.id] || [],
    },
  };
}

function sourceKeyFromSdkSpec(view) {
  const source = view.sdkSpec?.spec?.source;
  return typeof source?.sourceKey === "string" ? source.sourceKey : undefined;
}

function metricBindingKeysForView(view) {
  const keys = uniqueStrings(
    Array.isArray(view.metricBindingKeys) ? view.metricBindingKeys : [],
  );
  return keys.length > 0 ? { metricBindingKeys: keys } : {};
}

function scanUiMarkers(workspaceRoot, codegenSummary) {
  const viewComponentPaths = {};
  const inputComponentPaths = {};
  const viewMarkers = {};
  const inputMarkers = {};
  const realWorkspaceRoot = fs.realpathSync(workspaceRoot);
  const files = collectUiSourceFiles({
    root: path.join(workspaceRoot, "src"),
    workspaceRoot,
    realWorkspaceRoot,
  });
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(workspaceRoot, filePath);
    for (const view of codegenSummary.views || []) {
      const marker = markerFound(text, "data-semaphor-view-id", view.id);
      if (marker) {
        appendMapValue(viewComponentPaths, view.id, relativePath);
        appendMapValue(viewMarkers, view.id, marker);
      }
    }
    for (const input of codegenSummary.inputs || []) {
      const marker = markerFound(text, "data-semaphor-input-id", input.id);
      if (marker) {
        appendMapValue(inputComponentPaths, input.id, relativePath);
        appendMapValue(inputMarkers, input.id, marker);
      }
    }
  }
  return {
    viewComponentPaths,
    inputComponentPaths,
    viewMarkers,
    inputMarkers,
  };
}

function collectUiSourceFiles({ root, workspaceRoot, realWorkspaceRoot }) {
  if (!fs.existsSync(root)) {
    return [];
  }
  assertPlainWorkspacePath({
    candidatePath: root,
    workspaceRoot,
    realWorkspaceRoot,
    kind: "directory",
    label: "Data App UI source directory",
    allowRoot: true,
  });
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "semaphor" || entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(root, entry.name);
    assertPlainWorkspacePath({
      candidatePath: entryPath,
      workspaceRoot,
      realWorkspaceRoot,
      kind: entry.isDirectory() ? "directory" : "file",
      label: "Data App UI source path",
    });
    if (entry.isDirectory()) {
      files.push(...collectUiSourceFiles({
        root: entryPath,
        workspaceRoot,
        realWorkspaceRoot,
      }));
    } else if (isUiSourceFileName(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function assertPlainWorkspacePath({
  candidatePath,
  workspaceRoot,
  realWorkspaceRoot,
  kind,
  label,
  allowRoot = false,
}) {
  const resolvedCandidate = path.resolve(candidatePath);
  if (!allowRoot && !isPathInside(resolvedCandidate, workspaceRoot)) {
    throw new Error(`${label} escapes workspaceDir.`);
  }
  const stat = fs.lstatSync(resolvedCandidate);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not contain symlinks inside workspaceDir.`);
  }
  if (kind === "directory" && !stat.isDirectory()) {
    throw new Error(`${label} must be a directory.`);
  }
  if (kind === "file" && !stat.isFile()) {
    throw new Error(`${label} must be a file.`);
  }
  const realCandidate = fs.realpathSync(resolvedCandidate);
  if (realCandidate !== realWorkspaceRoot && !isPathInside(realCandidate, realWorkspaceRoot)) {
    throw new Error(`${label} escapes workspaceDir.`);
  }
}

function isPathInside(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isUiSourceFileName(fileName) {
  return [".tsx", ".jsx", ".ts", ".js"].includes(path.extname(fileName));
}

function markerFound(text, markerName, id) {
  const candidates = [
    `${markerName}="${id}"`,
    `${markerName}='${id}'`,
    `${markerName}={${JSON.stringify(id)}}`,
    `${markerName}={\"${id}\"}`,
    `${markerName}={'${id}'}`,
  ];
  if (markerName === "data-semaphor-view-id") {
    candidates.push(
      `semaphorViewMarkerProps(${JSON.stringify(id)})`,
      `semaphorViewMarkerProps('${id}')`,
    );
    const semaphorViewCardMarker = semaphorViewCardMarkerFound(text, id);
    if (semaphorViewCardMarker) {
      return semaphorViewCardMarker;
    }
  }
  if (markerName === "data-semaphor-input-id") {
    candidates.push(
      `semaphorInputMarkerProps(${JSON.stringify(id)})`,
      `semaphorInputMarkerProps('${id}')`,
    );
  }
  return candidates.find((candidate) => text.includes(candidate));
}

function semaphorViewCardMarkerFound(text, id) {
  const escapedId = escapeRegExp(id);
  const patterns = [
    new RegExp(`<SemaphorViewCard\\b[^>]*\\bviewId="${escapedId}"`, "u"),
    new RegExp(`<SemaphorViewCard\\b[^>]*\\bviewId='${escapedId}'`, "u"),
    new RegExp(`<SemaphorViewCard\\b[^>]*\\bviewId=\\{"${escapedId}"\\}`, "u"),
    new RegExp(`<SemaphorViewCard\\b[^>]*\\bviewId=\\{['"]${escapedId}['"]\\}`, "u"),
  ];
  return patterns.some((pattern) => pattern.test(text))
    ? `SemaphorViewCard:${id}`
    : "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function unmappedWarnings(codegenSummary, uiMapping) {
  const warnings = [];
  for (const view of codegenSummary.views || []) {
    if (!uiMapping.viewComponentPaths[view.id]?.length) {
      warnings.push({
        code: "unmapped_view_component",
        message: `Generated view ${view.id} was not mapped to a rendered component marker.`,
        path: `views.${view.id}`,
      });
    }
  }
  for (const input of codegenSummary.inputs || []) {
    if (!uiMapping.inputComponentPaths[input.id]?.length) {
      warnings.push({
        code: "unmapped_input_component",
        message: `Generated input ${input.id} was not mapped to a rendered input marker.`,
        path: `inputs.${input.id}`,
      });
    }
  }
  return warnings;
}

function aliasesForRecord({ id, title, type }) {
  return uniqueStrings([
    id,
    normalizeLabel(id),
    ...(title ? [title, normalizeLabel(title)] : []),
    ...(title && type ? [`${title} ${type}`, normalizeLabel(`${title} ${type}`)] : []),
  ]);
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
}

function issueRecords(issues, fallback) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return [];
  }
  return issues.map((issue) => ({
    code: issue.code || fallback.code,
    message: issue.message || fallback.message,
    ...(issue.path ? { path: issue.path } : {}),
  }));
}

function appendMapValue(map, key, value) {
  if (!map[key]) {
    map[key] = [];
  }
  if (!map[key].includes(value)) {
    map[key].push(value);
  }
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter(Boolean),
    ),
  );
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
