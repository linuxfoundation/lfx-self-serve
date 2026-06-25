#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * docs:validate (T053 / FR-031 / SC-006)
 *
 * Validates the two build artifacts produced by `docs:build` against the
 * authoritative JSON Schemas in
 * `specs/001-public-docs-portal/contracts/`. Fails the build on any
 * deviation so authors catch shape drift before it reaches production:
 *
 *   - apps/lfx-one/src/app/modules/docs/generated/docs-manifest.ts
 *     (the `docsManifest` constant) → docs-manifest.schema.json
 *   - apps/lfx-one/public/assets/docs/search-index.json
 *     → search-index.schema.json
 *
 * Manifest extraction is eval-free: we slice the file between the
 * `export const docsManifest = ` prefix and the trailing `;\n` and parse
 * the body as JSON5-shaped JSON (the build script emits strict JSON,
 * indented by the renderer in `build-docs.mjs`).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = resolve(dirname(__filename), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'specs', '001-public-docs-portal', 'contracts');
const MANIFEST_TS_PATH = resolve(APP_ROOT, 'src', 'app', 'modules', 'docs', 'generated', 'docs-manifest.ts');
const SEARCH_INDEX_JSON_PATH = resolve(APP_ROOT, 'public', 'assets', 'docs', 'search-index.json');

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * Extracts the `docsManifest` constant from the generated `.ts` file
 * without `eval`/`new Function`. The renderer in `build-docs.mjs`
 * emits a single top-level `export const docsManifest: DocsManifest = {…};`
 * statement, so a robust slice is sufficient.
 */
async function loadManifestFromTs(path) {
  const raw = await readFile(path, 'utf8');
  const start = raw.indexOf('= {');
  const end = raw.lastIndexOf('};');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`[docs:validate] could not locate docsManifest body in ${path}`);
  }
  const body = raw.slice(start + 2, end + 1);
  return JSON.parse(body);
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const manifestSchema = await readJson(resolve(CONTRACTS_DIR, 'docs-manifest.schema.json'));
  const searchSchema = await readJson(resolve(CONTRACTS_DIR, 'search-index.schema.json'));

  const validateManifest = ajv.compile(manifestSchema);
  const validateSearch = ajv.compile(searchSchema);

  const manifest = await loadManifestFromTs(MANIFEST_TS_PATH);
  const searchIndex = await readJson(SEARCH_INDEX_JSON_PATH);

  let failed = false;

  if (!validateManifest(manifest)) {
    failed = true;
    console.error('[docs:validate] FAIL — docs-manifest.ts violates docs-manifest.schema.json:');
    for (const err of validateManifest.errors ?? []) {
      console.error(`  - ${err.instancePath || '/'} ${err.message} ${JSON.stringify(err.params)}`);
    }
  } else {
    console.log(`[docs:validate] OK — docs-manifest.ts (${Object.keys(manifest.articles).length} articles, ${manifest.topics.length} topics)`);
  }

  if (!validateSearch(searchIndex)) {
    failed = true;
    console.error('[docs:validate] FAIL — search-index.json violates search-index.schema.json:');
    for (const err of validateSearch.errors ?? []) {
      console.error(`  - ${err.instancePath || '/'} ${err.message} ${JSON.stringify(err.params)}`);
    }
  } else {
    console.log(`[docs:validate] OK — search-index.json (${Object.keys(searchIndex.entries).length} entries)`);
  }

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('[docs:validate] unexpected error');
  console.error(err);
  process.exit(2);
});
