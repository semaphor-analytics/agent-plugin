#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.vite',
  'coverage',
  '.turbo',
  '.cache',
  '.git',
]);

const EXCLUDED_FILES = new Set(['.DS_Store', '.env']);
const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;

const SAFE_EXTENSIONLESS_FILES = new Set([
  'Dockerfile',
  'Containerfile',
  'Makefile',
  'Procfile',
  'LICENSE',
  'NOTICE',
  'yarn.lock',
]);

const SENSITIVE_FILE_PATTERNS = [
  /(^|[-_.])secret(s)?\.json$/i,
  /(^|[-_.])credential(s)?\.json$/i,
  /^service[-_]account\.json$/i,
  /^local\.config\.json$/i,
  /^local\.settings\.json$/i,
];

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.cjs',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.scss',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const HOSTED_ENTRY_EXTENSIONS = new Set(['.js', '.mjs']);
const HOSTED_STYLE_EXTENSIONS = new Set(['.css']);
const MIN_PUBLISHED_ASSET_HASH_LENGTH = 6;
const PUBLISHED_ASSET_HASH_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function parseArgs(argv) {
  const [command, ...rest] = argv.slice(2);
  const options = {
    command: command === '--help' || command === '-h' ? undefined : command,
    dir: process.cwd(),
    apiBaseUrl: firstEnvValue(
      process.env.SEMAPHOR_SERVER_URL,
      process.env.SEMAPHOR_API_BASE_URL,
    ),
    token: process.env.SEMAPHOR_PROJECT_TOKEN || '',
    json: false,
    runBuild: true,
    buildCommand: '',
    assetsDir: '',
    manifest: '',
    writeManifest: true,
    validationStatus: '',
    description: undefined,
    bridgeWorkspaceHint: undefined,
    newDataApp: false,
    force: false,
  };
  if (command === '--help' || command === '-h') {
    options.help = true;
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--dir') {
      options.dir = rest[i + 1];
      i += 1;
    } else if (arg === '--api-base-url') {
      options.apiBaseUrl = rest[i + 1];
      i += 1;
    } else if (arg === '--token') {
      options.token = rest[i + 1];
      i += 1;
    } else if (arg === '--project-id') {
      options.projectId = rest[i + 1];
      i += 1;
    } else if (arg === '--data-app-id') {
      options.dataAppId = rest[i + 1];
      i += 1;
    } else if (arg === '--new') {
      options.newDataApp = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--title') {
      options.title = rest[i + 1];
      i += 1;
    } else if (arg === '--description') {
      options.description = rest[i + 1];
      i += 1;
    } else if (arg === '--manifest') {
      options.manifest = rest[i + 1];
      i += 1;
    } else if (arg === '--check') {
      options.writeManifest = false;
    } else if (arg === '--assets-dir') {
      options.assetsDir = rest[i + 1];
      i += 1;
    } else if (arg === '--build-command') {
      options.buildCommand = rest[i + 1];
      i += 1;
    } else if (arg === '--no-build') {
      options.runBuild = false;
    } else if (arg === '--validation-status') {
      options.validationStatus = rest[i + 1];
      i += 1;
    } else if (arg === '--bridge-workspace-hint') {
      options.bridgeWorkspaceHint = rest[i + 1];
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  const localEnv = readLocalEnv(options.dir);
  options.token = firstEnvValue(
    options.token,
    localEnv.SEMAPHOR_PROJECT_TOKEN,
    localEnv.VITE_SEMAPHOR_PROJECT_TOKEN,
  );
  options.apiBaseUrl = firstEnvValue(
    options.apiBaseUrl,
    localEnv.SEMAPHOR_SERVER_URL,
    localEnv.SEMAPHOR_API_BASE_URL,
    localEnv.VITE_SEMAPHOR_API_BASE_URL,
  );

  return options;
}

function printHelp() {
  console.log(`Usage:
  semaphor-data-app.mjs load --data-app-id <id>
  semaphor-data-app.mjs save-draft --project-id <id> --title <title> [--data-app-id <id>]
  semaphor-data-app.mjs prepare-publish [--dir <path>]
  semaphor-data-app.mjs publish --project-id <id> --title <title> [--data-app-id <id>]

Options:
  --dir <path>                  React app root. Defaults to cwd.
  --api-base-url <url>          Exact Semaphor app URL override. Defaults to SEMAPHOR_SERVER_URL, then token apiServiceUrl, then https://semaphor.cloud.
  --token <token>               Project token. Defaults to SEMAPHOR_PROJECT_TOKEN, then target app local env.
  --manifest <path>             Manifest JSON. Defaults to semaphor.data-app.json.
  --new                         Create a new Data App even if the manifest has semaphor.dataAppId.
  --assets-dir <path>           Built asset directory for publish. Defaults to dist.
  --build-command <command>     Build command for publish. Defaults to package build script.
  --no-build                    Skip local build before upload.
  --check                       Validate inferred publish metadata without writing the manifest.
  --force                       Bypass remote source conflict checks for intentional overwrite/recovery.
  --validation-status <path>    Precomputed validation status JSON.
  --json                        Print compact JSON only.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(value, compact) {
  console.log(JSON.stringify(value, null, compact ? 0 : 2));
}

function readLocalEnv(startDir) {
  const env = {};
  for (const directory of candidateEnvDirectories(startDir)) {
    for (const fileName of [
      '.env.local',
      '.env.development.local',
      '.env.development',
      '.env',
    ]) {
      for (const [key, value] of Object.entries(readEnvFile(path.join(directory, fileName)))) {
        if (env[key] === undefined) {
          env[key] = value;
        }
      }
    }
    if (Object.keys(env).length > 0) {
      return env;
    }
  }
  return env;
}

function candidateEnvDirectories(startDir) {
  const directories = [];
  const seen = new Set();
  for (const value of [startDir, process.env.INIT_CWD, process.env.PWD]) {
    const directory = normalizeEnvValue(value);
    if (!directory) {
      continue;
    }
    const resolved = path.resolve(directory);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      directories.push(resolved);
    }
  }
  return directories;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue = ''] = match;
    parsed[key] = parseEnvValue(rawValue);
  }
  return parsed;
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.indexOf(' #');
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

function firstEnvValue(...values) {
  for (const value of values) {
    const normalized = normalizeEnvValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function normalizeEnvValue(value) {
  if (!value || value.startsWith('${')) {
    return '';
  }
  return value.trim();
}

function requireToken(options) {
  if (!options.token) {
    throw new Error(
      'SEMAPHOR_PROJECT_TOKEN, VITE_SEMAPHOR_PROJECT_TOKEN, or --token is required.',
    );
  }
}

function requireValue(value, label) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function apiUrl(options, pathname) {
  return `${resolveApiBaseUrl(options)}${pathname}`;
}

function resolveApiBaseUrl(options) {
  const explicitBaseUrl = normalizeAppBaseUrl(options.apiBaseUrl);
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const tokenBaseUrl = normalizeAppBaseUrl(readProjectTokenApiServiceUrl(options.token));
  if (tokenBaseUrl) {
    return tokenBaseUrl;
  }

  return 'https://semaphor.cloud';
}

function readProjectTokenApiServiceUrl(token) {
  if (!token) {
    return '';
  }

  const [, payloadSegment] = token.split('.');
  if (!payloadSegment) {
    return '';
  }

  try {
    const normalizedPayload = payloadSegment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const payload = JSON.parse(Buffer.from(normalizedPayload, 'base64').toString('utf8'));
    return typeof payload.apiServiceUrl === 'string' ? payload.apiServiceUrl : '';
  } catch {
    return '';
  }
}

function normalizeAppBaseUrl(value) {
  const normalized = normalizeEnvValue(value);
  if (!normalized) {
    return '';
  }

  const trimmed = normalized.replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

async function requestJson(options, pathname, init = {}, requestOptions = {}) {
  requireToken(options);
  const response = await fetch(apiUrl(options, pathname), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) : {};
  const allowedStatuses = new Set(requestOptions.allowStatuses || []);
  if (!response.ok && !allowedStatuses.has(response.status)) {
    throw new Error(
      payload.error ||
        `Semaphor request failed with status ${response.status}: ${text.slice(0, 240)}`,
    );
  }
  return payload;
}

function normalizeRelativePath(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function isSnapshotFile(relativePath) {
  if (SAFE_EXTENSIONLESS_FILES.has(path.basename(relativePath))) {
    return true;
  }
  const ext = path.extname(relativePath).toLowerCase();
  if (!ext) {
    return false;
  }
  return TEXT_EXTENSIONS.has(ext);
}

function isSensitiveSnapshotFile(relativePath) {
  const basename = path.basename(relativePath);
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(basename));
}

function shouldSkipSnapshotPath(relativePath, isFile = false) {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) {
    return true;
  }
  if (segments.some((segment) => segment.startsWith('.'))) {
    return true;
  }
  if (segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))) {
    return true;
  }
  if (EXCLUDED_FILES.has(path.basename(relativePath))) {
    return true;
  }
  if (isFile && isSensitiveSnapshotFile(relativePath)) {
    return true;
  }
  if (isFile) {
    return !isSnapshotFile(relativePath);
  }
  return false;
}

function collectSnapshotFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relativePath = normalizeRelativePath(root, fullPath);
    if (shouldSkipSnapshotPath(relativePath, entry.isFile())) {
      continue;
    }
    if (entry.isDirectory()) {
      collectSnapshotFiles(root, fullPath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_SNAPSHOT_FILE_BYTES) {
      continue;
    }
    const contents = fs.readFileSync(fullPath, 'utf8');
    files.push({
      path: relativePath,
      contents,
      hash: sha256(contents),
    });
  }
  return files;
}

function collectGitSnapshotFiles(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  if (result.status !== 0) {
    return null;
  }

  const files = [];
  for (const relativePath of result.stdout.toString('utf8').split('\0')) {
    if (!relativePath || shouldSkipSnapshotPath(relativePath, true)) {
      continue;
    }
    const fullPath = path.resolve(root, relativePath);
    const normalizedRoot = path.resolve(root);
    if (
      fullPath !== normalizedRoot &&
      !fullPath.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_FILE_BYTES) {
      continue;
    }
    const contents = fs.readFileSync(fullPath, 'utf8');
    files.push({
      path: relativePath.replace(/\\/g, '/'),
      contents,
      hash: sha256(contents),
    });
  }
  return files;
}

function createSourceSnapshot(root) {
  const files = (collectGitSnapshotFiles(root) ?? collectSnapshotFiles(root)).sort(
    (left, right) => left.path.localeCompare(right.path),
  );
  return {
    schemaVersion: 'data-app-source-snapshot/v1',
    files,
    metadata: {
      excludedPaths: [
        'node_modules/**',
        'dist/**',
        'build/**',
        '.next/**',
        '.vite/**',
        'coverage/**',
        '.env',
        '.env.*',
        '.DS_Store',
        '.turbo/**',
        '.cache/**',
        '.git/**',
        '.*',
        '**/.*',
      ],
    },
  };
}

function stableSnapshotPayload(snapshot) {
  return JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    files: [...snapshot.files]
      .map((file) => ({
        path: file.path,
        contents: file.contents,
        hash: file.hash ?? null,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

function hashSourceSnapshot(snapshot) {
  return sha256(stableSnapshotPayload(snapshot));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function createSourceRevision(root, sourceSnapshot) {
  const status = runGit(root, ['status', '--porcelain=v1']);
  const dirtyPatch = [
    runGit(root, ['diff', '--binary', 'HEAD', '--']),
    runGit(root, ['diff', '--binary', '--cached', '--']),
    status,
  ].join('\n');
  const remoteUrl = runGit(root, ['config', '--get', 'remote.origin.url']);

  return {
    schemaVersion: 'data-app-source-revision/v1',
    snapshotHash: hashSourceSnapshot(sourceSnapshot),
    git: {
      commit: runGit(root, ['rev-parse', 'HEAD']) || undefined,
      branch: runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || undefined,
      dirtyTreeHash: dirtyPatch.trim() ? sha256(dirtyPatch) : undefined,
      isDirty: Boolean(status),
      remoteUrlHash: remoteUrl ? sha256(remoteUrl) : undefined,
    },
    workspace: {
      adapter: 'codex',
      rootName: path.basename(root),
      pathHash: sha256(root),
    },
    collectedAt: new Date().toISOString(),
  };
}

function resolveManifestPath(root, options) {
  return path.resolve(root, options.manifest || 'semaphor.data-app.json');
}

function readManifest(root, options) {
  const manifestPath = resolveManifestPath(root, options);
  if (!fs.existsSync(manifestPath)) {
    return {
      schemaVersion: 'data-app/v1',
      app: {
        name: options.title || path.basename(root),
        description: options.description || undefined,
        createdWith: 'semaphor-agent-plugin',
      },
      semaphor: {},
    };
  }
  return readJson(manifestPath);
}

function writeManifest(root, options, manifest) {
  const manifestPath = resolveManifestPath(root, options);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function resolveLocalStatePath(root) {
  return path.join(root, '.semaphor.data-app.local.json');
}

function readLocalState(root) {
  const statePath = resolveLocalStatePath(root);
  if (!fs.existsSync(statePath)) {
    return {
      schemaVersion: 'semaphor-data-app-local-state/v1',
      dataApps: {},
    };
  }
  const parsed = readJson(statePath);
  return {
    schemaVersion: 'semaphor-data-app-local-state/v1',
    dataApps:
      parsed && typeof parsed.dataApps === 'object' && parsed.dataApps
        ? parsed.dataApps
        : {},
  };
}

function writeLocalState(root, state) {
  const statePath = resolveLocalStatePath(root);
  fs.writeFileSync(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(`${statePath}.tmp`, statePath);
  return statePath;
}

function writeLocalDataAppState(root, options, input) {
  if (!options.writeManifest || !input.dataAppId || !input.sourceRevision) {
    return undefined;
  }
  const state = readLocalState(root);
  state.dataApps[input.dataAppId] = {
    projectId: input.projectId || undefined,
    sourceRevision: input.sourceRevision,
    updatedAt: new Date().toISOString(),
  };
  return writeLocalState(root, state);
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function manifestSemaphor(manifest) {
  return manifest && typeof manifest.semaphor === 'object' && manifest.semaphor
    ? manifest.semaphor
    : {};
}

function manifestSemaphorForOptions(manifest, options) {
  const semaphor = { ...manifestSemaphor(manifest) };
  if (options.newDataApp) {
    delete semaphor.dataAppId;
  }
  return semaphor;
}

function resolveDataAppOptions(root, options) {
  const manifest = readManifest(root, options);
  const semaphor = manifestSemaphor(manifest);
  return {
    ...options,
    projectId: stringValue(options.projectId) || stringValue(semaphor.projectId),
    dataAppId: options.newDataApp
      ? undefined
      : stringValue(options.dataAppId) || stringValue(semaphor.dataAppId),
    title: stringValue(options.title) || stringValue(manifest.app?.name),
    description:
      options.description !== undefined
        ? options.description
        : stringValue(manifest.app?.description),
  };
}

function mergeManifestIdentity(manifest, identity) {
  return {
    ...manifest,
    semaphor: {
      ...manifestSemaphor(manifest),
      ...(identity.projectId ? { projectId: identity.projectId } : {}),
      ...(identity.dataAppId ? { dataAppId: identity.dataAppId } : {}),
    },
  };
}

function writeManifestIdentity(root, options, identity) {
  if (!options.writeManifest) {
    return undefined;
  }
  const manifest = readManifest(root, options);
  return writeManifest(root, options, mergeManifestIdentity(manifest, identity));
}

function getLocalDataAppSourceRevision(root, dataAppId) {
  const state = readLocalState(root);
  const entry = state.dataApps?.[dataAppId];
  return entry && typeof entry.sourceRevision === 'object'
    ? entry.sourceRevision
    : null;
}

function pickRemoteSourceRevision(dataApp) {
  const versions = Array.isArray(dataApp?.dataAppVersions)
    ? dataApp.dataAppVersions
    : [];
  const draft = versions.find(
    (version) => version?.version === 0 && version?.sourceRevision,
  );
  if (draft?.sourceRevision) {
    return draft.sourceRevision;
  }
  if (dataApp?.currentDataAppVersion?.sourceRevision) {
    return dataApp.currentDataAppVersion.sourceRevision;
  }
  const currentVersion = versions.find(
    (version) => version?.id === dataApp?.currentDataAppVersionId,
  );
  if (currentVersion?.sourceRevision) {
    return currentVersion.sourceRevision;
  }
  const readyVersions = versions
    .filter((version) => version?.status === 'ready' && version?.sourceRevision)
    .sort((left, right) => Number(right.version || 0) - Number(left.version || 0));
  return readyVersions[0]?.sourceRevision || null;
}

async function loadRemoteDataApp(options, dataAppId) {
  return requestJson(
    options,
    `/api/data-apps/${encodeURIComponent(dataAppId)}`,
  );
}

async function assertNoRemoteSourceConflict(root, options) {
  if (!options.dataAppId || options.newDataApp || options.force) {
    return;
  }

  const localRevision = getLocalDataAppSourceRevision(root, options.dataAppId);
  if (!localRevision?.snapshotHash) {
    return;
  }

  const remote = await loadRemoteDataApp(options, options.dataAppId);
  const remoteRevision = pickRemoteSourceRevision(remote.dataApp);
  if (!remoteRevision?.snapshotHash) {
    return;
  }

  if (remoteRevision.snapshotHash !== localRevision.snapshotHash) {
    throw new Error(
      [
        `Remote Data App source has changed since this workspace last loaded or saved ${options.dataAppId}.`,
        `Known snapshot: ${localRevision.snapshotHash}.`,
        `Remote snapshot: ${remoteRevision.snapshotHash}.`,
        'Load the latest Data App source before editing, use --new to create a copy, or pass --force only when you intentionally want to overwrite the remote draft.',
      ].join(' '),
    );
  }
}

function readValidationStatus(root, options) {
  if (!options.validationStatus) {
    return undefined;
  }
  return readJson(path.resolve(root, options.validationStatus));
}

async function resolveValidationStatus(root, options) {
  const explicitValidationStatus = readValidationStatus(root, options);
  if (explicitValidationStatus) {
    return explicitValidationStatus;
  }
  return undefined;
}

function buildDraftPayload(root, options, validationStatus) {
  const sourceSnapshot = createSourceSnapshot(root);
  const sourceRevision = createSourceRevision(root, sourceSnapshot);
  return {
    title: options.title,
    description: options.description,
    manifest: readManifest(root, options),
    sourceSnapshot,
    sourceRevision,
    validationStatus,
    bridgeWorkspaceHint: options.bridgeWorkspaceHint || null,
  };
}

async function loadDataApp(options) {
  const root = path.resolve(options.dir);
  const resolvedOptions = resolveDataAppOptions(root, options);
  const dataAppId = requireValue(
    resolvedOptions.dataAppId,
    '--data-app-id or semaphor.dataAppId in the manifest',
  );
  const result = await loadRemoteDataApp(resolvedOptions, dataAppId);
  const sourceRevision = pickRemoteSourceRevision(result.dataApp);
  writeLocalDataAppState(root, resolvedOptions, {
    projectId: result.dataApp?.projectId || resolvedOptions.projectId,
    dataAppId,
    sourceRevision,
  });
  return result;
}

async function saveDraft(options, context = {}) {
  const root = path.resolve(options.dir);
  const resolvedOptions = resolveDataAppOptions(root, options);
  const validationStatus =
    context.validationStatus ??
    (await resolveValidationStatus(root, resolvedOptions));
  await assertNoRemoteSourceConflict(root, resolvedOptions);
  const payload = buildDraftPayload(root, resolvedOptions, validationStatus);

  if (resolvedOptions.dataAppId) {
    const result = await requestJson(
      resolvedOptions,
      `/api/data-apps/${encodeURIComponent(resolvedOptions.dataAppId)}/draft`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    writeManifestIdentity(root, resolvedOptions, {
      projectId: resolvedOptions.projectId,
      dataAppId: resolvedOptions.dataAppId,
    });
    writeLocalDataAppState(root, resolvedOptions, {
      projectId: resolvedOptions.projectId,
      dataAppId: resolvedOptions.dataAppId,
      sourceRevision: payload.sourceRevision,
    });
    return {
      dataAppId: resolvedOptions.dataAppId,
      draftId: result.draft?.id,
      sourceRevision: payload.sourceRevision,
      result,
    };
  }

  const projectId = requireValue(
    resolvedOptions.projectId,
    '--project-id or semaphor.projectId in the manifest',
  );
  const title = requireValue(
    resolvedOptions.title,
    '--title or app.name in the manifest',
  );
  const result = await requestJson(resolvedOptions, '/api/data-apps', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      projectId,
      title,
    }),
  });
  const dataAppId = result.dataApp?.id;
  writeManifestIdentity(root, resolvedOptions, { projectId, dataAppId });
  writeLocalDataAppState(root, resolvedOptions, {
    projectId,
    dataAppId,
    sourceRevision: payload.sourceRevision,
  });
  return {
    dataAppId,
    draftId: result.draft?.id,
    sourceRevision: payload.sourceRevision,
    result,
  };
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function defaultBuildCommand(root) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return '';
  }
  const scripts = readJson(packageJsonPath).scripts || {};
  if (!scripts.build) {
    return '';
  }
  const packageManager = detectPackageManager(root);
  if (packageManager === 'pnpm') return 'pnpm build';
  if (packageManager === 'yarn') return 'yarn build';
  if (packageManager === 'bun') return 'bun run build';
  return 'npm run build';
}

function runBuild(root, options) {
  if (!options.runBuild) {
    return;
  }
  const command = options.buildCommand || defaultBuildCommand(root);
  if (!command) {
    throw new Error('No build command found. Pass --build-command or --no-build.');
  }
  const stdio = options.json ? ['ignore', 'pipe', 'pipe'] : 'inherit';
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    stdio,
    encoding: options.json ? 'utf8' : undefined,
  });
  if (options.json) {
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.status !== 0) {
    throw new Error(`Build command failed: ${command}`);
  }
}

function resolveAssetsRoot(root, options) {
  return path.resolve(root, options.assetsDir || 'dist');
}

function listBuiltAssetPaths(assetsRoot) {
  const files = [];
  collectAssetFiles(assetsRoot, assetsRoot, files);
  return files.map((filePath) => normalizeRelativePath(assetsRoot, filePath));
}

function normalizeManifestAssetPath(assetPath) {
  const withoutHash = String(assetPath).split('#')[0].split('?')[0].trim();
  if (!withoutHash || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(withoutHash)) {
    return '';
  }
  return withoutHash
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^\/+/, '');
}

function hasPublishedAssetHash(assetPath) {
  const normalized = normalizeManifestAssetPath(assetPath);
  const fileName = normalized.split('/').at(-1) || '';
  const extensionIndex = fileName.lastIndexOf('.');
  const nameWithoutExtension =
    extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const hyphenIndexes = Array.from(nameWithoutExtension)
    .map((character, index) => (character === '-' ? index : -1))
    .filter((index) => index >= 0)
    .reverse();

  return hyphenIndexes.some((hyphenIndex) => {
    const candidate = nameWithoutExtension.slice(hyphenIndex + 1);
    const candidateCharacters = Array.from(candidate);
    const hasOnlyHashCharacters = candidateCharacters.every((character) =>
      PUBLISHED_ASSET_HASH_CHARACTERS.includes(character),
    );
    const hasHashSignal = candidateCharacters.some(
      (character) =>
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') ||
        character === '_' ||
        (character === '-' && candidate.length > MIN_PUBLISHED_ASSET_HASH_LENGTH),
    );

    return (
      candidate.length >= MIN_PUBLISHED_ASSET_HASH_LENGTH &&
      hasOnlyHashCharacters &&
      (hasHashSignal || candidate.length >= 8)
    );
  });
}

function isHostedPublishAssetPath(assetPath) {
  return isPublishableBuildAssetPath(assetPath) && hasPublishedAssetHash(assetPath);
}

function parseIndexHtmlRuntimeAssets(assetsRoot) {
  const indexPath = path.join(assetsRoot, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return { entry: '', styles: [] };
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptCandidates = Array.from(
    html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
  )
    .map((match) => normalizeManifestAssetPath(match[1]))
    .filter(Boolean);
  const styleCandidates = Array.from(
    html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi),
  )
    .map((match) => normalizeManifestAssetPath(match[1]))
    .filter(Boolean);

  return {
    entry: scriptCandidates.find((candidate) =>
      HOSTED_ENTRY_EXTENSIONS.has(path.extname(candidate).toLowerCase()),
    ) || '',
    styles: styleCandidates.filter((candidate) =>
      HOSTED_STYLE_EXTENSIONS.has(path.extname(candidate).toLowerCase()),
    ),
  };
}

function pickFallbackRuntimeAssets(assetPaths) {
  const hostedAssets = assetPaths.filter(isHostedPublishAssetPath);
  const jsCandidates = hostedAssets
    .filter((assetPath) =>
      HOSTED_ENTRY_EXTENSIONS.has(path.extname(assetPath).toLowerCase()),
    )
    .sort((left, right) => {
      const leftScore = /(^|\/)index[-.]/.test(left) ? 0 : 1;
      const rightScore = /(^|\/)index[-.]/.test(right) ? 0 : 1;
      return leftScore - rightScore || left.localeCompare(right);
    });
  const cssCandidates = hostedAssets
    .filter((assetPath) =>
      HOSTED_STYLE_EXTENSIONS.has(path.extname(assetPath).toLowerCase()),
    )
    .sort();

  return {
    entry: jsCandidates[0] || '',
    styles: cssCandidates,
  };
}

function assertHostedRuntimeAsset(input) {
  const normalized = normalizeManifestAssetPath(input.assetPath);
  if (!normalized) {
    throw new Error(`${input.label} must be a relative built asset path.`);
  }
  if (!input.assetPaths.includes(normalized)) {
    throw new Error(`${input.label} "${normalized}" was not found under ${input.assetsRoot}.`);
  }
  if (!hasPublishedAssetHash(normalized)) {
    throw new Error(
      `${input.label} "${normalized}" must include a content hash, for example assets/index-a1b2c3d4.js.`,
    );
  }
  return normalized;
}

function preparePublishManifest(root, options) {
  const assetsRoot = resolveAssetsRoot(root, options);
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`Built assets directory not found: ${assetsRoot}`);
  }

  const manifest = readManifest(root, options);
  const assetPaths = listBuiltAssetPaths(assetsRoot);
  const fromHtml = parseIndexHtmlRuntimeAssets(assetsRoot);
  const fallback = pickFallbackRuntimeAssets(assetPaths);
  const manifestEntry = normalizeManifestAssetPath(manifest.runtime?.entry || '');
  const entry =
    manifestEntry && assetPaths.includes(manifestEntry)
      ? manifestEntry
      : normalizeManifestAssetPath(fromHtml.entry || fallback.entry);
  const manifestStyles = Array.isArray(manifest.runtime?.styles)
    ? manifest.runtime.styles.map(normalizeManifestAssetPath).filter(Boolean)
    : [];
  const manifestStylesAreCurrent =
    manifestStyles.length > 0 &&
    manifestStyles.every((style) => assetPaths.includes(style));
  const styles = (
    manifestStylesAreCurrent
      ? manifestStyles
      : fromHtml.styles.length > 0
        ? fromHtml.styles
        : fallback.styles
  )
    .map(normalizeManifestAssetPath)
    .filter(Boolean);

  if (!entry) {
    throw new Error(
      [
        'Could not infer a Semaphor-hosted runtime entry file.',
        'Semaphor-hosted publish needs a static browser bundle with a hashed module entry that mounts into #root.',
        'For Vite-style apps, make sure npm run build writes dist/index.html and dist/assets/index-<hash>.js.',
        'For server-rendered apps such as Next.js or Remix, add a static Data App entrypoint or pass --manifest with runtime.entry.',
      ].join(' '),
    );
  }

  const runtime = {
    ...manifest.runtime,
    framework: manifest.runtime?.framework || 'react',
    bundler: manifest.runtime?.bundler || inferBundler(root, assetsRoot),
    entry: assertHostedRuntimeAsset({
      assetPath: entry,
      assetPaths,
      assetsRoot,
      label: 'runtime.entry',
    }),
    styles: styles.map((style) =>
      assertHostedRuntimeAsset({
        assetPath: style,
        assetPaths,
        assetsRoot,
        label: 'runtime.styles entry',
      }),
    ),
  };
  delete runtime.assetsBasePath;

  const preparedManifest = {
    ...manifest,
    schemaVersion: manifest.schemaVersion || 'data-app/v1',
    app: {
      ...(manifest.app || {}),
      name: manifest.app?.name || options.title || path.basename(root),
      description: manifest.app?.description || options.description,
      createdWith: manifest.app?.createdWith || 'semaphor-agent-plugin',
    },
    semaphor: {
      ...manifestSemaphorForOptions(manifest, options),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.dataAppId ? { dataAppId: options.dataAppId } : {}),
    },
    runtime,
  };

  const uploadAssets = assetPaths
    .filter(isHostedPublishAssetPath)
    .filter((assetPath) => assetPath !== 'index.html')
    .sort();
  const skippedAssets = assetPaths
    .filter((assetPath) => !isHostedPublishAssetPath(assetPath))
    .sort();

  return {
    manifest: preparedManifest,
    manifestPath: resolveManifestPath(root, options),
    assetsRoot,
    uploadAssets,
    skippedAssets,
  };
}

function inferBundler(root, assetsRoot) {
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath)
    ? readJson(packageJsonPath)
    : {};
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
  if (deps.vite || fs.existsSync(path.join(assetsRoot, '.vite'))) return 'vite';
  if (deps.next) return 'next-static-entry';
  if (deps['@remix-run/react']) return 'remix-static-entry';
  return 'static';
}

function preparePublish(root, options) {
  runBuild(root, options);
  const prepared = preparePublishManifest(root, options);
  if (options.writeManifest) {
    writeManifest(root, options, prepared.manifest);
  }
  return prepared;
}

function collectAssets(root, options, manifest) {
  const assetsRoot = resolveAssetsRoot(root, options);
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`Built assets directory not found: ${assetsRoot}`);
  }

  const files = [];
  collectAssetFiles(assetsRoot, assetsRoot, files);
  const required = [
    manifest.runtime?.entry,
    ...(Array.isArray(manifest.runtime?.styles) ? manifest.runtime.styles : []),
  ].filter(Boolean);
  for (const requiredPath of required) {
    const requiredAssetExists = files.some(
      (filePath) => normalizeRelativePath(assetsRoot, filePath) === requiredPath,
    );
    if (!requiredAssetExists) {
      throw new Error(
        `Manifest runtime asset "${requiredPath}" was not found under ${assetsRoot}.`,
      );
    }
  }
  return files
    .map((filePath) => normalizeRelativePath(assetsRoot, filePath))
    .filter(isHostedPublishAssetPath)
    .map((assetPath) => ({
      path: assetPath,
      contentsBase64: fs
        .readFileSync(path.join(assetsRoot, assetPath))
        .toString('base64'),
      contentType:
        CONTENT_TYPES.get(path.extname(assetPath).toLowerCase()) ||
        'application/octet-stream',
    }));
}

function collectAssetFiles(root, current, files) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      collectAssetFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function isPublishableBuildAssetPath(assetPath) {
  const normalized = assetPath.replace(/\\/g, '/').trim();
  const segments = normalized.split('/').filter(Boolean);
  const extension = path.extname(normalized).toLowerCase();
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
    segments.includes('..') ||
    extension === '.map'
  ) {
    return false;
  }

  return true;
}

async function publish(options) {
  const root = path.resolve(options.dir);
  const resolvedOptions = resolveDataAppOptions(root, options);
  const validationStatus = await resolveValidationStatus(root, resolvedOptions);
  const prepared = preparePublish(root, resolvedOptions);
  const saved = await saveDraft(resolvedOptions, { validationStatus });
  const dataAppId = requireValue(saved.dataAppId, 'Saved Data App id');
  const draftId = requireValue(saved.draftId, 'Saved draft id');
  const projectId = requireValue(
    resolvedOptions.projectId,
    '--project-id or semaphor.projectId in the manifest',
  );

  const start = await requestJson(
    { ...resolvedOptions, dataAppId },
    `/api/data-apps/${encodeURIComponent(dataAppId)}/publish/start`,
    {
      method: 'POST',
      body: JSON.stringify({
        draftId,
        sourceRevisionSnapshotHash: saved.sourceRevision.snapshotHash,
        validationStatus,
      }),
    },
  );
  const versionId = requireValue(
    start.publishSession?.versionId,
    'Publish session version id',
  );
  let publishStarted = true;

  try {
    const manifest = mergeManifestIdentity(prepared.manifest, {
      projectId,
      dataAppId,
    });
    if (resolvedOptions.writeManifest) {
      writeManifest(root, resolvedOptions, manifest);
    }
    const assets = collectAssets(root, resolvedOptions, manifest);
    for (const asset of assets) {
      await requestJson(
        { ...resolvedOptions, dataAppId },
        `/api/data-apps/${encodeURIComponent(dataAppId)}/publish/upload`,
        {
          method: 'POST',
          body: JSON.stringify({
            versionId,
            assetPath: asset.path,
            contentsBase64: asset.contentsBase64,
            contentType: asset.contentType,
          }),
        },
      );
    }

    const completed = await requestJson(
      { ...resolvedOptions, dataAppId },
      `/api/data-apps/${encodeURIComponent(dataAppId)}/publish/complete`,
      {
        method: 'POST',
        body: JSON.stringify({
          versionId,
          manifest,
          entryFile: manifest.runtime.entry,
          styleFiles: manifest.runtime.styles || [],
          validationStatus,
        }),
      },
    );
    publishStarted = false;
    return {
      dataAppId,
      draftId,
      sourceRevision: saved.sourceRevision,
      publishSession: start.publishSession,
      uploadedAssets: assets.map((asset) => asset.path),
      result: completed,
    };
  } catch (error) {
    if (publishStarted && versionId) {
      await requestJson(
        { ...resolvedOptions, dataAppId },
        `/api/data-apps/${encodeURIComponent(dataAppId)}/publish/fail`,
        {
          method: 'POST',
          body: JSON.stringify({
            versionId,
            validationStatus: {
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
            },
          }),
        },
      ).catch(() => undefined);
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help || !options.command) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  let result;
  if (options.command === 'load') {
    result = await loadDataApp(options);
  } else if (options.command === 'save-draft') {
    result = await saveDraft(options);
  } else if (options.command === 'prepare-publish') {
    const root = path.resolve(options.dir);
    const resolvedOptions = resolveDataAppOptions(root, options);
    const prepared = preparePublish(root, resolvedOptions);
    result = {
      manifestPath: prepared.manifestPath,
      assetsDir: prepared.assetsRoot,
      runtime: prepared.manifest.runtime,
      uploadAssets: prepared.uploadAssets,
      skippedAssets: prepared.skippedAssets,
      wroteManifest: options.writeManifest,
    };
  } else if (options.command === 'publish') {
    result = await publish(options);
  } else {
    throw new Error(`Unknown command: ${options.command}`);
  }

  writeJson(result, options.json);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
