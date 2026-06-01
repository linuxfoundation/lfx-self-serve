// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Matches a router URL that the docs portal owns: `/docs` exactly, or
 * `/docs/...`, optionally followed by a query string or fragment. Mirrors
 * the bounded-match contract used by `auth.middleware.ts`
 * (`/^\/docs(?:\/.*)?$/`) so a string-prefix check on `/docs` cannot
 * silently fail-open on `/docs-admin`, `/docsx`, etc.
 *
 * The regex is exported from `@lfx-one/shared` (rather than inlined in
 * each Angular component) because the same predicate is needed in two
 * places — the authed lens-switcher's "docs button is active" check and
 * the public minimal sidebar's equivalent — and divergence between them
 * would surface as a UI bug only at runtime. Sharing the regex means
 * either both components agree with the auth middleware or neither does.
 *
 * Coupled with `DOCS_ROUTE_PREFIX` (`/docs`) in `docs.constant.ts`: if
 * the prefix ever moves, both must move together.
 */
export const DOCS_ROUTE_PATTERN = /^\/docs(?:\/|$|\?|#)/;

/**
 * Returns `true` if `urlOrPath` is a docs-owned router URL — i.e. `/docs`
 * exactly or `/docs/...` (with optional query / fragment), and crucially
 * NOT `/docs-admin`, `/docsx`, or other prefix-similar paths that a naive
 * `startsWith('/docs')` would falsely match.
 *
 * Accepts a router URL with optional query/fragment (e.g. the value of
 * `Router.url` or `NavigationEnd.urlAfterRedirects`).
 *
 * @param urlOrPath The URL or pathname to test (e.g. `Router.url`).
 */
export function isDocsPath(urlOrPath: string | null | undefined): boolean {
  if (!urlOrPath) return false;
  return DOCS_ROUTE_PATTERN.test(urlOrPath);
}
