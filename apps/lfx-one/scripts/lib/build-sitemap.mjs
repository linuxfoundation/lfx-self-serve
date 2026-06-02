// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const DEFAULT_BASE_URL = 'https://app.lfx.dev';

/**
 * Builds the sitemap XML payload from a manifest. Same shape as
 * `specs/001-public-docs-portal/contracts/sitemap.example.xml`.
 *
 * Priorities (per the example contract):
 *   - root /docs landing → 1.0
 *   - topic landing       → 0.8
 *   - leaf article        → 0.7
 *
 * `changefreq` is `weekly` for everything at launch; we don't have per-article
 * cadence data yet to differentiate.
 *
 * @param {{ manifest: import('@lfx-one/shared').DocsManifest, baseUrl?: string }} args
 * @returns {string}
 */
export function buildSitemapXml({ manifest, baseUrl = DEFAULT_BASE_URL }) {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  /** @type {string[]} */
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

  // Sort articles by URL for byte-identical output across runs (R17).
  const articles = Object.values(manifest.articles).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

  for (const article of articles) {
    const priority = article.slug === '' ? '1.0' : article.isTopicLanding ? '0.8' : '0.7';
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${trimmedBase}${article.url}`)}</loc>`);
    lines.push(`    <lastmod>${escapeXml(article.lastUpdated)}</lastmod>`);
    lines.push('    <changefreq>weekly</changefreq>');
    lines.push(`    <priority>${priority}</priority>`);
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  // Trailing newline so the file is "well-formed" by Unix conventions.
  return lines.join('\n') + '\n';
}

/** @param {string} value */
function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
