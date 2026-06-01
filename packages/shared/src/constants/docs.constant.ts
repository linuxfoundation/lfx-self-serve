// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Public URL prefix for the documentation portal. Every article URL is
 * composed as `DOCS_ROUTE_PREFIX + '/' + slug` (or just `DOCS_ROUTE_PREFIX`
 * for the synthetic root landing).
 */
export const DOCS_ROUTE_PREFIX = '/docs';

/**
 * Production origin for canonical URL construction in SEO head tags.
 * Used by the docs landing and article components to emit
 * `<link rel="canonical">` and OpenGraph / Twitter-card URLs that point at
 * the production deployment regardless of which preview / staging origin
 * is rendering the page.
 */
export const DOCS_CANONICAL_ORIGIN = 'https://app.lfx.dev';

/**
 * Canonical display order for top-level docs topics on the landing page,
 * breadcrumbs, and any taxonomy-driven UI.
 *
 * This constant is the runtime source of truth for the Angular app — the
 * generated manifest's `DocsTopic.displayOrder` is read here at render
 * time. The build pipeline (`apps/lfx-one/scripts/lib/build-manifest.mjs`)
 * keeps a synchronized in-file copy of the same list (and acknowledges
 * the duplication inline) because the build script is a Node-only `.mjs`
 * and the workspace's strict ESM resolver can't pull this TypeScript
 * source without a shared-package rebuild on every `docs:build`. The
 * lists must be updated together; the docs-coverage CI gate
 * (`docs:check-coverage`) catches drift between the markdown source tree
 * and the manifest.
 *
 * Topics not in this list (e.g. a future addition under `docs/user/`
 * whose slug isn't yet recognized) are appended in alphabetical order
 * with display orders starting at `DOCS_TAXONOMY_ORDER.length`, so the
 * build never fails just because a new topic shows up — but the ordering
 * is no longer guaranteed for that topic until the constant is updated.
 */
export const DOCS_TAXONOMY_ORDER: readonly string[] = [
  'badges',
  'committees',
  'dashboards',
  'documents',
  'events',
  'mailing-lists',
  'meetings',
  'profile',
  'settings',
  'surveys',
  'trainings',
  'transactions',
  'votes',
] as const;
