export const CODEGEN_SUMMARY_SCHEMA_VERSION = 'semaphor-data-app-codegen-summary/v1';
export const CODEGEN_SUMMARY_VALIDATOR_VERSION =
  'semaphor-data-app-codegen-summary-validator/v2';

const CODEGEN_QUERY_KINDS = new Set([
  'metric',
  'records',
  'matrix',
  'analysis',
  'sql_fallback',
]);

const CODEGEN_SDK_BUILDERS = new Set([
  'semaphor.metric',
  'semaphor.records',
  'semaphor.matrix',
  'semaphor.analysis',
  'semaphor.sql',
]);

const CODEGEN_ANALYSIS_DRIVER_MODES = new Set([
  'absolute_delta',
  'largest_negative',
  'largest_positive',
  'positive_and_negative',
  'all',
]);

const CODEGEN_VISUAL_TYPES = new Set([
  'kpi',
  'line_chart',
  'bar_chart',
  'stacked_bar_chart',
  'pie_chart',
  'donut_chart',
  'area_chart',
  'table',
  'matrix',
  'narrative',
  'text_block',
  'custom',
]);

const CODEGEN_UNSUPPORTED_REASONS = new Set([
  'missing_measure',
  'missing_dimension',
  'missing_date',
  'missing_relationship',
  'missing_semantic_role',
  'missing_current_app_state',
  'unsupported_change_intent',
  'ambiguous_field_grounding',
  'invalid_ranker_output',
  'latest_snapshot_selector_not_modeled',
  'unsupported_grain',
  'requires_sql_escape_hatch',
  'unsupported_sdk_capability',
]);

export function assertValidCodegenSummary(value) {
  const issues = validateCodegenSummary(value);
  if (issues.length > 0) {
    throw new Error(`Invalid Semaphor codegenSummary:\n- ${issues.join('\n- ')}`);
  }
}

export function validateCodegenSummary(value) {
  const issues = [];
  const summary = asRecord(value);
  if (!summary) {
    return ['Plan artifact must be a Semaphor codegenSummary object.'];
  }
  if (summary.schemaVersion !== CODEGEN_SUMMARY_SCHEMA_VERSION) {
    issues.push(
      `schemaVersion must be ${CODEGEN_SUMMARY_SCHEMA_VERSION}.`,
    );
  }
  if (typeof summary.title !== 'string' || !summary.title.trim()) {
    issues.push('title is required.');
  }
  for (const [fieldName, fieldValue] of [
    ['sources', summary.sources],
    ['inputs', summary.inputs],
    ['views', summary.views],
    ['filterContracts', summary.filterContracts],
  ]) {
    if (!Array.isArray(fieldValue)) {
      issues.push(`${fieldName} must be an array.`);
    }
  }
  issues.push(...validateImplementationChecklist(summary.implementationChecklist));
  if (Array.isArray(summary.sources)) {
    summary.sources.forEach((source, index) => {
      issues.push(...validateSource(source, `sources.${index}`));
    });
  }
  if (Array.isArray(summary.inputs)) {
    summary.inputs.forEach((input, index) => {
      issues.push(...validateInput(input, `inputs.${index}`));
    });
  }
  if (Array.isArray(summary.views)) {
    summary.views.forEach((view, index) => {
      issues.push(...validateView(view, `views.${index}`));
    });
  }
  if (Array.isArray(summary.filterContracts)) {
    summary.filterContracts.forEach((filterContract, index) => {
      issues.push(...validateFilterContract(filterContract, `filterContracts.${index}`));
    });
  }
  if (summary.unsupportedInsights !== undefined) {
    if (!Array.isArray(summary.unsupportedInsights)) {
      issues.push('unsupportedInsights must be an array.');
    } else {
      summary.unsupportedInsights.forEach((unsupportedInsight, index) => {
        issues.push(...validateUnsupportedInsight(unsupportedInsight, `unsupportedInsights.${index}`));
      });
    }
  }
  return issues;
}

