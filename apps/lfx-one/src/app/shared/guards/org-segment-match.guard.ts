// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CanMatchFn } from '@angular/router';
import { isOrgAccountIdSegment, isOrgRollUpSegment, isOrgSlugSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';

/**
 * `/org/:orgSegment` matches only values shaped like an organization segment — a slug (matched
 * case-insensitively; `orgPathParamGuard` canonicalizes the address to lowercase on the browser run
 * afterwards, SSR renders it as addressed — FR-021) that is not an Org Lens page name, or an 18-char
 * SFID (spec 050, contracts/web-org-url-scheme.md §1).
 *
 * Static page routes are declared before this node, so a page name never reaches it in practice;
 * rejecting them here is belt-and-braces, and rejecting malformed segments lets the in-shell 404
 * catch-all answer instead of a resolver round trip.
 *
 * The reserved All Organizations roll-up segment matches too (lfx-self-serve#4125). It is accepted
 * explicitly rather than falling out of `isOrgSlugSegment`, which rejects it: a slug is something
 * the resolver can look up, and this names a set the BFF expands per caller. `orgPathParamGuard`
 * then adopts it without a resolver round trip.
 */
export const orgSegmentMatchGuard: CanMatchFn = (_route, segments) => {
  const raw = segments[0]?.path;
  if (!raw) return false;
  const segment = normalizeOrgSegment(raw);
  return isOrgRollUpSegment(segment) || isOrgAccountIdSegment(segment) || isOrgSlugSegment(segment);
};
