#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocsManifest } from './lib/build-manifest.mjs';
import { buildSearchIndex } from './lib/build-search-index.mjs';
import { buildSitemapXml } from './lib/build-sitemap.mjs';
import { walkDocsSource } from './lib/walk-source.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..'); // apps/lfx-one
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const SOURCE_ROOT = resolve(REPO_ROOT, 'docs', 'user');
const GENERATED_DIR = resolve(APP_ROOT, 'src', 'app', 'modules', 'docs', 'generated');
const DIST_DOCS_DIR = resolve(APP_ROOT, 'dist-docs');

// The search index ships as a static asset so the runtime can lazy-load it
// once and cache for the session (research R5). Angular's build copies
// everything under `public/` into `dist/lfx-one/browser/` verbatim, so
// emitting here gives us a stable URL at /assets/docs/search-index.json.
// The directory is gitignored — the file is regenerated each build.
const PUBLIC_ASSETS_DOCS_DIR = resolve(APP_ROOT, 'public', 'assets', 'docs');

const MANIFEST_TS_PATH = resolve(GENERATED_DIR, 'docs-manifest.ts');
const SEARCH_INDEX_JSON_PATH = resolve(PUBLIC_ASSETS_DOCS_DIR, 'search-index.json');
const SITEMAP_XML_PATH = resolve(DIST_DOCS_DIR, 'sitemap.xml');

const baseUrl = process.env.PCC_BASE_URL || process.env.DOCS_BASE_URL || 'https://app.lfx.dev';

console.log('[docs:build] reading source from', SOURCE_ROOT);
const records = walkDocsSource({ sourceRoot: SOURCE_ROOT, repoRoot: REPO_ROOT });
console.log(`[docs:build] found ${records.length} markdown files`);

if (records.length === 0) {
  console.error('[docs:build] No markdown files found under docs/user/. Aborting.');
  process.exit(1);
}

const { manifest, warnings } = buildDocsManifest({ records });

// FR-024 / SC-002 / US4: every article URL must be human-readable, free of
// query strings or fragments, and use lowercase + hyphens only. We assert
// this at build time so authors can't inadvertently introduce a URL that
// would break bookmarks, sitemap parity, or routing normalization. The
// regex matches `/docs` exactly (the synthetic landing) or
// `/docs/<seg>(/<seg>)*` where each segment is `[a-z0-9-]+`.
const URL_SHAPE = /^\/docs(?:\/[a-z0-9-]+)*$/;
const violatingUrls = Object.values(manifest.articles)
  .map((a) => a.url)
  .filter((url) => !URL_SHAPE.test(url));
if (violatingUrls.length > 0) {
  console.error('[docs:build] URL-shape violation (US4 / FR-024):');
  for (const url of violatingUrls) console.error(`  - ${url}`);
  console.error('  URLs must match ^/docs(?:/[a-z0-9-]+)*$ — no query strings, fragments, uppercase, or underscores.');
  process.exit(1);
}

const searchIndex = buildSearchIndex({ manifest });
const sitemapXml = buildSitemapXml({ manifest, baseUrl });

mkdirSync(GENERATED_DIR, { recursive: true });
mkdirSync(DIST_DOCS_DIR, { recursive: true });
mkdirSync(PUBLIC_ASSETS_DOCS_DIR, { recursive: true });

writeFileSync(MANIFEST_TS_PATH, renderManifestModule(manifest));
writeFileSync(SEARCH_INDEX_JSON_PATH, JSON.stringify(searchIndex, null, 2) + '\n');
writeFileSync(SITEMAP_XML_PATH, sitemapXml);

console.log('[docs:build] wrote', relativeFromApp(MANIFEST_TS_PATH));
console.log('[docs:build] wrote', relativeFromApp(SEARCH_INDEX_JSON_PATH));
console.log('[docs:build] wrote', relativeFromApp(SITEMAP_XML_PATH));
console.log(`[docs:build] articles=${Object.keys(manifest.articles).length} topics=${manifest.topics.length} contentHash=${manifest.contentHash.slice(0, 10)}`);

if (warnings.length > 0) {
  console.warn(`[docs:build] ${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

/**
 * Renders the manifest as a typed TypeScript module. Importing this module
 * gives the runtime synchronous, type-checked access to the manifest with
 * zero async cost on the SSR request path (research R8).
 *
 * @param {import('@lfx-one/shared').DocsManifest} manifest
 */
function renderManifestModule(manifest) {
  const header = [
    '// Copyright The Linux Foundation and each contributor to LFX.',
    '// SPDX-License-Identifier: MIT',
    '',
    '// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.',
    '// Regenerate via `yarn workspace lfx-one-ui docs:build`.',
    '// Sourced from docs/user/**/index.md.',
    '',
    "import type { DocsManifest } from '@lfx-one/shared/interfaces';",
    '',
  ].join('\n');
  const body = `export const docsManifest: DocsManifest = ${JSON.stringify(manifest, null, 2)};\n`;
  return header + body;
}

/** @param {string} absPath */
function relativeFromApp(absPath) {
  return absPath.replace(APP_ROOT + '/', '');
}
