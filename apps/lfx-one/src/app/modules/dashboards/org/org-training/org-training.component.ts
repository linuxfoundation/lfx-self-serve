// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_TRAINING_TAB_ID,
  ORG_EVENTS_ALL_COMPANIES_LABEL,
  ORG_EVENTS_ROLL_UP_EXCLUDED_NOTICE,
  ORG_EVENTS_ROLL_UP_INCOMPLETE_NOTICE,
  ORG_TRAINING_COMPANY_QUERY_PARAM,
  ORG_TRAINING_PAGE_DESCRIPTION,
  ORG_TRAINING_ROLL_UP_PAGE_DESCRIPTION,
  ORG_TRAINING_TABS,
  VALID_ORG_TRAINING_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  OrgDropdownOption,
  OrgLensRowOrganization,
  OrgTrainingStatKey,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
  OrgTrainingTabId,
  OrgTrainingViewState,
} from '@lfx-one/shared/interfaces';
import { orgTrainingFiltersSignature, orgTrainingStatsQuery, orgTrainingTableNote, parseOrgTrainingViewState } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, of, skip, switchMap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { OrgTrainingFilterBarComponent } from '@components/org-training-filter-bar/org-training-filter-bar.component';
import { OrgTrainingStatsComponent } from '@components/org-training-stats/org-training-stats.component';
import { OrgTrainingStatsErrorComponent } from '@components/org-training-stats-error/org-training-stats-error.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { PersonDetailDrawerComponent } from '@components/person-detail-drawer/person-detail-drawer.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgLensViewModeService } from '@shared/services/org-lens-view-mode.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { runWhenRouterIdle } from '@shared/utils/router-idle.util';

import { OrgTrainingGroupsTableComponent } from './components/org-training-groups-table/org-training-groups-table.component';

