// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_ACCOUNT_ID_PATTERN,
  ORG_EASYCLA_LEGACY_RETURN_ORG_PARAM,
  ORG_EASYCLA_PATH,
  ORG_EASYCLA_RETURN_ORG_PARAM,
  ORG_LENS_LEGACY_URL_ROOT,
  ORG_LENS_PAGE_SEGMENTS,
  ORG_LENS_URL_ROOT,
  ORG_SLUG_SEGMENT_PATTERN,
} from '../constants';
import type { Account } from '../interfaces';

/**
 * The `/company/{segment}/…` segment for an organization: its lowercase slug when it has one, else its
 * 18-char SFID. Null when the selection carries neither (placeholder account) — callers then emit
 * the legacy `/company/{page}` form and let the redirect guard resolve it. The slug is the one the
 * *index* carries for the organization (org-items row, resolver answer) — derived upstream by
 * member-service from the org name (DR-007), but taken here only as indexed, since that is what
 * addresses resolve against; never re-derived here, never the canonical record's. A slug equal to
 * an Org Lens page name is emitted as the SFID so a static route can never be shadowed (DR-007 §5,
 * T017a).
 *
 * Both values are shape-checked, not trusted: this is the one producer every in-app Org Lens
 * address goes through, and some consumers join it into a string (`routerLink="…"`, `parseUrl`),
 * where a stray `/`, `?` or `#` would reshape the address. A slug `isOrgSlugSegment` rejects —
 * not `[a-z0-9-]`, a reserved page name, or itself SFID-shaped — falls back to the SFID, and a uid
 * that is not an SFID (`isOrgAccountIdSegment`) yields null: the same rules the inbound resolver
 * applies, so what is produced here is what it will answer for.
 */
export function orgUrlSegment(org: Pick<Account, 'uid' | 'slug'> | null | undefined): string | null {
  if (!org) return null;
  const slug = org.slug?.trim().toLowerCase();
  if (slug && isOrgSlugSegment(slug)) return slug;
  const uid = org.uid?.trim();
  return uid && isOrgAccountIdSegment(uid) ? uid : null;
}

/** True when the segment is shaped like an org account id (`001` + 15 alphanumerics) — the identifier form of the address (FR-001, FR-002). */
export function isOrgAccountIdSegment(segment: string): boolean {
  return ORG_ACCOUNT_ID_PATTERN.test(segment);
}

/**
 * True when the (already lowercased) segment is shaped like a slug, is not a reserved page name, and
 * is not shaped like an SFID — the resolver classifies SFID syntax first, so a published slug that
 * happens to look like one (`0014100000mgaaaaaa`) would resolve as an account id, not as this slug;
 * such an organization is addressed by its real SFID instead. Does not mean the org exists — only
 * that a lookup is worth making. Uses `=== true`, not `in`: a plain-object `in` test also matches
 * `Object.prototype` keys (`'constructor' in {}` is true).
 */
export function isOrgSlugSegment(segment: string): boolean {
  return ORG_SLUG_SEGMENT_PATTERN.test(segment) && !isOrgAccountIdSegment(segment) && ORG_LENS_PAGE_SEGMENTS[segment] !== true;
}

/**
 * Path of an Org Lens page in the address scope of the URL being navigated to (`urlSegments` = its
 * primary segments): `/company/{segment}/{page}` when that address names an organization, else the
 * legacy `/company/{page}`. Feature fallbacks redirect through this so they never drop the organization
 * a shared link named (FR-001) and hand the viewer back to the cookie selection. The segment is
 * passed through as addressed; the path-param guard canonicalizes it on the next navigation.
 *
 * "Names an organization" means shaped like one — slug (`isOrgSlugSegment`) or SFID
 * (`isOrgAccountIdSegment`) — the same rules `orgUrlSegment` applies on the producing side. The
 * matcher already rejects other values before a guard runs; this keeps the two builders honest
 * with each other rather than trusting that ordering.
 */
export function orgLensPagePath(urlSegments: readonly string[], page: string): string {
  const [root, second] = urlSegments;
  if (root === ORG_LENS_URL_ROOT && second) {
    const normalized = normalizeOrgSegment(second);
    if (isOrgSlugSegment(normalized) || isOrgAccountIdSegment(normalized)) {
      return `/${ORG_LENS_URL_ROOT}/${second}/${page}`;
    }
  }
  return `/${ORG_LENS_URL_ROOT}/${page}`;
}

