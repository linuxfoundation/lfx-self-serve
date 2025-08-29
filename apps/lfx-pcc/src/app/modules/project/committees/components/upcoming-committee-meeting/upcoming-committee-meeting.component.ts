// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { HttpParams } from '@angular/common/http';
import { Component, computed, inject, Injector, input, OnInit, runInInjectionContext, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { TooltipModule } from 'primeng/tooltip';
import { map, of } from 'rxjs';

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
    return toSignal(this.project() ? this.getNextUpcomingCommitteeMeeting(this.project()!.uid.toString(), this.committeeId()) : of(null), {
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
    const now = new Date().toISOString();
    let params = new HttpParams().set('project_uid', `eq.${projectId}`).set('start_time', `gte.${now}`).set('order', 'start_time.asc').set('limit', '1');

    // If a specific committee ID is provided, filter by that committee
    if (committeeId) {
      // Use PostgREST's array containment operator to check if the committee ID exists in the committees array
      params = params.set('committees', `cs.{${committeeId}}`);
    } else {
      // If no specific committee, only show meetings that have committees
      params = params.set('committees', `not.is.null`);
    }

    return this.meetingService.getMeetings(params).pipe(map((meetings: Meeting[]) => (meetings.length > 0 ? meetings[0] : null)));
  }
}
