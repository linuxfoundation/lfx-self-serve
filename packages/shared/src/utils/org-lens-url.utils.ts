// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCOUNT_ID_PATTERN, ORG_LENS_PAGE_SEGMENTS, ORG_SLUG_SEGMENT_PATTERN } from '../constants';
import type { Account } from '../interfaces';

/**
 * The `/org/{segment}/…` segment for an organization: its lowercase slug when it has one, else its
 * 18-char SFID. Null when the selection carries neither (placeholder account) — callers then emit
 * the legacy `/org/{page}` form and let the redirect guard resolve it. The slug is whatever
 * member-service published (derived from the org name, DR-007) — never re-derived here or taken
 * from the Snowflake `accountSlug`. A slug equal to an Org Lens page name is emitted as the SFID so
 * a static route can never be shadowed (DR-007 §5, T017a).
 *
 * Both values are shape-checked, not trusted: this is the one producer every in-app Org Lens
 * address goes through, and some consumers join it into a string (`routerLink="…"`, `parseUrl`),
 * where a stray `/`, `?` or `#` would reshape the address. A slug that is not `[a-z0-9-]` falls
 * back to the SFID, and a uid that is not an SFID yields null — the same two rules the inbound
 * resolver applies (`isOrgSlugSegment`, `isOrgAccountIdSegment`).
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

/** True when the (already lowercased) segment is shaped like a slug and is not a reserved page name. Does not mean the org exists — only that a lookup is worth making. Uses `=== true`, not `in`: a plain-object `in` test also matches `Object.prototype` keys (`'constructor' in {}` is true). */
export function isOrgSlugSegment(segment: string): boolean {
  return ORG_SLUG_SEGMENT_PATTERN.test(segment) && ORG_LENS_PAGE_SEGMENTS[segment] !== true;
}

/**
 * Path of an Org Lens page in the address scope of the URL being navigated to (`urlSegments` = its
 * primary segments): `/org/{segment}/{page}` when that address names an organization, else the
 * legacy `/org/{page}`. Feature fallbacks redirect through this so they never drop the organization
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
  if (root === 'org' && second) {
    const normalized = normalizeOrgSegment(second);
    if (isOrgSlugSegment(normalized) || isOrgAccountIdSegment(normalized)) {
      return `/org/${second}/${page}`;
    }
  }
  return `/org/${page}`;
}

/**
 * The organization-independent form of an Org Lens address: `/org/{segment}/{page}/…` becomes
 * `/org/{page}/…`; any other path is returned unchanged. For identity that must survive an
 * organization switch — the sidebar tracks its rows by destination, and a switch only re-addresses
 * them, it does not replace them.
 */
export function orgLensDestinationKey(path: string): string {
  const [, root, second, ...rest] = path.split('/');
  if (root === 'org' && second && ORG_LENS_PAGE_SEGMENTS[second.toLowerCase()] !== true && rest.length > 0) {
    return `/org/${rest.join('/')}`;
  }
  return path;
}

/** Lowercase + trim a raw URL segment before matching or lookup (FR-004). SFIDs are case-sensitive upstream, so they are only trimmed. */
export function normalizeOrgSegment(raw: string): string {
  const trimmed = raw.trim();
  return isOrgAccountIdSegment(trimmed) ? trimmed : trimmed.toLowerCase();
}