/**
 * The organization-independent form of an Org Lens address: `/company/{segment}/{page}/…` becomes
 * `/company/{page}/…`; any other path is returned unchanged. For identity that must survive an
 * organization switch — the sidebar tracks its rows by destination, and a switch only re-addresses
 * them, it does not replace them.
 */
export function orgLensDestinationKey(path: string): string {
  const [, root, second, ...rest] = path.split('/');
  if (root === ORG_LENS_URL_ROOT && second && ORG_LENS_PAGE_SEGMENTS[second.toLowerCase()] !== true && rest.length > 0) {
    return `/${ORG_LENS_URL_ROOT}/${rest.join('/')}`;
  }
  return path;
}

/** Lowercase + trim a raw URL segment before matching or lookup (FR-004). SFIDs are case-sensitive upstream, so they are only trimmed. */
export function normalizeOrgSegment(raw: string): string {
  const trimmed = raw.trim();
  return isOrgAccountIdSegment(trimmed) ? trimmed : trimmed.toLowerCase();
}

/**
 * The return address the BFF mints while the `ORG_EASYCLA_RETURN_IN_PATH` gate is off:
 * `/company/easycla/{claGroupId}`, with the organization carried in `?company=` (`ORG_EASYCLA_RETURN_ORG_PARAM`)
 * rather than in the path. Every release routes and reads this shape, which is what makes it the
 * safe default across a rolling deploy or a rollback. Sibling of `orgEasyclaReturnPath`.
 */
export function legacyOrgEasyclaReturnPath(claGroupId: string): string {
  // Minted with the pre-rename `/org` root on purpose: a return URL is fixed when signing starts and is used days
  // later, possibly by a replica or a rollback that does not route `/company` yet. This release 301s it to `/company`.
  return `/${ORG_LENS_LEGACY_URL_ROOT}/easycla/${encodeURIComponent(claGroupId)}`;
}

/**
 * Where EasyCLA returns a signatory after signing a corporate CLA (#1983, #2352): the CLA Group's
 * own address under the organization the signing was opened for — `/company/{orgUid}/easycla/{claGroupId}`
 * (spec 050 address scheme, lfx-self-serve#2743). Mirrors the `easycla` child of the
 * `/company/:orgSegment` route in the org dashboard routes.
 *
 * `orgUid` is the 18-char SFID the grant check cleared; the path guard resolves it against the
 * viewer's own organizations and canonicalizes the segment to the slug on arrival, so the address
 * names an organization without granting one.
 *
 * Sibling of `MY_CLAS_PATH` for the same reason that one is shared: the BFF derives the return
 * address from the request Host, and the two hand-offs must not disagree on where they land.
 */
export function orgEasyclaReturnPath(orgUid: string, claGroupId: string): string {
  // Pre-rename `/org` root, for the same rollback-safety reason as `legacyOrgEasyclaReturnPath`; the server 301s it to `/company`.
  return `/${ORG_LENS_LEGACY_URL_ROOT}/${encodeURIComponent(orgUid)}/easycla/${encodeURIComponent(claGroupId)}`;
}

/**
 * The organization a corporate-signing return names on the leftover (un-addressed) EasyCLA mount: `?company=`, else
 * the pre-rename `?org=` that trips opened before #5064 still return on. Takes the lookup function so it serves
 * `ParamMap.get`, `URLSearchParams.get` and plain objects alike.
 */
export function easyclaReturnOrgParam(get: (name: string) => string | null | undefined): string | null {
  return get(ORG_EASYCLA_RETURN_ORG_PARAM) ?? get(ORG_EASYCLA_LEGACY_RETURN_ORG_PARAM) ?? null;
}

/**
 * The permanent-redirect target for a pre-rename Company Lens address, or null when `pathAndQuery` is not one.
 *
 * Every old form maps by swapping the first segment, so the page and the organization selection travel with it:
 * `/org` → `/company`, `/org/not-found`, the addressed `/org/{slug|SFID}/{page}/…`, and the legacy unaddressed
 * `/org/{page}/…`. The query string is kept verbatim; on an EasyCLA address the pre-rename `?org=` return
 * parameter is renamed to `?company=`. The fragment never reaches a server, and a browser re-applies it to a
 * redirect target that carries none, so callers that see one (the Angular router) pass it through themselves.
 *
 * Only the exact segment `org` matches: `/organization`, `/orgs` and `/org-x` are other addresses. The result
 * is always a same-origin path (it starts with a single `/company`), so it cannot be turned into an open redirect.
 */
