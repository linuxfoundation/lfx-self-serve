#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppTestShards, parseShard } from './lib/app-test-shards.mjs';

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
  const files = discoverSpecs(join(APP_ROOT, 'src/app'));
  const { files: durations } = JSON.parse(readFileSync(join(APP_ROOT, 'scripts/frontend-test-durations.json'), 'utf8'));
  const shards = createAppTestShards(files, count, durations);
  for (const [offset, shard] of shards.entries()) {
    console.log(`[test:app] shard ${offset + 1}/${count}: ${shard.files.length} specs, estimated weight ${shard.seconds.toFixed(1)}s`);
  }
  const selected = shards[index - 1].files;
  if (options.includes('--list')) {
    console.log(selected.join('\n'));
  } else {
    // Keep Angular compilation and TestBed initialization. Plain Vitest cannot run these specs.
    const { status, signal, error } = spawnSync('yarn', ['test:app', '--watch=false', ...selected.map((file) => `--include=${file}`)], {
      cwd: APP_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    if (error) throw error;
    if (signal) console.error(`[test:app] shard ${index}/${count} was killed by ${signal}.`);
    process.exitCode = status ?? 1;
  }
} catch (error) {
  console.error(`[test:app] ${error.message}`);
  process.exitCode = 1;
}

function discoverSpecs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return discoverSpecs(full);
    if (entry.isFile() && entry.name.endsWith('.spec.ts')) return [relative(APP_ROOT, full).split(sep).join('/')];
    return [];
  });
}
