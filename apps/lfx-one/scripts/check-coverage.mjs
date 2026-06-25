#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * docs:check-coverage (T051 / FR-010 / FR-022 / SC-003 / SC-010)
 *
 * Two invariants hold the docs build to its content contract:
 *
 *   1. File coverage — every `index.md` under `docs/user/` (excluding the
 *      VitePress-style root) must surface as a manifest article.
 *   2. Navigation reachability — every leaf article must be reachable
 *      within ≤2 hops from `/docs` via topic-landing breadcrumbs.
 *
 * Failure on either invariant exits non-zero; the CI workflow consumes
 * this as part of the `docs:check` aggregate alongside `docs:validate`
 * and `docs:check-sitemap`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const APP_ROOT = resolve(dirname(__filename), '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const DOCS_USER_DIR = resolve(REPO_ROOT, 'docs', 'user');
const MANIFEST_TS_PATH = resolve(APP_ROOT, 'src', 'app', 'modules', 'docs', 'generated', 'docs-manifest.ts');

const MAX_HOPS_FROM_LANDING = 2;

function loadManifest() {
  const raw = readFileSync(MANIFEST_TS_PATH, 'utf8');
  const start = raw.indexOf('= {');
  const end = raw.lastIndexOf('};');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`[docs:check-coverage] could not locate docsManifest body in ${MANIFEST_TS_PATH}`);
  }
  return JSON.parse(raw.slice(start + 2, end + 1));
}

function walkMarkdown(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkMarkdown(full, acc);
    } else if (entry === 'index.md') {
      acc.push(full);
    }
  }
  return acc;
}

function checkFileCoverage(manifest) {
  const sourceFiles = walkMarkdown(DOCS_USER_DIR)
    .map((f) => relative(REPO_ROOT, f).split('\\').join('/'))
    // Skip the VitePress-style root landing (docs/user/index.md). The
    // build pipeline replaces it with a synthetic root landing populated
    // from the manifest topics.
    .filter((p) => p !== 'docs/user/index.md');

  const indexedSources = new Set(Object.keys(manifest.sourcePathToSlug ?? {}));

  const missing = sourceFiles.filter((p) => !indexedSources.has(p));
  if (missing.length > 0) {
    console.error('[docs:check-coverage] FAIL — markdown files missing from manifest (FR-010 / SC-003):');
    for (const p of missing) console.error(`  - ${p}`);
    return false;
  }

  console.log(`[docs:check-coverage] OK — file coverage (${sourceFiles.length} markdown files all indexed)`);
  return true;
}

function checkReachability(manifest) {
  const articles = manifest.articles ?? {};
  const violations = [];

  for (const [slug, article] of Object.entries(articles)) {
    if (slug === '') continue;
    // breadcrumb[0] is the root landing, so hops = breadcrumb.length - 1.
    // Topic landing pages have breadcrumb.length = 2 (root → topic) =>
    // 1 hop. Leaf articles have breadcrumb.length = 3 => 2 hops, which
    // is the SC-010 ceiling. Anything deeper violates the contract.
    const hops = (article.breadcrumb?.length ?? 1) - 1;
    if (hops > MAX_HOPS_FROM_LANDING) {
      violations.push({ slug, hops, breadcrumb: article.breadcrumb?.map((b) => b.slug || '<root>').join(' → ') });
    }
  }

  if (violations.length > 0) {
    console.error('[docs:check-coverage] FAIL — articles unreachable within ≤2 hops from /docs (SC-010):');
    for (const v of violations) console.error(`  - ${v.slug} (hops=${v.hops}, breadcrumb=${v.breadcrumb})`);
    return false;
  }

  console.log(`[docs:check-coverage] OK — navigation reachability (all ${Object.keys(articles).length - 1} articles ≤${MAX_HOPS_FROM_LANDING} hops from /docs)`);
  return true;
}

function main() {
  const manifest = loadManifest();
  const fileOk = checkFileCoverage(manifest);
  const reachOk = checkReachability(manifest);
  if (!fileOk || !reachOk) process.exit(1);
}

main();
