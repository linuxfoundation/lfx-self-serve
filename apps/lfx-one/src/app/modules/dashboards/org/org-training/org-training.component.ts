// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_ORG_TRAINING_TAB_ID, ORG_TRAINING_TABS, VALID_ORG_TRAINING_TAB_IDS } from '@lfx-one/shared/constants';
import type { OrgTrainingStats, OrgTrainingStatsQuery, OrgTrainingTabId, OrgTrainingViewState } from '@lfx-one/shared/interfaces';
import { orgTrainingFiltersSignature, orgTrainingStatsQuery, orgTrainingTableNote, parseOrgTrainingViewState } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, finalize, of, skip, switchMap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { OrgTrainingFilterBarComponent } from '@components/org-training-filter-bar/org-training-filter-bar.component';
import { OrgTrainingStatsComponent } from '@components/org-training-stats/org-training-stats.component';
import { OrgTrainingStatsErrorComponent } from '@components/org-training-stats-error/org-training-stats-error.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { PersonDetailDrawerComponent } from '@components/person-detail-drawer/person-detail-drawer.component';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';

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
  ],
  templateUrl: './org-training.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgTrainingComponent {
  // ─── Private injections ────────────────────────────────────────────────────
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  protected readonly emptyState = inject(OrgLensEmptyStateService);

  // ─── Configuration ─────────────────────────────────────────────────────────
  // Shared constants are readonly; copy into a mutable array for the component input that expects it.
  protected readonly tabs = [...ORG_TRAINING_TABS];

  // ─── Forms ─────────────────────────────────────────────────────────────────
  // The name search sits in the filter row but is table-local: it narrows the group rows, never the stat tiles.
  protected readonly searchForm = new FormGroup({ search: new FormControl('') });

  // ─── Writable Signals ──────────────────────────────────────────────────────
  // Starts true: the first org emission arrives after the first render, which must not state an as-of date it lacks.
  protected readonly statsLoading = signal(true);
  protected readonly statsError = signal(false);
  // Bumped by the stats error card's Retry: re-fetches the stats only, never the table.
  private readonly statsRetryTrigger = signal(0);
  protected readonly searchQuery = signal('');

  // ─── Computed / toSignal ───────────────────────────────────────────────────
  // Page-level state (e.g. `contractor-no-grant`, `could-not-load`) replacing the page, or null when it renders.
  protected readonly pageState = this.emptyState.pageState;
  protected readonly correlationId = this.orgRoleGrantsService.correlationId;
  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  protected readonly orgUid = computed(() => this.accountContext.selectedAccount()?.uid ?? '');
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
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
  private readonly trainingStats: Signal<OrgTrainingStats | null> = this.initTrainingStats();
  // Null while loading or failed, so no tile states the previous organization's or filters' numbers or as-of dates.
  protected readonly shownStats: Signal<OrgTrainingStats | null> = computed(() => (this.statsLoading() || this.statsError() ? null : this.trainingStats()));

  public constructor() {
    this.searchForm.controls.search.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((value) => this.searchQuery.set((value ?? '').trim()));

    // The name search belongs to the organization it was typed for: clear it (and its applied term) on a switch.
    toObservable(this.orgUid)
      .pipe(distinctUntilChanged(), skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.searchForm.controls.search.setValue('');
        this.searchQuery.set('');
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

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initTrainingStats(): Signal<OrgTrainingStats | null> {
    const request$ = toObservable(
      computed(() => ({ orgUid: this.accountContext.selectedAccount()?.uid ?? null, query: this.statsQuery(), retry: this.statsRetryTrigger() }))
    );
    return toSignal(
      request$.pipe(
        switchMap(({ orgUid, query }) => {
          // No org selected (or context cleared mid-flight): reset state instead of leaving loading stuck.
          if (!orgUid) {
            this.statsLoading.set(false);
            this.statsError.set(false);
            return of(null);
          }

          this.statsLoading.set(true);
          this.statsError.set(false);

          return this.trainingService.getTrainingStats(orgUid, query).pipe(
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
