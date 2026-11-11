// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens URL scheme (spec 050 / lfx-self-serve#2570): `/company/{segment}/{page}` (was `/org/…` until #5064) where `segment`
 * is the organization's lowercase slug, or its 18-char SFID when it has none. Shared by the
 * router, the guards, the selector navigation, and the BFF segment resolver so the three tiers
 * cannot drift on what a segment is.
 */

/**
 * First URL segment of every Company Lens address (`/company/{segment}/{page}`). The lens id stays `org`
 * and code names are unchanged (epic #5060); only the address people see and share is `company`.
 */
export const ORG_LENS_URL_ROOT = 'company';

/** Root of the pre-rename addresses (`/org/…`). Never generated; every such address redirects permanently to `/company/…` (#5064). */
export const ORG_LENS_LEGACY_URL_ROOT = 'org';

/** Route parameter carrying the organization segment on the addressed mount (`/company/:orgSegment/…`). The router declares it as `':' + ORG_SEGMENT_PARAM`; guards and pages read it by this name. */
export const ORG_SEGMENT_PARAM = 'orgSegment';

/** In-shell not-found page for unresolvable / inaccessible / unavailable Org Lens addresses (FR-022). Declared as a sibling of the `org` route node so a `canMatch` fail-closed redirect cannot loop back into itself. */
export const ORG_NOT_FOUND_PATH = `/${ORG_LENS_URL_ROOT}/not-found`;

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
  initiatives: true,
  donations: true,
  'not-found': true,
};

/** Route path of the Org Lens EasyCLA page, `/org/{segment}/easycla`. */
export const ORG_EASYCLA_PAGE_SEGMENT = 'easycla';

/**
 * Prefix of the reserved `/org/{segment}` value selecting a **family roll-up** — the combined view
 * over the organizations the caller holds in one Salesforce family (lfx-self-serve#4125). The full
 * segment is the prefix followed by the family's top Salesforce account id, e.g.
 * `family-001A000000abcdeXYZ`: one roll-up per family, so a caller holding organizations in two
 * families has two. A view mode, not an organization: it names no `b2b_org` row, carries no grant of
 * its own, and is expanded to the caller's organizations in that family server-side on every request.
 *
 * Reserved rather than page-listed. It is deliberately **not** added to `ORG_LENS_PAGE_SEGMENTS`:
 * that map answers "is this segment a page", and callers act on the answer — `orgLensDestinationKey`
 * would stop stripping the segment and the sidebar would lose row identity across a switch. The
 * reservation is enforced in `isOrgSlugSegment` instead, so an organization whose indexed slug has
 * the roll-up shape is addressed by its SFID, the same fallback a reserved page name already gets
 * (DR-007 §5).
 */
export const ORG_ROLLUP_SEGMENT_PREFIX = 'family-';

/**
 * A family roll-up segment, capturing the family's top account id. The id is matched exactly as an
 * SFID is (`ORG_ACCOUNT_ID_PATTERN`): Salesforce ids are case-sensitive, so the prefix is the only
 * part `normalizeOrgSegment` may lowercase.
 */
export const ORG_ROLLUP_SEGMENT_PATTERN = /^family-(001[A-Za-z0-9]{15})$/;

/** The roll-up shape regardless of case — what a slug may never be, since slugs are matched after lowercasing. */
export const ORG_ROLLUP_SEGMENT_RESERVED_PATTERN = /^family-001[a-z0-9]{15}$/i;

/** Display name of a family roll-up whose family name is not known yet (cookie restore or deep link before the grant sets load). */
export const ROLLUP_ACCOUNT_NAME = 'All Companies Roll-Up';

/** Fewest organizations in one family a roll-up is worth offering over: with one, it is the organization. */
export const ROLLUP_MIN_ORGANIZATIONS = 2;

/**
 * Query parameters an organization switch nulls (a `queryParamsHandling: 'merge'` navigation) on every Org Lens
 * page: an Employees selection came from the previous organization's roster, so it would match nothing, or the
 * wrong people, under the next one. Back does not restore it: the pages that filter by Employees (Projects, Code
 * Contributions) clear the selection whenever the organization changes between two resolved organizations.
 */
export const ORG_LENS_SWITCH_PARAMS_RESET: Readonly<Record<string, null>> = Object.freeze({
  employees: null,
});

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