function validateSource(value, path) {
  const source = asRecord(value);
  if (!source) {
    return [`${path} must be an object.`];
  }
  if (source.kind === 'semantic') {
    if (
      typeof source.domainId === 'string' &&
      source.domainId.trim() &&
      typeof source.datasetName === 'string' &&
      source.datasetName.trim()
    ) {
      return [];
    }
    return [`${path} must include sourceKey or a supported source identity.`];
  }
  if (typeof source.sourceKey === 'string' && source.sourceKey.trim()) {
    return [];
  }
  if (
    source.kind === 'physical' &&
    typeof source.tableName === 'string' &&
    source.tableName.trim() &&
    typeof source.connectionId === 'string' &&
    source.connectionId.trim()
  ) {
    return [];
  }
  if (
    source.kind === 'sql' &&
    typeof source.connectionId === 'string' &&
    source.connectionId.trim()
  ) {
    return [];
  }
  return [`${path} must include sourceKey or a supported source identity.`];
}

function validateImplementationChecklist(value) {
  const checklist = asRecord(value);
  if (!checklist) {
    return ['implementationChecklist must be an object.'];
  }
  const issues = [];
  for (const key of [
    'requiredDevtools',
    'requiredInputOptions',
    'filterScopeByInput',
    'bindingsByView',
    'validationCommands',
    'browserSmokeChecks',
  ]) {
    if (!(key in checklist)) {
      issues.push(`implementationChecklist.${key} is required.`);
    }
  }
  const devtools = asRecord(checklist.requiredDevtools);
  if (!devtools) {
    issues.push('implementationChecklist.requiredDevtools must be an object.');
  } else if (typeof devtools.mountRootDevtools !== 'boolean') {
    issues.push('implementationChecklist.requiredDevtools.mountRootDevtools must be a boolean.');
  }
  if (!Array.isArray(checklist.requiredInputOptions)) {
    issues.push('implementationChecklist.requiredInputOptions must be an array.');
  }
  if (!Array.isArray(checklist.filterScopeByInput)) {
    issues.push('implementationChecklist.filterScopeByInput must be an array.');
  }
  if (!asRecord(checklist.bindingsByView)) {
    issues.push('implementationChecklist.bindingsByView must be an object.');
  }
  if (!arrayOfStrings(checklist.validationCommands)) {
    issues.push('implementationChecklist.validationCommands must be an array of strings.');
  }
  if (!arrayOfStrings(checklist.browserSmokeChecks)) {
    issues.push('implementationChecklist.browserSmokeChecks must be an array of strings.');
  }
  return issues;
}

function validateInput(value, path) {
  const input = asRecord(value);
  if (!input) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (typeof input.id !== 'string' || !input.id.trim()) {
    issues.push(`${path}.id is required.`);
  }
  if (input.fieldRef !== undefined) {
    issues.push(...validateFieldRef(input.fieldRef, `${path}.fieldRef`));
  }
  issues.push(...validateOptionQuery(input.optionQuery, `${path}.optionQuery`));
  if (!arrayOfStrings(input.appliesToViewIds)) {
    issues.push(`${path}.appliesToViewIds must be an array of strings.`);
  }
  if (input.bindings !== undefined) {
    if (!Array.isArray(input.bindings)) {
      issues.push(`${path}.bindings must be an array.`);
    } else {
      input.bindings.forEach((binding, index) => {
        issues.push(...validateBinding(binding, `${path}.bindings.${index}`));
      });
    }
  }
  return issues;
}

