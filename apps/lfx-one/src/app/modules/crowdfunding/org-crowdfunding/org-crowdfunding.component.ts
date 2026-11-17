// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { environment } from '@environments/environment';
import { CF_ORG_DONATIONS_FLAG } from '@lfx-one/shared/constants';
import { OrgCrowdfundingTab, OrgCrowdfundingTabItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { filter, map, startWith } from 'rxjs/operators';

/**
 * Company lens Crowdfunding page (#5838): the Initiatives (#348) and Donations (#415) pages as two tabs under one
 * header, laid out like the Memberships page. Each tab is a child route so deep links, back/forward and the old
 * `/initiatives` and `/donations` redirects keep working; this shell owns only the header and the tab bar.
 */
@Component({
  selector: 'lfx-org-crowdfunding',
  imports: [ButtonComponent, PageHeaderComponent, RouterOutlet],
  templateUrl: './org-crowdfunding.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgCrowdfundingComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly isDonationsEnabled = inject(FeatureFlagService).getBooleanFlag(CF_ORG_DONATIONS_FLAG, false);

  // ─── Public Fields ─────────────────────────────────────────────────────────
  protected readonly newInitiativeUrl = `${environment.urls.crowdfunding}?fundraise=true`;
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);

  private readonly allTabs: OrgCrowdfundingTabItem[] = [
    { id: 'initiatives', label: 'Initiatives', icon: 'fa-light fa-box-dollar' },
    { id: 'donations', label: 'Donations', icon: 'fa-light fa-hand-holding-heart' },
  ];

  // ─── Computed Signals ─────────────────────────────────────────────────────
  // The tab the child route shows: the last segment of the shell's active child ('' while it is still redirecting).
  protected readonly activeTab = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map((): OrgCrowdfundingTab | '' => (this.route.snapshot.firstChild?.routeConfig?.path as OrgCrowdfundingTab | undefined) ?? '')
    ),
    { initialValue: '' as OrgCrowdfundingTab | '' }
  );
  // A tab shows for the viewers its nav entry used to: Initiatives for a direct writer on the company, Donations behind
  // `cf-org-donations`. The tab being viewed always shows, so a deep link never leaves the bar without its own tab.
  protected readonly tabs = computed(() => {
    const isWriter = this.orgRoleGrants.writerSet().has(this.accountContext.selectedAccount().uid ?? '');
    const available: Record<OrgCrowdfundingTab, boolean> = { initiatives: isWriter, donations: this.isDonationsEnabled() };
    return this.allTabs.filter((tab) => available[tab.id] || tab.id === this.activeTab());
  });

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected switchTab(tab: OrgCrowdfundingTab): void {
    void this.router.navigate([tab], { relativeTo: this.route });
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const idx = ids.indexOf(this.activeTab() as OrgCrowdfundingTab);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (typeof document !== 'undefined') {
        (document.getElementById(`crowdfunding-tab-trigger-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }
}
