const DIAGNOSTIC_FIX_KINDS = new Set([
  'diagnostic_fix',
  'fix_diagnostics',
  'fix_inspector_warnings',
  'fix_runtime_warnings',
  'fix_warnings',
]);

const WARNING_FIX_VIEW_REASONS = new Set([
  'fields',
  'sdkSpec',
]);

export function evaluateContractUpdatePolicy({
  beforeSummary,
  afterSummary,
  migrationReport,
  operationIntent,
}) {
  const kind = typeof operationIntent?.kind === 'string'
    ? operationIntent.kind.trim()
    : 'add';

  if (DIAGNOSTIC_FIX_KINDS.has(kind)) {
    return evaluateDiagnosticFixPolicy({
      beforeSummary,
      afterSummary,
      migrationReport,
      operationIntent,
    });
  }

  return {
    ok: true,
    policy: {
      kind,
      mode: 'general_iterative_update',
      reason:
        'General generated-contract edits are allowed to change the requested contract shape. Review the migration report for expected UI work.',
    },
    violations: [],
  };
}

function evaluateDiagnosticFixPolicy({
  beforeSummary,
  afterSummary,
  migrationReport,
  operationIntent,
}) {
  const violations = [];
  const targetViewIds = normalizeStringSet(operationIntent?.targetViewIds);
  const report = migrationReport || {};

  if (targetViewIds.size === 0) {
    violations.push({
      path: 'operationIntent.targetViewIds',
      reason:
        'Diagnostic warning fixes must declare targetViewIds so the update cannot broaden to unrelated views.',
    });
  }

  collectAddedRemovedViolations({
    bucket: report.views,
    label: 'views',
    violations,
  });
  collectAddedRemovedViolations({
    bucket: report.inputs,
    label: 'inputs',
    violations,
  });
  collectAnyChangeViolations({
    bucket: report.inputs,
    label: 'inputs',
    violations,
  });
  collectAddedRemovedViolations({
    bucket: report.filterContracts,
    label: 'filterContracts',
    violations,
  });
  collectAnyChangeViolations({
    bucket: report.filterContracts,
    label: 'filterContracts',
    violations,
  });

  for (const change of changedEntries(report.views)) {
    if (targetViewIds.size > 0 && !targetViewIds.has(change.id)) {
      violations.push({
        path: `views.${change.id}`,
        reason:
          'Diagnostic warning fixes may only change explicitly targeted views.',
      });
    }
    const disallowedReasons = Array.isArray(change.reasons)
      ? change.reasons.filter((reason) => !WARNING_FIX_VIEW_REASONS.has(reason))
      : [];
    if (disallowedReasons.length > 0) {
      violations.push({
        path: `views.${change.id}`,
        reason:
          `Diagnostic warning fixes may only adjust fields/sdkSpec; changed ${disallowedReasons.join(', ')}.`,
      });
    }
  }
  const fullSummaryViolation = findDisallowedSummaryChange({
    beforeSummary,
    afterSummary,
    targetViewIds,
  });
  if (fullSummaryViolation) {
    violations.push(fullSummaryViolation);
  }

  return {
    ok: violations.length === 0,
    policy: {
      kind: operationIntent?.kind || 'diagnostic_fix',
      mode: 'diagnostic_warning_fix',
      allowedViewChangeReasons: Array.from(WARNING_FIX_VIEW_REASONS).sort(),
      targetViewIds: Array.from(targetViewIds).sort(),
      reason:
        'Diagnostic warning fixes are preserve-by-default and may not add/remove views, inputs, or filter contracts.',
    },
    violations,
  };
}

function findDisallowedSummaryChange({
  beforeSummary,
  afterSummary,
  targetViewIds,
}) {
  if (!beforeSummary || !afterSummary || typeof beforeSummary !== 'object' || typeof afterSummary !== 'object') {
    return {
      path: 'codegenSummary',
      reason:
        'Diagnostic warning fixes require before/after codegen summaries for full-scope verification.',
    };
  }

  const expectedAfter = deepClone(beforeSummary);
  const beforeViews = mapViewsById(beforeSummary.views);
  const afterViews = mapViewsById(afterSummary.views);
  expectedAfter.views = Array.isArray(expectedAfter.views) ? expectedAfter.views : [];

  for (const viewId of targetViewIds) {
    const beforeView = beforeViews.get(viewId);
    const afterView = afterViews.get(viewId);
    if (!beforeView || !afterView) {
      continue;
    }
    const expectedView = expectedAfter.views.find((view) => view?.id === viewId);
    if (!expectedView) {
      continue;
    }
    expectedView.fields = deepClone(afterView.fields);
    expectedView.sdkSpec = deepClone(afterView.sdkSpec);
  }

  if (canonicalJson(expectedAfter) === canonicalJson(afterSummary)) {
    return null;
  }

  return {
    path: 'codegenSummary',
    reason:
      'Diagnostic warning fixes may only change fields/sdkSpec on targetViewIds; another generated contract section changed.',
  };
}

function collectAddedRemovedViolations({ bucket, label, violations }) {
  for (const entry of entries(bucket?.added)) {
    violations.push({
      path: `${label}.${entry.id || '<unknown>'}`,
      reason: `Diagnostic warning fixes may not add ${label}.`,
    });
  }
  for (const entry of entries(bucket?.removed)) {
    violations.push({
      path: `${label}.${entry.id || '<unknown>'}`,
      reason: `Diagnostic warning fixes may not remove ${label}.`,
    });
  }
}

function collectAnyChangeViolations({ bucket, label, violations }) {
  for (const entry of changedEntries(bucket)) {
    violations.push({
      path: `${label}.${entry.id || '<unknown>'}`,
      reason: `Diagnostic warning fixes may not change ${label}.`,
    });
  }
}

function changedEntries(bucket) {
  return entries(bucket?.changed);
}

function entries(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringSet(value) {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(
    value
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim()),
  );
}

function mapViewsById(views) {
  const map = new Map();
  for (const view of Array.isArray(views) ? views : []) {
    if (typeof view?.id === 'string' && view.id.trim()) {
      map.set(view.id, view);
    }
  }
  return map;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}
