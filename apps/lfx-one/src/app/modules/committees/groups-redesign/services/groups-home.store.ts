// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, linkedSignal, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  BEHAVIORAL_CLASS_CONFIG,
  GROUPS_HOME_DEFAULT_FILTERS,
  GROUPS_HOME_PAGE_SIZE,
  GROUPS_VIEW_MODE_STORAGE_KEY,
  WG_ENGAGEMENT_METRICS_FLAG,
} from '@lfx-one/shared/constants';
import {
  FilterOption,
  GroupBehavioralClass,
  GroupsHomeFilterChip,
  GroupsHomeFilters,
  GroupsHomeMetric,
  GroupsHomeTab,
  GroupsHomeVotingCounts,
  GroupsViewMode,
  MyCommittee,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { buildEngagementStatCards, getGroupBehavioralClass } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { catchError, filter, finalize, map, of, switchMap, take } from 'rxjs';

/**
 * State of the Me lens groups page, provided by the page component.
 * @description Loads the viewer's groups once, sorted A–Z with their type resolved, then narrows them by foundation or
 * project, search, type tab and voting, in that order, and shows {@link GROUPS_HOME_PAGE_SIZE} groups at a time.
 * Metrics and tab counts cover every group. The card or list view is kept in local storage, like the existing groups page.
 */
@Injectable()
export class GroupsHomeStore {
  private readonly committeeService = inject(CommitteeService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly loadingState: WritableSignal<boolean> = signal(true);
  private readonly failedState: WritableSignal<boolean> = signal(false);
  private readonly reloadState: WritableSignal<number> = signal(0);
  private readonly tabState: WritableSignal<GroupsHomeTab> = signal<GroupsHomeTab>('all');
  private readonly searchState: WritableSignal<string> = signal('');
  private readonly filtersState: WritableSignal<GroupsHomeFilters> = signal(GROUPS_HOME_DEFAULT_FILTERS);
  private readonly viewState: WritableSignal<GroupsViewMode> = signal('card');
  /** Groups the viewer has left here; they stay hidden while the membership index catches up. */
  private readonly leftUidsState: WritableSignal<ReadonlySet<string>> = signal(new Set());
  private readonly visibleCountState: WritableSignal<number> = linkedSignal({
    source: () => ({ tab: this.tabState(), search: this.searchState(), filters: this.filtersState(), view: this.viewState() }),
    computation: () => GROUPS_HOME_PAGE_SIZE,
  });

  public readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  /** True when the groups failed to load. */
  public readonly failed: Signal<boolean> = this.failedState.asReadonly();
  public readonly tab: Signal<GroupsHomeTab> = this.tabState.asReadonly();
  public readonly search: Signal<string> = this.searchState.asReadonly();
  public readonly filters: Signal<GroupsHomeFilters> = this.filtersState.asReadonly();
  public readonly view: Signal<GroupsViewMode> = this.viewState.asReadonly();
  private readonly loadedGroups: Signal<MyCommittee[]> = this.initGroups();
  /** Every group the viewer belongs to, A–Z, with `behavioralClass` and `classDisplay` set. */
  public readonly groups: Signal<MyCommittee[]> = computed(() => {
    const left = this.leftUidsState();
    return left.size ? this.loadedGroups().filter((group) => !left.has(group.uid)) : this.loadedGroups();
  });
  /** Groups per behavioral class, over every group. */
  public readonly classCounts: Signal<Record<GroupBehavioralClass, number>> = this.initClassCounts();
  private readonly engagementEnabled: Signal<boolean> = this.featureFlagService.getBooleanFlag(WG_ENGAGEMENT_METRICS_FLAG, false);
  /** Unique people active across the viewer's groups, with its freshness, sample-data or coverage note; `null` while the flag is off or the stats load. */
  private readonly activeMembers: Signal<StatCardItem | null> = this.initActiveMembers();
  public readonly metrics: Signal<GroupsHomeMetric[]> = this.initMetrics();
  /** Foundations A–Z, then projects A–Z, from every group. */
  public readonly scopeOptions: Signal<FilterOption<string>[]> = this.initScopeOptions();
  /** Groups matching the foundation or project and the search, before the tab and voting. */
  private readonly searchedGroups: Signal<MyCommittee[]> = this.initSearchedGroups();
  /** Voting enabled and disabled counts for the Voting capability options, before the tab. */
  public readonly votingCounts: Signal<GroupsHomeVotingCounts> = computed(() => {
    const enabled = this.searchedGroups().filter((group) => !!group.enable_voting).length;
    return { enabled, disabled: this.searchedGroups().length - enabled };
  });
  /** Groups matching every filter and the tab. */
  public readonly filteredGroups: Signal<MyCommittee[]> = this.initFilteredGroups();
  public readonly visibleGroups: Signal<MyCommittee[]> = computed(() => this.filteredGroups().slice(0, this.visibleCountState()));
  public readonly hasMore: Signal<boolean> = computed(() => this.visibleCountState() < this.filteredGroups().length);
  public readonly filterChips: Signal<GroupsHomeFilterChip[]> = this.initFilterChips();

  public constructor() {
    // Restored after the first render so the server's card view hydrates unchanged.
    afterNextRender(() => this.viewState.set(this.readStoredView()));
  }

  public setTab(tab: GroupsHomeTab): void {
    this.tabState.set(tab);
  }

  public setSearch(search: string): void {
    this.searchState.set(search);
  }

  public setFilters(filters: GroupsHomeFilters): void {
    this.filtersState.set(filters);
  }

  public setView(view: GroupsViewMode): void {
    this.viewState.set(view);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(GROUPS_VIEW_MODE_STORAGE_KEY, view);
    } catch {
      // Storage may be full or disabled; the view still changes for this visit.
    }
  }

  /** Drops a group the viewer has just left from the list, tabs and metrics. */
  public removeGroup(uid: string): void {
    this.leftUidsState.update((left) => new Set(left).add(uid));
    // A tab or scope with no groups left disappears, so the list falls back to every group.
    const tab = this.tabState();
    if (tab !== 'all' && this.classCounts()[tab] === 0) this.tabState.set('all');
    const scope = this.filtersState().scope;
    if (scope && !this.groups().some((group) => group.project_uid === scope)) this.clearFilter('scope');
  }

  public clearFilter(key: keyof GroupsHomeFilters): void {
    this.filtersState.update((filters) => ({ ...filters, [key]: null }));
  }

  /** Clears the search, tab and filters. */
  public resetFilters(): void {
    this.searchState.set('');
    this.tabState.set('all');
    this.filtersState.set(GROUPS_HOME_DEFAULT_FILTERS);
  }

  /** Fetches the groups again, after a failure or a change to the viewer's memberships. */
  public reload(): void {
    this.reloadState.update((count) => count + 1);
  }

  public loadMore(): void {
    if (this.hasMore()) this.visibleCountState.update((count) => count + GROUPS_HOME_PAGE_SIZE);
  }

  /** The view chosen on an earlier visit; cards by default. */
  private readStoredView(): GroupsViewMode {
    try {
      return localStorage.getItem(GROUPS_VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'card';
    } catch {
      return 'card';
    }
  }

  private initGroups(): Signal<MyCommittee[]> {
    return toSignal(
      toObservable(this.reloadState).pipe(
        switchMap(() => {
          this.loadingState.set(true);
          this.failedState.set(false);
          return this.committeeService.getMyCommitteesOrError().pipe(
            map((groups) =>
              groups
                .map((group) => {
                  const behavioralClass = getGroupBehavioralClass(group.category);
                  return { ...group, behavioralClass, classDisplay: BEHAVIORAL_CLASS_CONFIG[behavioralClass] };
                })
                .sort((a, b) => a.name.localeCompare(b.name))
            ),
            catchError((error: HttpErrorResponse) => {
              console.error('Failed to load my groups:', error.status, error.message);
              this.failedState.set(true);
              return of([]);
            }),
            finalize(() => this.loadingState.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initClassCounts(): Signal<Record<GroupBehavioralClass, number>> {
    return computed(() => {
      const counts = Object.fromEntries(Object.keys(BEHAVIORAL_CLASS_CONFIG).map((key) => [key, 0])) as Record<GroupBehavioralClass, number>;
      for (const group of this.groups()) counts[group.behavioralClass ?? 'other']++;
      return counts;
    });
  }

  /** Fetched once the engagement metrics flag first turns on; shown only while it stays on. */
  private initActiveMembers(): Signal<StatCardItem | null> {
    const stats = toSignal(
      toObservable(this.engagementEnabled).pipe(
        filter((enabled) => enabled),
        take(1),
        switchMap(() => this.committeeService.getGroupsEngagementStats()),
        map((value) => buildEngagementStatCards(value, false)[0])
      ),
      { initialValue: null }
    );
    return computed(() => (this.engagementEnabled() ? stats() : null));
  }

  private initMetrics(): Signal<GroupsHomeMetric[]> {
    return computed(() => {
      const groups = this.groups();
      const activeMembers = this.activeMembers();
      const format = (value: number): string => value.toLocaleString('en-US');
      return [
        { label: 'Total Groups', icon: 'fa-light fa-users-rectangle', value: format(groups.length) },
        { label: 'Public Groups', icon: 'fa-light fa-globe', value: format(groups.filter((group) => group.public).length) },
        { label: 'Voting Enabled Groups', icon: 'fa-light fa-check-to-slot', value: format(groups.filter((group) => group.enable_voting === true).length) },
        {
          label: 'Active Members',
          icon: 'fa-light fa-user-group',
          value: typeof activeMembers?.value === 'number' ? format(activeMembers.value) : '—',
          subLine: activeMembers?.subLine,
        },
      ];
    });
  }

  private initScopeOptions(): Signal<FilterOption<string>[]> {
    return computed(() => {
      const foundations = new Map<string, string>();
      const projects = new Map<string, string>();
      for (const group of this.groups()) {
        if (group.project_uid) (group.is_foundation ? foundations : projects).set(group.project_uid, group.project_name || group.project_uid);
      }
      const sorted = (entities: Map<string, string>): FilterOption<string>[] =>
        [...entities].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
      return [...sorted(foundations), ...sorted(projects)];
    });
  }

  private initSearchedGroups(): Signal<MyCommittee[]> {
    return computed(() => {
      const scope = this.filters().scope;
      const isFoundation = !!scope && this.groups().some((group) => group.is_foundation && group.project_uid === scope);
      const search = this.search().trim().toLowerCase();
      return this.groups().filter(
        (group) =>
          (!scope || group.project_uid === scope || (isFoundation && !group.is_foundation && group.parent_project_uid === scope)) &&
          (!search || [group.name, group.description, group.category].some((text) => text?.toLowerCase().includes(search)))
      );
    });
  }

  private initFilteredGroups(): Signal<MyCommittee[]> {
    return computed(() => {
      const tab = this.tab();
      const voting = this.filters().voting;
      return this.searchedGroups().filter(
        (group) => (tab === 'all' || group.behavioralClass === tab) && (!voting || !!group.enable_voting === (voting === 'enabled'))
      );
    });
  }

  private initFilterChips(): Signal<GroupsHomeFilterChip[]> {
    return computed(() => {
      const { scope, voting } = this.filters();
      const chips: GroupsHomeFilterChip[] = [];
      if (scope) {
        const scopeGroup = this.groups().find((group) => group.project_uid === scope);
        chips.push({ key: 'scope', prefix: scopeGroup?.is_foundation ? 'Foundation:' : 'Project:', label: scopeGroup?.project_name || scope });
      }
      if (voting) chips.push({ key: 'voting', prefix: 'Voting:', label: voting === 'enabled' ? 'Enabled' : 'Disabled' });
      return chips;
    });
  }
}
