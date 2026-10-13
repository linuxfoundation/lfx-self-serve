// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { NgClass } from '@angular/common';
import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { MEETING_ATTENDEE_PREVIEW_LIMIT } from '@lfx-one/shared/constants';
import {
  MeetingPastRosterState,
  PastMeetingAttendanceFigures,
  PastMeetingAttendanceTone,
  PastRosterAttendanceFilter,
  PastRosterInvitationFilter,
  PublicPastMeetingParticipant,
} from '@lfx-one/shared/interfaces';
import { filterPublicPastMeetingRoster, getPastMeetingAttendanceFigures } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 past roster: who attended an ended meeting, in the content column where the upcoming people
 * section sits (E4-05, #3259, FR-032).
 * @description The page renders it for an ended meeting where `visibleSections().people` allows (a
 * signed-in viewer with artifact access, never an anonymous one), once the occurrence record is
 * loaded. It reads the public roster (`/public/api/meetings/past/:id/participants`), which carries only
 * § Public roster fields (`meeting-surface-boundary.md`): verified identities with name, avatar,
 * organization and attended / invited, plus a count of the attendees it does not name. No email, job
 * title or committee standing, and no attendance writes: those stay on the admin page.
 *
 * The attendance figures (rate, attended, absent) and the rate bar's bands come from the same shared
 * helper as the admin page (`getPastMeetingAttendanceFigures`), over counts that cover every
 * participant, so the two pages cannot disagree. The invited and attended filters are the admin
 * page's, worded as its cells are ("Not invited").
 */
@Component({
  selector: 'lfx-meeting-past-people',
  imports: [NgClass, SkeletonModule, PersonAvatarComponent],
  templateUrl: './past-people.component.html',
})
export class MeetingPastPeopleComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly meetingService = inject(MeetingService);

  /** The rate bar per band, mirroring the admin page's amber / blue / emerald in the page's tokens. */
  protected readonly toneBarClass: Record<PastMeetingAttendanceTone, string> = {
    low: 'bg-[var(--md-status-warn)]',
    medium: 'bg-[var(--md-accent)]',
    high: 'bg-[var(--md-status-good)]',
  };
  protected readonly invitationFilters: { value: PastRosterInvitationFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'invited', label: 'Invited' },
    { value: 'not-invited', label: 'Not invited' },
  ];
  protected readonly attendanceFilters: { value: PastRosterAttendanceFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'attended', label: 'Attended' },
    { value: 'absent', label: 'Absent' },
  ];
  protected readonly signInHref = this.state.signInHref;

  protected readonly invitation = signal<PastRosterInvitationFilter>('all');
  protected readonly attendance = signal<PastRosterAttendanceFilter>('all');
  /** Whether every matching row shows, rather than the first few. */
  protected readonly expanded = signal(false);
  /** Bumped to read the roster again after a read error. */
  private readonly refreshCount = signal(0);

  protected readonly roster: Signal<MeetingPastRosterState> = this.initRoster();
  protected readonly figures: Signal<PastMeetingAttendanceFigures | null> = computed(() => getPastMeetingAttendanceFigures(this.roster().roster?.attendance));
  protected readonly filteredRows: Signal<PublicPastMeetingParticipant[]> = computed(() =>
    filterPublicPastMeetingRoster(this.roster().roster?.participants ?? [], this.invitation(), this.attendance())
  );
  protected readonly visibleRows = computed(() => (this.expanded() ? this.filteredRows() : this.filteredRows().slice(0, MEETING_ATTENDEE_PREVIEW_LIMIT)));
  protected readonly hiddenCount = computed(() => this.filteredRows().length - this.visibleRows().length);
  protected readonly filtered = computed(() => this.invitation() !== 'all' || this.attendance() !== 'all');

  public setInvitation(value: PastRosterInvitationFilter): void {
    this.invitation.set(value);
    this.expanded.set(false);
  }

  public setAttendance(value: PastRosterAttendanceFilter): void {
    this.attendance.set(value);
    this.expanded.set(false);
  }

  public showAll(): void {
    this.expanded.set(true);
  }

  public retry(): void {
    this.refreshCount.update((count) => count + 1);
  }

  private initRoster(): Signal<MeetingPastRosterState> {
    const loading: MeetingPastRosterState = { status: 'loading' };
    // The public roster route takes the id the page loaded the past meeting with (the BFF resolves it).
    const request = computed(
      () => {
        const meeting = this.state.meeting();
        return meeting && this.state.loadedViaPastMeetingId() ? { id: meeting.id, refresh: this.refreshCount() } : null;
      },
      { equal: (a, b) => a?.id === b?.id && a?.refresh === b?.refresh }
    );

    return toSignal(
      toObservable(request).pipe(
        switchMap((req): Observable<MeetingPastRosterState> => {
          if (!req) {
            return of(loading);
          }
          return this.meetingService.getPublicPastMeetingRoster(req.id).pipe(
            map((roster): MeetingPastRosterState => ({ status: 'ready', roster })),
            catchError((error: unknown) => of(this.rosterFailure(error))),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }

  /** 401: the session lapsed (the route needs one). 403: no artifact access. Anything else: an error with Try again. */
  private rosterFailure(error: unknown): MeetingPastRosterState {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 401) {
      return { status: 'session-expired' };
    }
    if (status === 403) {
      return { status: 'no-access' };
    }
    console.error('Failed to load the past roster', error);
    return { status: 'error' };
  }
}
