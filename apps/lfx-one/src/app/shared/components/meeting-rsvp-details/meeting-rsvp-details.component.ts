// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, InputSignal, output, OutputEmitterRef, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { calculateRsvpCounts, Meeting, MeetingOccurrence, MeetingRsvp, PastMeeting, Project, RsvpCounts } from '@lfx-one/shared';
import { MeetingService } from '@services/meeting.service';
import { catchError, of, switchMap } from 'rxjs';

import { ButtonComponent } from '../button/button.component';

@Component({
  selector: 'lfx-meeting-rsvp-details',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './meeting-rsvp-details.component.html',
})
export class MeetingRsvpDetailsComponent {
  private readonly meetingService = inject(MeetingService);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly project: InputSignal<Project | null> = input<Project | null>(null);
  public readonly currentOccurrence: InputSignal<MeetingOccurrence | null> = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddLink: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddModal: InputSignal<boolean> = input<boolean>(false);

  public readonly backgroundColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly borderColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly additionalRegistrantsCount: InputSignal<number> = input<number>(0);
  public readonly addParticipant: OutputEmitterRef<void> = output<void>();

  public readonly rsvps: Signal<MeetingRsvp[]> = this.initializeRsvps();
  public readonly rsvpCounts: Signal<RsvpCounts> = this.initializeRsvpCounts();
  public readonly acceptedCount: Signal<number> = computed(() => this.rsvpCounts().accepted);
  public readonly maybeCount: Signal<number> = computed(() => this.rsvpCounts().maybe);
  public readonly declinedCount: Signal<number> = computed(() => this.rsvpCounts().declined);
  public readonly meetingRegistrantCount: Signal<number> = this.initializeMeetingRegistrantCount();
  public readonly attendedCount: Signal<number> = this.initializeAttendedCount();
  public readonly attendancePercentage: Signal<number> = this.initializeAttendancePercentage();
  public readonly showPoorAttendanceWarning: Signal<boolean> = computed(() => this.pastMeeting() && this.attendancePercentage() < 50);
  public readonly backgroundClasses: Signal<string> = this.initializeBackgroundClasses();
  public readonly editLink: Signal<string> = this.initializeEditLink();
  public readonly borderClasses: Signal<string> = this.initializeBorderClasses();
  public readonly headerTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-600' : 'text-gray-600'));
  public readonly summaryTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-900' : 'text-gray-900'));

  public onAddParticipantClick(): void {
    this.addParticipant.emit();
  }

  private initializeRsvps(): Signal<MeetingRsvp[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        switchMap((meeting) =>
          this.meetingService.getMeetingRsvps(meeting.uid).pipe(
            catchError((error) => {
              console.error('Failed to fetch meeting RSVPs:', error);
              return of([]);
            })
          )
        )
      ),
      { initialValue: [] }
    );
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
      const baseCount = (meeting.individual_registrants_count || 0) + (meeting.committee_members_count || 0);
      const additionalCount = this.additionalRegistrantsCount();
      return baseCount + additionalCount;
    });
  }

  private initializeAttendedCount(): Signal<number> {
    return computed(() => {
      if ('attended_count' in this.meeting()) {
        return (this.meeting() as PastMeeting).attended_count || 0;
      }
      return 0;
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

  private initializeEditLink(): Signal<string> {
    return computed(() => {
      const slug = this.project()?.slug;
      if (slug) {
        return `/project/${slug}/meetings/${this.meeting().uid}/edit`;
      }
      return `/meetings/${this.meeting().uid}/edit`;
    });
  }
}
