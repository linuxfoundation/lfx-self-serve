#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 *   1. Playwright's own collection errors are non-empty (a spec file threw while loading, or a
 *      `forbidOnly` violation fired — either way something needs a human to look at it), or
 *   2. a `*.spec.ts` file that exists on disk under `e2e/` is missing from the collected set —
 *      catches a file that loads cleanly but silently contributes zero tests.
 *
 * Runs as the `e2e:check-collection` script, wired into the root `quality-checks` CI job (cheap
 * enough to run there; the full `e2e` job needs a live server + secrets and stays separate).
 */
const reportDir = mkdtempSync(join(tmpdir(), 'e2e-check-collection-'));
const reportPath = join(reportDir, 'report.json');

let result;
try {
  result = runPlaywrightList(reportPath);
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

const collectionErrors = result.errors ?? [];
if (collectionErrors.length > 0) {
  console.error(`[e2e:check-collection] FAIL: ${collectionErrors.length} collection error(s) — see stacks below`);
  for (const err of collectionErrors) {
    const where = err.location ? ` (${err.location.file}:${err.location.line}:${err.location.column})` : '';
    console.error(`  ${(err.stack ?? err.message)}${where}`);
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

console.log(`[e2e:check-collection] OK: ${diskFiles.length} spec file(s) collected, 0 collection errors`);
process.exit(0);

/**
 * Runs `playwright test --list`, writing its JSON report to `reportPath` via
 * `PLAYWRIGHT_JSON_OUTPUT_NAME` instead of parsing stdout — a stray `console.log` in
 * `playwright.config.ts` (or a reporter change) would otherwise corrupt an in-memory parse.
 * stderr is inherited so a failure this script's own JSON.parse can't make sense of (Playwright
 * dying before it writes a report at all — a bad config, an unresolvable module at config load)
 * still lands its diagnostics in the CI log instead of vanishing.
 *
 * @param {string} reportPath
 * @returns {{ errors?: unknown[], suites?: { file: string }[] }}
 */
function runPlaywrightList(reportPath) {
  try {
    execFileSync('yarn', ['playwright', 'test', '--list', '--reporter=json'], {
      cwd: APP_ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    });
  } catch {
    // Playwright exits non-zero when collection errors exist, which is exactly the case this
    // check needs to inspect — it still writes its JSON report when it gets far enough to collect
    // at all; only re-throw once the report is confirmed absent, below.
  }

  let raw;
  try {
    raw = readFileSync(reportPath, 'utf8');
  } catch {
    console.error('[e2e:check-collection] FAIL: playwright produced no JSON report at all (see stderr above)');
    process.exit(1);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[e2e:check-collection] FAIL: playwright wrote an unparsable JSON report');
    console.error(err.message);
    process.exit(1);
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
