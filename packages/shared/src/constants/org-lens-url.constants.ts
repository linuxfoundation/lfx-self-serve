// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens URL scheme (spec 050 / lfx-self-serve#2570): `/org/{segment}/{page}` where `segment`
 * is the organization's lowercase slug, or its 18-char SFID when it has none. Shared by the
 * router, the guards, the selector navigation, and the BFF segment resolver so the three tiers
 * cannot drift on what a segment is.
 */

/** In-shell not-found page for unresolvable / inaccessible / unavailable Org Lens addresses (FR-022). Declared as a sibling of the `org` route node so a `canMatch` fail-closed redirect cannot loop back into itself. */
export const ORG_NOT_FOUND_PATH = '/org/not-found';

/** `ORG_NOT_FOUND_PATH` as primary URL segments, for callers that compare an address segment by segment. */
export const ORG_NOT_FOUND_SEGMENTS: readonly string[] = ORG_NOT_FOUND_PATH.split('/').filter(Boolean);

/**
 * Org Lens page segments. A URL segment equal to any of these is a page, never an organization:
 * static routes are declared first, and the `:orgSegment` matcher rejects them as belt-and-braces.
 * Kept in sync with the `org` route children in `app.routes.ts`. Membership test:
 * `ORG_LENS_PAGE_SEGMENTS[segment] === true` — never `segment in ORG_LENS_PAGE_SEGMENTS`, which also
 * matches `Object.prototype` keys (`'constructor'`, `'toString'`, …).
 */
export const ORG_LENS_PAGE_SEGMENTS: Readonly<Record<string, true>> = {
  overview: true,
  memberships: true,
  projects: true,
  easycla: true,
  roi: true,
  governance: true,
  people: true,
  contributions: true,
  events: true,
  training: true,
  meetings: true,
  groups: true,
  profile: true,
  'not-found': true,
};

/** Shape of a slug segment after lowercasing: URL-safe, starts alphanumeric, ≤128 chars. Anything that is neither this nor an SFID is rejected before any lookup. */
export const ORG_SLUG_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

/** Valkey namespace for per-viewer segment-resolution cache entries (DR-003). Keyed with `buildPerUserOrgKey(namespace, username, segment)` — never organization-keyed. */
export const ORG_SLUG_RESOLVE_NAMESPACE = 'org-slug-resolve:v1';

/** TTL for a cached positive resolution. Short: grant revocation already has a 10 s OpenFGA check-cache window, and every page re-reads through the gate. Negative results are never cached. */
export const ORG_SLUG_RESOLVE_TTL_SECONDS = 300;

/**
 * Raw rows requested per query-service page when looking a slug up. Query-service pages the OpenSearch
 * hits **before** the per-row access check, so a page can come back with fewer readable rows than
 * this (even none) and still carry a cursor; the resolver follows it until two readable rows or the
 * end (see `ORG_SLUG_RESOLVE_PAGE_CAP`). Sized so a real-world collision resolves in one round trip.
 */
export const ORG_SLUG_RESOLVE_PAGE_SIZE = 10;

/**
 * Per-call budget for each query-service lookup the segment resolver makes. A routing lookup must
 * fail fast: the server-side guard run blocks the whole SSR render of `/org/{segment}/…` on it, and
 * the browser run holds the navigation. A timeout is reported as a 408 → 502 and lands in the
 * FR-020 branch (SFID renders as-is; a slug is not found), never in a 30 s stall.
 */
export const ORG_SLUG_RESOLVE_LOOKUP_TIMEOUT_MS = 3000;

/** Hard cap on the pages one slug lookup may walk. Reached only when ≥ `ORG_SLUG_RESOLVE_PAGE_CAP × ORG_SLUG_RESOLVE_PAGE_SIZE` organizations share a slug; the lookup then fails closed as ambiguous rather than guessing. */
export const ORG_SLUG_RESOLVE_PAGE_CAP = 5;
