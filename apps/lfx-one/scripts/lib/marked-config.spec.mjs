// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { docsArticleUrl, rewriteHref } from './marked-config.mjs';

/**
 * Pins the same-page anchor rewrite at the URL-shape boundary. A bare
 * `#fragment` from authored markdown must become the article's own absolute
 * `/docs/...#fragment` URL — including the synthetic root article, whose
 * empty slug maps to `/docs` (never `/docs/`). No e2e exercises the root
 * case, and reverting the `docsArticleUrl` empty-slug special-case would
 * emit `/docs/#x` (a different route) with every other test green.
 */

/** @param {string} slug */
function ctxFor(slug) {
  return {
    article: { slug, sourcePath: 'docs/user/x/index.md', topic: 'x' },
    sourcePathToSlug: {},
    warnings: [],
    headings: [],
  };
}

describe('docsArticleUrl', () => {
  it('maps the root article (empty slug) to /docs', () => {
    expect(docsArticleUrl('')).toBe('/docs');
  });

  it('maps a nested slug to its /docs/... path', () => {
    expect(docsArticleUrl('crowdfunding/manage-initiatives')).toBe('/docs/crowdfunding/manage-initiatives');
  });
});

describe('rewriteHref — same-page anchors', () => {
  it('resolves a bare #fragment against the root article URL', () => {
    expect(rewriteHref('#x', ctxFor(''))).toBe('/docs#x');
  });

  it('resolves a bare #fragment against a nested article URL', () => {
    expect(rewriteHref('#fund-types', ctxFor('crowdfunding/manage-initiatives'))).toBe('/docs/crowdfunding/manage-initiatives#fund-types');
  });
});
