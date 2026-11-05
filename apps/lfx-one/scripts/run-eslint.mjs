#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/*
 * Runs ESLint once per TypeScript project, each in its own process, and exits with the
 * worst status.
 *
 * Typed linting builds a full TypeScript program for every `parserOptions.project` it meets
 * and keeps it alive until the process exits. The app, app specs and server specs are three
 * programs (see eslint.config.js), and holding all three in one process needs ~7 GB of heap.
 * Run separately, each one fits in Node's default heap.
 *
 * Arguments starting with `-` are forwarded to every run (e.g. `--fix`). Any other argument
 * is a file path, as lint-staged passes them. It goes to the run that owns its project: app
 * specs, server specs, or the app run for everything else. Every run lints its whole glob
 * either way, which matches the old single-command script. Flags that take a separate value
 * are not supported; use the `--flag=value` form.
 */

import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';

const appRoot = resolve(import.meta.dirname, '..');

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
  const { status, signal } = spawnSync('yarn', ['eslint', ...run.args, ...flags, ...owned], { cwd: appRoot, stdio: 'inherit', shell: false });
  if (signal) {
    console.error(`\neslint (${run.name}) was killed by ${signal}`);
  }
  worst = Math.max(worst, signal ? 1 : (status ?? 1));
}

process.exit(worst);
