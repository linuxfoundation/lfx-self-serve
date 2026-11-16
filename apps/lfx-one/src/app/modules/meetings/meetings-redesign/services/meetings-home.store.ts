// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, linkedSignal, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import {
  Meeting,
  MeetingDashboardView,
  MeetingDayGroup,
  MeetingFilterChip,
  MeetingHomeRow,
  MeetingRsvp,
  MeetingsHomeFilters,
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
import { catchError, combineLatest, defer, interval, map, Observable, of, retry, startWith, Subject, switchMap, tap } from 'rxjs';

import { MeetingsHomeJoinService } from './meetings-home-join.service';

/**
 * State of the Me lens meetings home list, provided by the page component.
 * @description Loads the upcoming and past feeds up front so both tab counts show, expands upcoming meetings into one
 * row per date, then applies search and filters, groups by day and pages {@link MEETINGS_HOME_PAGE_SIZE} rows at a time.
 */
@Injectable()
export class MeetingsHomeStore {
  private readonly userService = inject(UserService);
  private readonly meetingService = inject(MeetingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly toast = inject(UiToastService);
  private readonly joinService = inject(MeetingsHomeJoinService);

  private readonly tabState: WritableSignal<MeetingDashboardView> = signal<MeetingDashboardView>('upcoming');
  // Search and filters go back to their defaults when the viewer changes (login, impersonation).
  private readonly searchState: WritableSignal<string> = linkedSignal({ source: this.userService.meetingFeedIdentity, computation: () => '' });
  private readonly filtersState: WritableSignal<MeetingsHomeFilters> = linkedSignal({
    source: this.userService.meetingFeedIdentity,
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
  /** Key of the concurrent date picked on the Next meeting card; the first one when it is not among them. */
  private readonly nextCardKey: WritableSignal<string | null> = linkedSignal({ source: this.userService.meetingFeedIdentity, computation: () => null });
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

  private readonly upcomingMeetings: Signal<Meeting[]> = this.initFeed(
    () => this.userService.getUserMeetings({ includeAttendance: true }),
    this.userService.meetingsRefresh$,
    this.upcomingLoadingState,
    this.upcomingFailedState
  );
  // Carries `recording_share_url` / `has_ai_summary` for the Recording and AI Summary buttons, and organizer attendance.
  private readonly pastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.userService.getUserPastMeetings({ includeArtifactsAndAttendance: true }),
    this.userService.pastMeetingsRefresh$,
    this.pastLoadingState,
    this.pastFailedState
  );
  // The fast latest-past feed paints the Last meeting card before the full past list arrives.
  private readonly latestPastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.userService.getUserLatestPastMeetings(),
    this.userService.pastMeetingsRefresh$,
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
    source: () => ({ tab: this.tab(), search: this.search(), filters: this.filters(), identity: this.userService.meetingFeedIdentity() }),
    computation: () => MEETINGS_HOME_PAGE_SIZE,
  });

  /** One row per active upcoming date, soonest first. */
  public readonly upcomingRows: Signal<MeetingHomeRow[]> = this.initUpcomingRows();
  /** One row per past meeting, most recent first. */
  public readonly pastRows: Signal<MeetingHomeRow[]> = this.initPastRows();
  /** Upcoming dates the viewer can still answer, soonest first, whatever the search and filters. */
  public readonly pendingRsvpRows: Signal<MeetingHomeRow[]> = this.initPendingRsvpRows();
  public readonly loading: Signal<boolean> = computed(() => (this.tab() === 'past' ? this.pastLoading() : this.upcomingLoading()));
  /** The active tab's feed failed to load; its rows are empty but not confirmed empty. */
  public readonly failed: Signal<boolean> = computed(() => (this.tab() === 'past' ? this.pastFailed() : this.upcomingFailed()));
  /** The active tab's rows before search and filters. */
  public readonly tabRows: Signal<MeetingHomeRow[]> = computed(() => (this.tab() === 'past' ? this.pastRows() : this.upcomingRows()));
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
    filterMeetingsHome(this.tabRows(), this.filters(), this.search(), this.userService.viewerUsername())
  );
  /** Rows shown so far; back to one page whenever the tab, search or filters change. */
  public readonly visibleCount: Signal<number> = this.visibleCountState.asReadonly();
  public readonly groups: Signal<MeetingDayGroup[]> = computed(() =>
    groupMeetingsByDayBucket(this.filteredRows(), this.tab(), this.now(), this.visibleCount())
  );
  public readonly hasMore: Signal<boolean> = computed(() => this.visibleCount() < this.filteredRows().length);
  /** Most recent ended meeting the viewer has a direct grant on (invited, organizer or participant), as on the legacy dashboard card. */
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
  public readonly filterChips: Signal<MeetingFilterChip[]> = computed(() => buildMeetingFilterChips(this.filters(), this.tabRows()));

  /** Switches tab and clears the filters; search is kept. */
  public setTab(tab: MeetingDashboardView): void {
    if (tab === this.tab()) return;
    this.tabState.set(tab);
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
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

  public loadMore(): void {
    if (this.hasMore()) this.visibleCountState.update((count) => count + MEETINGS_HOME_PAGE_SIZE);
  }

  /** Clears both filters and search. */
  public resetFilters(): void {
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
    this.searchState.set('');
  }

  /** Re-requests every feed after a failure. */
  public retry(): void {
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
    failed: WritableSignal<boolean>
  ): Signal<T[]> {
    if (!isPlatformBrowser(this.platformId)) return signal<T[]>([]);
    let previousIdentity: string | null = null;
    let loaded = false;

    return toSignal(
      combineLatest([toObservable(this.userService.meetingFeedIdentity), this.retry$.pipe(startWith(undefined))]).pipe(
        switchMap(([identity]) => {
          const identityChanged = previousIdentity !== null && identity !== previousIdentity;
          previousIdentity = identity;
          if (identityChanged) loaded = false;
          loading.set(true);
          failed.set(false);
          const request$ = defer(load).pipe(
            tap({
              next: () => {
                loaded = true;
                loading.set(false);
                failed.set(false);
              },
              error: (error: unknown) => {
                console.error('Failed to load meetings for the meetings home page:', error);
                loading.set(false);
                if (loaded) this.showRefreshFailedToast();
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
      // Organizers keep their meetings after removing their own registration, without the registration.
      const deleted = this.deletedMeetingIds();
      const meetings = this.upcomingMeetings()
        .filter((meeting) => !deleted.has(meeting.id) && (meeting.organizer || !removed.has(meeting.id)))
        .map((meeting) => this.withLocalCancellations(meeting))
        .map((meeting) => (removed.has(meeting.id) ? { ...meeting, invited: false, my_registrant_ids: [], my_rsvp: null, my_rsvps: [] } : meeting))
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
    return computed(() =>
      sortPastMeetingsDescending(this.pastMeetings())
        .flatMap((meeting) => toPastMeetingHomeRow(meeting) ?? [])
        .filter((row) => !this.deletedPastIds().has(getMeetingSeriesUid(row.meeting)))
    );
  }

  /** Marks dates cancelled here as cancelled on the meeting, so its rows and the occurrence pickers leave them out. */
  private withLocalCancellations(meeting: Meeting): Meeting {
    const ids = this.cancelledOccurrenceIds().get(meeting.id);
    return ids ? { ...meeting, cancelled_occurrences: [...(meeting.cancelled_occurrences ?? []), ...ids] } : meeting;
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
