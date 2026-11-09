// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MEETING_CLOCK_TICK_MS } from '@lfx-one/shared/constants';
import {
  Meeting,
  MeetingDetailsDrawerData,
  MeetingDetailsState,
  MeetingDetailsTab,
  MeetingHomeRow,
  MeetingHostCandidate,
  MeetingOccurrence,
} from '@lfx-one/shared/interfaces';
import { canViewMeetingGuests, getMeetingDetailsState, getPastMeetingResourceId, hasMeetingFullAccess, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, filter, fromEvent, interval, map, merge, of } from 'rxjs';

import { MeetingsHomeStore } from '../../services/meetings-home.store';

/**
 * What every section of the meeting details drawer reads: the row it opened on, the meeting, the shown date and the viewer's relation.
 * @description Provided by the drawer. Sections fetch their own data from it, keyed on `occurrence` and `pastMeetingId`.
 */
@Injectable()
export class MeetingDetailsContext {
  private readonly data = inject<MeetingDetailsDrawerData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly store = inject(MeetingsHomeStore);
  private readonly toast = inject(UiToastService);
  private readonly dialogRef = inject(DialogRef, { optional: true });
  private readonly document = inject(DOCUMENT);
  /** Time read by the drawer's own clock; 0 until it first ticks. */
  private readonly tick = signal(0);
  /** Registered from the drawer; counts as invited before the list catches up. */
  private readonly registered = signal(false);

  /** The row the drawer opened on. */
  public readonly row: Signal<MeetingHomeRow> = signal(this.data.row).asReadonly();
  /** The meeting: the row's data first, replaced by the fresh detail of an upcoming meeting once it loads. */
  public readonly meeting: Signal<Meeting> = this.initMeeting();
  /** The date shown; null for a one-time or past meeting until another date is picked. */
  public readonly occurrence: WritableSignal<MeetingOccurrence | null> = signal(this.data.row.occurrence);
  /** The page clock, or the drawer's own when it is ahead: it ticks every 5s and on focus, so Join opens on time. */
  public readonly now: Signal<Date> = computed(() => {
    const page = this.store.now();
    return this.tick() > page.getTime() ? new Date(this.tick()) : page;
  });
  /** The row rebuilt for the shown date, for flows that act on one date, such as `MeetingsHomeEditService.edit`. */
  public readonly shownRow: Signal<MeetingHomeRow> = this.initShownRow();
  /** Where the shown date stands, re-checked as the page clock ticks. */
  public readonly state: Signal<MeetingDetailsState> = this.initState();
  public readonly organizer: Signal<boolean> = computed(() => this.meeting().organizer === true);
  /** Invited, and not just removed from the meeting on this page. */
  public readonly invited: Signal<boolean> = computed(
    () => (this.registered() || !!this.meeting().invited) && !this.meetingService.removedRegistrationMeetingIds().has(this.row().meeting.id)
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
  public readonly tab: WritableSignal<MeetingDetailsTab> = signal(this.data.tab);
  /** Guests or participants flagged as host, set by the guests section once it loads them; they join "Organized by". */
  public readonly hosts: WritableSignal<readonly MeetingHostCandidate[]> = signal([]);
  /** Guests or participants count for the tab, set by the guests section once it loads them. */
  public readonly guestCount: WritableSignal<number | null> = signal(null);

  public constructor() {
    this.startClock();
  }

  /** Records a registration made from the drawer and reloads the list behind it. */
  public markRegistered(): void {
    this.meetingService.clearRemovedRegistration(this.row().meeting.id);
    this.registered.set(true);
    this.refreshList();
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
    const row = this.data.row;
    if (isPastMeetingCalendarRow(row.meeting)) return signal(row.meeting).asReadonly();
    const fresh$ = this.meetingService.getMeetingDetail(row.meeting.id, { skipCache: row.meeting.organizer === true }).pipe(
      // The detail has no feed-only fields (the viewer's RSVP, registrations, counts), so they stay from the row.
      map((detail): Meeting => ({ ...row.meeting, ...detail })),
      catchError((error: unknown) => {
        console.error(`Failed to refresh meeting ${row.meeting.id} for its details drawer:`, error);
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 403)) {
          this.closeUnavailable();
          return of(row.meeting);
        }
        this.toast.show({
          variant: 'error',
          position: 'bottom-center',
          message: 'Meeting details unavailable',
          description: 'Some details may be out of date. Please try again later.',
        });
        return of(row.meeting);
      })
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
    this.dialogRef?.close();
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
