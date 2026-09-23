// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CanMatchFn } from '@angular/router';
import { isOrgAccountIdSegment, isOrgSlugSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';

/**
 * `/org/:orgSegment` matches only values shaped like an organization segment — a slug (matched
 * case-insensitively; `orgPathParamGuard` canonicalizes the address to lowercase on the browser run
 * afterwards, SSR renders it as addressed — FR-021) that is not an Org Lens page name, or an 18-char
 * SFID (spec 050, contracts/web-org-url-scheme.md §1).
 *
 * Static page routes are declared before this node, so a page name never reaches it in practice;
 * rejecting them here is belt-and-braces, and rejecting malformed segments lets the in-shell 404
 * catch-all answer instead of a resolver round trip.
 */
export const orgSegmentMatchGuard: CanMatchFn = (_route, segments) => {
  const raw = segments[0]?.path;
  if (!raw) return false;
  const segment = normalizeOrgSegment(raw);
  return isOrgAccountIdSegment(segment) || isOrgSlugSegment(segment);
};
