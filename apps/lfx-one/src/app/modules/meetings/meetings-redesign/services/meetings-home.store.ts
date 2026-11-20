// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, linkedSignal, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_NO_PAST_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import {
  Meeting,
  MeetingDashboardView,
  MeetingDayGroup,
  MeetingFilterChip,
  MeetingHomeRow,
  MeetingRollupFilterOptions,
  MeetingRsvp,
  MeetingsHomeFilters,
  MeetingsHomePastFilters,
  PastMeeting,
  PastMeetingAttendanceSummary,
  PastMeetingSummary,
  UiToastRef,
} from '@lfx-one/shared/interfaces';
import {
  buildMeetingFilterChips,
  countAppliedMeetingFilters,
  expandMeetingOccurrences,
  filterMeetingsHome,
  getLargestSessionShareUrl,
  getLocalDayKey,
  getMeetingGroupCategories,
  getMeetingGroupType,
  getMeetingSeriesUid,
  getRsvpTimestampMs,
  groupMeetingsByDayBucket,
  isMeetingHomeRowPendingRsvp,
  isPastMeetingSummaryAwaitingApproval,
  selectApplicableRsvp,
  sortPastMeetingsDescending,
  toPastMeetingHomeRow,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import {
  catchError,
  combineLatest,
  debounceTime,
  defer,
  distinctUntilChanged,
  filter,
  interval,
  map,
  merge,
  Observable,
  of,
  retry,
  startWith,
  Subject,
  Subscription,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { MeetingsHomeFeed } from './meetings-home-feed';
import { MeetingsHomeJoinService } from './meetings-home-join.service';

/**
 * State of the meetings home list, provided by the page component over a {@link MeetingsHomeFeed}.
 * @description Loads the upcoming and past feeds up front so both tab counts show, expands upcoming meetings into one
 * row per date, then applies search and filters, groups by day and pages {@link MEETINGS_HOME_PAGE_SIZE} rows at a time.
 * A paged past feed loads its next server page when the list runs out, and reloads from the first page on search and on
 * the filters the server can apply.
 */
@Injectable()
export class MeetingsHomeStore {
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly toast = inject(UiToastService);
  private readonly joinService = inject(MeetingsHomeJoinService);
  private readonly feed = inject(MeetingsHomeFeed);
  private readonly destroyRef = inject(DestroyRef);

  private readonly tabState: WritableSignal<MeetingDashboardView> = signal<MeetingDashboardView>('upcoming');
  // Search and filters go back to their defaults when the viewer changes (login, impersonation).
  private readonly searchState: WritableSignal<string> = linkedSignal({ source: this.feed.key, computation: () => '' });
  private readonly filtersState: WritableSignal<MeetingsHomeFilters> = linkedSignal({
    source: this.feed.key,
    computation: () => MEETINGS_HOME_DEFAULT_FILTERS,
  });
  private readonly upcomingLoadingState: WritableSignal<boolean> = signal(true);
  private readonly pastLoadingState: WritableSignal<boolean> = signal(true);
  private readonly upcomingFailedState: WritableSignal<boolean> = signal(false);
  private readonly pastFailedState: WritableSignal<boolean> = signal(false);
  private readonly lastMeetingLoadingState: WritableSignal<boolean> = signal(true);
  private readonly lastMeetingFailedState: WritableSignal<boolean> = signal(false);
  private readonly retry$ = new Subject<void>();
  private refreshFailedToast: UiToastRef | null = null;
  // Kept for the page's lifetime, so a refetch that still lists a deleted meeting or cancelled date does not bring it back.
  private readonly deletedMeetingIds: WritableSignal<ReadonlySet<string>> = signal(new Set());
  private readonly cancelledOccurrenceIds: WritableSignal<ReadonlyMap<string, readonly string[]>> = signal(new Map());
  /** Registrant uids of the meetings the viewer added themselves to here, until the feed's index lists them; a new viewer starts empty. */
  private readonly selfInvitedIds: WritableSignal<ReadonlyMap<string, readonly string[]>> = linkedSignal({
    source: this.feed.key,
    computation: () => new Map<string, readonly string[]>(),
  });
  /** Key of the concurrent date picked on the Next meeting card; the first one when it is not among them. */
  private readonly nextCardKey: WritableSignal<string | null> = linkedSignal({ source: this.feed.key, computation: () => null });
  /** Current time, ticking every minute so ended dates drop out and day buckets roll over. */
  public readonly now: Signal<Date> = this.initClock();

  public readonly tab: Signal<MeetingDashboardView> = this.tabState.asReadonly();
  public readonly search: Signal<string> = this.searchState.asReadonly();
  public readonly filters: Signal<MeetingsHomeFilters> = this.filtersState.asReadonly();
  public readonly upcomingLoading: Signal<boolean> = this.upcomingLoadingState.asReadonly();
  public readonly pastLoading: Signal<boolean> = this.pastLoadingState.asReadonly();
  public readonly upcomingFailed: Signal<boolean> = this.upcomingFailedState.asReadonly();
  public readonly pastFailed: Signal<boolean> = this.pastFailedState.asReadonly();
  public readonly lastMeetingLoading: Signal<boolean> = this.lastMeetingLoadingState.asReadonly();
  public readonly lastMeetingFailed: Signal<boolean> = this.lastMeetingFailedState.asReadonly();
  /** Projects and groups in scope, for the project filters' options; empty in the Me lens or when they fail to load. */
  public readonly scopeOptions: Signal<MeetingRollupFilterOptions> = this.initScopeOptions();
  /** Category of each group in scope by committee UID, for the Group type filter. */
  public readonly groupCategories: Signal<ReadonlyMap<string, string>> = computed(() => getMeetingGroupCategories(this.scopeOptions().groups));
  /** Filters a paged past feed applies on the server while the Past tab is open; none for a whole feed. */
  private readonly pastServerFilters: Signal<MeetingsHomePastFilters> = this.initPastServerFilters();

  private readonly upcomingMeetings: Signal<Meeting[]> = this.initFeed(
    () => this.feed.upcoming(),
    this.feed.upcomingRefresh$,
    this.upcomingLoadingState,
    this.upcomingFailedState
  );
  /** Cursor of a paged past feed's next server page; undefined once it is exhausted or for a whole feed. */
  // A cursor belongs to one viewer and scope, so a new feed key drops it even before its first page answers.
  private readonly pastPageToken: WritableSignal<string | undefined> = linkedSignal({ source: this.feed.key, computation: () => undefined });
  private readonly pastLoadingMore: WritableSignal<boolean> = signal(false);
  private pastNextPage: Subscription | null = null;
  // Bumped whenever the first past page is requested, so a next page for an older query is dropped.
  private pastQueryVersion = 0;
  // Search and filters the first past page was loaded with; its cursor only continues that query.
  private readonly pastQuery: WritableSignal<string> = signal('');
  private readonly pastFilters: WritableSignal<MeetingsHomePastFilters> = signal(MEETINGS_HOME_NO_PAST_FILTERS);
  private readonly pastPageFailedState: WritableSignal<boolean> = signal(false);
  // Past meetings of the last load without server filters; server-filtered rows only hold the picked values. A new scope drops them.
  private readonly pastOptionMeetings: WritableSignal<PastMeeting[]> = linkedSignal({ source: this.feed.key, computation: (): PastMeeting[] => [] });
  // Carries `recording_share_url` / `has_ai_summary` for the Recording and AI Summary buttons, and organizer attendance.
  private readonly pastFirstPage: Signal<PastMeeting[]> = this.initFeed(
    () => this.loadFirstPastPage(),
    this.feed.pastRefresh$,
    this.pastLoadingState,
    this.pastFailedState,
    this.initPastReloads()
  );
  private readonly pastNextPages: WritableSignal<PastMeeting[]> = linkedSignal({ source: this.pastFirstPage, computation: () => [] as PastMeeting[] });
  private readonly pastMeetings: Signal<PastMeeting[]> = computed(() => [...this.pastFirstPage(), ...this.pastNextPages()]);
  // The fast latest-past feed paints the Last meeting card before the full past list arrives.
  private readonly latestPastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.feed.latestPast(),
    this.feed.pastRefresh$,
    this.lastMeetingLoadingState,
    this.lastMeetingFailedState
  );
  // The latest-past feed has no attendance counts; the full past feed's record of the same meeting does.
  private readonly pastAttendanceById: Signal<Map<string, PastMeetingAttendanceSummary>> = computed(
    () => new Map(this.pastMeetings().flatMap((meeting) => (meeting.attendance_summary ? [[meeting.id, meeting.attendance_summary] as const] : [])))
  );
  // Past records may outlive their meeting, so past rows are hidden only until their feed answers again.
  private readonly deletedPastIds: WritableSignal<ReadonlySet<string>> = linkedSignal({ source: this.pastMeetings, computation: () => new Set<string>() });
  private readonly deletedLatestPastIds: WritableSignal<ReadonlySet<string>> = linkedSignal({
    source: this.latestPastMeetings,
    computation: () => new Set<string>(),
  });
  private readonly visibleCountState: WritableSignal<number> = linkedSignal({
    source: () => ({ tab: this.tab(), search: this.search(), filters: this.filters(), identity: this.feed.key() }),
    computation: () => MEETINGS_HOME_PAGE_SIZE,
  });
  /** Local day (`YYYY-MM-DD`) picked on the calendar whose rows the list is still bringing in; a new tab, search or filters drop it. */
  private readonly revealDayState: WritableSignal<string | null> = linkedSignal({
    source: () => ({ tab: this.tab(), search: this.search(), filters: this.filters(), identity: this.feed.key() }),
    computation: () => null,
  });
  /** Local day (`YYYY-MM-DD`) the calendar shows back to; a paged past feed loads pages until its rows reach it. */
  private readonly pastCalendarFromState: WritableSignal<string | null> = linkedSignal({ source: this.feed.key, computation: () => null });

  /** One row per active upcoming date, soonest first. */
  public readonly upcomingRows: Signal<MeetingHomeRow[]> = this.initUpcomingRows();
  /** One row per past meeting, most recent first. */
  public readonly pastRows: Signal<MeetingHomeRow[]> = this.initPastRows();
  /** Upcoming dates the viewer can still answer, soonest first, whatever the search and filters. */
  public readonly pendingRsvpRows: Signal<MeetingHomeRow[]> = this.initPendingRsvpRows();
  /** Past meetings come a page at a time and are searched on the server. */
  public readonly pagedPast: boolean = this.feed.pagedPast;
  /** The active tab's first load, or, on a paged past feed, more pages while none of the loaded rows match. */
  public readonly loading: Signal<boolean> = computed(() =>
    this.tab() === 'past' ? this.pastLoading() || (this.pastLoadingMore() && this.filteredRows().length === 0) : this.upcomingLoading()
  );
  /** The active tab's feed failed to load; its rows are empty but not confirmed empty. */
  public readonly failed: Signal<boolean> = computed(() => (this.tab() === 'past' ? this.pastShowsError() : this.upcomingFailed()));
  /** The past count is unknown: its load failed, or a next page failed with no past meetings loaded, whatever the tab. */
  public readonly pastCountUnknown: Signal<boolean> = computed(() => this.pastFailed() || (this.pastPageFailedState() && this.pastMeetings().length === 0));
  /**
   * The past list is in its error state: its load failed, or, on the Past tab, a next page failed for the current search
   * with nothing to show, so the viewer gets Retry.
   */
  public readonly pastShowsError: Signal<boolean> = computed(
    () =>
      this.pastFailed() ||
      (this.tab() === 'past' && this.pastPageFailedState() && this.search().trim() === this.pastQuery() && this.filteredRows().length === 0)
  );
  /** The active tab's rows before search and filters. */
  public readonly tabRows: Signal<MeetingHomeRow[]> = computed(() => (this.tab() === 'past' ? this.pastRows() : this.upcomingRows()));
  /** Rows the Filters popover takes its options from: the tab's rows, or the last past rows loaded without server filters. */
  public readonly filterOptionRows: Signal<MeetingHomeRow[]> = this.initFilterOptionRows();
  /** The soonest date not yet over, else the soonest one, whatever the search and filters; it anchors the Next meeting card. */
  public readonly nextRow: Signal<MeetingHomeRow | null> = this.initNextRow();
  /** The next date and the dates not yet over that overlap it, soonest first; the Next meeting card pages through them. */
  public readonly concurrentNextRows: Signal<MeetingHomeRow[]> = this.initConcurrentNextRows();
  /** Position of the Next meeting card's date in the concurrent dates. */
  public readonly nextCardIndex: Signal<number> = computed(() =>
    Math.max(
      0,
      this.concurrentNextRows().findIndex((row) => row.key === this.nextCardKey())
    )
  );
  /** The concurrent date the Next meeting card shows. */
  public readonly nextCardRow: Signal<MeetingHomeRow | null> = computed(() => this.concurrentNextRows()[this.nextCardIndex()] ?? null);
  /** The card's date is inside its join window, and is not a restricted meeting the viewer is not invited to. */
  public readonly nextRowJoinable: Signal<boolean> = this.joinService.joinable(this.nextCardRow, this.now);
  /** Join link for the card's date, built for the real viewer while impersonating; null until joinable or when unavailable. */
  public readonly nextRowJoinUrl: Signal<string | null> = this.joinService.joinUrl(this.nextCardRow, this.nextRowJoinable);
  /** The list's rows: the active tab's rows that match the search and filters, the Next meeting card's date included. */
  public readonly filteredRows: Signal<MeetingHomeRow[]> = computed(() =>
    filterMeetingsHome(this.tabRows(), this.filters(), this.search(), this.userService.viewerUsername(), this.groupCategories())
  );
  /** Rows of the list up to and including the last row of the day picked on the calendar; 0 without one. */
  private readonly revealCount: Signal<number> = this.initRevealCount();
  /** Rows shown so far; back to one page whenever the tab, search or filters change, and at least through a picked day. */
  public readonly visibleCount: Signal<number> = computed(() => Math.max(this.visibleCountState(), this.revealCount()));
  /** A paged past list, loaded for the current search, has not yet loaded past the picked day and has a cursor to continue. */
  private readonly revealNeedsOlderPast: Signal<boolean> = this.initRevealNeedsOlderPast();
  /** The calendar shows a month older than the paged past rows loaded so far, and the feed has more. */
  private readonly calendarNeedsOlderPast: Signal<boolean> = computed(() => {
    const from = this.pastCalendarFromState();
    return !!from && this.pastPageToken() !== undefined && this.oldestPastDayAtOrAfter(from);
  });
  /** The picked day once every one of its rows is loaded and shown; the page then scrolls to it and calls {@link completeReveal}. */
  public readonly revealedDay: Signal<string | null> = computed(() => {
    const day = this.revealDayState();
    if (!day || this.loading()) return null;
    // Only a paged feed reloads on a new search; a page loading past an already covered day does not hold the day back.
    const pastPending = (this.feed.pagedPast && this.pastQuery() !== this.search().trim()) || this.revealNeedsOlderPast();
    return this.tab() === 'past' && pastPending ? null : day;
  });
  public readonly groups: Signal<MeetingDayGroup[]> = computed(() =>
    groupMeetingsByDayBucket(this.filteredRows(), this.tab(), this.now(), this.visibleCount())
  );
  /** A next past page failed on the past tab; the list offers to load more instead of retrying on its own. */
  public readonly pastPageFailed: Signal<boolean> = computed(() => this.tab() === 'past' && this.pastPageFailedState() && this.filteredRows().length > 0);
  /** More rows to show, loaded or still on the server for a paged past feed. */
  public readonly hasMore: Signal<boolean> = computed(
    () =>
      this.visibleCount() < this.filteredRows().length ||
      // Server pages only count while the cursor's search is the current one and its last page did not fail.
      (this.tab() === 'past' && this.pastPageToken() !== undefined && !this.pastPageFailedState() && this.search().trim() === this.pastQuery())
  );
  /** Most recent ended meeting of the feed: one the viewer has a direct grant on in the Me lens, the scope's in a project lens. */
  public readonly lastMeeting: Signal<MeetingHomeRow | null> = computed(
    () =>
      this.latestPastMeetings()
        .map((meeting) => toPastMeetingHomeRow(this.withPastAttendance(meeting)))
        .find((row) => row !== null && !this.deletedLatestPastIds().has(getMeetingSeriesUid(row.meeting))) ?? null
  );
  private readonly fetchedLastMeetingSummary: Signal<PastMeetingSummary | null | undefined> = this.initLastMeetingArtifact((id) =>
    this.meetingService.getPastMeetingSummary(id)
  );
  private readonly lastMeetingSummaryState: WritableSignal<PastMeetingSummary | null | undefined> = linkedSignal(() => this.fetchedLastMeetingSummary());
  private readonly approvedSummariesState: WritableSignal<ReadonlyMap<string, string>> = signal(new Map());
  /** Summary uid an organizer approved this session, by row key; the feed and index lag until re-indexed. */
  public readonly approvedSummaries: Signal<ReadonlyMap<string, string>> = this.approvedSummariesState.asReadonly();
  /** Last meeting's AI summary: undefined while loading, null when there is none or the lookup failed. */
  public readonly lastMeetingSummary: Signal<PastMeetingSummary | null | undefined> = computed(() => {
    const summary = this.lastMeetingSummaryState();
    const key = this.lastMeeting()?.key;
    // An approval confirmed this session outranks an index that has not caught up yet.
    if (summary && key && this.approvedSummaries().get(key) === summary.uid && isPastMeetingSummaryAwaitingApproval(summary))
      return { ...summary, approved: true };
    return summary;
  });
  /** Share URL of the last meeting's recording: undefined while loading, null when there is none or the lookup failed. */
  public readonly lastMeetingRecordingUrl: Signal<string | null | undefined> = this.initLastMeetingArtifact((id) =>
    this.meetingService.getPastMeetingRecording(id).pipe(map((recording) => getLargestSessionShareUrl(recording)))
  );
  public readonly hasActiveQuery: Signal<boolean> = computed(() => this.search().trim() !== '' || countAppliedMeetingFilters(this.filters()) > 0);
  /** One chip per applied filter. */
  public readonly filterChips: Signal<MeetingFilterChip[]> = computed(() =>
    buildMeetingFilterChips(this.filters(), this.filterOptionRows(), this.feed.scope === 'project', this.scopeOptions())
  );

  public constructor() {
    this.initPastAutoLoad();
  }

  /** Switches tab and clears the filters; search is kept. */
  public setTab(tab: MeetingDashboardView): void {
    if (tab === this.tab()) return;
    this.tabState.set(tab);
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
  }

  /**
   * Shows every meeting of a local day (`YYYY-MM-DD`) on `tab`: clears search and filters, then shows rows through that day;
   * a paged past feed keeps loading pages until it is covered. {@link revealedDay} reports the day once it is.
   */
  public showDay(day: string, tab: MeetingDashboardView): void {
    this.tabState.set(tab);
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
    this.searchState.set('');
    this.revealDayState.set(day);
  }

  /** Loads past pages until they reach a local day (`YYYY-MM-DD`), so the calendar can show that month's past meetings. */
  public showPastFrom(day: string): void {
    this.pastCalendarFromState.update((current) => (current && current <= day ? current : day));
    // Going back another month is the calendar's way to retry a page that failed.
    this.retryPastPage();
  }

  /** Keeps the rows a picked day brought in and ends the reveal. */
  public completeReveal(): void {
    this.visibleCountState.set(this.visibleCount());
    this.revealDayState.set(null);
  }

  public setSearch(search: string): void {
    this.searchState.set(search);
  }

  public setFilters(filters: MeetingsHomeFilters): void {
    this.filtersState.set(filters);
  }

  /** Resets one filter, as removing its chip does. */
  public clearFilter(key: keyof MeetingsHomeFilters): void {
    this.filtersState.update((filters) => ({ ...filters, [key]: MEETINGS_HOME_DEFAULT_FILTERS[key] }));
  }

  /** Shows another page of rows; on a paged past feed the store loads server pages until they fill it. */
  public loadMore(): void {
    if (!this.hasMore() || (this.tab() === 'past' && this.pastLoadingMore())) return;
    this.visibleCountState.update((count) => count + MEETINGS_HOME_PAGE_SIZE);
  }

  /** Asks again for the past page that failed, with its cursor and query. */
  public retryPastPage(): void {
    this.pastPageFailedState.set(false);
  }

  /** Clears both filters and search. */
  public resetFilters(): void {
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
    this.searchState.set('');
  }

  /** Re-requests every feed after a failure. */
  public retry(): void {
    // Hands the past list's error state to the reload, so a reload that fails returns to it.
    if (this.pastShowsError()) this.pastFailedState.set(true);
    this.pastPageFailedState.set(false);
    this.retry$.next();
  }

  /** Drops every row of a deleted meeting, upcoming and past. */
  public removeMeeting(meetingId: string): void {
    const add = (ids: ReadonlySet<string>): ReadonlySet<string> => new Set(ids).add(meetingId);
    this.deletedMeetingIds.update(add);
    this.deletedPastIds.update(add);
    this.deletedLatestPastIds.update(add);
  }

  /** Drops the row of one cancelled date. */
  public removeOccurrence(meetingId: string, occurrenceId: string): void {
    this.cancelledOccurrenceIds.update((ids) => new Map(ids).set(meetingId, [...(ids.get(meetingId) ?? []), occurrenceId]));
  }

  /** Marks the viewer invited to a meeting they just added themselves to, with the registrations the add confirmed. */
  public markSelfInvited(meetingId: string, registrantUids: readonly string[]): void {
    this.selfInvitedIds.update((ids) => new Map(ids).set(meetingId, registrantUids));
  }

  /** Records an organizer's edit or approval of the summary opened from row `key`; the Last card takes it only while that row is last. */
  public applySummaryChange(key: string, summary: PastMeetingSummary): void {
    if (this.lastMeeting()?.key === key) this.lastMeetingSummaryState.set(summary);
    if (!isPastMeetingSummaryAwaitingApproval(summary)) this.approvedSummariesState.update((approved) => new Map(approved).set(key, summary.uid));
  }

  /** Shows the previous (-1) or the next (1) concurrent date on the Next meeting card. */
  public stepNextCard(step: -1 | 1): void {
    const rows = this.concurrentNextRows();
    const row = rows[Math.min(Math.max(this.nextCardIndex() + step, 0), rows.length - 1)];
    if (row) this.nextCardKey.set(row.key);
  }

  private withPastAttendance(meeting: PastMeeting): PastMeeting {
    const summary = this.pastAttendanceById().get(meeting.id);
    return summary && !meeting.attendance_summary ? { ...meeting, attendance_summary: summary } : meeting;
  }

  private initClock(): Signal<Date> {
    if (!isPlatformBrowser(this.platformId)) return signal(new Date());
    return toSignal(interval(60_000).pipe(map(() => new Date())), { initialValue: new Date() });
  }

  /**
   * Re-requests the feed when the viewer changes (login, impersonation), never keeping the previous viewer's rows.
   * @description Only a first load that fails shows the error state; a failed refresh keeps the rows already loaded.
   */
  private initFeed<T extends Meeting>(
    load: () => Observable<T[]>,
    refresh$: Observable<void>,
    loading: WritableSignal<boolean>,
    failed: WritableSignal<boolean>,
    reload$: Observable<unknown> = of(undefined)
  ): Signal<T[]> {
    if (!isPlatformBrowser(this.platformId)) return signal<T[]>([]);
    let previousIdentity: string | null = null;
    let loaded = false;

    return toSignal(
      combineLatest([toObservable(this.feed.key), this.retry$.pipe(startWith(undefined)), reload$]).pipe(
        switchMap(([identity]) => {
          const identityChanged = previousIdentity !== null && identity !== previousIdentity;
          previousIdentity = identity;
          if (identityChanged) loaded = false;
          // A reload from the error state (Retry) returns to it on failure, rather than a toast over an empty list.
          let fromError = failed();
          loading.set(true);
          failed.set(false);
          const request$ = defer(load).pipe(
            tap({
              next: () => {
                loaded = true;
                fromError = false;
                loading.set(false);
                failed.set(false);
              },
              error: (error: unknown) => {
                console.error('Failed to load meetings for the meetings home page:', error);
                loading.set(false);
                if (loaded && !fromError) this.showRefreshFailedToast();
                else failed.set(true);
              },
            }),
            // The shared feed ends on an error, so subscribe again when the next refresh is requested.
            retry({ delay: () => refresh$ })
          );
          return identityChanged ? request$.pipe(startWith([] as T[])) : request$;
        })
      ),
      { initialValue: [] as T[] }
    );
  }

  /** One toast for the feeds that fail together after the same action. */
  private showRefreshFailedToast(): void {
    const shown = this.refreshFailedToast;
    if (shown && this.toast.toasts().some((item) => item.id === shown.id)) return;
    this.refreshFailedToast = this.toast.show({
      variant: 'warning',
      position: 'bottom-center',
      message: "Couldn't refresh your meetings",
      description: 'Showing the list as it was last loaded.',
      duration: 5000,
    });
  }

  /** Emits when a paged past feed's search settles, its server filters change or it is refreshed; never for a whole feed. */
  private initPastReloads(): Observable<unknown> {
    if (!this.feed.pagedPast) return of(undefined);
    const search$ = toObservable(computed(() => this.search().trim())).pipe(debounceTime(300), startWith(''), distinctUntilChanged());
    const filters$ = toObservable(this.pastServerFilters).pipe(distinctUntilChanged((a, b) => this.samePastFilters(a, b)));
    return merge(combineLatest([search$, filters$]), this.feed.pastRefresh$);
  }

  private initScopeOptions(): Signal<MeetingRollupFilterOptions> {
    const empty: MeetingRollupFilterOptions = { projects: [], groups: [], complete: false };
    if (!isPlatformBrowser(this.platformId)) return signal(empty);
    return toSignal(toObservable(this.feed.key).pipe(switchMap(() => this.feed.filterOptions().pipe(startWith(empty)))), { initialValue: empty });
  }

  /**
   * The server matches a group type on the selected group's own category, so it gets one only with no group picked, a complete scope,
   * and no uncategorised group in scope or on loaded rows reading as that type; otherwise the loaded rows are filtered.
   */
  private initPastServerFilters(): Signal<MeetingsHomePastFilters> {
    return computed(() => {
      if (!this.feed.pagedPast || this.tab() !== 'past') return MEETINGS_HOME_NO_PAST_FILTERS;
      const { project, group, groupType, meetingType } = this.filters();
      const { groups, complete } = this.scopeOptions();
      const categories = this.groupCategories();
      const rowGroups = this.pastOptionMeetings().flatMap((meeting) => (meeting.committees ?? []).map(({ uid, name }) => ({ uid, name: name ?? '' })));
      const serverType =
        !!groupType &&
        !group &&
        complete &&
        [...categories.values()].includes(groupType) &&
        ![...groups, ...rowGroups].some((scoped) => !categories.has(scoped.uid) && getMeetingGroupType(scoped.name) === groupType);
      return { projectUid: project, committeeUid: group, groupType: serverType ? groupType : null, meetingType };
    });
  }

  private initFilterOptionRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      if (this.tab() !== 'past') return this.upcomingRows();
      // Narrowed rows add values the unfiltered snapshot may lack, for when roll-up options fail.
      return this.isNarrowed(this.pastServerFilters()) ? [...this.toPastRows(this.pastOptionMeetings()), ...this.pastRows()] : this.pastRows();
    });
  }

  private isNarrowed(filters: MeetingsHomePastFilters): boolean {
    return Object.values(filters).some(Boolean);
  }

  private samePastFilters(a: MeetingsHomePastFilters, b: MeetingsHomePastFilters): boolean {
    return (Object.keys(a) as (keyof MeetingsHomePastFilters)[]).every((key) => a[key] === b[key]);
  }

  /** The cursor and its query change only when a first page succeeds, so a failed reload keeps the rows and cursor it had. */
  private loadFirstPastPage(): Observable<PastMeeting[]> {
    const version = ++this.pastQueryVersion;
    const query = this.search().trim();
    const filters = this.pastServerFilters();
    this.pastNextPage?.unsubscribe();
    this.pastLoadingMore.set(false);
    return this.feed.past(query, filters).pipe(
      tap((page) => {
        if (version !== this.pastQueryVersion) return;
        this.pastQuery.set(query);
        this.pastFilters.set(filters);
        this.pastPageFailedState.set(false);
        this.pastPageToken.set(page.pageToken);
        if (!this.isNarrowed(filters)) this.pastOptionMeetings.set(page.meetings);
      }),
      tap({
        // A failed reload of the past list the day waits on leaves it unreachable, so the list stops waiting for it.
        error: () => {
          const current = query === this.search().trim() && this.samePastFilters(filters, this.pastServerFilters());
          if (version === this.pastQueryVersion && this.tab() === 'past' && current) this.revealDayState.set(null);
        },
      }),
      map((page) => page.meetings)
    );
  }

  /** Loads server pages while the list, a picked day or the calendar's month needs more past rows and the feed has more. */
  private initPastAutoLoad(): void {
    if (!this.feed.pagedPast || !isPlatformBrowser(this.platformId)) return;
    toObservable(
      computed(
        () =>
          !this.pastLoading() &&
          !this.pastLoadingMore() &&
          !this.pastPageFailedState() &&
          this.pastPageToken() !== undefined &&
          // The cursor continues the last loaded search and filters; newer ones wait for their own first page.
          this.search().trim() === this.pastQuery() &&
          this.samePastFilters(this.pastServerFilters(), this.pastFilters()) &&
          ((this.tab() === 'past' && (this.filteredRows().length < this.visibleCount() || this.revealNeedsOlderPast())) || this.calendarNeedsOlderPast())
      )
    )
      .pipe(filter(Boolean), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadNextPastPage());
  }

  private loadNextPastPage(): void {
    const pageToken = this.pastPageToken();
    if (!pageToken || this.pastLoadingMore()) return;
    const version = this.pastQueryVersion;
    this.pastLoadingMore.set(true);
    this.pastNextPage = this.feed
      .past(this.pastQuery(), this.pastFilters(), pageToken)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (version !== this.pastQueryVersion) return;
          this.pastLoadingMore.set(false);
          this.pastNextPages.update((meetings) => [...meetings, ...page.meetings]);
          this.pastPageToken.set(page.pageToken);
          if (!this.isNarrowed(this.pastFilters())) this.pastOptionMeetings.update((meetings) => [...meetings, ...page.meetings]);
        },
        error: (error: unknown) => {
          if (version !== this.pastQueryVersion) return;
          console.error('Failed to load more past meetings for the meetings home page:', error);
          this.pastLoadingMore.set(false);
          // The cursor stays; the list then offers Load more meetings, or Retry while nothing is shown.
          this.pastPageFailedState.set(true);
        },
      });
  }

  /** Rows through the picked day in list order, so a day without meetings still opens the list to its date. */
  private initRevealCount(): Signal<number> {
    return computed(() => {
      const day = this.revealDayState();
      if (!day) return 0;
      const past = this.tab() === 'past';
      return this.filteredRows().filter((row) => {
        const key = getLocalDayKey(row.startTime);
        return past ? key >= day : key <= day;
      }).length;
    });
  }

  /** Past rows run newest first, so the day is covered once the oldest loaded row is from an earlier day. */
  private initRevealNeedsOlderPast(): Signal<boolean> {
    return computed(() => {
      const day = this.revealDayState();
      // A failed page keeps its cursor for Load more; the day settles on the rows loaded so far.
      if (!day || this.tab() !== 'past' || this.pastPageToken() === undefined || this.pastPageFailedState()) return false;
      if (this.pastQuery() !== this.search().trim()) return false;
      return this.oldestPastDayAtOrAfter(day);
    });
  }

  /** Past rows run newest first: true while none is loaded or the oldest loaded one is on or after `day`. */
  private oldestPastDayAtOrAfter(day: string): boolean {
    const oldest = this.pastRows().at(-1);
    return !oldest || getLocalDayKey(oldest.startTime) >= day;
  }

  private initNextRow(): Signal<MeetingHomeRow | null> {
    return computed(() => {
      const rows = this.upcomingRows();
      const nowMs = this.now().getTime();
      return rows.find((row) => Date.parse(row.startTime) + row.durationMinutes * 60_000 > nowMs) ?? rows[0] ?? null;
    });
  }

  // Same overlap rule as the dashboard's My Meetings card.
  private initConcurrentNextRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const next = this.nextRow();
      if (!next) return [];
      const nowMs = this.now().getTime();
      const span = (row: MeetingHomeRow): [number, number] => {
        const start = Date.parse(row.startTime);
        return [start, start + row.durationMinutes * 60_000];
      };
      const [nextStart, nextEnd] = span(next);
      return this.upcomingRows().filter((row) => {
        const [start, end] = span(row);
        return row === next || (end > nowMs && start < nextEnd && end > nextStart);
      });
    });
  }

  private initUpcomingRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const removed = this.meetingService.removedRegistrationMeetingIds();
      // Organizers, and every viewer of a project's list, keep a meeting after removing their own registration, without it.
      const deleted = this.deletedMeetingIds();
      const keepsRemoved = this.feed.scope === 'project';
      const meetings = this.upcomingMeetings()
        .filter((meeting) => !deleted.has(meeting.id) && (meeting.organizer || keepsRemoved || !removed.has(meeting.id)))
        .map((meeting) => this.withLocalCancellations(meeting))
        .map((meeting) => (removed.has(meeting.id) ? { ...meeting, invited: false, my_registrant_ids: [], my_rsvp: null, my_rsvps: [] } : meeting))
        .map((meeting) => (removed.has(meeting.id) ? meeting : this.withSelfInvite(meeting)))
        .map((meeting) => this.withCurrentRsvps(meeting));
      return expandMeetingOccurrences(meetings, this.now()).map((row) => this.withConfirmedRowRsvp(row));
    });
  }

  private initPendingRsvpRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const removed = this.meetingService.removedRegistrationMeetingIds();
      // Only dates the RSVP controls can answer: invited, with a registration still in place.
      return this.upcomingRows().filter((row) => row.meeting.invited && !removed.has(row.meeting.id) && isMeetingHomeRowPendingRsvp(row));
    });
  }

  private initPastRows(): Signal<MeetingHomeRow[]> {
    return computed(() => this.toPastRows(this.pastMeetings()).filter((row) => !this.deletedPastIds().has(getMeetingSeriesUid(row.meeting))));
  }

  private toPastRows(meetings: PastMeeting[]): MeetingHomeRow[] {
    return sortPastMeetingsDescending(meetings).flatMap((meeting) => toPastMeetingHomeRow(meeting) ?? []);
  }

  /** Marks dates cancelled here as cancelled on the meeting, so its rows and the occurrence pickers leave them out. */
  private withLocalCancellations(meeting: Meeting): Meeting {
    const ids = this.cancelledOccurrenceIds().get(meeting.id);
    return ids ? { ...meeting, cancelled_occurrences: [...(meeting.cancelled_occurrences ?? []), ...ids] } : meeting;
  }

  /** Applies a self-invite made this session, which the feed can still miss while it indexes. */
  private withSelfInvite(meeting: Meeting): Meeting {
    const added = this.selfInvitedIds().get(meeting.id);
    if (!added) return meeting;
    // Without a returned uid the registration is still confirmed, so no list stands in for it and `invited` decides.
    if (!added.length) return { ...meeting, invited: true, my_registrant_ids: meeting.my_registrant_ids?.length ? meeting.my_registrant_ids : undefined };
    return { ...meeting, invited: true, my_registrant_ids: [...new Set([...(meeting.my_registrant_ids ?? []), ...added])] };
  }

  /** Loads one artifact of the last meeting, again whenever it changes; a missing or failed lookup reads as null. */
  private initLastMeetingArtifact<T>(load: (pastMeetingId: string) => Observable<T>): Signal<T | null | undefined> {
    return toSignal(
      toObservable(computed(() => this.lastMeeting()?.key ?? null)).pipe(
        switchMap((id) =>
          id
            ? load(id).pipe(
                catchError((error: unknown) => {
                  // A 404 just means the meeting has no such artifact.
                  if (!(error instanceof HttpErrorResponse && error.status === 404)) console.error('Failed to load a last meeting artifact:', error);
                  return of(null);
                }),
                startWith(undefined)
              )
            : of(null)
        )
      ),
      { initialValue: undefined }
    );
  }

  /** Merges answers saved this session into `my_rsvps` (one copy per id, the confirmation on ties) and drops ended registrations. */
  private withCurrentRsvps(meeting: Meeting): Meeting {
    const current = this.currentRsvps(meeting, meeting.my_rsvp ? [meeting.my_rsvp] : []);
    const myRsvp = meeting.my_rsvp && current.length === 0 ? null : meeting.my_rsvp;
    if (!meeting.my_rsvps) return { ...meeting, my_rsvp: myRsvp };

    const byId = new Map<string, MeetingRsvp>();
    for (const rsvp of this.currentRsvps(meeting, [...meeting.my_rsvps, ...this.userService.confirmedMeetingRsvps(meeting.id)])) {
      const kept = byId.get(rsvp.id);
      if (!kept || getRsvpTimestampMs(rsvp) >= getRsvpTimestampMs(kept)) byId.set(rsvp.id, rsvp);
    }
    // The overlay takes a confirmed copy of itself unless the overlay is newer.
    const copy = myRsvp && byId.get(myRsvp.id);
    const overlay = copy && myRsvp && getRsvpTimestampMs(copy) >= getRsvpTimestampMs(myRsvp) ? copy : myRsvp;
    return { ...meeting, my_rsvp: overlay, my_rsvps: [...byId.values()] };
  }

  /** Without indexed history, applies answers saved this session per date; dates none of them cover keep their status. */
  private withConfirmedRowRsvp(row: MeetingHomeRow): MeetingHomeRow {
    if (row.meeting.my_rsvps) return row;
    const confirmed = this.currentRsvps(row.meeting, this.userService.confirmedMeetingRsvps(row.meeting.id));
    if (confirmed.length === 0) return row;
    // Confirmations go first so they win timestamp ties.
    const rsvp = selectApplicableRsvp(row.occurrenceId, row.myRsvp ? [...confirmed, row.myRsvp] : confirmed);
    return rsvp ? { ...row, myRsvp: rsvp } : row;
  }

  private currentRsvps(meeting: Meeting, rsvps: MeetingRsvp[]): MeetingRsvp[] {
    return rsvps.filter((rsvp) => this.userService.isMeetingRsvpCurrent(rsvp, meeting));
  }
}
