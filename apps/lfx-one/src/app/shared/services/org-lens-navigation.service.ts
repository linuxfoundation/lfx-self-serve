// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { ORG_EASYCLA_RETURN_ORG_PARAM, ORG_EASYCLA_RETURN_SIGNED_PARAM, ORG_LENS_PAGE_SEGMENTS, ORG_NOT_FOUND_SEGMENTS } from '@lfx-one/shared/constants';
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
 * The segment is the *index's* slug for the selection (org-items row, resolver answer), never
 * member-service's: addresses are resolved against the index (`/api/orgs/resolve/:segment` reads
 * query-service), and during index lag the canonical record's slug is the one the resolver cannot
 * answer yet. The full slug-ownership rules — who writes the slug, the SFID fallback, how a rename
 * lands (links first, the address on the next resolved navigation) and the guard's trust window —
 * live in one place: docs/architecture/frontend/lens-system.md, "Org Lens addresses".
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

  /** `isNotFoundAddress` for the router's current address — the one page a same-organization pick may still leave. */
  public isOnNotFound(): boolean {
    return this.isNotFoundAddress(this.currentPrimarySegments());
  }

  /**
   * Re-address the current page to the selected organization. No-op outside Org Lens (a switch
   * from the Me or Project lens changes the selection only), when no segment is known yet, or when
   * the address already names the selected organization (FR-014). EasyCLA pages follow the same
   * rule since lfx-self-serve#2743 ended their DR-004 exemption.
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
    // Legacy `/org/easycla/…` for one release after lfx-self-serve#2743: a corporate-signing return
    // minted before the deploy arrives here as `?org={uid}&signed=1`, and the org list can answer
    // before `OrgClaReturnService.adopt` has run — a default insert then would write the *default*
    // organization into the address while the page adopts the named one from `?org=` (the DR-004
    // Option-B trace). The viewer's own switch may still re-address it; only the automatic default
    // leaves the legacy EasyCLA address alone. New returns carry the organization in the path and
    // are address-adopted, so they never reach a default in the first place.
    if (intent === 'default' && segments[1] === 'easycla') {
      return;
    }
    // A viewer's switch off that legacy address must not carry the return state with it: preserved,
    // `?org={A}` would be re-adopted by the re-mounted page under B's address (undoing the switch),
    // and `?signed=1` would resume a wait for A's row under B. The organization is in the path now.
    const leavingLegacyReturn = segments[1] === 'easycla';
    const segment = this.accountContext.selectedUrlSegment();
    if (!segment) {
      return;
    }

    let child: string[];
    // A bare or legacy address names no organization, so it has no pre-switch organization to go
    // back to: Back would re-render it under the *new* selection. Inserting the organization is a
    // canonicalization of the address the viewer already meant, whoever triggered it, so it replaces.
    let canonicalizes = false;
    if (segments.length === 1) {
      // Nothing after `/org`: land on the organization's overview.
      child = ['overview'];
      canonicalizes = true;
    } else if (this.isNotFoundAddress(segments)) {
      // The dead end: only the viewer's own pick may leave it, for that organization's overview.
      if (intent !== 'switch') {
        return;
      }
      child = ['overview'];
    } else if (ORG_LENS_PAGE_SEGMENTS[segments[1]] === true) {
      // Legacy `/org/{page}/…`: insert the organization.
      child = segments.slice(1);
      canonicalizes = true;
    } else {
      // `/org/{organization}/…`: a switch swaps the organization and keeps the page; a default
      // leaves an addressed organization alone.
      const selected = this.accountContext.selectedAccount();
      if (intent !== 'switch' || segments[1] === segment || segments[1] === selected.uid) {
        return;
      }
      child = segments.slice(2);
    }

    // A switch between addressed organizations is pushed so Back returns to the pre-switch
    // organization and page (US2 scenario 3); a default, or any insert into an address that named
    // no organization, is a canonicalizing rewrite of the address the viewer already meant, so it
    // replaces (FR-011) — otherwise Back would land on the bare, uncopyable form of the same screen,
    // now showing the new selection.
    void this.router.navigate(['/org', segment, ...child], {
      replaceUrl: intent === 'default' || canonicalizes,
      preserveFragment: true,
      ...(leavingLegacyReturn
        ? { queryParamsHandling: 'merge', queryParams: { [ORG_EASYCLA_RETURN_ORG_PARAM]: null, [ORG_EASYCLA_RETURN_SIGNED_PARAM]: null } }
        : { queryParamsHandling: 'preserve' }),
    });
  }

  /** True on the not-found dead end (`ORG_NOT_FOUND_SEGMENTS`) or anything beneath it — a deeper path there is still the dead end, never a legacy page. */
  private isNotFoundAddress(segments: readonly string[]): boolean {
    return segments.length >= ORG_NOT_FOUND_SEGMENTS.length && ORG_NOT_FOUND_SEGMENTS.every((segment, i) => segment === segments[i]);
  }

  /** An Org Lens address this service may rewrite: anything under `/org` (EasyCLA included since lfx-self-serve#2743). */
  private isRewritableOrgAddress(segments: readonly string[]): boolean {
    return segments[0] === 'org';
  }

  /** Path segments of the current primary outlet (`/org/acme-inc/projects` → `['org', 'acme-inc', 'projects']`). */
  private currentPrimarySegments(): string[] {
    return this.router.parseUrl(this.router.url).root.children['primary']?.segments.map((s) => s.path) ?? [];
  }
}