export function companyLensRedirectTarget(pathAndQuery: string): string | null {
  const queryStart = pathAndQuery.indexOf('?');
  const path = queryStart === -1 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
  const query = queryStart === -1 ? '' : pathAndQuery.slice(queryStart);
  const legacyRoot = `/${ORG_LENS_LEGACY_URL_ROOT}`;
  if (path !== legacyRoot && !path.startsWith(`${legacyRoot}/`)) {
    return null;
  }
  const rest = path.slice(legacyRoot.length);
  return `/${ORG_LENS_URL_ROOT}${rest}${isEasyclaAddress(rest) ? renameLegacyEasyclaOrgParam(query) : query}`;
}

/** True for `/easycla…` (leftover mount) and `/{segment}/easycla…` (addressed mount) once the root is stripped. */
function isEasyclaAddress(rest: string): boolean {
  const [, first, second] = rest.split('/');
  return first === 'easycla' || second === 'easycla';
}

/** Rename `org` → `company` in a raw query string, leaving every other pair and its encoding untouched; an existing `company` wins. */
function renameLegacyEasyclaOrgParam(query: string): string {
  if (!query) return query;
  const pairs = query.slice(1).split('&');
  const hasCompany = pairs.some((p) => p.split('=')[0] === ORG_EASYCLA_RETURN_ORG_PARAM);
  const renamed = pairs
    .filter((p) => !(hasCompany && p.split('=')[0] === ORG_EASYCLA_LEGACY_RETURN_ORG_PARAM))
    .map((p) =>
      p.split('=')[0] === ORG_EASYCLA_LEGACY_RETURN_ORG_PARAM ? ORG_EASYCLA_RETURN_ORG_PARAM + p.slice(ORG_EASYCLA_LEGACY_RETURN_ORG_PARAM.length) : p
    );
  return renamed.length ? `?${renamed.join('&')}` : '';
}

/** Pages whose folder name carried the old wording when `docs/user/organization` became `docs/user/company` (#5066); every other page keeps its slug. */
const LEGACY_DOCS_PAGE_RENAMES: Readonly<Record<string, string>> = {
  'choose-an-organization': 'choose-a-company',
  'org-overview': 'company-overview',
  'manage-org-lens-access': 'manage-company-lens-access',
  'org-events': 'company-events',
  'org-profile': 'company-profile',
};

/** Single pages outside `docs/user/organization` whose folder carried the old wording; each maps to its renamed address. */
const LEGACY_DOCS_SINGLE_PAGES: Readonly<Record<string, string>> = {
  '/docs/dashboards/organization-involvement': '/docs/dashboards/company-involvement',
};

/**
 * The permanent-redirect target for a pre-rename user-docs address, or null when `pathAndQuery` is not one.
 * `/docs/organization[/{page}…]` → `/docs/company[/{page}…]`, with the three renamed pages mapped to their new
 * slugs. The docs portal derives each URL from the article's folder path and has no redirect mechanism of its own,
 * so this is that mechanism. Query string kept verbatim; the fragment is re-applied by the browser (or passed by the caller).
 */
export function legacyDocsRedirectTarget(pathAndQuery: string): string | null {
  const queryStart = pathAndQuery.indexOf('?');
  // The docs resolver ignores case and a trailing slash, so old links in those forms still reach a page; match the same way.
  let path = (queryStart === -1 ? pathAndQuery : pathAndQuery.slice(0, queryStart)).toLowerCase();
  // A loop, not a `/+$` regex: that pattern backtracks polynomially on a long run of slashes (CodeQL).
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  const query = queryStart === -1 ? '' : pathAndQuery.slice(queryStart);
  const movedPage = LEGACY_DOCS_SINGLE_PAGES[path];
  if (movedPage) {
    return `${movedPage}${query}`;
  }
  const root = '/docs/organization';
  if (path !== root && !path.startsWith(`${root}/`)) {
    return null;
  }
  const tail = path
    .slice(root.length)
    .split('/')
    .map((segment) => LEGACY_DOCS_PAGE_RENAMES[segment] ?? segment)
    .join('/');
  return `/docs/company${tail}${query}`;
}
