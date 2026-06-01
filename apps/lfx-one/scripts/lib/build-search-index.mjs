// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import MiniSearch from 'minisearch';

const SEARCH_INDEX_SCHEMA_VERSION = 1;

/**
 * Builds the serialized MiniSearch index from a manifest. The root landing is
 * excluded from search (it's a navigation page, not a content match) — this
 * matches the data-model.md §5 invariant.
 *
 * Field boosts (research R5):
 *   - title:    3×
 *   - headings: 2×
 *   - tags:     2×
 *   - body:     1×
 *
 * Search options enable prefix and fuzzy matching by default; the runtime
 * search UI doesn't need to override anything.
 *
 * @param {{ manifest: import('@lfx-one/shared').DocsManifest }} args
 * @returns {import('@lfx-one/shared').DocsSearchIndexFile}
 */
export function buildSearchIndex({ manifest }) {
  /** @type {import('@lfx-one/shared').DocsSearchEntry[]} */
  const entries = [];
  for (const article of Object.values(manifest.articles)) {
    if (article.slug === '') continue;
    entries.push({
      id: article.slug,
      title: article.title,
      headings: article.headings
        .filter((h) => h.level <= 4)
        .map((h) => h.text)
        .join(' '),
      body: article.bodyText,
      tags: (article.tags ?? []).join(' '),
      url: article.url,
      topic: article.topic,
    });
  }

  // Sort entries by id for deterministic output (research R17).
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const miniSearch = new MiniSearch({
    fields: ['title', 'headings', 'body', 'tags'],
    storeFields: ['url', 'topic'],
    searchOptions: {
      boost: { title: 3, headings: 2, tags: 2, body: 1 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'AND',
    },
  });
  miniSearch.addAll(entries);

  /** @type {Record<string, import('@lfx-one/shared').DocsSearchEntry>} */
  const entriesById = {};
  for (const e of entries) entriesById[e.id] = e;

  return {
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    // generatedAt mirrors the manifest's so they always carry the same wall-clock.
    generatedAt: manifest.generatedAt,
    miniSearch: miniSearch.toJSON(),
    entries: entriesById,
  };
}
