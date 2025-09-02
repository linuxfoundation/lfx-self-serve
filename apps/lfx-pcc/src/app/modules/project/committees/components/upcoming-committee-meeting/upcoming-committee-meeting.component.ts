// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, Injector, input, OnInit, runInInjectionContext, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { TooltipModule } from 'primeng/tooltip';
import { filter, map, of } from 'rxjs';

@Component({
  selector: 'lfx-upcoming-committee-meeting',
  standalone: true,
  imports: [CommonModule, RouterLink, MeetingTimePipe, TooltipModule],
  templateUrl: './upcoming-committee-meeting.component.html',
})
export class UpcomingCommitteeMeetingComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly injector = inject(Injector);

  public readonly committeeId = input<string | null>(null);
  public readonly project = this.projectService.project;
  public upcomingMeeting!: Signal<Meeting | null>;
  public committees!: Signal<string>;

  public constructor() {
    this.committees = this.initializeCommittees();
  }

  public ngOnInit() {
    runInInjectionContext(this.injector, () => {
      this.upcomingMeeting = this.initializeUpcomingMeeting();
    });
  }

  private initializeUpcomingMeeting(): Signal<Meeting | null> {
    return toSignal(this.project() ? this.getNextUpcomingCommitteeMeeting(this.project()!.uid, this.committeeId()) : of(null), {
      initialValue: null,
    });
  }

  private initializeCommittees() {
    return computed(
      () =>
        this.upcomingMeeting()
          ?.meeting_committees?.map((committee) => committee.name)
          .join(', ') ?? ''
    );
  }

  private getNextUpcomingCommitteeMeeting(projectId: string, committeeId: string | null = null) {
    return this.meetingService.getMeetingsByProject(projectId).pipe(
      filter((meetings: Meeting[]) => {
        // Return only meetings that have a start time in the future and has a committee value regardless of the committee id
        return (
          meetings.filter((meeting) => new Date(meeting.start_time).getTime() > new Date().getTime() && meeting.committees && meeting.committees?.length > 0)
            .length > 0
        );
      }),
      map((meetings: Meeting[]) => {
        if (meetings.length > 0) {
          if (committeeId) {
            // Find the earliest upcoming meeting that has the committee id and return it
            const committeeMeetings = meetings.filter(
              (meeting) =>
                new Date(meeting.start_time).getTime() > new Date().getTime() &&
                meeting.committees &&
                meeting.committees?.length > 0 &&
                meeting.committees.some((c) => c.uid === committeeId)
            );

            return committeeMeetings.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
          }

          // Return the next upcoming meeting by date in the future
          return meetings.filter((meeting) => new Date(meeting.start_time).getTime() > new Date().getTime())[0];
        }
        return null;
      })
    );
  }
}
