#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs(argv) {
  const args = { dir: process.cwd(), json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      args.dir = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function detectFramework(root, pkg) {
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  if (deps.next || fs.existsSync(path.join(root, 'next.config.js')) || fs.existsSync(path.join(root, 'next.config.mjs'))) {
    return 'next';
  }
  if (deps['@remix-run/react']) return 'remix';
  if (deps['react-router'] || deps['react-router-dom']) return 'react-router';
  if (deps.vite || fs.existsSync(path.join(root, 'vite.config.ts')) || fs.existsSync(path.join(root, 'vite.config.js'))) {
    return 'vite';
  }
  return 'react';
}

function commandFor(packageManager, command) {
  if (packageManager === 'pnpm') return `pnpm ${command}`;
  if (packageManager === 'yarn') return `yarn ${command}`;
  if (packageManager === 'bun') return `bun ${command}`;
  return `npm run ${command}`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: detect-react-app.mjs [--dir <path>] [--json]');
    process.exit(0);
  }

  const root = path.resolve(args.dir);
  const packageJsonPath = path.join(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`No package.json found at ${packageJsonPath}`);
    process.exit(1);
  }

  const pkg = readJson(packageJsonPath);
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const packageManager = detectPackageManager(root);
  const framework = detectFramework(root, pkg);
  const scripts = pkg.scripts || {};
  const result = {
    root,
    name: pkg.name || path.basename(root),
    packageManager,
    framework,
    hasReact: Boolean(deps.react),
    hasReactDom: Boolean(deps['react-dom']),
    hasReactSemaphor: Boolean(deps['react-semaphor']),
    reactSemaphorVersion: deps['react-semaphor'] || null,
    scripts: {
      typecheck: scripts.typecheck ? commandFor(packageManager, 'typecheck') : null,
      build: scripts.build ? commandFor(packageManager, 'build') : null,
      dev: scripts.dev ? commandFor(packageManager, 'dev') : null,
    },
    recommendedInstall:
      packageManager === 'pnpm'
        ? 'pnpm add react-semaphor'
        : packageManager === 'yarn'
          ? 'yarn add react-semaphor'
          : packageManager === 'bun'
            ? 'bun add react-semaphor'
            : 'npm install react-semaphor',
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`React app: ${result.name}`);
  console.log(`Root: ${result.root}`);
  console.log(`Framework: ${result.framework}`);
  console.log(`Package manager: ${result.packageManager}`);
  console.log(`React installed: ${result.hasReact ? 'yes' : 'no'}`);
  console.log(`react-semaphor installed: ${result.hasReactSemaphor ? result.reactSemaphorVersion : 'no'}`);
  if (!result.hasReactSemaphor) {
    console.log(`Install SDK: ${result.recommendedInstall}`);
  }
  if (result.scripts.typecheck) console.log(`Typecheck: ${result.scripts.typecheck}`);
  if (result.scripts.build) console.log(`Build: ${result.scripts.build}`);
  if (result.scripts.dev) console.log(`Dev server: ${result.scripts.dev}`);
}

main();
