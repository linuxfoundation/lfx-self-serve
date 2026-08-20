// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Routes } from '@angular/router';

import { docsArticleResolver } from './resolvers/docs-article.resolver';

/**
 * Child route table for the public-facing user documentation portal.
 *
 * Routes (matched in order):
 *   - `''`           → `DocsLandingComponent`     — synthetic `/docs` landing (FR-002).
 *   - `'not-found'`  → `DocsNotFoundComponent`    — brand-styled 404, kept reachable for direct
 *                                                   visits; SSR pairs it with status 404 (FR-014).
 *   - `'**'`         → `DocsArticleComponent`     — any nested slug; on a miss the resolver returns
 *                                                   `null` and the not-found view renders inline (404).
 *
 * Lazy-loaded via `loadComponent` so the article + landing chunks stay out
 * of the main browser bundle until a `/docs/**` URL is activated.
 *
 * Wildcard ordering matters: keep `not-found` BEFORE the `**` catch-all so a
 * direct visit to `/docs/not-found` renders the dedicated page rather than
 * falling into the resolver-driven dynamic article match.
 */
export const DOCS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/docs-landing/docs-landing.component').then((m) => m.DocsLandingComponent),
  },
  {
    path: 'not-found',
    loadComponent: () => import('./pages/docs-not-found/docs-not-found.component').then((m) => m.DocsNotFoundComponent),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/docs-article/docs-article.component').then((m) => m.DocsArticleComponent),
    resolve: { article: docsArticleResolver },
  },
];
