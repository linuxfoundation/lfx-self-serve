// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformServer } from '@angular/common';
import { inject, PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { ResolveFn, UrlSegment } from '@angular/router';
import type { DocsArticle, ServerRequestContext } from '@lfx-one/shared/interfaces';

import { DocsManifestService } from '../services/docs-manifest.service';

/**
 * Functional resolver for `/docs/**` article routes.
 *
 * Reads the catch-all route segments, joins them into a slug, normalizes
 * (trim leading/trailing slashes, lowercase, collapse repeated slashes), and
 * looks up the corresponding `DocsArticle` via `DocsManifestService`.
 *
 * On hit: returns the article — `DocsArticleComponent` consumes it via
 * `route.snapshot.data['article']`.
 *
 * On miss: returns `null` so `DocsArticleComponent` renders not-found inline at
 * the original URL; SSR sets `reqContext.notFound` to emit a real 404 (like `/u/`).
 *
 * URL normalization (FR / R: SC-008): trailing slash, mixed case, and
 * doubled slashes all resolve to the same canonical slug. The manifest is
 * generated lower-case so we lower-case the request side once here.
 */
export const docsArticleResolver: ResolveFn<DocsArticle | null> = (route) => {
  const manifest = inject(DocsManifestService);
  const platformId = inject(PLATFORM_ID);
  const reqContext = inject(REQUEST_CONTEXT, { optional: true }) as ServerRequestContext | null;

  const slug = normalizeSlug(route.url);
  const article = manifest.getArticle(slug);
  if (article) {
    return article;
  }

  // Miss → render not-found in place (no route change). During SSR, signal the
  // handler to emit a real HTTP 404 at the originally-requested path.
  if (isPlatformServer(platformId) && reqContext) {
    reqContext.notFound = true;
  }
  return null;
};

function normalizeSlug(segments: UrlSegment[]): string {
  return segments
    .map((s) => s.path)
    .filter((p) => p.length > 0)
    .join('/')
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
}
