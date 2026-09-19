// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { ORG_LENS_PAGE_SEGMENTS, ORG_NOT_FOUND_PATH } from '@lfx-one/shared/constants';
import { OrgLensAddressIntent } from '@lfx-one/shared/interfaces';

import { AccountContextService } from './account-context.service';

/**
 * Builds Org Lens addresses that carry the selected organization and keeps the address in step
 * with the selection (spec 050 US2 — FR-013…FR-016, FR-029).
 *
 * - `orgLensLink(page, …rest)` is the one way in-app links (sidebar, breadcrumbs, table rows,
 *   "view all", CTAs) address an Org Lens page: `['/org', segment, page, …rest]`, or the legacy
 *   `['/org', page, …rest]` while nothing is selected yet (the default-organization redirect of
 *   US3 resolves that form). Reading `selectedUrlSegment()` makes every template link re-render on
 *   a switch, so the address bar and the links on screen never disagree.
 * - `navigateToSelectedOrg(intent)` runs after a selection change: the viewer stays on the same Org
 *   Lens page, now addressed to the selected organization — same child segments, query and
 *   fragment. What it may touch, and whether history stacks, depends on who made the selection
 *   (`OrgLensAddressIntent`).
 *
 * Two builders coexist on purpose. This one derives the organization from the *selection*, which is
 * right for links and for code that runs after a route has been recognized. Code that runs *during*
 * recognition under `/org/:orgSegment` (a `CanMatch` flag guard) must derive it from the URL being
 * recognized (`orgLensPagePath` in `@lfx-one/shared/utils`) — at that moment the path guard has not
 * adopted the addressed organization yet, and the selection may still be the cookie's.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensNavigationService {
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);

  /**
   * The address `navigateToSelectedOrg` last navigated toward — the organization (by uid) and the
   * segment it was written with — plus the navigation itself. What `reconcileAddress` is allowed to
   * replace, and only after that navigation has settled: the navigation may still be in flight when
   * the canonical record lands, and it may have been cancelled or redirected (a guard failing closed),
   * which is why the live address is re-checked rather than trusted.
   */
  private lastWrite: { uid: string; segment: string; navigation: Promise<boolean> } | null = null;

  /** Router commands for an Org Lens page under the current selection. */
  public orgLensLink(page: string, ...rest: (string | number)[]): string[] {
    const segment = this.accountContext.selectedUrlSegment();
    const tail = rest.map(String);
    return segment ? ['/org', segment, page, ...tail] : ['/org', page, ...tail];
  }

  /** `orgLensLink` as a single path string, for string-typed `routerLink`s (sidebar items). */
  public orgLensPath(page: string, ...rest: (string | number)[]): string {
    return this.orgLensLink(page, ...rest).join('/');
  }

  /** True on the Org Lens not-found dead end (`ORG_NOT_FOUND_PATH`), the one page a same-organization pick may still leave. */
  public isOnNotFound(): boolean {
    return this.isNotFoundAddress(this.currentPrimarySegments());
  }

  /**
   * Re-address the current page to the selected organization. No-op outside Org Lens (a switch
   * from the Me or Project lens changes the selection only), on EasyCLA pages (DR-004: they stay
   * on the legacy address in phase 1), when no segment is known yet, or when the address already
   * names the selected organization (FR-014).
   *
   * A `default` intent is narrower still: it only fills an organization into an address that names
   * none. It never leaves `/org/not-found` — a default landing there would be the silent
   * substitution the dead end exists to prevent (FR-022–FR-024) — and never overrides an address
   * that already names an organization, because the path guard that resolves it is the authority
   * and may not have adopted it yet when the org list answers.
   */
  public navigateToSelectedOrg(intent: OrgLensAddressIntent = 'switch'): void {
    const segments = this.currentPrimarySegments();
    if (!this.isRewritableOrgAddress(segments)) {
      return;
    }
    const segment = this.accountContext.selectedUrlSegment();
    const uid = this.accountContext.selectedAccount().uid;
    if (!segment || !uid) {
      return;
    }

    let child: string[];
    if (segments.length === 1) {
      // Nothing after `/org`: land on the organization's overview.
      child = ['overview'];
    } else if (this.isNotFoundAddress(segments)) {
      // The dead end: only the viewer's own pick may leave it, for that organization's overview.
      if (intent !== 'switch') {
        return;
      }
      child = ['overview'];
    } else if (ORG_LENS_PAGE_SEGMENTS[segments[1]] === true) {
      // Legacy `/org/{page}/…`: insert the organization.
      child = segments.slice(1);
    } else {
      // `/org/{organization}/…`: a switch swaps the organization and keeps the page; a default
      // leaves an addressed organization alone.
      const selected = this.accountContext.selectedAccount();
      if (intent !== 'switch' || segments[1] === segment || segments[1] === selected.uid) {
        return;
      }
      child = segments.slice(2);
    }

    // A switch is pushed so Back returns to the pre-switch organization and page (US2 scenario 3);
    // a default is a canonicalizing rewrite of the address the viewer already meant, so it replaces
    // (FR-011) — otherwise Back would land on the bare, uncopyable form of the same screen.
    const navigation = this.router.navigate(['/org', segment, ...child], {
      replaceUrl: intent === 'default',
      queryParamsHandling: 'preserve',
      preserveFragment: true,
    });
    this.lastWrite = { uid, segment, navigation: this.settled(navigation) };
  }

  /**
   * Re-canonicalizes the address after the selection's canonical record arrives. The segment written
   * by `navigateToSelectedOrg` comes from the indexed org row; the canonical fetch that both callers
   * start alongside it can carry a different slug (index lag, a rename), after which every link on
   * the page uses the new segment while the address bar still shows the old one — copied then, it
   * could reopen as not-found. Always a replacement: the viewer meant this page all along (FR-011).
   *
   * Bounded four ways to the write this service itself made. It waits for that navigation to settle
   * (the canonical fetch can win the race — `refreshCanonicalRecord` dedupes in-flight requests, so a
   * re-pick can be handed a promise that is already resolving — and `Router.url` only moves once a
   * navigation activates). It yields to a newer write, including a re-pick of the same organization.
   * It acts only for the *same organization*: a later default selection of another organization must
   * not re-address a page a switch wrote, however the segments compare. And it re-checks that the
   * live address still carries the written segment — the navigation may have been cancelled or
   * redirected, and a redirect under the same organization (a flag guard sending `/roi` to
   * `/overview`) still leaves that segment in place and still wants the canonical slug.
   *
   * Deep links do not come through here on purpose: `orgPathParamGuard` canonicalizes from the
   * resolver's own answer, which is authoritative for the address it was asked about.
   */
  public async reconcileAddress(): Promise<void> {
    const write = this.lastWrite;
    if (!write) {
      return;
    }
    // Settled either way — `false` for a guard cancel or redirect, rejection for a navigation error
    // (both already handled at creation; neither is this method's to report). What the address
    // holds afterwards is what the live check below decides on.
    await write.navigation;
    if (this.lastWrite !== write) {
      return;
    }
    const selected = this.accountContext.selectedAccount();
    const canonical = this.accountContext.selectedUrlSegment();
    if (selected.uid !== write.uid || !canonical || canonical === write.segment) {
      return;
    }
    const segments = this.currentPrimarySegments();
    if (!this.isRewritableOrgAddress(segments) || segments[1] !== write.segment) {
      return;
    }
    const navigation = this.router.navigate(['/org', canonical, ...segments.slice(2)], {
      replaceUrl: true,
      queryParamsHandling: 'preserve',
      preserveFragment: true,
    });
    this.lastWrite = { uid: write.uid, segment: canonical, navigation: this.settled(navigation) };
  }

  /**
   * A navigation promise that never rejects: `Router.navigate` rejects on a navigation error, which
   * the router has already reported, and these promises are stored to be awaited later (or never) —
   * an unhandled rejection is the only thing an unguarded one could add.
   */
  private settled(navigation: Promise<boolean>): Promise<boolean> {
    return navigation.catch(() => false);
  }

  private isNotFoundAddress([root, second]: readonly string[]): boolean {
    return `/${root}/${second}` === ORG_NOT_FOUND_PATH;
  }

  /** An Org Lens address this service may rewrite: under `/org`, and not EasyCLA (DR-004 — legacy address in phase 1). */
  private isRewritableOrgAddress(segments: readonly string[]): boolean {
    return segments[0] === 'org' && segments[1] !== 'easycla';
  }

  /** Path segments of the current primary outlet (`/org/acme-inc/projects` → `['org', 'acme-inc', 'projects']`). */
  private currentPrimarySegments(): string[] {
    return this.router.parseUrl(this.router.url).root.children['primary']?.segments.map((s) => s.path) ?? [];
  }
}
