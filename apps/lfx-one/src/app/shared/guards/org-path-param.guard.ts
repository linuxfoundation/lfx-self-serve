// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { ORG_NOT_FOUND_PATH } from '@lfx-one/shared/constants';
import { Account } from '@lfx-one/shared/interfaces';
import { isOrgAccountIdSegment, normalizeOrgSegment, orgUrlSegment } from '@lfx-one/shared/utils';
import { catchError, map, of } from 'rxjs';

import { AccountContextService } from '../services/account-context.service';
import { OrgSlugResolverService } from '../services/org-slug-resolver.service';

/**
 * Seeds the selected organization from the `/org/{orgSegment}/…` address (spec 050,
 * contracts/web-org-url-scheme.md §2 — FR-001…FR-004, FR-017, FR-020, FR-021, FR-022a, FR-024).
 *
 * - Segment already selected (by slug or by uid) with the slug known: no round trip — the guard
 *   re-runs on every child navigation and must not re-resolve or flicker; only the address is
 *   canonicalized when it is not already in the canonical form.
 * - Resolves through the BFF (`GET /api/orgs/resolve/:segment?prefer=<selected uid>`), which is
 *   FGA-filtered per viewer: a hit adopts the organization; a 404/409 (unknown, not readable, or a
 *   same-slug tie the selection could not break) lands on the not-found page **without** touching
 *   the current selection.
 * - Canonical address (FR-002, FR-004): the lowercase slug, or the SFID when the organization has no
 *   slug or its slug is a reserved page name (DR-007 §5). Any other form — SFID for a slugged org,
 *   upper-case slug — is rewritten in place, keeping child segments, query and fragment.
 * - Resolver unavailable (network, timeout, 5xx): an SFID is let through (the pages read by uid
 *   anyway, FR-020); a slug cannot be trusted and lands on not-found. A 4xx is an answer about the
 *   address, not an outage, and fails closed the same way a miss does.
 * - Server: resolves the same way (cookies are forwarded to the BFF) so the selection the initial
 *   HTML is rendered from is the organization the address names, or none — SSR serializes once the
 *   initial navigation (this guard included) has settled, so the shell and the page share that
 *   selection (SC-010; the render-level proof is e2e E16). It issues no redirect (FR-021): where the
 *   browser would redirect, the server clears the selection (page skeleton) and lets the browser run
 *   decide after hydration.
 */
export const orgPathParamGuard: CanActivateFn = (route, state) => {
  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  const router = inject(Router);
  const accountContext = inject(AccountContextService);
  const resolver = inject(OrgSlugResolverService);

  const notFound = router.createUrlTree([ORG_NOT_FOUND_PATH]);
  /**
   * Browser: land on not-found. Server: render no organization (page skeleton) and defer the decision
   * (FR-021) — `clearAccount` only touches the in-memory selection there, cookie writes are no-ops in SSR.
   */
  const failClosed = (): boolean | UrlTree => {
    if (isBrowser) return notFound;
    accountContext.clearAccount();
    return true;
  };

  // `addressed` is the segment exactly as the URL carries it (decoded, untrimmed) — what a rewrite
  // compares against, so encoded whitespace and letter case are canonicalized away, not kept.
  const addressed = route.paramMap.get('orgSegment') ?? '';
  const segment = normalizeOrgSegment(addressed);
  if (!segment) {
    return failClosed();
  }

  // `slug === null` is a confirmed "no slug"; `undefined` is a cookie-restored stub whose slug the
  // canonical fetch has not filled yet — the resolver must still answer for it, or an SFID address to
  // the cookie organization would never canonicalize (FR-002).
  const selected = accountContext.selectedAccount();
  if (selected.uid && selected.slug !== undefined && (segment === selected.uid || segment === selected.slug?.toLowerCase())) {
    return isBrowser ? canonicalizeAddress(router, state.url, addressed, selected) : true;
  }

  const segmentIsSfid = isOrgAccountIdSegment(segment);

  return resolver.resolve(segment, selected.uid ?? null).pipe(
    map((resolved): boolean | UrlTree => {
      if (!resolved) {
        return failClosed();
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
      accountContext.adoptFromAddress(account);
      // Spec 020 US4 — fire-and-forget canonical reconciliation fills display fields.
      void accountContext.refreshCanonicalRecord(account);

      return isBrowser ? canonicalizeAddress(router, state.url, addressed, account) : true;
    }),
    catchError((error: unknown) => {
      if (!segmentIsSfid || !isResolverUnavailable(error)) {
        return of(failClosed());
      }
      // FR-020: the pages read by uid, so an SFID address still renders — but the rendered org must
      // follow the address, never the previous selection (the silent substitution #2570 removes).
      // Adopt a uid-only stub, the same shape a cookie-restored selection uses; display fields fill
      // when the canonical fetch succeeds.
      const stub: Account = { accountId: '', accountName: '', accountSlug: '', membershipTier: '', uid: segment };
      accountContext.adoptFromAddress(stub);
      void accountContext.refreshCanonicalRecord(stub);
      return of<boolean | UrlTree>(true);
    })
  );
};

/**
 * `true` when the address already carries the organization's canonical segment; otherwise a
 * `UrlTree` for the same address with the canonical segment swapped in (second primary segment,
 * after `org`), keeping child segments, query params and fragment. Redirecting from a guard replaces
 * the in-flight navigation, so no intermediate history entry is left behind (SC-009).
 */
function canonicalizeAddress(router: Router, url: string, addressed: string, org: Pick<Account, 'uid' | 'slug'>): boolean | UrlTree {
  const canonical = orgUrlSegment(org);
  if (!canonical || canonical === addressed) {
    return true;
  }
  const tree = router.parseUrl(url);
  const primary = tree.root.children['primary'];
  if (primary && primary.segments.length >= 2 && primary.segments[0].path === 'org') {
    primary.segments[1].path = canonical;
    primary.segments[1].parameters = {};
  }
  return tree;
}

/** Network failure / timeout (status 0) or a 5xx — the resolver could not answer, as opposed to answering "no" (4xx). */
function isResolverUnavailable(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}
