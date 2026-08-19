#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/*
 * Runs both unit-test halves — server (vitest, node) and app (ng test, jsdom) —
 * unconditionally, and exits with the worse of the two statuses.
 *
 * This is a script rather than a `package.json` one-liner because `yarn run`
 * executes scripts in Yarn's own portable shell, not in `sh`. That shell has no
 * `$?` and no `$(( ))`: it globs the `?` instead ("No matches found") and hands
 * `process.exitCode` a NaN. Chaining with `&&` would work in that shell but is
 * the thing being avoided — a failing server spec must not stop the app half,
 * or CI reports only the first failure and costs a second round to find the
 * second.
 */

import { spawnSync } from 'node:child_process';

/** Runs one half and returns its exit code, treating a signal kill as a failure. */
function runHalf(script) {
  const { status, signal } = spawnSync('yarn', [script], { stdio: 'inherit', shell: false });
  if (signal) {
    console.error(`\n${script} was killed by ${signal}`);
    return 1;
  }
  return status ?? 1;
}

const server = runHalf('test:server');
const app = runHalf('test:app');

process.exit(Math.max(server, app));
