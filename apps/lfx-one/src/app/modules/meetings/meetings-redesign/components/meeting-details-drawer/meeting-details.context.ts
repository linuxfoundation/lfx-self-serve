// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, linkedSignal, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MEETING_CLOCK_TICK_MS } from '@lfx-one/shared/constants';
import {
  Meeting,
  MeetingDetailsState,
  MeetingDetailsTab,
  MeetingHomeRow,
  MeetingHostCandidate,
  MeetingOccurrence,
  MeetingRsvp,
} from '@lfx-one/shared/interfaces';
import {
  canViewMeetingGuests,
  getMeetingDetailsState,
  getPastMeetingResourceId,
  hasMeetingFullAccess,
  isPastMeetingCalendarRow,
  isRsvpSupersededBy,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, EMPTY, filter, fromEvent, interval, map, merge, of, startWith, Subject, Subscription, switchMap, take, tap, timer } from 'rxjs';

import { MeetingDetailsSource } from './meeting-details.source';

/**
 * What every section of the meeting details drawer reads: the row it opened on, the meeting, the shown date and the viewer's relation.
 * @description Provided by the host next to a `MeetingDetailsSource`. Sections fetch their own data from it, keyed on `occurrence` and `pastMeetingId`.
 */
@Injectable()
export class MeetingDetailsContext {
  private readonly source = inject(MeetingDetailsSource);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly toast = inject(UiToastService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  /** Time read by the drawer's own clock; 0 until it first ticks. */
  private readonly tick = signal(0);
  /** The live meeting load for an upcoming date picked on a past row; a newer pick replaces it. */
  private upcomingLoad: Subscription | null = null;
  /** Registered from the drawer; counts as invited before the list catches up. */
  private readonly registered = signal(false);
  /** Emits on `retryLoad` to fetch the meeting again. */
  private readonly reload$ = new Subject<void>();
  private readonly loadErrorState = signal(false);
  private readonly retryingState = signal(false);

  /** The meeting could not be refreshed; the drawer shows an error with a retry instead of the row's data. */
  public readonly loadError: Signal<boolean> = this.loadErrorState.asReadonly();
  /** A retry after a failed load is in flight. */
  public readonly retrying: Signal<boolean> = this.retryingState.asReadonly();

  /** The row the drawer opened on. */
  public readonly row: Signal<MeetingHomeRow> = signal(this.source.row).asReadonly();
  /** The meeting: the row's data first, replaced by the fresh detail of an upcoming meeting once it loads. */
  public readonly meeting: Signal<Meeting> = this.initMeeting();
  /** The date shown; null for a one-time or past meeting until another date is picked. */
  public readonly occurrence: WritableSignal<MeetingOccurrence | null> = signal(this.source.row.occurrence);
  /** The page clock, or the drawer's own when it is ahead: it ticks every 5s and on focus, so Join opens on time. */
  public readonly now: Signal<Date> = computed(() => {
    const page = this.source.now();
    return this.tick() > page.getTime() ? new Date(this.tick()) : page;
  });
  /** The row rebuilt for the shown date, for flows that act on one date, such as `MeetingsHomeEditService.edit`. */
  public readonly shownRow: Signal<MeetingHomeRow> = this.initShownRow();
  /** Where the shown date stands, re-checked as the page clock ticks. */
  public readonly state: Signal<MeetingDetailsState> = this.initState();
  public readonly organizer: Signal<boolean> = computed(() => this.meeting().organizer === true);
  /** Invited, or listed as a guest, and not just removed from the meeting on this page. */
  public readonly invited: Signal<boolean> = computed(
    () =>
      (this.registered() || !!this.meeting().invited || this.listedSelfRegistrantUids().length > 0) &&
      !this.meetingService.removedRegistrationMeetingIds().has(this.row().meeting.id)
  );
  /** Invited, or on a past row: the past feed lists only meetings the viewer is a member of. */
  private readonly member: Signal<boolean> = computed(() => this.invited() || isPastMeetingCalendarRow(this.row().meeting));
  public readonly canViewGuests: Signal<boolean> = computed(() =>
    canViewMeetingGuests(this.meeting(), { organizer: this.organizer(), invited: this.member() })
  );
  /** May see the agenda and materials. */
  public readonly fullAccess: Signal<boolean> = computed(() => hasMeetingFullAccess(this.meeting(), { organizer: this.organizer(), member: this.member() }));
  /** Resource id of the shown date's past meeting record; null until the date has ended. */
  public readonly pastMeetingId: Signal<string | null> = this.initPastMeetingId();
  public readonly tab: WritableSignal<MeetingDetailsTab> = signal(this.source.tab);
  /** Guests or participants flagged as host, set by the guests section once it loads them; they join "Organized by". */
  public readonly hosts: WritableSignal<readonly MeetingHostCandidate[]> = signal([]);
  /** Guests or participants count for the tab, set by the guests section once it loads them. */
  public readonly guestCount: WritableSignal<number | null> = signal(null);
  /** Bumped when the shown date's participants change; the sections that list them reload on it. */
  public readonly participantsVersion: WritableSignal<number> = signal(0);
  /** The viewer's registrant uids the guests section lists, newer than the meeting's after a re-invite. */
  public readonly listedSelfRegistrantUids: WritableSignal<readonly string[]> = signal([]);
  /** Registrants removed in the drawer; every section drops them until it closes. */
  public readonly removedRegistrantUids: WritableSignal<ReadonlySet<string>> = signal(new Set());
  /**
   * The viewer's saved answers: the store's copies, plus ones a feed refresh retired while the drawer is open.
   * @description The sections read an older roster, so an answer retired by indexing stays until the store supersedes it or its registration ends.
   */
  public readonly savedRsvps: Signal<MeetingRsvp[]> = linkedSignal<{ confirmed: MeetingRsvp[]; meeting: Meeting }, MeetingRsvp[]>({
    source: () => ({ confirmed: this.userService.confirmedMeetingRsvps(this.row().meeting.id), meeting: this.meeting() }),
    computation: ({ confirmed, meeting }, previous) => {
      // Without the opening row's registrant ids, so only the service's ended-registration check applies.
      const live = { ...meeting, my_registrant_ids: undefined };
      const retired = (previous?.value ?? []).filter(
        (kept) => !confirmed.some((rsvp) => rsvp.id === kept.id || isRsvpSupersededBy(kept, rsvp)) && this.userService.isMeetingRsvpCurrent(kept, live)
      );
      return [...confirmed, ...retired];
    },
  });

  public constructor() {
    this.startClock();
  }

  /** Records a registration made from the drawer and reloads the list behind it. */
  public markRegistered(): void {
    this.meetingService.clearRemovedRegistration(this.row().meeting.id);
    this.registered.set(true);
    this.refreshList();
  }

  /** Reloads the participants now and again after 1s, as the meeting page does while the change indexes, and the list behind the drawer. */
  public refreshParticipants(): void {
    this.participantsVersion.update((version) => version + 1);
    timer(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.participantsVersion.update((version) => version + 1));
    this.refreshList();
  }

  /** Reopens the drawer on an upcoming date of a past row's series, with the live meeting that date needs. */
  public showUpcoming(occurrence: MeetingOccurrence): void {
    const row = this.row();
    if (!isPastMeetingCalendarRow(row.meeting)) return;
    this.upcomingLoad?.unsubscribe();
    const seriesId = row.meeting.meeting_id;
    const listed = this.source.upcomingRows().filter((upcoming) => upcoming.meeting.id === seriesId);
    const exact = listed.find((upcoming) => Date.parse(upcoming.startTime) === Date.parse(occurrence.start_time));
    if (exact) {
      this.source.open(exact);
      return;
    }
    // The feed's copy carries the viewer's invite and answers; the detail stands in when the feed does not list the series.
    const live$ = listed.length ? of(listed[0].meeting) : this.meetingService.getMeetingDetail(seriesId);
    const shown = this.occurrence();
    this.upcomingLoad = live$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (meeting) => {
        // The viewer moved to another date while it loaded.
        if (this.occurrence() !== shown) return;
        // The meeting's own copy of the date carries its title and agenda overrides.
        const full = meeting.occurrences?.find((listed) => Date.parse(listed.start_time) === Date.parse(occurrence.start_time)) ?? occurrence;
        this.source.open({
          key: `${seriesId}:${full.occurrence_id}`,
          meeting,
          occurrence: full,
          title: full.title || meeting.title,
          occurrenceId: full.occurrence_id,
          startTime: full.start_time,
          durationMinutes: full.duration || meeting.duration,
        });
      },
      error: (error: unknown) => {
        console.error(`Failed to load meeting ${seriesId} for an upcoming date:`, error);
        this.toast.show({
          variant: 'error',
          position: 'bottom-center',
          message: 'Meeting unavailable',
          description: 'Unable to open this date. Please try again.',
        });
      },
    });
  }

  /** Fetches the meeting again after a failed load. */
  public retryLoad(): void {
    this.retryingState.set(true);
    this.reload$.next();
  }

  /** Reloads the home list behind the drawer after an action changed the meeting. */
  public refreshList(): void {
    if (this.state() === 'ended') {
      this.userService.refreshUserPastMeetings();
    } else {
      this.userService.refreshUserMeetings();
    }
  }

  private initMeeting(): Signal<Meeting> {
    const row = this.source.row;
    if (isPastMeetingCalendarRow(row.meeting)) return signal(row.meeting).asReadonly();
    const fresh$ = this.reload$.pipe(
      startWith(undefined),
      switchMap(() =>
        this.meetingService.getMeetingDetail(row.meeting.id, { skipCache: row.meeting.organizer === true }).pipe(
          // The detail has no feed-only fields (the viewer's RSVP, registrations, counts), so they stay from the row.
          map((detail): Meeting => ({ ...row.meeting, ...detail })),
          // Cleared on settle, not finalize: a retry cancelled by a newer one must not clear the newer one's spinner.
          tap(() => {
            this.loadErrorState.set(false);
            this.retryingState.set(false);
          }),
          catchError((error: unknown) => {
            this.retryingState.set(false);
            console.error(`Failed to refresh meeting ${row.meeting.id} for its details drawer:`, error);
            if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)) {
              this.closeUnavailable();
              return of(row.meeting);
            }
            this.loadErrorState.set(true);
            return EMPTY;
          })
        )
      )
    );
    return toSignal(fresh$, { initialValue: row.meeting });
  }

  private initShownRow(): Signal<MeetingHomeRow> {
    return computed(() => {
      const row = this.row();
      const occurrence = this.occurrence() ?? row.occurrence;
      // The title follows the refreshed meeting, unless the date has its own.
      const title = occurrence?.title || this.meeting().title;
      if (!occurrence || occurrence.occurrence_id === row.occurrenceId) return title === row.title ? row : { ...row, title };
      return {
        ...row,
        key: `${row.meeting.id}:${occurrence.occurrence_id}`,
        occurrence,
        title,
        occurrenceId: occurrence.occurrence_id,
        startTime: occurrence.start_time,
        durationMinutes: occurrence.duration || row.meeting.duration,
        // The row's answer belongs to its own date; another date's is not loaded.
        myRsvp: undefined,
      };
    });
  }

  private initState(): Signal<MeetingDetailsState> {
    return computed(() => {
      const row = this.shownRow();
      return getMeetingDetailsState(row.startTime, row.durationMinutes, this.now(), {
        past: !this.occurrence() && isPastMeetingCalendarRow(row.meeting),
        earlyJoinMinutes: this.meeting().early_join_time_minutes,
      });
    });
  }

  private initPastMeetingId(): Signal<string | null> {
    return computed(() => {
      if (this.state() !== 'ended') return null;
      const row = this.row();
      const occurrence = this.occurrence();
      if (!occurrence) return isPastMeetingCalendarRow(row.meeting) ? getPastMeetingResourceId(row.meeting) : `${row.meeting.id}-${Date.parse(row.startTime)}`;
      const seriesId = isPastMeetingCalendarRow(row.meeting) ? row.meeting.meeting_id : row.meeting.id;
      return `${seriesId}-${Date.parse(occurrence.start_time)}`;
    });
  }

  /** The meeting was deleted or the viewer lost access: close, say so and reload the list. */
  private closeUnavailable(): void {
    this.toast.show({
      variant: 'error',
      position: 'bottom-center',
      message: 'Meeting unavailable',
      description: 'This meeting was deleted or you no longer have access to it.',
    });
    this.userService.refreshUserMeetings();
    this.source.hostRef?.close();
  }

  /** Re-reads the time every 5s, and when the tab comes back, since background tabs freeze timers. Browser only. */
  private startClock(): void {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const visible$ = fromEvent(this.document, 'visibilitychange').pipe(filter(() => this.document.visibilityState === 'visible'));
    merge(interval(MEETING_CLOCK_TICK_MS), fromEvent(window, 'focus'), visible$)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tick.set(Date.now()));
  }
}
