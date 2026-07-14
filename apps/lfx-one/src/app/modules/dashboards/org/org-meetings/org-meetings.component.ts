// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, Signal } from '@angular/core';
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
  // Account the last-resolved `summary` actually belongs to — keeping this alongside the summary value
  // (rather than trusting `summary()` alone) is what lets `accountUnseeded` avoid the account-switch race
  // where the previous account's summary is still sitting in the signal while a new account's list/summary
  // requests are in flight.
  private readonly summaryAccountId = signal<string | null>(null);
  protected readonly summary: Signal<OrgMeetingsSummary | null> = this.initSummary();
  // Ground truth for "this account genuinely has no real data." `total()` reflects the most recently
  // completed real list fetch for the *current* request cycle (switchMap cancels stale in-flight
  // requests on account/filter change, so it's always account-correct) — a positive total is definitive
  // proof of real data and short-circuits the rest of this check. Below that, while the summary hasn't
  // resolved *for the current account* yet, default to true (matches the pre-race-fix behavior of
  // favoring the demo fallback over prematurely clearing the screen) — `pendingListOutcome`/its
  // correction effect below re-evaluates once the summary actually resolves, so a confirmed-seeded
  // account still ends up showing its real (possibly empty, possibly errored) state rather than getting
  // stuck on demo data. Deliberately distinct from "a filter matched nothing," which is a legitimate
  // zero and must not be treated as an unseeded account. A `null` summary means the fetch *failed*,
  // not that it resolved to zero — treating failure as proof of "unseeded" would let the demo fallback
  // mask a genuine summary/list error as the selected org's real (empty) data. Only a successfully
  // resolved all-zero summary may establish the demo fallback; `null` leaves the account non-unseeded
  // so the error/unknown path (e.g. `pendingListOutcome`'s 'failed' kind) surfaces instead.
  protected readonly accountUnseeded: Signal<boolean> = computed(() => {
    if (this.total() > 0) return false;
    const resolved = this.summaryAccountId() === this.accountId();
    if (!resolved) return true;
    const real = this.summary();
    return real !== null && real.upcomingMeetings === 0 && real.recurringSeries === 0;
  });
  // A resolved-but-null summary for the current account is a genuine fetch failure (see `accountUnseeded`'s
  // doc comment) rather than proof the account is unseeded — `initEffectiveSummary` still has to return some
  // shape in that case, so it falls back to the (paginated, possibly-first-page-only) `upcomingMeetings()` list.
  // That fallback is fine for `total()`-backed counts but not for `recurringSeries`/`recurringFoundations`,
  // which only reflect whatever page is currently loaded. This flag lets `initKpiCards` render those two
  // cards as unavailable instead of presenting a partial-page count as the org-wide total.
  protected readonly summaryError: Signal<boolean> = computed(() => {
    const resolved = this.summaryAccountId() === this.accountId();
    return resolved && this.summary() === null && !this.accountUnseeded();
  });
  // Set when the offset-0 list decision above was made *before* the summary had resolved for this
  // account, so `accountUnseeded` was only an optimistic guess — corrected by the effect in the
  // constructor once the summary actually resolves for the same account.
  private readonly pendingListOutcome = signal<{ accountId: string; kind: 'failed' | 'empty' } | null>(null);
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
    this.initPendingListOutcomeCorrection();
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
  // Re-evaluates an offset-0 list decision that was made while the summary hadn't resolved for the
  // current account yet (see `pendingListOutcome`). Once it resolves and turns out the account is NOT
  // actually unseeded, the optimistic demo fallback was wrong — replace it with the real (possibly
  // empty, possibly errored) outcome instead of leaving demo rows on screen indefinitely.
  private initPendingListOutcomeCorrection(): void {
    effect(() => {
      const pending = this.pendingListOutcome();
      if (!pending) return;
      const resolved = this.summaryAccountId() === this.accountId();
      if (!resolved || pending.accountId !== this.accountId()) return;
      if (!this.accountUnseeded()) {
        if (pending.kind === 'failed') {
          this.upcomingMeetings.set([]);
          this.listError.set(true);
        } else {
          // 'empty' outcome was an optimistic demo fallback made before the summary resolved — now that
          // the account is confirmed seeded, re-fetch at offset 0 for an authoritative answer instead of
          // trusting a response that a race could have made stale.
          this.offset.set(0);
          this.refreshTick.update((value) => value + 1);
        }
      }
      this.pendingListOutcome.set(null);
    });
  }

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
      const hasError = this.summaryError();
      const nextDate = this.nextUpcomingMeetingDate();
      const summary = this.effectiveSummary();
      const recurringProjects = summary.recurringFoundations;
      const recurringProjectsLabel = recurringProjects === 1 ? 'project' : 'projects';
      // A resolved-but-failed summary fetch leaves `effectiveSummary` deriving these counts from
      // whatever page of `upcomingMeetings()` happens to be loaded — accurate for a demo/unseeded
      // account, but a misleading partial-page count for a real account whose summary call failed
      // (see `summaryError`). Render "—" instead of presenting that partial count as an org-wide total.
      let upcomingSubLine: string | undefined;
      if (hasError) {
        upcomingSubLine = 'Unable to load';
      } else if (nextDate) {
        upcomingSubLine = `Next: ${nextDate}`;
      }
      let recurringSubLine: string | undefined;
      if (hasError) {
        recurringSubLine = 'Unable to load';
      } else if (recurringProjects > 0) {
        recurringSubLine = `Across ${recurringProjects} ${recurringProjectsLabel}`;
      }
      return [
        {
          value: hasError ? '—' : summary.upcomingMeetings.toLocaleString(),
          label: 'Upcoming Meetings',
          subLine: upcomingSubLine,
          icon: 'fa-light fa-calendar',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: hasError ? '—' : summary.recurringSeries.toLocaleString(),
          label: 'Recurring Series',
          subLine: recurringSubLine,
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
        switchMap((id) => {
          // Set loading=true *inside* the switchMap projection, not in a tap() before it — a tap()
          // ahead of switchMap runs, then switchMap cancels the previous inner observable, whose
          // finalize() immediately flips loading back to false before this inner observable ever
          // subscribes. Setting it here means loading stays true for the whole duration of this
          // specific inner observable's lifetime.
          this.summaryLoading.set(true);
          return this.meetingService.getOrgMeetingsSummary(id).pipe(
            map((summary) => ({ id, summary })),
            catchError(() => of({ id, summary: null as OrgMeetingsSummary | null })),
            finalize(() => this.summaryLoading.set(false))
          );
        }),
        // Record which account this result belongs to *before* the summary value itself updates, so
        // `accountUnseeded` never reads a summary value against the wrong account's id.
        tap(({ id }) => this.summaryAccountId.set(id)),
        map(({ summary }) => summary)
      ),
      { initialValue: null }
    );
  }

  // The real summary() call can legitimately return all-zeros while `upcomingMeetings()` is still
  // showing the demo fallback (no real rows yet) — that mismatch is exactly what made the KPI cards
  // disagree with the rendered list. Trust the real summary whenever the account isn't genuinely
  // unseeded (a filtered-to-zero list is still a real account with real data); otherwise derive the
  // summary directly from whatever demo list is actually on screen.
  private initEffectiveSummary(): Signal<OrgMeetingsSummary> {
    return computed<OrgMeetingsSummary>(() => {
      const real = this.summary();
      // `accountUnseeded`'s `total() > 0` fast path can go false before `summaryAccountId` catches up
      // to a just-switched `accountId` (e.g. the new account's list resolves before its summary does) —
      // trusting `real` in that window would render the *previous* account's summary against the new
      // account's list. Require the summary to actually belong to the current account too.
      const summaryMatchesAccount = this.summaryAccountId() === this.accountId();
      if (!this.accountUnseeded() && summaryMatchesAccount && real) return real;

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
            // A fresh page-0 request supersedes whatever the previous cycle's outcome was — if a stale
            // pending correction from an earlier fetch (e.g. the failure that a retry just re-requested)
            // were left set, its effect could fire later and stomp this new response once it lands.
            this.pendingListOutcome.set(null);
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
            // Same ground-truth check as the zero-result branch below: only treat the on-screen list as a
            // disposable demo fallback when the account is confirmed unseeded (keyed to this account, not
            // racing a stale/previous-account summary). Otherwise a first-page failure must clear whatever's
            // showing and surface the error, rather than leaving stale data look current.
            if (!this.accountUnseeded()) {
              this.upcomingMeetings.set([]);
              this.listError.set(true);
            } else {
              // Genuinely unseeded account: keep the demo seed, but respect whatever filters are active so
              // the controls don't silently stop working against the fallback data.
              this.upcomingMeetings.set(DEMO_UPCOMING_MEETINGS.filter((meeting) => this.matchesFilters(meeting)));
              if (this.summaryAccountId() !== this.accountId()) {
                // Summary hasn't resolved for this account yet — this was an optimistic guess, not a
                // confirmed unseeded account. Flag it for re-evaluation once the summary resolves.
                this.pendingListOutcome.set({ accountId: this.accountId(), kind: 'failed' });
              }
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
          // `accountUnseeded` (keyed to this account) is the ground truth for "does this account have any
          // real data at all." Only treat a zero-result page as missing seed data when the account is
          // genuinely unseeded; otherwise this zero is a real result (e.g. a filter with no matches, or a
          // switched-to account that's empty) and must replace whatever's on screen instead of leaving
          // demo/stale rows visible.
          if (!this.accountUnseeded()) {
            this.upcomingMeetings.set([]);
          } else {
            // Genuinely unseeded: keep showing demo data, but filter it so search/type/project controls
            // still reflect their current selection instead of always showing the full unfiltered seed.
            this.upcomingMeetings.set(DEMO_UPCOMING_MEETINGS.filter((meeting) => this.matchesFilters(meeting)));
            if (this.summaryAccountId() !== this.accountId()) {
              // Summary hasn't resolved for this account yet — flag for re-evaluation once it does.
              this.pendingListOutcome.set({ accountId: this.accountId(), kind: 'empty' });
            }
          }
          this.listLoading.set(false);
          this.loadingMore.set(false);
          return;
        }
        // Splice the page in at its offset so a re-fetch of the same page can't duplicate rows. This is a
        // confirmed real (non-demo) result, so any pending correction from an earlier cycle is moot.
        this.pendingListOutcome.set(null);
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
