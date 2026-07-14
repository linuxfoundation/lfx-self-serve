// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, of, switchMap } from 'rxjs';

import { GROUPS_TABS, GROUPS_VOTING_OPTIONS, DEFAULT_GROUPS_TAB_ID, VALID_GROUPS_TAB_IDS, VALID_GROUPS_VOTING_FILTERS } from '@lfx-one/shared/constants';
import type {
  GroupsSelectOption,
  GroupsTabConfig,
  GroupsTabId,
  GroupsVotingFilter,
  OrgGroup,
  OrgGroupsPrivacySplit,
  OrgGroupsStats,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { splitOrgGroupsByPrivacy } from '@lfx-one/shared/utils';

import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { AccountContextService } from '@services/account-context.service';

import { GroupsTableComponent } from './components/groups-table/groups-table.component';
import { OrgGroupsService } from './services/org-groups.service';

/** Groups page shell (LFXV2-1879 + LFXV2-1880) — KPI strip, tab strip, composing filter bar, groups table. */
@Component({
  selector: 'lfx-org-groups',
  imports: [ReactiveFormsModule, CardComponent, EmptyStateComponent, InputTextComponent, SelectComponent, StatCardGridComponent, GroupsTableComponent],
  templateUrl: './org-groups.component.html',
})
export class OrgGroupsComponent {
  // ─── Private injections ──────────────────────────────────────────────────────

  private readonly accountContext = inject(AccountContextService);
  private readonly groupsService = inject(OrgGroupsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  // ─── Constants exposed to template ───────────────────────────────────────────

  protected readonly tabs = GROUPS_TABS;
  protected readonly votingOptions: GroupsSelectOption[] = [...GROUPS_VOTING_OPTIONS];
  protected readonly foundationPlaceholder = 'All Foundations';

  // ─── URL snapshot for initial values ─────────────────────────────────────────

  private readonly initialParams = this.route.snapshot.queryParamMap;

  // ─── Filter form ──────────────────────────────────────────────────────────────

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.initialParams.get('q') ?? '', { nonNullable: true }),
    foundation: new FormControl<string>(this.initialParams.get('foundation') ?? '', { nonNullable: true }),
    voting: new FormControl<GroupsVotingFilter>(
      (() => {
        const v = this.initialParams.get('voting');
        return v && VALID_GROUPS_VOTING_FILTERS.has(v as GroupsVotingFilter) ? (v as GroupsVotingFilter) : 'all';
      })(),
      { nonNullable: true }
    ),
  });

  // ─── Mutable state ────────────────────────────────────────────────────────────

  private readonly loadingState = signal(true);
  protected readonly isLoading = this.loadingState.asReadonly();

  // ─── Tab state (from URL) ─────────────────────────────────────────────────────

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly activeTab: Signal<GroupsTabId> = computed(() => this.initActiveTab());
  protected readonly activeTabConfig: Signal<GroupsTabConfig> = computed(() => GROUPS_TABS.find((t) => t.id === this.activeTab()) ?? GROUPS_TABS[0]);

  // ─── Account context ──────────────────────────────────────────────────────────

  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);

  // ─── Filter values (debounced) ────────────────────────────────────────────────

  private readonly filterValues = toSignal(this.filterForm.valueChanges.pipe(debounceTime(300)), {
    initialValue: this.filterForm.getRawValue(),
  });

  // ─── Server data ──────────────────────────────────────────────────────────────

  private readonly allGroups: Signal<readonly OrgGroup[]> = this.initAllGroups();
  private readonly stats: Signal<OrgGroupsStats> = this.initStats();

  // ─── Privacy split (public + viewer-member private vs. rolled-up private) ─────
  // Computed from the unfiltered set so the rollup always reflects every hidden
  // group regardless of the current search/foundation/voting filters — filtering
  // first would let a search query act as an oracle for private group names.

  protected readonly groupsPrivacySplit: Signal<OrgGroupsPrivacySplit> = computed(() => splitOrgGroupsByPrivacy(this.allGroups()));

  // ─── Filtered rows (client-side, applied only to the viewer-visible set) ──────

  protected readonly visibleGroups = computed<readonly OrgGroup[]>(() => {
    const groups = this.groupsPrivacySplit().visible;
    const { search, foundation, voting } = this.filterValues();
    const q = (search ?? '').toLowerCase().trim();
    return groups.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q) && !g.description.toLowerCase().includes(q)) return false;
      if (foundation && g.foundation !== foundation) return false;
      if (voting === 'enabled' && !g.votingEnabled) return false;
      if (voting === 'disabled' && g.votingEnabled) return false;
      return true;
    });
  });

  // ─── Tab counts (applied to filtered + privacy-visible rows + tab filter) ─────

  protected readonly allCount = computed(() => this.visibleGroups().length);
  protected readonly boardCount = computed(() => this.visibleGroups().filter((g) => g.type === 'Board').length);
  protected readonly otherCount = computed(() => this.visibleGroups().filter((g) => g.type !== 'Board').length);

  // ─── KPI cards ────────────────────────────────────────────────────────────────

  protected readonly kpiCards: Signal<StatCardItem[]> = computed(() => this.initKpiCards());

  // ─── Foundation options (derived from the viewer-visible set — a hidden ──────
  // private group's foundation must not leak into the dropdown as a filterable option)

  protected readonly foundationOptions: Signal<GroupsSelectOption[]> = computed(() => {
    const foundations = [...new Set(this.groupsPrivacySplit().visible.map((g) => g.foundation))].sort();
    return [{ label: 'All Foundations', value: '' }, ...foundations.map((f) => ({ label: f, value: f }))];
  });

  // ─── URL sync ─────────────────────────────────────────────────────────────────

  public constructor() {
    this.filterForm.valueChanges.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((v) => {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          q: v.search || null,
          foundation: v.foundation || null,

          voting: v.voting !== 'all' ? v.voting : null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  // ─── Public methods ───────────────────────────────────────────────────────────

  protected switchTab(tabId: GroupsTabId): void {
    if (tabId === this.activeTab()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_GROUPS_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const ids = this.tabs.map((t) => t.id);
    const idx = ids.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (idx + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (idx - 1 + ids.length) % ids.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ids.length - 1;
    if (next !== null) {
      event.preventDefault();
      this.switchTab(ids[next]);
      if (isPlatformBrowser(this.platformId)) {
        (document.getElementById(`org-groups-tab-${ids[next]}`) as HTMLElement | null)?.focus();
      }
    }
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', foundation: '', voting: 'all' });
  }

  protected tabLabel(tab: GroupsTabConfig): string {
    if (!this.hasCompany() || this.isLoading()) return tab.label;
    if (tab.id === 'all') return `${tab.label} (${this.allCount()})`;
    if (tab.id === 'board') return `Board (${this.boardCount()})`;
    return `Other (${this.otherCount()})`;
  }

  // ─── Private initializers ─────────────────────────────────────────────────────

  private initActiveTab(): GroupsTabId {
    const raw = this.queryParamMap().get('tab');
    return raw && VALID_GROUPS_TAB_IDS.has(raw as GroupsTabId) ? (raw as GroupsTabId) : DEFAULT_GROUPS_TAB_ID;
  }

  private initAllGroups(): Signal<readonly OrgGroup[]> {
    return toSignal(
      toObservable(this.accountContext.selectedAccount).pipe(
        switchMap((account) => {
          if (!account.uid) {
            this.loadingState.set(false);
            return of([] as OrgGroup[]);
          }
          this.loadingState.set(true);
          return this.groupsService.getGroups().pipe(
            switchMap((data) => {
              this.loadingState.set(false);
              return of(data);
            })
          );
        })
      ),
      { initialValue: [] as OrgGroup[] }
    );
  }

  private initStats(): Signal<OrgGroupsStats> {
    const emptyStats: OrgGroupsStats = { total: 0, public: 0, votingEnabled: 0, boardCount: 0, otherCount: 0, foundationCount: 0 };
    return toSignal(
      toObservable(this.accountContext.selectedAccount).pipe(switchMap((account) => (account.uid ? this.groupsService.getStats() : of(emptyStats)))),
      { initialValue: emptyStats }
    );
  }

  private initKpiCards(): StatCardItem[] {
    const s = this.stats();
    const loading = this.isLoading();
    return [
      {
        value: loading ? '—' : s.total,
        label: 'Total Groups',
        icon: 'fa-light fa-users-rectangle',
        iconContainerClass: 'bg-gray-200 text-gray-500',
      },
      {
        value: loading ? '—' : s.public,
        label: 'Public Groups',
        icon: 'fa-light fa-globe',
        iconContainerClass: 'bg-blue-100 text-blue-600',
      },
      {
        value: loading ? '—' : s.votingEnabled,
        label: 'Voting Enabled Groups',
        icon: 'fa-light fa-check-to-slot',
        iconContainerClass: 'bg-emerald-100 text-emerald-600',
      },
    ];
  }
}
