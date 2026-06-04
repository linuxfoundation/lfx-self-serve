#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDocsManifest } from './lib/build-manifest.mjs';
import { walkDocsSource } from './lib/walk-source.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const SOURCE_ROOT = resolve(REPO_ROOT, 'docs', 'user');
const SITEMAP_PATH = resolve(APP_ROOT, 'dist-docs', 'sitemap.xml');

/**
 * SC-003a invariant: the URL set in `dist-docs/sitemap.xml` MUST equal the
 * URL set computed from the manifest's articles. This script reads both,
 * derives the URL paths from each, and fails with a non-zero exit code when
 * they differ.
 *
 * Runs as the `docs:check-sitemap` npm script. Wired into `docs:check` so
 * the MVP cut after Phase 3 can rely on automated parity, not manual review.
 */
const sitemapXml = readFileSync(SITEMAP_PATH, 'utf8');
const sitemapUrls = parseSitemapUrls(sitemapXml);

const records = walkDocsSource({ sourceRoot: SOURCE_ROOT, repoRoot: REPO_ROOT });
const { manifest } = buildDocsManifest({ records });
const manifestUrls = new Set(Object.values(manifest.articles).map((a) => a.url));

const missingFromSitemap = [...manifestUrls].filter((u) => !sitemapUrls.has(u));
const extraInSitemap = [...sitemapUrls].filter((u) => !manifestUrls.has(u));

if (missingFromSitemap.length === 0 && extraInSitemap.length === 0) {
  console.log(`[docs:check-sitemap] OK: ${manifestUrls.size} URLs match`);
  process.exit(0);
}

console.error('[docs:check-sitemap] FAIL: sitemap and manifest disagree (SC-003a)');
if (missingFromSitemap.length > 0) {
  console.error(`  ${missingFromSitemap.length} URL(s) in manifest but missing from sitemap.xml:`);
  for (const u of missingFromSitemap) console.error(`    ${u}`);
}
if (extraInSitemap.length > 0) {
  console.error(`  ${extraInSitemap.length} URL(s) in sitemap.xml but missing from manifest:`);
  for (const u of extraInSitemap) console.error(`    ${u}`);
}
process.exit(1);

/**
 * Pulls path-only URLs out of the sitemap (drops scheme + host so the parity
 * check is base-URL-agnostic).
 *
 * @param {string} xml
 * @returns {Set<string>}
 */
function parseSitemapUrls(xml) {
  /** @type {Set<string>} */
  const urls = new Set();
  const locRe = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRe.exec(xml)) !== null) {
    const loc = m[1].trim();
    try {
      const u = new URL(loc);
      urls.add(u.pathname.replace(/\/+$/, '') || '/');
    } catch {
      urls.add(loc);
    }
  }
  return urls;
}