function validateView(value, path) {
  const view = asRecord(value);
  if (!view) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (typeof view.id !== 'string' || !view.id.trim()) {
    issues.push(`${path}.id is required.`);
  }
  if (view.visualSpec !== undefined) {
    issues.push(...validateVisualSpec(view.visualSpec, `${path}.visualSpec`));
  }
  if (view.computation !== undefined) {
    issues.push(...validateComputation(view.computation, `${path}.computation`));
  }
  if (!Array.isArray(view.fields)) {
    if (!isPresentationCodegenView(view)) {
      issues.push(`${path}.fields must be an array.`);
    }
    if (view.sdkSpec !== undefined || view.sdkBuilder !== undefined) {
      issues.push(`${path}.fields must be an array for executable views.`);
    }
    return issues;
  }
  view.fields.forEach((field, index) => {
    issues.push(...validateFieldRef(field, `${path}.fields.${index}`));
  });
  if (isPresentationCodegenView(view) && view.sdkSpec === undefined) {
    return issues;
  }
  if (!CODEGEN_QUERY_KINDS.has(view.queryKind)) {
    issues.push(`${path}.queryKind must be a supported codegen query kind.`);
  }
  if (view.sdkBuilder !== undefined && !CODEGEN_SDK_BUILDERS.has(view.sdkBuilder)) {
    issues.push(`${path}.sdkBuilder must be a supported SDK builder.`);
  }
  const computation = asRecord(view.computation);
  if (
    computation?.kind === 'server_query' &&
    CODEGEN_QUERY_KINDS.has(view.queryKind) &&
    CODEGEN_QUERY_KINDS.has(computation.queryKind) &&
    computation.queryKind !== view.queryKind
  ) {
    issues.push(`${path}.computation.queryKind must match queryKind.`);
  }
  issues.push(...validateSdkSpec({
    value: view.sdkSpec,
    path: `${path}.sdkSpec`,
    queryKind: typeof view.queryKind === 'string' ? view.queryKind : undefined,
    sdkBuilder: typeof view.sdkBuilder === 'string' ? view.sdkBuilder : undefined,
  }));
  return issues;
}

function validateFilterContract(value, path) {
  const filterContract = asRecord(value);
  if (!filterContract) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (typeof filterContract.inputId !== 'string' || !filterContract.inputId.trim()) {
    issues.push(`${path}.inputId is required.`);
  }
  if (!arrayOfStrings(filterContract.appliesToViewIds)) {
    issues.push(`${path}.appliesToViewIds must be an array of strings.`);
  }
  if (!arrayOfStrings(filterContract.notAppliedToViewIds)) {
    issues.push(`${path}.notAppliedToViewIds must be an array of strings.`);
  }
  if (!Array.isArray(filterContract.bindings)) {
    issues.push(`${path}.bindings must be an array.`);
  } else {
    const appliesToViewIds = arrayOfStrings(filterContract.appliesToViewIds)
      ? new Set(filterContract.appliesToViewIds)
      : undefined;
    const notAppliedToViewIds = arrayOfStrings(filterContract.notAppliedToViewIds)
      ? new Set(filterContract.notAppliedToViewIds)
      : undefined;
    filterContract.bindings.forEach((binding, index) => {
      issues.push(...validateFilterContractBinding({
        value: binding,
        path: `${path}.bindings.${index}`,
        appliesToViewIds,
        notAppliedToViewIds,
      }));
    });
  }
  if (filterContract.fieldRef !== undefined) {
    issues.push(...validateFieldRef(filterContract.fieldRef, `${path}.fieldRef`));
  }
  issues.push(...validateOptionQuery(filterContract.optionQuery, `${path}.optionQuery`));
  return issues;
}

function isPresentationCodegenView(view) {
  const computation = asRecord(view.computation);
  const visualSpec = asRecord(view.visualSpec);
  return (
    computation?.kind === 'presentation_only' ||
    computation?.kind === 'derived' ||
    computation?.kind === 'unsupported' ||
    view.visual === 'text_block' ||
    visualSpec?.visualType === 'text_block'
  );
}

