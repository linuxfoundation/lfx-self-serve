#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const E2E_ROOT = resolve(APP_ROOT, 'e2e');

/**
 * GH-2381: a spec file that fails to *load* (a bad import, a static dependency that can't run in
 * Playwright's plain Node runtime, etc.) and a spec file with nothing in it report the same thing
 * today — "0 failures". `playwright test --list` already fails loudly and prints a stack trace
 * when collection breaks, but nothing was running it: the real `e2e` job is commented out of CI
 * (`.github/workflows/quality-check.yml`), so that failure was never seen.
 *
 * This check runs collection-only (`--list`, no browser, no `webServer`, no `globalSetup`) so it
 * can run on every PR regardless of secrets, and fails the build when either:
 *   1. Playwright's own collection errors are non-empty (a spec file threw while loading), or
 *   2. a `*.spec.ts` file that exists on disk under `e2e/` is missing from the collected set —
 *      catches a file that loads cleanly but silently contributes zero tests.
 *
 * Runs as the `e2e:check-collection` script, wired into the root `quality-checks` CI job (cheap
 * enough to run there; the full `e2e` job needs a live server + secrets and stays separate).
 */
const output = runPlaywrightList();
const result = JSON.parse(output);

const loadErrors = result.errors ?? [];
if (loadErrors.length > 0) {
  console.error(`[e2e:check-collection] FAIL: ${loadErrors.length} spec file(s) failed to load`);
  for (const err of loadErrors) {
    const where = err.location ? ` (${err.location.file}:${err.location.line}:${err.location.column})` : '';
    console.error(`  ${err.message.split('\n')[0]}${where}`);
  }
  process.exit(1);
}

const collectedFiles = new Set((result.suites ?? []).map((s) => s.file));
const diskFiles = walkSpecFiles(E2E_ROOT);
const missing = diskFiles.filter((f) => !collectedFiles.has(f));

if (missing.length > 0) {
  console.error(`[e2e:check-collection] FAIL: ${missing.length} spec file(s) on disk did not collect any tests`);
  for (const f of missing) console.error(`  e2e/${f}`);
  process.exit(1);
}

console.log(`[e2e:check-collection] OK: ${diskFiles.length} spec file(s) collected, 0 load errors`);
process.exit(0);

/**
 * @returns {string} the raw stdout of `playwright test --list --reporter=json`
 */
function runPlaywrightList() {
  try {
    return execFileSync('yarn', ['playwright', 'test', '--list', '--reporter=json'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // The JSON report for this suite runs several MB; Node's execFileSync default (1MB) would
      // truncate it mid-stream and turn a real result into a JSON.parse crash.
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (err) {
    // Playwright exits non-zero when collection errors exist, which is exactly the case this
    // check needs to inspect — its JSON report (with the errors array) is still on stdout.
    if (err.stdout) return err.stdout.toString();
    throw err;
  }
}

/**
 * @param {string} dir
 * @returns {string[]} `*.spec.ts` file paths relative to `e2e/`, matching the `file` field
 *   Playwright's JSON reporter reports for each collected suite.
 */
function walkSpecFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...walkSpecFiles(full));
    } else if (entry.endsWith('.spec.ts')) {
      found.push(relative(E2E_ROOT, full));
    }
  }
  return found;
}