@Component({
  selector: 'lfx-org-training',
  imports: [
    PageHeaderComponent,
    SkeletonModule,
    CardComponent,
    CardTabsBarComponent,
    InputTextComponent,
    OrgLensEmptyStateComponent,
    OrgTrainingFilterBarComponent,
    OrgTrainingStatsComponent,
    OrgTrainingStatsErrorComponent,
    OrgTrainingGroupsTableComponent,
    PersonDetailDrawerComponent,
    SelectComponent,
  ],
  templateUrl: './org-training.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgTrainingComponent {
  // ─── Private injections ────────────────────────────────────────────────────
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly accountContext = inject(AccountContextService);
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  protected readonly emptyState = inject(OrgLensEmptyStateService);
  protected readonly viewMode = inject(OrgLensViewModeService);
  /** The all employee view has no People page, so the learners-not-on-the-people-list tile (and its endpoint) is gone there. */
  protected readonly statsExcludeKeys = computed<OrgTrainingStatKey[]>(() => (this.viewMode.isEmployeeView() ? ['learnersOutsidePeopleList'] : []));

  // ─── Configuration ─────────────────────────────────────────────────────────
  // Shared constants are readonly; copy into a mutable array for the component input that expects it.
  protected readonly tabs = [...ORG_TRAINING_TABS];
  // The Company pick sits in the filter bar's row, so its Clear all resets it too.
  protected readonly projectedFilterParams = [ORG_TRAINING_COMPANY_QUERY_PARAM];

  // ─── Forms ─────────────────────────────────────────────────────────────────
  // The name search sits in the filter row but is table-local: it narrows the group rows, never the stat tiles.
  protected readonly searchForm = new FormGroup({ search: new FormControl('') });
  // Roll-up only: the Company pick follows `?company=` ('' is All Companies).
  protected readonly companyForm = new FormGroup({ company: new FormControl<string>('', { nonNullable: true }) });

  // ─── Writable Signals ──────────────────────────────────────────────────────
  // Starts true: the first org emission arrives after the first render, which must not state an as-of date it lacks.
  protected readonly statsLoading = signal(true);
  protected readonly statsError = signal(false);
  // Bumped by the stats error card's Retry: re-fetches the stats only, never the table.
  private readonly statsRetryTrigger = signal(0);
  protected readonly searchQuery = signal('');
  // The roll-up's organizations, from the stats response of the roll-up they belong to.
  private readonly servedOrganizations = signal<{ orgUid: string; organizations: readonly OrgLensRowOrganization[] } | null>(null);

  // ─── Computed / toSignal ───────────────────────────────────────────────────
  // Page-level state (e.g. `contractor-no-grant`, `could-not-load`) replacing the page, or null when it renders.
  protected readonly pageState = this.emptyState.pageState;
  protected readonly correlationId = this.orgRoleGrantsService.correlationId;
  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly orgUid = computed(() => this.accountContext.selectedAccount()?.uid ?? '');
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected readonly isRollUp = this.accountContext.isRollUp;
  protected readonly description = computed(() => (this.isRollUp() ? ORG_TRAINING_ROLL_UP_PAGE_DESCRIPTION : ORG_TRAINING_PAGE_DESCRIPTION));
  private readonly organizations = computed<readonly OrgLensRowOrganization[] | null>(() => {
    const served = this.servedOrganizations();
    return this.isRollUp() && served?.orgUid === this.orgUid() ? served.organizations : null;
  });
  private readonly pickedCompany = computed(() => this.queryParamMap().get(ORG_TRAINING_COMPANY_QUERY_PARAM) ?? '');
  /**
   * The company the reads narrow to: '' for every organization of the roll-up (and always on a single organization), or
   * null while a picked company cannot be checked yet against the roll-up's organizations. A company outside them reads as ''.
   */
  protected readonly company: Signal<string | null> = computed(() => {
    const picked = this.pickedCompany();
    if (!this.isRollUp() || !picked) return '';
    const organizations = this.organizations();
    if (!organizations) return null;
    return organizations.some((organization) => organization.accountId === picked) ? picked : '';
  });
  // The stats read that names the roll-up's organizations failed, so the pick cannot be checked: the stats error's Retry restarts it.
  protected readonly companyCheckFailed = computed(() => this.company() === null && this.statsError());
  protected readonly companyOptions: Signal<OrgDropdownOption[]> = computed(() => [
    { label: ORG_EVENTS_ALL_COMPANIES_LABEL, value: '' },
    ...(this.organizations() ?? []).map((organization) => ({ label: organization.name, value: organization.accountId })),
  ]);
  // The filter bar writes range, filters and group-by to the URL; the page and the bar read the same state from it.
  protected readonly viewState: Signal<OrgTrainingViewState> = computed(() => parseOrgTrainingViewState((param) => this.queryParamMap().get(param)));
  // Equal while range and filters are, so a tab or group-by change refetches neither the stats nor the table's pairs.
  protected readonly statsQuery: Signal<OrgTrainingStatsQuery> = computed(() => orgTrainingStatsQuery(this.viewState()), {
    equal: (a, b) => orgTrainingFiltersSignature(a) === orgTrainingFiltersSignature(b),
  });
  protected readonly groupBy = computed(() => this.viewState().groupBy);
  protected readonly range = computed(() => this.viewState().range);
  protected readonly tableNote = computed(() => orgTrainingTableNote(this.range()));
  protected readonly activeTab: Signal<OrgTrainingTabId> = computed(() => {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_ORG_TRAINING_TAB_IDS.has(raw as OrgTrainingTabId) ? (raw as OrgTrainingTabId) : DEFAULT_ORG_TRAINING_TAB_ID;
  });
  private readonly trainingStats: Signal<{ company: string; stats: OrgTrainingStats } | null> = this.initTrainingStats();
  // Null while loading or failed, or while the stats are not yet the picked company's, so no tile states another view's numbers or as-of dates.
  protected readonly shownStats: Signal<OrgTrainingStats | null> = computed(() => {
    const served = this.trainingStats();
    return this.statsLoading() || this.statsError() || !served || served.company !== this.company() ? null : served.stats;
  });
  protected readonly rollUpNotices = computed<string[]>(() => {
    const coverage = this.isRollUp() ? this.shownStats()?.rollUp : undefined;
    if (!coverage) return [];
    return [...(coverage.excludedCount > 0 ? [ORG_EVENTS_ROLL_UP_EXCLUDED_NOTICE] : []), ...(!coverage.complete ? [ORG_EVENTS_ROLL_UP_INCOMPLETE_NOTICE] : [])];
  });

  public constructor() {
    this.searchForm.controls.search.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((value) => this.searchQuery.set((value ?? '').trim()));

    // The name search belongs to the organization it was typed for: clear it (and its applied term) on a switch.
    toObservable(this.orgUid)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.searchForm.controls.search.setValue('');
        this.searchQuery.set('');
      });

    // URL → Company pick (silent), and a pick → URL; `tab`, range and filters are kept.
    toObservable(this.pickedCompany)
      .pipe(takeUntilDestroyed())
      .subscribe((company) => this.companyForm.controls.company.setValue(company, { emitEvent: false }));
    this.companyForm.controls.company.valueChanges.pipe(takeUntilDestroyed()).subscribe((company) => this.navigateCompany(company));

    // A company the page cannot narrow to (a single organization, or one outside the roll-up) is dropped from the URL,
    // once no other navigation (an org switch) is in flight and only if the pick is still one to drop.
    toObservable(computed(() => ({ picked: this.pickedCompany(), company: this.company() })))
      .pipe(takeUntilDestroyed())
      .subscribe(({ picked, company }) => {
        if (!picked || company !== '') return;
        runWhenRouterIdle(this.router, this.destroyRef, () => {
          if (this.pickedCompany() && this.company() === '') this.navigateCompany('');
        });
      });
  }

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onActiveTabChange(tabId: string): void {
    if (!VALID_ORG_TRAINING_TAB_IDS.has(tabId as OrgTrainingTabId) || tabId === this.activeTab()) {
      return;
    }
    // Merge keeps range, filters and group-by in the URL across tabs.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_ORG_TRAINING_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected retryStats(): void {
    this.statsRetryTrigger.update((value) => value + 1);
  }

  // ─── Private Methods ───────────────────────────────────────────────────────
  private navigateCompany(company: string): void {
    if (company === this.pickedCompany()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [ORG_TRAINING_COMPANY_QUERY_PARAM]: company || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initTrainingStats(): Signal<{ company: string; stats: OrgTrainingStats } | null> {
    const request$ = toObservable(
      computed(() => ({
        orgUid: this.accountContext.selectedAccount()?.uid ?? null,
        // An unchecked pick reads every organization first: that response names the roll-up's organizations to check it against.
        company: this.company() ?? '',
        query: this.statsQuery(),
        retry: this.statsRetryTrigger(),
      }))
    ).pipe(
      // An unchecked pick that turns out to be outside the roll-up resolves to the read already made.
      distinctUntilChanged((a, b) => a.orgUid === b.orgUid && a.company === b.company && a.query === b.query && a.retry === b.retry)
    );
    return toSignal(
      request$.pipe(
        switchMap(({ orgUid, company, query }) => {
          // No org selected (or context cleared mid-flight): reset state instead of leaving loading stuck.
          if (!orgUid) {
            this.statsLoading.set(false);
            this.statsError.set(false);
            return of(null);
          }

          this.statsLoading.set(true);
          this.statsError.set(false);

          const stats$ = company ? this.trainingService.getTrainingStats(orgUid, query, company) : this.trainingService.getTrainingStats(orgUid, query);
          return stats$.pipe(
            map((stats) => {
              if (!stats) return null;
              if (stats.organizations) this.servedOrganizations.set({ orgUid, organizations: stats.organizations });
              return { company, stats };
            }),
            catchError((error: unknown) => {
              console.error('Failed to load training stats', error);
              this.statsError.set(true);
              return of(null);
            }),
            // finalize clears loading once — covers success and the recovered error path.
            finalize(() => this.statsLoading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