function validateBinding(value, path) {
  const binding = asRecord(value);
  if (!binding) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (!arrayOfStrings(binding.appliesToViewIds)) {
    issues.push(`${path}.appliesToViewIds must be an array of strings.`);
  }
  issues.push(...validateFieldRef(binding.fieldRef, `${path}.fieldRef`));
  return issues;
}

function validateFilterContractBinding({
  value,
  path,
  appliesToViewIds,
  notAppliedToViewIds,
}) {
  const binding = asRecord(value);
  if (!binding) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (typeof binding.viewId !== 'string' || !binding.viewId.trim()) {
    issues.push(`${path}.viewId is required.`);
  } else {
    if (appliesToViewIds && !appliesToViewIds.has(binding.viewId)) {
      issues.push(`${path}.viewId must be included in appliesToViewIds.`);
    }
    if (notAppliedToViewIds?.has(binding.viewId)) {
      issues.push(`${path}.viewId must not be listed in notAppliedToViewIds.`);
    }
  }
  issues.push(...validateFieldRef(binding.fieldRef, `${path}.fieldRef`));
  return issues;
}

function validateOptionQuery(value, path) {
  if (value === undefined) {
    return [];
  }
  const optionQuery = asRecord(value);
  if (!optionQuery) {
    return [`${path} must be an object.`];
  }
  const issues = [
    ...validateOptionalFieldRef(optionQuery.valueFieldRef, `${path}.valueFieldRef`),
    ...validateOptionalFieldRef(optionQuery.labelFieldRef, `${path}.labelFieldRef`),
    ...validateOptionalFieldRef(optionQuery.filterFieldRef, `${path}.filterFieldRef`),
    ...validateNonMeasureOptionField(optionQuery.valueFieldRef, `${path}.valueFieldRef`),
    ...validateNonMeasureOptionField(optionQuery.labelFieldRef, `${path}.labelFieldRef`),
    ...validateNonMeasureOptionField(optionQuery.filterFieldRef, `${path}.filterFieldRef`),
  ];
  if (optionQuery.builder !== 'semaphor.inputOptions') {
    issues.push(`${path}.builder must be semaphor.inputOptions.`);
  }
  if (typeof optionQuery.sourceKey !== 'string' && optionQuery.source === undefined) {
    issues.push(`${path} must include source or sourceKey.`);
  }
  if (optionQuery.source !== undefined) {
    issues.push(...validateSource(optionQuery.source, `${path}.source`));
  }
  if (!asRecord(optionQuery.valueFieldRef)) {
    issues.push(`${path}.valueFieldRef is required.`);
  }
  if (!asRecord(optionQuery.labelFieldRef)) {
    issues.push(`${path}.labelFieldRef is required.`);
  }
  if (
    optionQuery.limit !== undefined &&
    (typeof optionQuery.limit !== 'number' ||
      !Number.isInteger(optionQuery.limit) ||
      optionQuery.limit <= 0)
  ) {
    issues.push(`${path}.limit must be a positive integer.`);
  }
  return issues;
}

