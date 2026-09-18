// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { ORG_LENS_PAGE_SEGMENTS } from '@lfx-one/shared/constants';

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
 * - `navigateToSelectedOrg()` runs after a selection change: the viewer stays on the same Org Lens
 *   page, now addressed to the new organization — same child segments, query and fragment. A
 *   pushed history entry (not a replacement): the switch is a user intent, and Back must return
 *   to the pre-switch organization and page (US2 scenario 3, SC-009).
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

  /**
   * Re-address the current page to the selected organization. No-op outside Org Lens (a switch
   * from the Me or Project lens changes the selection only), on EasyCLA pages (DR-004: they stay
   * on the legacy address in phase 1), when no segment is known yet, or when the address already
   * names the selected organization (FR-014).
   */
  public navigateToSelectedOrg(): void {
    const tree = this.router.parseUrl(this.router.url);
    const segments = tree.root.children['primary']?.segments.map((s) => s.path) ?? [];
    if (segments[0] !== 'org' || segments[1] === 'easycla') {
      return;
    }
    const segment = this.accountContext.selectedUrlSegment();
    if (!segment) {
      return;
    }

    let child: string[];
    if (segments.length === 1 || segments[1] === 'not-found') {
      // Nothing (or the dead end) after `/org`: land on the organization's overview.
      child = ['overview'];
    } else if (ORG_LENS_PAGE_SEGMENTS[segments[1]] === true) {
      // Legacy `/org/{page}/…`: insert the organization.
      child = segments.slice(1);
    } else {
      // `/org/{organization}/…`: swap the organization, keep the page.
      const selected = this.accountContext.selectedAccount();
      if (segments[1] === segment || segments[1] === selected.uid) {
        return;
      }
      child = segments.slice(2);
    }

    void this.router.navigate(['/org', segment, ...child], { queryParamsHandling: 'preserve', preserveFragment: true });
  }
}
