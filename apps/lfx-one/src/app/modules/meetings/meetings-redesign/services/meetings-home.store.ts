// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, linkedSignal, PLATFORM_ID, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MEETINGS_HOME_DEFAULT_FILTERS, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { Meeting, MeetingDashboardView, MeetingDayGroup, MeetingHomeRow, MeetingRsvp, MeetingsHomeFilters, PastMeeting } from '@lfx-one/shared/interfaces';
import {
  countAppliedMeetingFilters,
  expandMeetingOccurrences,
  filterMeetingsHome,
  getPastMeetingResourceId,
  getPastMeetingStartTimeMs,
  getRsvpTimestampMs,
  groupMeetingsByDayBucket,
  selectApplicableRsvp,
  sortPastMeetingsDescending,
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
  private readonly retry$ = new Subject<void>();
  /** Current time, ticking every minute so ended dates drop out and day buckets roll over. */
  private readonly now: Signal<Date> = this.initClock();

  public readonly tab: Signal<MeetingDashboardView> = this.tabState.asReadonly();
  public readonly search: Signal<string> = this.searchState.asReadonly();
  public readonly filters: Signal<MeetingsHomeFilters> = this.filtersState.asReadonly();
  public readonly upcomingLoading: Signal<boolean> = this.upcomingLoadingState.asReadonly();
  public readonly pastLoading: Signal<boolean> = this.pastLoadingState.asReadonly();
  public readonly upcomingFailed: Signal<boolean> = this.upcomingFailedState.asReadonly();
  public readonly pastFailed: Signal<boolean> = this.pastFailedState.asReadonly();

  private readonly upcomingMeetings: Signal<Meeting[]> = this.initFeed(
    () => this.userService.getUserMeetings(),
    this.upcomingLoadingState,
    this.upcomingFailedState
  );
  // shortcut: past feed loads without include=artifacts. revisit: when past rows show Recording / AI Summary buttons
  private readonly pastMeetings: Signal<PastMeeting[]> = this.initFeed(
    () => this.userService.getUserPastMeetings(),
    this.pastLoadingState,
    this.pastFailedState
  );
  private readonly visibleCountState: WritableSignal<number> = linkedSignal({
    source: () => ({ tab: this.tab(), search: this.search(), filters: this.filters() }),
    computation: () => MEETINGS_HOME_PAGE_SIZE,
  });

  /** One row per active upcoming date, soonest first. */
  public readonly upcomingRows: Signal<MeetingHomeRow[]> = this.initUpcomingRows();
  /** One row per past meeting, most recent first. */
  public readonly pastRows: Signal<MeetingHomeRow[]> = this.initPastRows();
  public readonly loading: Signal<boolean> = computed(() => (this.tab() === 'past' ? this.pastLoading() : this.upcomingLoading()));
  /** The active tab's feed failed to load; its rows are empty but not confirmed empty. */
  public readonly failed: Signal<boolean> = computed(() => (this.tab() === 'past' ? this.pastFailed() : this.upcomingFailed()));
  /** The active tab's rows before search and filters. */
  public readonly tabRows: Signal<MeetingHomeRow[]> = computed(() => (this.tab() === 'past' ? this.pastRows() : this.upcomingRows()));
  public readonly filteredRows: Signal<MeetingHomeRow[]> = computed(() =>
    filterMeetingsHome(this.tabRows(), this.filters(), this.search(), this.userService.viewerUsername())
  );
  /** Rows shown so far; back to one page whenever the tab, search or filters change. */
  public readonly visibleCount: Signal<number> = this.visibleCountState.asReadonly();
  public readonly groups: Signal<MeetingDayGroup[]> = computed(() =>
    groupMeetingsByDayBucket(this.filteredRows(), this.tab(), this.now(), this.visibleCount())
  );
  public readonly hasMore: Signal<boolean> = computed(() => this.visibleCount() < this.filteredRows().length);
  public readonly hasActiveQuery: Signal<boolean> = computed(() => this.search().trim() !== '' || countAppliedMeetingFilters(this.filters()) > 0);

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

  public loadMore(): void {
    if (this.hasMore()) this.visibleCountState.update((count) => count + MEETINGS_HOME_PAGE_SIZE);
  }

  /** Clears both filters and search. */
  public resetFilters(): void {
    this.filtersState.set(MEETINGS_HOME_DEFAULT_FILTERS);
    this.searchState.set('');
  }

  /** Re-requests both feeds after a failure. */
  public retry(): void {
    this.retry$.next();
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

  private initUpcomingRows(): Signal<MeetingHomeRow[]> {
    return computed(() => {
      const removed = this.meetingService.removedRegistrationMeetingIds();
      // Organizers keep their meetings after removing their own registration.
      const meetings = this.upcomingMeetings()
        .filter((meeting) => meeting.organizer || !removed.has(meeting.id))
        .map((meeting) => this.withCurrentRsvps(meeting));
      return expandMeetingOccurrences(meetings, this.now()).map((row) => this.withConfirmedRowRsvp(row));
    });
  }

  private initPastRows(): Signal<MeetingHomeRow[]> {
    return computed(() =>
      sortPastMeetingsDescending(this.pastMeetings()).flatMap((meeting) => {
        const startMs = getPastMeetingStartTimeMs(meeting);
        if (startMs === null) return [];
        return [
          {
            key: getPastMeetingResourceId(meeting),
            meeting,
            occurrence: null,
            title: meeting.title,
            occurrenceId: meeting.occurrence_id || null,
            startTime: new Date(startMs).toISOString(),
            durationMinutes: meeting.duration,
          },
        ];
      })
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
