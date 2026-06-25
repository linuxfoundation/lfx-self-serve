#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * docs:check-idempotence (T054 / R17 / FR-031)
 *
 * Asserts that two consecutive `docs:build` runs produce byte-identical
 * artifacts. The build script derives `generatedAt` from source-file
 * mtimes (not `Date.now()`) and the search index is canonically
 * serialized — but this guard makes the contract explicit so any future
 * regression in determinism fails CI before it can poison downstream
 * caches or produce noisy git diffs in PRs.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = resolve(dirname(__filename), '..');

const ARTIFACTS = [
  resolve(APP_ROOT, 'src', 'app', 'modules', 'docs', 'generated', 'docs-manifest.ts'),
  resolve(APP_ROOT, 'public', 'assets', 'docs', 'search-index.json'),
  resolve(APP_ROOT, 'dist-docs', 'sitemap.xml'),
];

function hashAll() {
  const out = {};
  for (const p of ARTIFACTS) {
    out[p] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
  return out;
}

function runBuild() {
  execFileSync('node', [resolve(APP_ROOT, 'scripts', 'build-docs.mjs')], {
    cwd: APP_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function main() {
  console.log('[docs:check-idempotence] run #1');
  runBuild();
  const first = hashAll();

  console.log('[docs:check-idempotence] run #2');
  runBuild();
  const second = hashAll();

  let drift = false;
  for (const path of ARTIFACTS) {
    if (first[path] !== second[path]) {
      drift = true;
      console.error(`[docs:check-idempotence] FAIL — non-deterministic output in ${path}`);
      console.error(`  run #1 sha256: ${first[path]}`);
      console.error(`  run #2 sha256: ${second[path]}`);
    }
  }

  if (drift) {
    console.error('[docs:check-idempotence] R17 violation — see scripts/build-docs.mjs and ensure no Date.now() / Math.random() / iteration-order-sensitive serialization.');
    process.exit(1);
  }

  console.log('[docs:check-idempotence] OK — all artifacts byte-stable across two runs');
}

main();
