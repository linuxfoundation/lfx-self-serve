// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { ORG_NOT_FOUND_PATH } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { isOrgAccountIdSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';
import { catchError, map, of } from 'rxjs';

import { AccountContextService } from '../services/account-context.service';
import { OrgSlugResolverService } from '../services/org-slug-resolver.service';

/**
 * Seeds the selected organization from the `/org/{orgSegment}/…` address (spec 050,
 * contracts/web-org-url-scheme.md §2 — FR-001…FR-004, FR-017, FR-020, FR-022a, FR-024).
 *
 * - Server: returns `true` and renders the skeleton; the browser run after hydration decides.
 * - Segment already selected (by slug or by uid): no-op — the guard re-runs on every child
 *   navigation and must not re-resolve or flicker.
 * - Resolves through the BFF (`GET /api/orgs/resolve/:segment?prefer=<selected uid>`), which is
 *   FGA-filtered per viewer: a hit adopts the organization; a 404/409 (unknown, not readable, or a
 *   same-slug tie the selection could not break) lands on the not-found page **without** touching
 *   the current selection.
 * - An SFID address whose organization has a slug is rewritten to the slug form (FR-002), keeping
 *   child segments, query and fragment.
 * - Upstream failure: an SFID is let through (the pages read by uid anyway, FR-020); a slug cannot
 *   be trusted and lands on not-found.
 */
export const orgPathParamGuard: CanActivateFn = (route, state) => {
  const platformId = inject(PLATFORM_ID);
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const router = inject(Router);
  const accountContext = inject(AccountContextService);
  const resolver = inject(OrgSlugResolverService);

  const rawSegment = route.paramMap.get('orgSegment') ?? '';
  const segment = normalizeOrgSegment(rawSegment);
  if (!segment) {
    return router.createUrlTree([ORG_NOT_FOUND_PATH]);
  }

  const selected = accountContext.selectedAccount();
  if (selected.uid && segment === selected.uid && selected.slug) {
    // Already selected, addressed by SFID, slug known: canonicalize without a round trip (FR-002).
    return canonicalizeSegment(router, state.url, selected.slug.toLowerCase());
  }
  if (selected.uid && (segment === selected.slug?.toLowerCase() || segment === selected.uid)) {
    return true;
  }

  const notFound = router.createUrlTree([ORG_NOT_FOUND_PATH]);
  const segmentIsSfid = isOrgAccountIdSegment(segment);

  return resolver.resolve(segment, selected.uid ?? null).pipe(
    map((resolved): boolean | UrlTree => {
      if (!resolved) {
        return notFound;
      }

      const account: Account = {
        accountId: resolved.uid,
        accountName: resolved.name,
        accountSlug: '',
        membershipTier: '',
        logoUrl: null,
        uid: resolved.uid,
        slug: resolved.slug,
      };
      accountContext.setAccount(account);
      // Spec 020 US4 — fire-and-forget canonical reconciliation fills display fields.
      void accountContext.refreshCanonicalRecord(account);

      if (segmentIsSfid && resolved.slug) {
        return canonicalizeSegment(router, state.url, resolved.slug);
      }
      return true;
    }),
    catchError(() => {
      if (!segmentIsSfid) {
        return of<boolean | UrlTree>(notFound);
      }
      // FR-020: the pages read by uid, so an SFID address still renders — but the rendered org must
      // follow the address, never the previous selection (the silent substitution #2570 removes).
      // Adopt a uid-only stub, the same shape a cookie-restored selection uses; display fields fill
      // when the canonical fetch succeeds.
      const stub: Account = { accountId: '', accountName: '', accountSlug: '', membershipTier: '', uid: segment };
      accountContext.setAccount(stub);
      void accountContext.refreshCanonicalRecord(stub);
      return of<boolean | UrlTree>(true);
    })
  );
};

/** Replace the organization segment (second primary segment, after `org`) with the slug, keeping child segments, query params and fragment. */
function canonicalizeSegment(router: Router, url: string, slug: string): UrlTree {
  const tree = router.parseUrl(url);
  const primary = tree.root.children['primary'];
  if (primary && primary.segments.length >= 2 && primary.segments[0].path === 'org') {
    primary.segments[1].path = slug;
    primary.segments[1].parameters = {};
  }
  return tree;
}
