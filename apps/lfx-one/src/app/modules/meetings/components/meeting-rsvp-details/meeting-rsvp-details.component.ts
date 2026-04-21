// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, InputSignal, output, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  calculateRsvpCounts,
  Meeting,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeeting,
  PastMeetingParticipant,
  Project,
  RsvpCounts,
} from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-rsvp-details',
  imports: [NgClass, ButtonComponent],
  templateUrl: './meeting-rsvp-details.component.html',
})
export class MeetingRsvpDetailsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly project: InputSignal<Partial<Project> | null> = input<Partial<Project> | null>(null);
  public readonly currentOccurrence: InputSignal<MeetingOccurrence | null> = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddButton: InputSignal<boolean> = input<boolean>(false);

  public readonly backgroundColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly borderColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly additionalRegistrantsCount: InputSignal<number> = input<number>(0);
  public readonly addClicked = output<void>();
  // Emits whether the current user has any RSVP on this meeting, derived from the already-fetched
  // registrants/rsvps data. Parent card uses this to flip "Set My RSVP" → "Update My RSVP".
  public readonly currentUserHasRsvpChanged = output<boolean>();
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
  public readonly disabledMessage: InputSignal<string> = input<string>('RSVP not available for this meeting');

  public readonly loading: WritableSignal<boolean> = signal(true);
  // Private source: one observable, two derived signals. Consolidates registrants + RSVPs
  // into a single HTTP call for the Me lens (where the backend doesn't populate counts),
  // and falls back to a direct RSVP fetch for the non-Me lens where counts are already populated.
  private readonly upcomingData: Signal<{ rsvps: MeetingRsvp[]; registrants: MeetingRegistrant[] }> = this.initializeUpcomingData();
  public readonly rsvps: Signal<MeetingRsvp[]> = computed(() => this.upcomingData().rsvps);
  public readonly pastParticipants: Signal<PastMeetingParticipant[]> = this.initializePastParticipants();
  public readonly registrants: Signal<MeetingRegistrant[]> = computed(() => this.upcomingData().registrants);
  // Tracks across both rsvps data AND user identity; re-emits whenever either changes so the
  // parent card's "Set My RSVP" / "Update My RSVP" label stays in sync with login/impersonation.
  public readonly currentUserHasRsvp: Signal<boolean> = computed(() => {
    const email = this.userService.user()?.email?.toLowerCase();
    if (!email) return false;
    return this.upcomingData().rsvps.some((r) => r.email?.toLowerCase() === email);
  });
  public readonly rsvpCounts: Signal<RsvpCounts> = this.initializeRsvpCounts();
  public readonly acceptedCount: Signal<number> = computed(() => this.rsvpCounts().accepted);
  public readonly maybeCount: Signal<number> = computed(() => this.rsvpCounts().maybe);
  public readonly declinedCount: Signal<number> = computed(() => this.rsvpCounts().declined);
  public readonly meetingRegistrantCount: Signal<number> = this.initializeMeetingRegistrantCount();
  public readonly attendedCount: Signal<number> = this.initializeAttendedCount();
  public readonly attendancePercentage: Signal<number> = this.initializeAttendancePercentage();
  public readonly showPoorAttendanceWarning: Signal<boolean> = computed(() => this.pastMeeting() && this.attendancePercentage() < 50);
  public readonly backgroundClasses: Signal<string> = this.initializeBackgroundClasses();
  public readonly borderClasses: Signal<string> = this.initializeBorderClasses();
  public readonly headerTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-600' : 'text-gray-600'));
  public readonly summaryTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-900' : 'text-gray-900'));

  public constructor() {
    // Forward currentUserHasRsvp to the output whenever either rsvps data or user identity changes.
    toObservable(this.currentUserHasRsvp)
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((v) => this.currentUserHasRsvpChanged.emit(v));
  }

  private initializeUpcomingData(): Signal<{ rsvps: MeetingRsvp[]; registrants: MeetingRegistrant[] }> {
    return toSignal(
      toObservable(this.meeting).pipe(
        tap(() => {
          if (!this.pastMeeting()) this.loading.set(true);
        }),
        switchMap((meeting) => {
          if (this.pastMeeting()) {
            return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
          }
          // Me lens (backend counts not populated) — one call for both registrants + RSVPs inline.
          if (!this.hasBackendRegistrantCounts(meeting)) {
            return this.meetingService.getMeetingRegistrants(meeting.id, true).pipe(
              map((registrants) => ({
                registrants,
                rsvps: registrants.map((r) => r.rsvp).filter((r): r is MeetingRsvp => r != null),
              })),
              catchError((error) => {
                console.error('Failed to fetch meeting registrants:', error);
                return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
              })
            );
          }
          // Non-Me lens — counts are already on the meeting object, only need RSVPs.
          return this.meetingService.getMeetingRsvps(meeting.id).pipe(
            map((rsvps) => ({ rsvps, registrants: [] as MeetingRegistrant[] })),
            catchError((error) => {
              console.error('Failed to fetch meeting RSVPs:', error);
              return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
            })
          );
        }),
        tap(() => {
          if (!this.pastMeeting()) this.loading.set(false);
        })
      ),
      { initialValue: { rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] } }
    );
  }

  private initializePastParticipants(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        tap(() => {
          if (this.pastMeeting()) this.loading.set(true);
        }),
        switchMap((meeting) => {
          if (!this.pastMeeting()) {
            return of([] as PastMeetingParticipant[]);
          }
          return this.meetingService.getPastMeetingParticipants(meeting.id).pipe(
            catchError((error) => {
              console.error('Failed to fetch past meeting participants:', error);
              return of([] as PastMeetingParticipant[]);
            })
          );
        }),
        tap(() => {
          if (this.pastMeeting()) this.loading.set(false);
        })
      ),
      { initialValue: [] }
    );
  }

  private hasBackendRegistrantCounts(meeting: Meeting | PastMeeting): boolean {
    return meeting.individual_registrants_count !== undefined || meeting.committee_members_count !== undefined;
  }

  private initializeRsvpCounts(): Signal<RsvpCounts> {
    return computed(() => {
      const rsvps = this.rsvps();
      const occurrence = this.currentOccurrence();
      const meeting = this.meeting();
      return calculateRsvpCounts(occurrence, rsvps, meeting.start_time);
    });
  }

  private initializeMeetingRegistrantCount(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      const additionalCount = this.additionalRegistrantsCount();

      if (this.pastMeeting()) {
        return this.pastParticipants().length + additionalCount;
      }

      const splitCount = (meeting.individual_registrants_count || 0) + (meeting.committee_members_count || 0);
      // Me lens: splitCount is 0 (backend doesn't populate), fall back to the lazy-fetched registrants.
      // Non-Me lens: registrant_count may be populated by legacy paths that don't split; respect it.
      const baseCount = splitCount > 0 ? splitCount : (meeting.registrant_count ?? this.registrants().length);
      return baseCount + additionalCount;
    });
  }

  private initializeAttendedCount(): Signal<number> {
    return computed(() => {
      if (!this.pastMeeting()) return 0;
      return this.pastParticipants().filter((p) => p.is_attended).length;
    });
  }

  private initializeAttendancePercentage(): Signal<number> {
    return computed(() => {
      const total = this.meetingRegistrantCount();
      if (total === 0) {
        return 0;
      }

      if (this.pastMeeting()) {
        return Math.round((this.attendedCount() / total) * 100);
      }

      return Math.round((this.acceptedCount() / total) * 100);
    });
  }

  private initializeBackgroundClasses(): Signal<string> {
    return computed(() => {
      if (this.showPoorAttendanceWarning()) {
        return 'bg-amber-50';
      }
      return this.backgroundColor() || 'bg-gray-100/60';
    });
  }

  private initializeBorderClasses(): Signal<string> {
    return computed(() => {
      if (this.showPoorAttendanceWarning()) {
        return 'border border-amber-200';
      }
      if (this.borderColor()) {
        return `border ${this.borderColor()}`;
      }
      return '';
    });
  }
}
