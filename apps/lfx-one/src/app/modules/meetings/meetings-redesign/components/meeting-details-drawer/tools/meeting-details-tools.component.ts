// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingHomeAttendance, MeetingReconcileDialogData, PastMeetingParticipant, PastMeetingSummary } from '@lfx-one/shared/interfaces';
import { getPastMeetingAttendance, isHostKeyVisible, isPastMeetingCalendarRow } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiSplitButtonComponent } from '@shared/uikit/split-button/split-button.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { catchError, distinctUntilChanged, of, startWith, switchMap, take } from 'rxjs';

import { MeetingsHomeDialogsService } from '../../../services/meetings-home-dialogs.service';
import { MeetingsHomeStore } from '../../../services/meetings-home.store';
import { MeetingAttendeeGridComponent } from '../../meeting-attendee-grid/meeting-attendee-grid.component';
import { MeetingHomeAttendanceComponent } from '../../meeting-home-attendance/meeting-home-attendance.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsHostKeyComponent } from './host-key/meeting-details-host-key.component';
import { MeetingDetailsReconcileDialogComponent } from '../reconcile/meeting-details-reconcile-dialog.component';
import { MeetingDetailsArtifactsService } from './meeting-details-artifacts.service';
import { MeetingDetailsRsvpComponent } from './rsvp/meeting-details-rsvp.component';

/**
 * Right column of the meeting details drawer under the schedule: host controls, the organizer's RSVP counts, attendance,
 * the organizer's Reconcile Attendance, the recording, AI summary and transcript, and the private-meeting notice.
 * @description Follows the legacy meeting page's gates and copy.
 */
@Component({
  selector: 'lfx-meeting-details-tools',
  imports: [
    MeetingDetailsHostKeyComponent,
    MeetingDetailsRsvpComponent,
    MeetingAttendeeGridComponent,
    MeetingHomeAttendanceComponent,
    UiButtonComponent,
    UiNoteComponent,
    UiSkeletonComponent,
    UiSplitButtonComponent,
    UiTooltipDirective,
  ],
  templateUrl: './meeting-details-tools.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[16px] empty:hidden' },
})
export class MeetingDetailsToolsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly dialogs = inject(MeetingsHomeDialogsService);
  private readonly modal = inject(UiModalService);
  private readonly store = inject(MeetingsHomeStore);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly context = inject(MeetingDetailsContext);
  protected readonly artifactsService = inject(MeetingDetailsArtifactsService);

  protected readonly ended: Signal<boolean> = computed(() => this.context.state() === 'ended');
  /** The BFF sends the key only to its audience inside its window, so nothing else gates it. */
  protected readonly hostKey: Signal<string | null> = computed(() => {
    const meeting = this.context.meeting();
    return isHostKeyVisible(meeting) ? (meeting.host_key ?? null) : null;
  });
  /** The ended date's participants; undefined while loading, null before the end or without access. */
  protected readonly participants: Signal<PastMeetingParticipant[] | null | undefined> = this.initParticipants();
  protected readonly attendance: Signal<MeetingHomeAttendance | null | undefined> = this.initAttendance();

  protected openRecording(url: string): void {
    this.dialogs.openRecording(url);
  }

  protected copyRecordingLink(url: string): void {
    this.dialogs.copyRecordingLink(url);
  }

  protected openSummary(summary: PastMeetingSummary): void {
    const pastMeetingId = this.context.pastMeetingId();
    if (!pastMeetingId) return;
    // The dialog writes edits back to the past meeting the row key names.
    const row = { ...this.context.shownRow(), key: pastMeetingId, meeting: this.context.meeting() };
    const onChange = (change: PastMeetingSummary): void => {
      this.artifactsService.summary.set(change);
      // The home list behind the drawer shows the same summary.
      this.store.applySummaryChange(pastMeetingId, change);
    };
    this.dialogs.openSummary(row, summary, onChange, { origin: 'drawer', showPending: true });
  }

  protected openReconcile(): void {
    const pastMeetingId = this.context.pastMeetingId();
    if (!pastMeetingId) return;
    const data: MeetingReconcileDialogData = { row: this.context.shownRow(), pastMeetingId, onChange: () => this.context.refreshParticipants() };
    const ref = this.modal.open<void, MeetingReconcileDialogData>(MeetingDetailsReconcileDialogComponent, { data, describedBy: true });
    // The dialog belongs to the drawer, so it closes with it.
    const stopClosingOnDestroy = this.destroyRef.onDestroy(() => ref.close());
    ref.closed.pipe(take(1)).subscribe(() => stopClosingOnDestroy());
  }

  protected openTranscript(): void {
    const pastMeetingId = this.context.pastMeetingId();
    if (!pastMeetingId) return;
    this.dialogs.openTranscript(pastMeetingId, { ...this.context.shownRow(), meeting: this.context.meeting() }, { origin: 'drawer' });
  }

  private initParticipants(): Signal<PastMeetingParticipant[] | null | undefined> {
    const id = computed(() => (this.context.fullAccess() ? this.context.pastMeetingId() : null));
    const version$ = toObservable(this.context.participantsVersion);
    const participants$ = toObservable(id).pipe(
      distinctUntilChanged(),
      switchMap((pastMeetingId) => {
        if (!pastMeetingId) return of(null);
        // A reload after a change keeps the shown list until the new one arrives.
        return version$.pipe(
          switchMap(() =>
            this.meetingService.getPastMeetingParticipants(pastMeetingId).pipe(
              // The list is hidden from some viewers, so a failure falls back to the meeting's own counts.
              catchError((error: unknown) => {
                console.error('Failed to load the past meeting participants:', error);
                return of([]);
              })
            )
          ),
          startWith(undefined)
        );
      })
    );
    return toSignal(participants$, { initialValue: undefined });
  }

  private initAttendance(): Signal<MeetingHomeAttendance | null | undefined> {
    return computed(() => {
      const list = this.participants();
      if (list === undefined) return undefined;
      if (list === null) return null;
      // The participant list is hidden from some viewers; the meeting's own counts stand in, as on the meeting page.
      const meeting = this.context.meeting();
      const feed = isPastMeetingCalendarRow(meeting) ? meeting.attendance_summary : undefined;
      const summary = list.length
        ? { invited: list.length, attended: list.filter((participant) => participant.is_attended).length }
        : (feed ?? { invited: meeting.participant_count ?? 0, attended: meeting.attended_count ?? 0 });
      return getPastMeetingAttendance(summary, { withAbsent: true });
    });
  }
}
