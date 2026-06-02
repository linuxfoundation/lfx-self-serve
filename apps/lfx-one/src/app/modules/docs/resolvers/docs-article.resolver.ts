// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router, UrlSegment } from '@angular/router';
import type { DocsArticle } from '@lfx-one/shared/interfaces';

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
 * On miss: returns a `RedirectCommand` pointing at `/docs/not-found` so the
 * Angular 20 router triggers a navigation redirect (a bare `UrlTree` would
 * be stored as the resolved value and rendered as if it were an article).
 * The dedicated server route in `app.routes.server.ts` is configured with
 * `status: 404`, so SSR serves the proper HTTP status to crawlers.
 *
 * URL normalization (FR / R: SC-008): trailing slash, mixed case, and
 * doubled slashes all resolve to the same canonical slug. The manifest is
 * generated lower-case so we lower-case the request side once here.
 */
export const docsArticleResolver: ResolveFn<DocsArticle | RedirectCommand> = (route) => {
  const router = inject(Router);
  const manifest = inject(DocsManifestService);

  const slug = normalizeSlug(route.url);
  const article = manifest.getArticle(slug);
  if (article) {
    return article;
  }

  // Miss → tell the router to redirect. Angular 20 only honors a redirect
  // from a resolver when the returned value is a `RedirectCommand`; a bare
  // `UrlTree` would be stored as `data['article']` and rendered as if it
  // were the article (see `apps/lfx-one/node_modules/@angular/router`
  // resolveNode → instanceof RedirectCommand check).
  return new RedirectCommand(router.parseUrl('/docs/not-found'));
};

function normalizeSlug(segments: UrlSegment[]): string {
  return segments
    .map((s) => s.path)
    .filter((p) => p.length > 0)
    .join('/')
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '');
}
