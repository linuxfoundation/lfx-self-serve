// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
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
  DEMO_UPCOMING_MEETINGS,
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
import { splitOrgMeetingsByPrivacy } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { MeetingService } from '@services/meeting.service';

import { OrgUpcomingMeetingsComponent } from './components/org-upcoming-meetings/org-upcoming-meetings.component';
import { OrgPastMeetingsComponent } from './components/org-past-meetings/org-past-meetings.component';

@Component({
  selector: 'lfx-org-meetings',
  imports: [ReactiveFormsModule, StatCardGridComponent, InputTextComponent, SelectComponent, OrgUpcomingMeetingsComponent, OrgPastMeetingsComponent],
  providers: [DatePipe],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  // === Private injections ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingService = inject(MeetingService);
  private readonly datePipe = inject(DatePipe);

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
  protected readonly listLoading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly listError = signal(false);
  protected readonly loadMoreError = signal(false);
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  // Seeded with demo data until a real fetch returns rows — mirrors the past-tab demo seam (real Snowflake data pass deferred).
  protected readonly upcomingMeetings = signal<readonly OrgMeeting[]>(DEMO_UPCOMING_MEETINGS);
  protected readonly projectOptions = signal<FilterOption[]>([{ label: 'All Projects', value: null }]);
  protected readonly pastMeetings = signal<readonly OrgPastMeeting[]>(DEMO_PAST_MEETINGS);
  private readonly refreshTick = signal(0);

  // === Computed signals ===
  protected readonly accountId = computed(() => this.accountContext.selectedAccount().accountId);
  protected readonly orgName = computed(() => this.accountContext.selectedAccount().accountName ?? '');
  protected readonly summary: Signal<OrgMeetingsSummary | null> = this.initSummary();
  protected readonly effectiveSummary: Signal<OrgMeetingsSummary> = this.initEffectiveSummary();
  protected readonly activeTab: Signal<OrgMeetingsTabId> = this.initActiveTab();
  protected readonly kpiCards: Signal<StatCardItem[]> = this.initKpiCards();
  protected readonly nextUpcomingMeetingDate: Signal<string> = this.initNextUpcomingMeetingDate();
  protected readonly filterSearch: Signal<string> = toSignal(this.filterForm.controls.search.valueChanges, { initialValue: '' });
  protected readonly filterType: Signal<OrgMeetingType | null> = toSignal(this.filterForm.controls.type.valueChanges, { initialValue: null });
  protected readonly filterProject: Signal<string | null> = toSignal(this.filterForm.controls.project.valueChanges, { initialValue: null });
  protected readonly hasMore = computed(() => this.upcomingMeetings().length < this.total());
  protected readonly filteredPast: Signal<readonly OrgPastMeeting[]> = this.initFilteredPast();
  protected readonly recordingsAvailableCount: Signal<number> = this.initRecordingsAvailableCount();
  protected readonly attendanceRate: Signal<number> = this.initAttendanceRate();

  private readonly debouncedSearch = toSignal(toObservable(this.filterSearch).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });

  public constructor() {
    this.initProjectOptions();
    this.initResetFiltersOnAccountChange();
    this.initResetOnFilterChange();
    this.initUpcomingFetch();
  }

  // === Protected methods ===
  protected switchTab(tabId: OrgMeetingsTabId): void {
    if (tabId === this.activeTab()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_ORG_MEETINGS_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
        const pastCount = this.filteredPast().length;
        const attendanceRate = this.attendanceRate();
        return [
          {
            value: pastCount.toLocaleString(),
            label: 'Past Meetings',
            subLine: pastCount > 0 ? `${attendanceRate}% attendance rate` : undefined,
            icon: 'fa-light fa-clock-rotate-left',
            iconContainerClass: 'bg-gray-200 text-gray-500',
          },
          {
            value: this.recordingsAvailableCount().toLocaleString(),
            label: 'Recordings Available',
            subLine: 'From past 30 days',
            icon: 'fa-light fa-video',
            iconContainerClass: 'bg-red-100 text-red-600',
          },
        ];
      }
      const nextDate = this.nextUpcomingMeetingDate();
      const summary = this.effectiveSummary();
      const recurringProjects = summary.recurringFoundations;
      const recurringProjectsLabel = recurringProjects === 1 ? 'project' : 'projects';
      return [
        {
          value: summary.upcomingMeetings.toLocaleString(),
          label: 'Upcoming Meetings',
          subLine: nextDate ? `Next: ${nextDate}` : undefined,
          icon: 'fa-light fa-calendar',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: summary.recurringSeries.toLocaleString(),
          label: 'Recurring Series',
          subLine: recurringProjects > 0 ? `Across ${recurringProjects} ${recurringProjectsLabel}` : undefined,
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

  // The real summary() call can legitimately return all-zeros while `upcomingMeetings()` is still
  // showing the demo fallback (no real rows yet) — that mismatch is exactly what made the KPI cards
  // disagree with the rendered list. Once the real list-fetch has confirmed rows exist (total() > 0),
  // trust the real summary; otherwise derive the summary directly from whatever list is actually on screen.
  private initEffectiveSummary(): Signal<OrgMeetingsSummary> {
    return computed<OrgMeetingsSummary>(() => {
      const real = this.summary();
      if (this.total() > 0 && real) return real;

      const meetings = this.upcomingMeetings();
      const recurring = meetings.filter((meeting) => meeting.recurrenceLabel !== null);
      const recurringFoundations = new Set(recurring.map((meeting) => meeting.foundation)).size;
      const nextMeeting = meetings.reduce<string | null>(
        (earliest, meeting) => (earliest === null || meeting.startTime < earliest ? meeting.startTime : earliest),
        null
      );
      return {
        upcomingMeetings: meetings.length,
        recurringSeries: recurring.length,
        recurringFoundations,
        nextMeeting,
      };
    });
  }

  private initNextUpcomingMeetingDate(): Signal<string> {
    return computed(() => {
      const next = this.effectiveSummary().nextMeeting;
      if (!next) return '';
      // Format via DatePipe (same engine as the meeting-card `| date` bindings) so the KPI date stays consistent with the cards.
      return this.datePipe.transform(next, 'MMM d') ?? '';
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

  private initResetFiltersOnAccountChange(): void {
    // Filters are org-scoped: a leftover project/type/search would hide the new org's meetings.
    // accountId starts as the placeholder '' and resolves to the first real account either
    // synchronously or after an async canonical-record fetch — filtering out the falsy value before
    // skip(1) ensures that initial settling (of either speed) is never mistaken for a user-driven
    // account switch.
    toObservable(this.accountId)
      .pipe(
        filter((id): id is string => !!id),
        distinctUntilChanged(),
        skip(1),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.filterForm.reset({ search: '', type: null, project: null });
        // Reset to the same demo seed the signal starts with (not `[]`) rather than leaving the prior
        // account's rows visible until the new account's fetch resolves — an empty array here would
        // read as "confirmed no meetings" and fight the zero-result branch's own demo-fallback logic.
        this.upcomingMeetings.set(DEMO_UPCOMING_MEETINGS);
        this.total.set(0);
      });
  }

  private initResetOnFilterChange(): void {
    combineLatest([toObservable(this.accountId), toObservable(this.debouncedSearch), toObservable(this.filterType), toObservable(this.filterProject)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.offset.set(0));
  }

  private initUpcomingFetch(): void {
    const params$ = toObservable(
      computed(() => {
        // Every signal must be read unconditionally (before the early-return) so this computed's
        // dependency set always includes offset/refreshTick/etc. — a computed only tracks whatever it
        // actually read on its last run, so short-circuiting here on a transient falsy accountId would
        // silently drop those dependencies and loadMore()/filters would stop triggering re-fetches.
        const accountId = this.accountId();
        const searchQuery = this.debouncedSearch() || null;
        const project = this.filterProject();
        const type = this.filterType();
        const offset = this.offset();
        const tick = this.refreshTick();
        if (!accountId) return null;
        return { accountId, searchQuery, project, type, offset, tick };
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
            // Only surface the error banner when there's nothing to fall back on — otherwise keep showing
            // the demo/existing set instead of wiping it out from under the viewer.
            if (this.upcomingMeetings().length === 0) {
              this.listError.set(true);
            }
            this.listLoading.set(false);
          } else {
            // Keep the loaded pages; the load-more button surfaces the error and retries the same offset.
            this.loadMoreError.set(true);
            this.loadingMore.set(false);
          }
          return;
        }
        this.total.set(res.total);
        if (offset === 0 && res.data.length === 0) {
          // The org-wide summary (unaffected by the current search/type/project filter) is the ground
          // truth for "does this account have any real data at all." Only treat a zero-result page as
          // missing seed data when the summary agrees the account is genuinely empty/unloaded; otherwise
          // this zero is a real result (e.g. a filter with no matches, or a switched-to account that's
          // empty) and must replace whatever's on screen instead of leaving demo/stale rows visible.
          const real = this.summary();
          const accountLooksUnseeded = !real || (real.upcomingMeetings === 0 && real.recurringSeries === 0);
          if (!accountLooksUnseeded) {
            this.upcomingMeetings.set([]);
          }
          this.listLoading.set(false);
          this.loadingMore.set(false);
          return;
        }
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

  // "Available" means the viewer can actually reach the recording: public meetings, or private meetings
  // they're invited to (same visibility rule as the rendered cards vs. the private rollup — see `splitOrgMeetingsByPrivacy`).
  // Scoped to a rolling 30-day window to match the "From past 30 days" KPI subtext.
  private initRecordingsAvailableCount(): Signal<number> {
    return computed(() => {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recent = this.filteredPast().filter((meeting) => new Date(meeting.startTime).getTime() >= cutoff);
      const { visible } = splitOrgMeetingsByPrivacy(recent, (meeting) => meeting.orgPastInvitees.map((invitee) => invitee.name));
      return visible.filter((meeting) => meeting.artifact.recordingUrl !== null).length;
    });
  }

  private initAttendanceRate(): Signal<number> {
    return computed(() => {
      const totals = this.filteredPast().reduce(
        (acc, meeting) => {
          const { attended, missed, excused } = meeting.attendanceTally;
          acc.attended += attended;
          acc.total += attended + missed + excused;
          return acc;
        },
        { attended: 0, total: 0 }
      );
      return totals.total > 0 ? Math.round((totals.attended / totals.total) * 100) : 0;
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
