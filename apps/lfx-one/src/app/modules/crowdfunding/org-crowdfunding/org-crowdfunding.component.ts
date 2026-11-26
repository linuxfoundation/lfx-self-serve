// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { environment } from '@environments/environment';
import { CF_ORG_DONATIONS_FLAG } from '@lfx-one/shared/constants';
import { OrgCrowdfundingTab, OrgCrowdfundingTabItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { runWhenRouterIdle } from '@shared/utils/router-idle.util';
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly accountContext = inject(AccountContextService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly isDonationsEnabled = this.featureFlagService.getBooleanFlag(CF_ORG_DONATIONS_FLAG, false);

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
  // The tab list is only known once its inputs have settled: the role grants (an empty writer set before they load reads as
  // "not a writer"), the donations flag (it reads `false` until the provider is ready) and the selected company (the writer
  // check is against its uid, which the placeholder account lacks until the default company loads). Until then the bar is empty.
  private readonly flagSettled = signal(false);
  private readonly settled = computed(
    () => this.flagSettled() && !!this.accountContext.selectedAccount().uid && (this.orgRoleGrants.loaded() || !!this.orgRoleGrants.error())
  );
  // A tab shows for the viewers its nav entry used to: Initiatives for a direct writer on the company, Donations behind
  // `cf-org-donations`. A viewer who lands on a tab they cannot use is moved to one they can (see the constructor).
  protected readonly tabs = computed(() => {
    if (!this.settled()) return [];
    const isWriter = this.orgRoleGrants.writerSet().has(this.accountContext.selectedAccount().uid ?? '');
    const available: Record<OrgCrowdfundingTab, boolean> = { initiatives: isWriter, donations: this.isDonationsEnabled() };
    return this.allTabs.filter((tab) => available[tab.id]);
  });
  protected readonly showNewInitiative = computed(() => this.activeTab() === 'initiatives' && this.tabs().some((tab) => tab.id === 'initiatives'));

  // The tab to move to, or null when the current address is fine (and until the grants and the flag settle).
  private readonly landingTarget = computed((): OrgCrowdfundingTab | null => {
    if (!this.settled()) return null;
    const tabs = this.tabs();
    const active = this.activeTab();
    if (active === '') {
      const requested = this.route.snapshot.queryParamMap.get('tab');
      return tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? 'initiatives';
    }
    if (tabs.some((tab) => tab.id === active)) return null;
    // A tab the viewer cannot use moves to their first, or to Initiatives when they have none (its page explains the missing
    // access), so a Donations panel never stays mounted once the flag closes under a non-writer.
    const fallback = tabs[0]?.id ?? 'initiatives';
    return fallback === active ? null : fallback;
  });

  constructor() {
    this.settleFlag();
    // Picks the tab once the role grants and the donations flag have settled: before that the writer set is empty and the
    // flag reads `false`, which would send a direct writer to Donations and a donations-only viewer to Initiatives.
    // - The bare `/crowdfunding` address lands on `?tab=` when that tab is available, else the first tab.
    // - A tab the viewer cannot use (an old Initiatives link, or a switch to a company they only view) moves to the first.
    // - A viewer with no tab at all keeps Initiatives, whose page explains the missing access.
    toObservable(this.landingTarget)
      .pipe(
        filter((target): target is OrgCrowdfundingTab => !!target),
        takeUntilDestroyed(this.destroyRef)
      )
      // Not while a navigation is in flight: a relative `navigate` builds on this page's route, so issued during an
      // All Companies switch it would supersede the switch. The target is recomputed once the router is idle.
      .subscribe(() =>
        runWhenRouterIdle(this.router, this.destroyRef, () => {
          const target = this.landingTarget();
          if (target) {
            void this.router.navigate([target], { relativeTo: this.route, replaceUrl: true, queryParams: { tab: null }, queryParamsHandling: 'merge' });
          }
        })
      );
  }

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

  // Follows `orgLensFlagGuard`: a local override decides on its own, else wait for the provider; a provider that never
  // becomes ready in time settles too, and the flag then reads its closed default. Browser-only, as the guard is.
  private settleFlag(): void {
    if (!this.isBrowser) return;
    if (this.featureFlagService.getFlagOverride(CF_ORG_DONATIONS_FLAG) !== undefined || this.featureFlagService.providerReady()) {
      this.flagSettled.set(true);
      return;
    }
    void this.featureFlagService.waitForReady({ guard: 'orgCrowdfundingTabs', flag: CF_ORG_DONATIONS_FLAG }).finally(() => this.flagSettled.set(true));
  }
}