function validateSdkSpec({ value, path, queryKind, sdkBuilder }) {
  const sdkSpec = asRecord(value);
  if (!sdkSpec) {
    return [`${path} is required for executable views.`];
  }
  const issues = [];
  if (!CODEGEN_SDK_BUILDERS.has(sdkSpec.builder)) {
    issues.push(`${path}.builder must be a supported SDK builder.`);
    return issues;
  }
  if (sdkBuilder && sdkSpec.builder !== sdkBuilder) {
    issues.push(`${path}.builder must match sdkBuilder.`);
  }
  if (
    queryKind &&
    CODEGEN_QUERY_KINDS.has(queryKind) &&
    sdkSpec.builder !== builderForQueryKind(queryKind)
  ) {
    issues.push(`${path}.builder must match queryKind.`);
  }
  const spec = asRecord(sdkSpec.spec);
  if (!spec) {
    issues.push(`${path}.spec must be an object.`);
    return issues;
  }
  switch (sdkSpec.builder) {
    case 'semaphor.metric':
      issues.push(
        ...validateSdkSourceBearingSpec(spec, path),
        ...validateFieldRefArray(spec.measures, `${path}.spec.measures`),
        ...validateOptionalFieldRef(spec.primaryMeasure, `${path}.spec.primaryMeasure`),
        ...validateOptionalFieldRef(spec.dateField, `${path}.spec.dateField`),
        ...validateOptionalFieldRefArray(spec.dimensions, `${path}.spec.dimensions`),
        ...validateOptionalOrderBy(spec.orderBy, `${path}.spec.orderBy`),
      );
      break;
    case 'semaphor.analysis':
      issues.push(
        ...validateSdkSourceBearingSpec(spec, path),
        ...validateFieldRefArray(spec.measures, `${path}.spec.measures`),
        ...validateOptionalFieldRef(spec.primaryMeasure, `${path}.spec.primaryMeasure`),
        ...validateOptionalFieldRef(spec.dateField, `${path}.spec.dateField`),
        ...validateOptionalFieldRefArray(spec.dimensions, `${path}.spec.dimensions`),
        ...validateOptionalOrderBy(spec.orderBy, `${path}.spec.orderBy`),
        ...validateAnalysisOptions(spec, `${path}.spec`),
      );
      break;
    case 'semaphor.records':
      issues.push(
        ...validateSdkSourceBearingSpec(spec, path),
        ...validateFieldRefArray(spec.fields, `${path}.spec.fields`),
        ...validateOptionalFieldRef(spec.dateField, `${path}.spec.dateField`),
        ...validateOptionalOrderBy(spec.orderBy, `${path}.spec.orderBy`),
      );
      break;
    case 'semaphor.matrix':
      issues.push(
        ...validateSdkSourceBearingSpec(spec, path),
        ...validateMatrixAxisLevels(spec.rows, `${path}.spec.rows`),
        ...validateOptionalMatrixAxisLevels(spec.columns, `${path}.spec.columns`),
        ...validateMatrixValueFields(spec.values, `${path}.spec.values`),
        ...validateOptionalMatrixSort(spec.sort, `${path}.spec.sort`),
      );
      break;
    case 'semaphor.sql':
      issues.push(...validateSdkSourceBearingSpec(spec, path));
      if (asRecord(spec.source)?.kind !== 'sql') {
        issues.push(`${path}.spec.source.kind must be sql.`);
      }
      if (typeof spec.sql !== 'string' || !spec.sql.trim()) {
        issues.push(`${path}.spec.sql is required.`);
      }
      issues.push(...validateOptionalFieldRefArray(spec.fields, `${path}.spec.fields`));
      break;
  }
  return issues;
}

function validateAnalysisOptions(spec, path) {
  const issues = [];
  if (
    spec.driverMode !== undefined &&
    !CODEGEN_ANALYSIS_DRIVER_MODES.has(spec.driverMode)
  ) {
    issues.push(`${path}.driverMode must be a supported analysis driver mode.`);
  }
  if (
    spec.includePopulation !== undefined &&
    typeof spec.includePopulation !== 'boolean'
  ) {
    issues.push(`${path}.includePopulation must be a boolean.`);
  }
  if (spec.calendarContext !== undefined) {
    const calendarContext = asRecord(spec.calendarContext);
    if (!calendarContext) {
      issues.push(`${path}.calendarContext must be an object.`);
    } else {
      if (calendarContext.tz !== undefined && typeof calendarContext.tz !== 'string') {
        issues.push(`${path}.calendarContext.tz must be a string.`);
      }
      if (
        calendarContext.weekStart !== undefined &&
        (typeof calendarContext.weekStart !== 'number' ||
          !Number.isInteger(calendarContext.weekStart) ||
          calendarContext.weekStart < 0 ||
          calendarContext.weekStart > 6)
      ) {
        issues.push(`${path}.calendarContext.weekStart must be an integer between 0 and 6.`);
      }
      const anchor = calendarContext.anchor;
      if (anchor !== undefined && anchor !== 'now') {
        const anchorRecord = asRecord(anchor);
        if (!anchorRecord || typeof anchorRecord.iso !== 'string' || !anchorRecord.iso.trim()) {
          issues.push(`${path}.calendarContext.anchor must be now or { iso }.`);
        }
      }
    }
  }
  return issues;
}

