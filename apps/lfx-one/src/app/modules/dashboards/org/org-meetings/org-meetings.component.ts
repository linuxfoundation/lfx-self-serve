// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, skip, switchMap, tap } from 'rxjs';

import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import {
  DEFAULT_MEETINGS_PAGE_SIZE,
  DEFAULT_ORG_MEETINGS_TAB_ID,
  DEMO_PAST_MEETINGS,
  ORG_MEETINGS_KPI_RECORDINGS_COUNT,
  ORG_MEETINGS_TABS,
  ORG_MEETINGS_TYPE_OPTIONS,
  VALID_ORG_MEETINGS_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  FilterOption,
  OrgMeeting,
  OrgMeetingBase,
  OrgMeetingsSummary,
  OrgMeetingsTabId,
  OrgMeetingType,
  OrgPastMeeting,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { MeetingService } from '@services/meeting.service';

import { OrgUpcomingMeetingsComponent } from './components/org-upcoming-meetings/org-upcoming-meetings.component';
import { OrgPastMeetingsComponent } from './components/org-past-meetings/org-past-meetings.component';

@Component({
  selector: 'lfx-org-meetings',
  imports: [ReactiveFormsModule, StatCardGridComponent, InputTextComponent, SelectComponent, OrgUpcomingMeetingsComponent, OrgPastMeetingsComponent],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  // === Private injections ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingService = inject(MeetingService);

  // === Template constants ===
  protected readonly tabs = ORG_MEETINGS_TABS;
  protected readonly pageSize = DEFAULT_MEETINGS_PAGE_SIZE;
  protected readonly typeOptions: FilterOption<OrgMeetingType | null>[] = ORG_MEETINGS_TYPE_OPTIONS;

  // === Forms ===
  protected readonly filterForm = new FormGroup({
    search: new FormControl('', { nonNullable: true }),
    type: new FormControl<OrgMeetingType | null>(null),
    project: new FormControl<string | null>(null),
  });

  // === WritableSignals ===
  protected readonly summaryLoading = signal(true);
  protected readonly pendingRsvpOnly = signal(false);
  protected readonly listLoading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly listError = signal(false);
  protected readonly loadMoreError = signal(false);
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly upcomingMeetings = signal<readonly OrgMeeting[]>([]);
  protected readonly projectOptions = signal<FilterOption[]>([{ label: 'All Projects', value: null }]);
  protected readonly pastMeetings = signal<readonly OrgPastMeeting[]>(DEMO_PAST_MEETINGS);
  private readonly refreshTick = signal(0);

  // === Computed signals ===
  protected readonly accountId = computed(() => this.accountContext.selectedAccount().accountId);
  protected readonly orgName = computed(() => this.accountContext.selectedAccount().accountName ?? '');
  protected readonly summary: Signal<OrgMeetingsSummary | null> = this.initSummary();
  protected readonly activeTab: Signal<OrgMeetingsTabId> = this.initActiveTab();
  protected readonly kpiCards: Signal<StatCardItem[]> = this.initKpiCards();
  protected readonly nextUpcomingMeetingDate: Signal<string> = this.initNextUpcomingMeetingDate();
  protected readonly filterSearch: Signal<string> = toSignal(this.filterForm.controls.search.valueChanges, { initialValue: '' });
  protected readonly filterType: Signal<OrgMeetingType | null> = toSignal(this.filterForm.controls.type.valueChanges, { initialValue: null });
  protected readonly filterProject: Signal<string | null> = toSignal(this.filterForm.controls.project.valueChanges, { initialValue: null });
  protected readonly hasMore = computed(() => this.upcomingMeetings().length < this.total());
  protected readonly filteredPast: Signal<readonly OrgPastMeeting[]> = this.initFilteredPast();

  private readonly debouncedSearch = toSignal(toObservable(this.filterSearch).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });

  public constructor() {
    this.initProjectOptions();
    this.initResetOnFilterChange();
    this.initUpcomingFetch();
  }

  // === Protected methods ===
  protected switchTab(tabId: OrgMeetingsTabId): void {
    if (tabId === this.activeTab()) return;
    if (tabId !== 'upcoming') {
      this.pendingRsvpOnly.set(false);
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_ORG_MEETINGS_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected togglePendingRsvpOnly(): void {
    this.pendingRsvpOnly.update((value) => !value);
  }

  protected loadMore(): void {
    // offset tracks the loaded count (monotonic), so this advances on success and retries the same page after a failure.
    this.loadMoreError.set(false);
    this.offset.set(this.upcomingMeetings().length);
    this.refreshTick.update((value) => value + 1);
  }

  protected retryUpcoming(): void {
    this.listError.set(false);
    this.offset.set(0);
    this.refreshTick.update((value) => value + 1);
  }

  // === Private initializers ===
  private initActiveTab(): Signal<OrgMeetingsTabId> {
    return toSignal(
      this.route.queryParamMap.pipe(
        map((params) => {
          const tab = params.get('tab') as OrgMeetingsTabId | null;
          return tab && VALID_ORG_MEETINGS_TAB_IDS.has(tab) ? tab : DEFAULT_ORG_MEETINGS_TAB_ID;
        })
      ),
      { initialValue: DEFAULT_ORG_MEETINGS_TAB_ID }
    );
  }

  private initKpiCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => {
      if (this.activeTab() === 'past') {
        return [
          {
            value: this.filteredPast().length.toLocaleString(),
            label: 'Past Meetings',
            icon: 'fa-light fa-clock-rotate-left',
            iconContainerClass: 'bg-gray-200 text-gray-500',
          },
          {
            value: ORG_MEETINGS_KPI_RECORDINGS_COUNT.toLocaleString(),
            label: 'Recordings Available',
            icon: 'fa-light fa-video',
            iconContainerClass: 'bg-red-100 text-red-600',
          },
        ];
      }
      const nextDate = this.nextUpcomingMeetingDate();
      const summary = this.summary();
      const recurringProjects = summary?.recurringFoundations ?? 0;
      return [
        {
          value: (summary?.upcomingMeetings ?? 0).toLocaleString(),
          label: 'Upcoming Meetings',
          subLine: nextDate ? `Next: ${nextDate}` : undefined,
          icon: 'fa-light fa-calendar',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: (summary?.recurringSeries ?? 0).toLocaleString(),
          label: 'Recurring Series',
          subLine: recurringProjects > 0 ? `Across ${recurringProjects} ${recurringProjects === 1 ? 'project' : 'projects'}` : undefined,
          icon: 'fa-light fa-repeat',
          iconContainerClass: 'bg-purple-100 text-purple-600',
        },
      ];
    });
  }

  private initSummary(): Signal<OrgMeetingsSummary | null> {
    return toSignal(
      toObservable(this.accountId).pipe(
        filter((id): id is string => !!id),
        tap(() => this.summaryLoading.set(true)),
        switchMap((id) =>
          this.meetingService.getOrgMeetingsSummary(id).pipe(
            catchError(() => of(null)),
            finalize(() => this.summaryLoading.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initNextUpcomingMeetingDate(): Signal<string> {
    return computed(() => {
      const next = this.summary()?.nextMeeting;
      if (!next) return '';
      return new Date(next).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
  }

  private initProjectOptions(): void {
    toObservable(this.accountId)
      .pipe(
        filter((id): id is string => !!id),
        switchMap((id) => this.meetingService.getOrgMeetingProjects(id).pipe(catchError(() => of({ projects: [] as string[] })))),
        takeUntilDestroyed()
      )
      .subscribe((res) => this.projectOptions.set([{ label: 'All Projects', value: null }, ...res.projects.map((p) => ({ label: p, value: p }))]));
  }

  private initResetOnFilterChange(): void {
    combineLatest([
      toObservable(this.accountId),
      toObservable(this.debouncedSearch),
      toObservable(this.filterType),
      toObservable(this.filterProject),
      toObservable(this.pendingRsvpOnly),
    ])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.offset.set(0));
  }

  private initUpcomingFetch(): void {
    const params$ = toObservable(
      computed(() => {
        const accountId = this.accountId();
        if (!accountId) return null;
        return {
          accountId,
          searchQuery: this.debouncedSearch() || null,
          project: this.filterProject(),
          type: this.filterType(),
          pendingRsvpOnly: this.pendingRsvpOnly(),
          offset: this.offset(),
          tick: this.refreshTick(),
        };
      })
    );

    params$
      .pipe(
        debounceTime(0),
        filter((p): p is NonNullable<typeof p> => p !== null),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        tap((p) => {
          if (p.offset === 0) {
            this.listLoading.set(true);
            this.listError.set(false);
            this.loadMoreError.set(false);
            this.loadingMore.set(false);
          } else {
            this.loadingMore.set(true);
            this.loadMoreError.set(false);
          }
        }),
        switchMap((p) =>
          this.meetingService
            .getOrgUpcomingMeetings(p.accountId, {
              searchQuery: p.searchQuery,
              project: p.project,
              type: p.type,
              pendingRsvpOnly: p.pendingRsvpOnly,
              pageSize: this.pageSize,
              offset: p.offset,
            })
            .pipe(
              map((res) => ({ res, offset: p.offset })),
              catchError(() => of({ res: null, offset: p.offset }))
            )
        ),
        takeUntilDestroyed()
      )
      .subscribe(({ res, offset }) => {
        if (!res) {
          if (offset === 0) {
            this.listError.set(true);
            this.upcomingMeetings.set([]);
            this.listLoading.set(false);
          } else {
            // Keep the loaded pages; the load-more button surfaces the error and retries the same offset.
            this.loadMoreError.set(true);
            this.loadingMore.set(false);
          }
          return;
        }
        this.total.set(res.total);
        // Splice the page in at its offset so a re-fetch of the same page can't duplicate rows.
        this.upcomingMeetings.set([...this.upcomingMeetings().slice(0, offset), ...res.data]);
        this.listLoading.set(false);
        this.loadingMore.set(false);
      });
  }

  private initFilteredPast(): Signal<readonly OrgPastMeeting[]> {
    return computed(() => {
      const now = Date.now();
      return this.pastMeetings()
        .filter((m) => new Date(m.startTime).getTime() < now)
        .filter((m) => this.matchesFilters(m));
    });
  }

  private matchesFilters(meeting: OrgMeetingBase): boolean {
    const search = this.filterSearch().toLowerCase();
    const type = this.filterType();
    const project = this.filterProject();
    const matchesSearch = !search || meeting.title.toLowerCase().includes(search) || (meeting.agenda ?? '').toLowerCase().includes(search);
    const matchesType = !type || meeting.type === type;
    const matchesProject = !project || meeting.project === project;
    return matchesSearch && matchesType && matchesProject;
  }
}
