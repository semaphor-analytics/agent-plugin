export const CODEGEN_SUMMARY_SCHEMA_VERSION = 'semaphor-data-app-codegen-summary/v1';

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
  return issues;
}

function validateSource(value, path) {
  const source = asRecord(value);
  if (!source) {
    return [`${path} must be an object.`];
  }
  if (typeof source.sourceKey === 'string' && source.sourceKey.trim()) {
    return [];
  }
  if (
    source.kind === 'semantic' &&
    typeof source.domainId === 'string' &&
    source.domainId.trim() &&
    (
      (typeof source.datasetName === 'string' && source.datasetName.trim()) ||
      (typeof source.datasetId === 'string' && source.datasetId.trim())
    )
  ) {
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
  if (!Array.isArray(input.appliesToViewIds)) {
    issues.push(`${path}.appliesToViewIds must be an array.`);
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
  if (!Array.isArray(view.fields)) {
    if (!isPresentationCodegenView(view)) {
      issues.push(`${path}.fields must be an array.`);
    }
    return issues;
  }
  view.fields.forEach((field, index) => {
    issues.push(...validateFieldRef(field, `${path}.fields.${index}`));
  });
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
  if (!Array.isArray(filterContract.appliesToViewIds)) {
    issues.push(`${path}.appliesToViewIds must be an array.`);
  }
  if (!Array.isArray(filterContract.notAppliedToViewIds)) {
    issues.push(`${path}.notAppliedToViewIds must be an array.`);
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
  return [
    ...validateOptionalFieldRef(optionQuery.valueFieldRef, `${path}.valueFieldRef`),
    ...validateOptionalFieldRef(optionQuery.labelFieldRef, `${path}.labelFieldRef`),
    ...validateOptionalFieldRef(optionQuery.filterFieldRef, `${path}.filterFieldRef`),
  ];
}

function validateOptionalFieldRef(value, path) {
  return value === undefined ? [] : validateFieldRef(value, path);
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

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function arrayOfStrings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
