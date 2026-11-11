#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/*
 * Runs ESLint in three processes (app, app specs, server specs) and exits with the worst
 * status.
 *
 * Typed linting builds a full TypeScript program for every `parserOptions.project` it meets
 * and keeps it alive until the process exits (see eslint.config.js). The app run also lints the
 * stories, so it holds the app and Storybook programs; the two spec runs hold one program each.
 * Holding them all in one process needs ~7 GB of heap. Split this way, each run stays near
 * Node's default heap; CI gives the lint job 8 GB of headroom for large branches.
 *
 * Arguments starting with `-` are forwarded to every run (e.g. `--fix`). Any other argument
 * is a file path, as lint-staged passes them. It goes to the run that owns its project: app
 * specs, server specs, or the app run for everything else. Every run lints its whole glob
 * either way, which matches the old single-command script. Flags that take a separate value
 * are not supported; use the `--flag=value` form.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..');

// Run ESLint's bin with the current Node rather than through `yarn`, whose Windows shim
// (`yarn.cmd`) spawnSync can't start without a shell. The package doesn't export `bin/`, so
// the path comes from its package.json.
const require = createRequire(import.meta.url);
const eslintBin = resolve(dirname(require.resolve('eslint/package.json')), require('eslint/package.json').bin.eslint);

const runs = [
  { name: 'app', args: ['src/**/*.{ts,html}', '--ignore-pattern', '**/*.spec.ts'], owns: () => true },
  { name: 'app specs', args: ['src/app/**/*.spec.ts'], owns: (path) => path.startsWith(`src${sep}app${sep}`) && path.endsWith('.spec.ts') },
  { name: 'server specs', args: ['src/server/**/*.spec.ts'], owns: (path) => path.startsWith(`src${sep}server${sep}`) && path.endsWith('.spec.ts') },
];

const argv = process.argv.slice(2);
const flags = argv.filter((arg) => arg.startsWith('-'));
const files = argv.filter((arg) => !arg.startsWith('-'));

/** The specific runs are checked first, so a spec never falls through to the app run. */
function ownerOf(file) {
  const path = relative(appRoot, resolve(file));
  return [...runs.slice(1), runs[0]].find((run) => run.owns(path));
}

let worst = 0;
for (const run of runs) {
  const owned = files.filter((file) => ownerOf(file) === run);
  console.log(`\n> eslint (${run.name})`);
  const { status, signal, error } = spawnSync(process.execPath, [eslintBin, ...run.args, ...flags, ...owned], { cwd: appRoot, stdio: 'inherit', shell: false });
  if (error) {
    console.error(`\neslint (${run.name}) failed to start: ${error.message}`);
  }
  if (signal) {
    console.error(`\neslint (${run.name}) was killed by ${signal}`);
  }
  worst = Math.max(worst, signal ? 1 : (status ?? 1));
}

process.exit(worst);
