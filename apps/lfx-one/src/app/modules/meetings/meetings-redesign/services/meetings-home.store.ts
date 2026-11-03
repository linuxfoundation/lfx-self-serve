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
  PastMeetingSummary,
} from '@lfx-one/shared/interfaces';
import {
  buildJoinUrlWithParams,
  buildMeetingFilterChips,
  canJoinMeeting,
  countAppliedMeetingFilters,
  expandMeetingOccurrences,
  filterMeetingsHome,
  getLargestSessionShareUrl,
  getRsvpTimestampMs,
  groupMeetingsByDayBucket,
  isMeetingHomeRowPendingRsvp,
  selectApplicableRsvp,
  sortPastMeetingsDescending,
  toPastMeetingHomeRow,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { catchError, combineLatest, interval, map, Observable, of, startWith, Subject, switchMap, tap } from 'rxjs';

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

  private readonly tabState: WritableSignal<MeetingDashboardView> = signal<MeetingDashboardView>('upcoming');
  private readonly searchState: WritableSignal<string> = signal('');
  private readonly filtersState: WritableSignal<MeetingsHomeFilters> = signal(MEETINGS_HOME_DEFAULT_FILTERS);
  private readonly upcomingLoadingState: WritableSignal<boolean> = signal(true);
  private readonly pastLoadingState: WritableSignal<boolean> = signal(true);
  private readonly upcomingFailedState: WritableSignal<boolean> = signal(false);
  private readonly pastFailedState: WritableSignal<boolean> = signal(false);
  private readonly lastMeetingLoadingState: WritableSignal<boolean> = signal(true);
  private readonly lastMeetingFailedState: WritableSignal<boolean> = signal(false);
  private readonly retry$ = new Subject<void>();
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
    () => this.userService.getUserMeetings(),
    this.upcomingLoadingState,
    this.upcomingFailedState
  );
  // Carries `has_recording` / `has_ai_summary` for the past rows' Recording and AI Summary buttons.
  private readonly pastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.userService.getUserPastMeetings({ includeArtifacts: true }),
    this.pastLoadingState,
    this.pastFailedState
  );
  // The fast latest-past feed paints the Last meeting card before the full past list arrives.
  private readonly latestPastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.userService.getUserLatestPastMeetings(),
    this.lastMeetingLoadingState,
    this.lastMeetingFailedState
  );
  private readonly visibleCountState: WritableSignal<number> = linkedSignal({
    source: () => ({ tab: this.tab(), search: this.search(), filters: this.filters() }),
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
  /** The Next meeting card's date, whatever the search and filters: the soonest one not yet over, else the soonest one. */
  public readonly nextRow: Signal<MeetingHomeRow | null> = this.initNextRow();
  /** The next date is inside its join window, and is not a restricted meeting the viewer is not invited to. */
  public readonly nextRowJoinable: Signal<boolean> = this.initNextRowJoinable();
  /** Join link for the next date, built for the real viewer while impersonating; null until joinable or when unavailable. */
  public readonly nextRowJoinUrl: Signal<string | null> = this.initNextRowJoinUrl();
  /** The active tab's rows that match the search and filters, the Next meeting card's date included. */
  public readonly matchingRows: Signal<MeetingHomeRow[]> = computed(() =>
    filterMeetingsHome(this.tabRows(), this.filters(), this.search(), this.userService.viewerUsername())
  );
  /** The list's rows: the matching rows, with the Upcoming list leaving out the Next meeting card's date. */
  public readonly filteredRows: Signal<MeetingHomeRow[]> = this.initFilteredRows();
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
        .map((meeting) => toPastMeetingHomeRow(meeting))
        .find((row) => row !== null) ?? null
  );
  private readonly fetchedLastMeetingSummary: Signal<PastMeetingSummary | null | undefined> = this.initLastMeetingArtifact((id) =>
    this.meetingService.getPastMeetingSummary(id)
  );
  private readonly lastMeetingSummaryState: WritableSignal<PastMeetingSummary | null | undefined> = linkedSignal(() => this.fetchedLastMeetingSummary());
  /** Last meeting's AI summary: undefined while loading, null when there is none or the lookup failed. */
  public readonly lastMeetingSummary: Signal<PastMeetingSummary | null | undefined> = this.lastMeetingSummaryState.asReadonly();
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

  /** Keeps the Last meeting card in step after an organizer edits or approves the summary. */
  public setLastMeetingSummary(summary: PastMeetingSummary): void {
    this.lastMeetingSummaryState.set(summary);
  }

  private initClock(): Signal<Date> {
    if (!isPlatformBrowser(this.platformId)) return signal(new Date());
    return toSignal(interval(60_000).pipe(map(() => new Date())), { initialValue: new Date() });
  }

  /** Re-requests the feed when the viewer changes (login, impersonation), never keeping the previous viewer's rows. */
  private initFeed<T extends Meeting>(load: () => Observable<T[]>, loading: WritableSignal<boolean>, failed: WritableSignal<boolean>): Signal<T[]> {
    if (!isPlatformBrowser(this.platformId)) return signal<T[]>([]);
    let previousIdentity: string | null = null;

    return toSignal(
      combineLatest([toObservable(this.userService.meetingFeedIdentity), this.retry$.pipe(startWith(undefined))]).pipe(
        switchMap(([identity]) => {
          const identityChanged = previousIdentity !== null && identity !== previousIdentity;
          previousIdentity = identity;
          loading.set(true);
          failed.set(false);
          const request$ = load().pipe(
            tap(() => loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meetings for the meetings home page:', error);
              failed.set(true);
              loading.set(false);
              return of([] as T[]);
            })
          );
          return identityChanged ? request$.pipe(startWith([] as T[])) : request$;
        })
      ),
      { initialValue: [] as T[] }
    );
  }

  private initNextRow(): Signal<MeetingHomeRow | null> {
    return computed(() => {
      const rows = this.upcomingRows();
      const nowMs = this.now().getTime();
      return rows.find((row) => Date.parse(row.startTime) + row.durationMinutes * 60_000 > nowMs) ?? rows[0] ?? null;
    });
  }

  private initNextRowJoinable(): Signal<boolean> {
    return computed(() => {
      this.now();
      const row = this.nextRow();
      if (!row || (row.meeting.restricted && !row.meeting.invited)) return false;
      return canJoinMeeting(row.meeting, { occurrence_id: row.occurrenceId ?? '', start_time: row.startTime, duration: row.durationMinutes });
    });
  }

  private initNextRowJoinUrl(): Signal<string | null> {
    const request = computed(
      () => {
        const meeting = this.nextRow()?.meeting;
        const user = this.userService.meetingJoinIdentity();
        if (!meeting || !this.nextRowJoinable() || !this.userService.authenticated() || !user?.email) return null;
        return { id: meeting.id, password: meeting.password, user };
      },
      { equal: (a, b) => a?.id === b?.id && a?.password === b?.password && a?.user.email === b?.user.email && a?.user.name === b?.user.name }
    );
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) =>
          target
            ? this.meetingService.getPublicMeetingJoinUrl(target.id, target.password, { email: target.user.email }).pipe(
                map((response) => buildJoinUrlWithParams(response.link, target.user)),
                catchError(() => of(null)),
                // Never offer the previous meeting's link while this one loads.
                startWith(null)
              )
            : of(null)
        )
      ),
      { initialValue: null }
    );
  }

  private initFilteredRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const rows = this.matchingRows();
      const nextKey = this.tab() === 'upcoming' ? this.nextRow()?.key : undefined;
      return nextKey ? rows.filter((row) => row.key !== nextKey) : rows;
    });
  }

  private initUpcomingRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const removed = this.meetingService.removedRegistrationMeetingIds();
      // Organizers keep their meetings after removing their own registration, without the registration.
      const meetings = this.upcomingMeetings()
        .filter((meeting) => meeting.organizer || !removed.has(meeting.id))
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
    return computed(() => sortPastMeetingsDescending(this.pastMeetings()).flatMap((meeting) => toPastMeetingHomeRow(meeting) ?? []));
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
