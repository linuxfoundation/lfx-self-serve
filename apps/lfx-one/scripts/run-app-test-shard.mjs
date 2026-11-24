#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppTestShards, discoverSpecs, parseShard } from './lib/app-test-shards.mjs';
import { checkSpecBudget, formatViolation } from './lib/check-spec-budget.mjs';
import { attachSpecPaths, missingSpecs, parseVitestFileLines } from './lib/spec-timings.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const [value, ...options] = process.argv.slice(2);
  if (options.length > 1 || options.some((option) => option !== '--list')) {
    throw new Error('Usage: node scripts/run-app-test-shard.mjs index/count [--list]');
  }
  const { index, count } = parseShard(value);
  const angular = JSON.parse(readFileSync(join(APP_ROOT, 'angular.json'), 'utf8'));
  const target = angular.projects['lfx-one'].architect.test;
  // Match the unsharded target exactly. A changed collection contract needs a corresponding
  // discovery update, not a green CI run that silently leaves new patterns untested.
  if (
    target.builder !== '@angular/build:unit-test' ||
    JSON.stringify(target.options.include) !== JSON.stringify(['src/app/**/*.spec.ts']) ||
    (target.options.exclude?.length ?? 0) > 0 ||
    target.defaultConfiguration
  ) {
    throw new Error('Angular test discovery changed; update shard discovery to match before running CI.');
  }
  const files = discoverSpecs(join(APP_ROOT, 'src/app'), APP_ROOT);
  const { files: durations } = JSON.parse(readFileSync(join(APP_ROOT, 'scripts/frontend-test-durations.json'), 'utf8'));
  const shards = createAppTestShards(files, count, durations);
  for (const [offset, shard] of shards.entries()) {
    console.log(`[test:app] shard ${offset + 1}/${count}: ${shard.files.length} specs, estimated weight ${shard.seconds.toFixed(1)}s`);
  }
  const selected = shards[index - 1].files;
  if (options.includes('--list')) {
    console.log(selected.join('\n'));
  } else {
    const { status, output } = await runShard(selected, `${index}/${count}`);
    const budgetFailed = checkBudget(output, selected);
    process.exitCode = status === 0 && budgetFailed ? 1 : (status ?? 1);
  }
} catch (error) {
  console.error(`[test:app] ${error.message}`);
  process.exitCode = 1;
}

/**
 * Keep Angular compilation and TestBed initialization; plain Vitest cannot run these specs.
 * Stdout is mirrored live and kept, so the per-file timing lines can be checked afterwards.
 */
function runShard(selected, label) {
  return new Promise((resolvePromise, reject) => {
    // Piping stdout would otherwise turn colours off for a developer running a shard locally.
    const env = process.stdout.isTTY && !('FORCE_COLOR' in process.env) ? { ...process.env, FORCE_COLOR: '1' } : process.env;
    const child = spawn('yarn', ['test:app', '--watch=false', ...selected.map((file) => `--include=${file}`)], {
      cwd: APP_ROOT,
      env,
      stdio: ['inherit', 'pipe', 'inherit'],
      shell: false,
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      if (signal) console.error(`[test:app] shard ${label} was killed by ${signal}.`);
      resolvePromise({ status, output: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

/** Returns true when the shard must fail on the per-file runtime budget (#5980). */
function checkBudget(output, selected) {
  const { matched, unknown } = attachSpecPaths(parseVitestFileLines(output), selected);
  if (unknown.length > 0) console.log(`[test:app] timings for specs outside this shard were ignored: ${unknown.join(', ')}`);
  if (matched.length === 0) {
    console.error('[test:app] Found no per-file Vitest timings in the shard output, so the runtime budget could not be checked. Update scripts/lib/spec-timings.mjs to match the new output.');
    return true;
  }
  const missing = missingSpecs(matched, selected);
  if (missing.length > 0) {
    const shown = missing.slice(0, 10).join(', ');
    console.error(
      `[test:app] No Vitest timing line for ${missing.length} of ${selected.length} specs in this shard, so their runtime budget could not be checked: ` +
        `${shown}${missing.length > 10 ? ', ...' : ''}. Update scripts/lib/spec-timings.mjs to match the output.`
    );
    return true;
  }
  const { files: baseline } = JSON.parse(readFileSync(join(APP_ROOT, 'scripts/spec-budget-baseline.json'), 'utf8'));
  const violations = checkSpecBudget(matched, baseline);
  for (const violation of violations) {
    const message = formatViolation(violation);
    console.error(`[test:app] Spec runtime budget: ${message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error file=apps/lfx-one/${violation.file},title=Spec runtime budget::${message}`);
  }
  if (violations.length === 0) console.log(`[test:app] Spec runtime budget: ${matched.length} spec files checked, all within budget.`);
  return violations.length > 0;
}
