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
const SPEC_PATTERN = /\.(spec|test)\.[cm]?[jt]sx?$/;

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
 *   2. a spec file that exists on disk under `e2e/` is missing from the collected set — catches a
 *      file that loads cleanly but silently contributes zero tests (including the degenerate case
 *      of `e2e/` itself having no spec files at all).
 *
 * Runs as the `e2e:check-collection` script, wired into the root `quality-checks` CI job (cheap
 * enough to run there; the full `e2e` job needs a live server + secrets and stays separate).
 */

/**
 * A JSON.parse of the failure message string is intentionally not attempted here — this class
 * just carries a human-readable summary plus optional detail lines up to the single top-level
 * exit(1), so the temp-dir `finally` below always gets a chance to run first (a bare
 * `process.exit()` inside `runPlaywrightList`/`checkCollection` would skip it). Declared before any
 * executable statement below so the top-level `catch`'s `instanceof` check isn't a TDZ reference to
 * a `class` binding that hasn't been reached yet.
 */
class CollectionCheckFailure extends Error {
  /**
   * @param {string} message
   * @param {string[]} [detailLines]
   */
  constructor(message, detailLines) {
    super(message);
    this.detailLines = detailLines;
  }
}

const reportDir = mkdtempSync(join(tmpdir(), 'e2e-check-collection-'));
const reportPath = join(reportDir, 'report.json');

try {
  const result = runPlaywrightList(reportPath);
  checkCollection(result);
} catch (err) {
  if (err instanceof CollectionCheckFailure) {
    console.error(`[e2e:check-collection] FAIL: ${err.message}`);
    for (const line of err.detailLines ?? []) console.error(`  ${line}`);
    process.exit(1);
  }
  throw err;
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

/**
 * @param {{ config?: { rootDir?: string }, errors?: { message: string, stack?: string, location?: { file: string, line: number, column: number } }[], suites?: { file: string }[] }} result
 */
function checkCollection(result) {
  const collectionErrors = result.errors ?? [];
  if (collectionErrors.length > 0) {
    throw new CollectionCheckFailure(
      `${collectionErrors.length} collection error(s) — see stacks below`,
      collectionErrors.map((err) => {
        const where = err.location ? ` (${err.location.file}:${err.location.line}:${err.location.column})` : '';
        return `${err.stack ?? err.message}${where}`;
      })
    );
  }

  const diskFiles = walkSpecFiles(E2E_ROOT);
  if (diskFiles.length === 0) {
    // The same silent-zero failure this script exists to catch, just at the whole-directory level
    // (e2e/ emptied, renamed, or every spec moved) — an empty collected set would otherwise report
    // "OK: 0 spec file(s) collected" and exit 0.
    throw new CollectionCheckFailure(`no spec files found under ${relative(APP_ROOT, E2E_ROOT)}/`);
  }

  // Playwright's JSON reporter reports each suite's `file` relative to `config.rootDir`, which is
  // only `e2e/` today because a single `testDir: './e2e'` is the common ancestor of all projects;
  // resolve through the report's own `rootDir` rather than assuming it, so this doesn't silently
  // break (every file reported "missing") if a project ever gets its own `testDir`.
  const rootDir = result.config?.rootDir ?? E2E_ROOT;
  const collectedFiles = new Set((result.suites ?? []).map((s) => resolve(rootDir, s.file)));
  const missing = diskFiles.filter((f) => !collectedFiles.has(f));

  if (missing.length > 0) {
    throw new CollectionCheckFailure(
      `${missing.length} spec file(s) on disk did not collect any tests` +
        ' (if you ran this locally, a stray test.only or a --grep filter can also produce this)',
      missing.map((f) => relative(APP_ROOT, f))
    );
  }

  console.log(`[e2e:check-collection] OK: ${diskFiles.length} spec file(s) collected, 0 collection errors`);
}

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
    // at all; only throw once the report is confirmed absent, below.
  }

  let raw;
  try {
    raw = readFileSync(reportPath, 'utf8');
  } catch {
    throw new CollectionCheckFailure('playwright produced no JSON report at all (see stderr above)');
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CollectionCheckFailure('playwright wrote an unparsable JSON report', [err.message]);
  }
}

/**
 * @param {string} dir
 * @returns {string[]} absolute paths of spec files (`*.spec.ts` and the same family Playwright's
 *   default `testMatch` collects, e.g. `*.test.ts`) found under `dir`.
 */
function walkSpecFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...walkSpecFiles(full));
    } else if (SPEC_PATTERN.test(entry)) {
      found.push(full);
    }
  }
  return found;
}
