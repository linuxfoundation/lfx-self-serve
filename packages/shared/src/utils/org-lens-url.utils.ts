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
 */
export function orgUrlSegment(org: Pick<Account, 'uid' | 'slug'> | null | undefined): string | null {
  if (!org) return null;
  const slug = org.slug?.trim().toLowerCase();
  if (slug && ORG_LENS_PAGE_SEGMENTS[slug] !== true) return slug;
  const uid = org.uid?.trim();
  return uid ? uid : null;
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
 */
export function orgLensPagePath(urlSegments: readonly string[], page: string): string {
  const [root, second] = urlSegments;
  if (root === 'org' && second && ORG_LENS_PAGE_SEGMENTS[second.toLowerCase()] !== true) {
    return `/org/${second}/${page}`;
  }
  return `/org/${page}`;
}

/** Lowercase + trim a raw URL segment before matching or lookup (FR-004). SFIDs are case-sensitive upstream, so they are only trimmed. */
export function normalizeOrgSegment(raw: string): string {
  const trimmed = raw.trim();
  return isOrgAccountIdSegment(trimmed) ? trimmed : trimmed.toLowerCase();
}
