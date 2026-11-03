// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { MeetingDeleteDialogData } from '@lfx-one/shared/interfaces';
import { formatMeetingTimeRange, getMeetingSeriesUid, resolveMeetingBaseCount } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Observable, take } from 'rxjs';

/**
 * Confirms deleting a meeting, or with an occurrence cancelling that date with an optional reason, then runs it; closes with `true` once done.
 * @description On failure it stays open with an error toast so the organizer can retry, as the legacy delete dialog does.
 */
@Component({
  selector: 'lfx-meeting-delete-modal',
  imports: [UiButtonComponent, UiModalComponent, UiNoteComponent, UiTextareaComponent],
  templateUrl: './meeting-delete-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetingDeleteModalComponent {
  private readonly dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly data = inject<MeetingDeleteDialogData>(DIALOG_DATA);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly occurrence = this.data.occurrence;
  protected readonly recurring = !!this.data.row.meeting.recurrence;
  protected readonly title = this.occurrence?.title || this.data.row.meeting.title || 'Untitled Meeting';
  protected readonly start = this.occurrence?.start_time ?? this.data.row.startTime;
  protected readonly date = formatDate(this.start, 'EEE, MMM d, y', 'en-US');
  protected readonly time = formatMeetingTimeRange(this.start, this.occurrence?.duration || this.data.row.durationMinutes);
  protected readonly guestCount = resolveMeetingBaseCount(this.data.row.meeting) ?? 0;
  protected readonly reasonMaxLength = MEETING_OCCURRENCE_CANCEL_NOTE_MAX_LENGTH;
  protected readonly reason = signal('');
  /** True while the request runs; the dialog cannot close meanwhile, or the list would miss the result. */
  public readonly busy = signal(false);

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected confirm(): void {
    if (this.busy()) return;
    this.busy.set(true);
    const meetingId = getMeetingSeriesUid(this.data.row.meeting);
    const occurrence = this.occurrence;
    const request$: Observable<void> = occurrence
      ? this.meetingService.cancelOccurrence(meetingId, occurrence.occurrence_id, this.reason().trim() || undefined)
      : this.meetingService.deleteMeeting(meetingId, this.recurring ? 'series' : undefined);

    request$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.dialogRef.close(true);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const status = error instanceof HttpErrorResponse ? error.status : null;
        this.toast.show({
          variant: 'error',
          position: 'bottom-center',
          message: occurrence ? 'Error' : 'Delete Failed',
          description: occurrence ? this.describeCancelFailure(error, status) : this.describeDeleteFailure(status),
        });
      },
    });
  }

  private describeDeleteFailure(status: number | null): string {
    if (status === 404) return 'Meeting not found. It may have already been deleted.';
    if (status === 403) return 'You do not have permission to delete this meeting.';
    if (status === 500) return 'Server error occurred. Please try again later.';
    if (status === 0) return 'Network error. Please check your connection and try again.';
    return 'Failed to delete meeting. Please try again.';
  }

  private describeCancelFailure(error: unknown, status: number | null): string {
    const message = error instanceof HttpErrorResponse ? error.error?.error : undefined;
    if (status === 400 && typeof message === 'string' && message.includes('already cancelled')) {
      return 'This occurrence has already been cancelled — please refresh the page.';
    }
    if (status === 404) return 'Meeting occurrence not found.';
    if (status === 403) return 'You do not have permission to cancel this occurrence.';
    if (status === 500) return 'Server error occurred while canceling occurrence.';
    if (status === 0) return 'Network error. Please check your connection.';
    return 'Failed to cancel occurrence. Please try again.';
  }
}