function validateSdkSourceBearingSpec(spec, path) {
  if (!asRecord(spec.source)) {
    return [`${path}.spec.source must be an object.`];
  }
  return validateSource(spec.source, `${path}.spec.source`);
}

function validateFieldRefArray(value, path) {
  const issues = validateNonEmptyArray(value, path);
  if (Array.isArray(value)) {
    value.forEach((fieldRef, index) => {
      issues.push(...validateFieldRef(fieldRef, `${path}.${index}`));
    });
  }
  return issues;
}

function validateOptionalFieldRefArray(value, path) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`${path} must be an array.`];
  }
  const issues = [];
  value.forEach((fieldRef, index) => {
    issues.push(...validateFieldRef(fieldRef, `${path}.${index}`));
  });
  return issues;
}

function validateOptionalOrderBy(value, path) {
  if (value === undefined) {
    return [];
  }
  const orderBy = asRecord(value);
  if (!orderBy) {
    return [`${path} must be an object.`];
  }
  return validateFieldRef(orderBy.field, `${path}.field`);
}

function validateMatrixAxisLevels(value, path) {
  const issues = validateNonEmptyArray(value, path);
  if (Array.isArray(value)) {
    value.forEach((axisLevel, index) => {
      const axisRecord = asRecord(axisLevel);
      if (!axisRecord) {
        issues.push(`${path}.${index} must be an object.`);
        return;
      }
      issues.push(...validateFieldRef(axisRecord.field, `${path}.${index}.field`));
    });
  }
  return issues;
}

function validateOptionalMatrixAxisLevels(value, path) {
  if (value === undefined) {
    return [];
  }
  const issues = [];
  if (!Array.isArray(value)) {
    return [`${path} must be an array.`];
  }
  value.forEach((axisLevel, index) => {
    const axisRecord = asRecord(axisLevel);
    if (!axisRecord) {
      issues.push(`${path}.${index} must be an object.`);
      return;
    }
    issues.push(...validateFieldRef(axisRecord.field, `${path}.${index}.field`));
  });
  return issues;
}

function validateMatrixValueFields(value, path) {
  const issues = validateNonEmptyArray(value, path);
  if (Array.isArray(value)) {
    value.forEach((valueField, index) => {
      const valueRecord = asRecord(valueField);
      if (!valueRecord) {
        issues.push(`${path}.${index} must be an object.`);
        return;
      }
      issues.push(...validateFieldRef(valueRecord.field, `${path}.${index}.field`));
    });
  }
  return issues;
}

function validateOptionalMatrixSort(value, path) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`${path} must be an array.`];
  }
  const issues = [];
  value.forEach((sort, index) => {
    const sortRecord = asRecord(sort);
    if (!sortRecord) {
      issues.push(`${path}.${index} must be an object.`);
      return;
    }
    issues.push(...validateOptionalFieldRef(sortRecord.field, `${path}.${index}.field`));
  });
  return issues;
}

function validateNonEmptyArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${path} must be a non-empty array.`];
  }
  return [];
}

function builderForQueryKind(queryKind) {
  switch (queryKind) {
    case 'metric':
      return 'semaphor.metric';
    case 'records':
      return 'semaphor.records';
    case 'matrix':
      return 'semaphor.matrix';
    case 'analysis':
      return 'semaphor.analysis';
    case 'sql_fallback':
      return 'semaphor.sql';
    default:
      return undefined;
  }
}

function validateOptionalFieldRef(value, path) {
  return value === undefined ? [] : validateFieldRef(value, path);
}

function validateNonMeasureOptionField(value, path) {
  const fieldRef = asRecord(value);
  if (!fieldRef || fieldRef.role !== 'measure') {
    return [];
  }
  return [
    `${path} must not be a measure. Input option fields must be categorical keys or labels so dropdown values are grouped, not aggregated.`,
  ];
}

function validateFieldRef(value, path) {
  const fieldRef = asRecord(value);
  if (!fieldRef) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (typeof fieldRef.name !== 'string' || !fieldRef.name.trim()) {
    issues.push(`${path}.name is required.`);
  }
  if (!fieldRef.source && typeof fieldRef.sourceKey !== 'string') {
    issues.push(`${path} must include source or sourceKey.`);
  }
  return issues;
}

function validateVisualSpec(value, path) {
  const visualSpec = asRecord(value);
  if (!visualSpec) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  if (!CODEGEN_VISUAL_TYPES.has(visualSpec.visualType)) {
    issues.push(`${path}.visualType must be a supported visual type.`);
  }
  if (
    visualSpec.limit !== undefined &&
    (typeof visualSpec.limit !== 'number' ||
      !Number.isInteger(visualSpec.limit) ||
      visualSpec.limit <= 0)
  ) {
    issues.push(`${path}.limit must be a positive integer.`);
  }
  return issues;
}

function validateComputation(value, path) {
  const computation = asRecord(value);
  if (!computation) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  switch (computation.kind) {
    case 'server_query':
      if (!CODEGEN_QUERY_KINDS.has(computation.queryKind)) {
        issues.push(`${path}.queryKind must be a supported codegen query kind.`);
      }
      if (
        computation.queryOwnership !== undefined &&
        computation.queryOwnership !== 'view_owned' &&
        computation.queryOwnership !== 'shared_query'
      ) {
        issues.push(`${path}.queryOwnership must be view_owned or shared_query.`);
      }
      if (computation.sourceKeys !== undefined && !arrayOfStrings(computation.sourceKeys)) {
        issues.push(`${path}.sourceKeys must be an array of strings.`);
      }
      if (computation.fieldNames !== undefined && !arrayOfStrings(computation.fieldNames)) {
        issues.push(`${path}.fieldNames must be an array of strings.`);
      }
      break;
    case 'derived':
      if (typeof computation.upstreamViewId !== 'string' || !computation.upstreamViewId.trim()) {
        issues.push(`${path}.upstreamViewId is required.`);
      }
      if (typeof computation.derivation !== 'string' || !computation.derivation.trim()) {
        issues.push(`${path}.derivation is required.`);
      }
      break;
    case 'presentation_only':
      break;
    case 'unsupported':
      if (typeof computation.reason !== 'string' || !computation.reason.trim()) {
        issues.push(`${path}.reason is required.`);
      }
      if (
        typeof computation.suggestedModelingFix !== 'string' ||
        !computation.suggestedModelingFix.trim()
      ) {
        issues.push(`${path}.suggestedModelingFix is required.`);
      }
      break;
    default:
      issues.push(`${path}.kind must be a supported computation kind.`);
  }
  return issues;
}

function validateUnsupportedInsight(value, path) {
  const unsupportedInsight = asRecord(value);
  if (!unsupportedInsight) {
    return [`${path} must be an object.`];
  }
  const issues = [];
  for (const key of ['title', 'requestedQuestion', 'suggestedModelingFix']) {
    if (typeof unsupportedInsight[key] !== 'string' || !unsupportedInsight[key].trim()) {
      issues.push(`${path}.${key} is required.`);
    }
  }
  if (!CODEGEN_UNSUPPORTED_REASONS.has(unsupportedInsight.reason)) {
    issues.push(`${path}.reason must be a supported unsupported insight reason.`);
  }
  return issues;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function arrayOfStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
