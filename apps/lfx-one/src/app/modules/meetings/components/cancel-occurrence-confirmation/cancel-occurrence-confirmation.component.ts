// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-cancel-occurrence-confirmation',
  imports: [ButtonComponent, MessageComponent, MeetingTimePipe],
  templateUrl: './cancel-occurrence-confirmation.component.html',
})
export class CancelOccurrenceConfirmationComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);

  public readonly meeting: Meeting = this.config.data.meeting;
  public readonly occurrence: MeetingOccurrence = this.config.data.occurrence;
  public readonly isCanceling = signal(false);

  public onCancel(): void {
    this.dialogRef.close({ confirmed: false });
  }

  public onConfirm(): void {
    this.isCanceling.set(true);

    this.meetingService.cancelOccurrence(this.meeting.uid, this.occurrence.occurrence_id).subscribe({
      next: () => {
        this.isCanceling.set(false);
        this.dialogRef.close({ confirmed: true });
      },
      error: (error: HttpErrorResponse) => {
        this.isCanceling.set(false);
        let errorMessage = 'Failed to cancel occurrence. Please try again.';

        if (error.status === 404) {
          errorMessage = 'Meeting occurrence not found.';
        } else if (error.status === 403) {
          errorMessage = 'You do not have permission to cancel this occurrence.';
        } else if (error.status === 500) {
          errorMessage = 'Server error occurred while canceling occurrence.';
        } else if (error.status === 0) {
          errorMessage = 'Network error. Please check your connection.';
        }

        this.dialogRef.close({ confirmed: false, error: errorMessage });
      },
    });
  }
}
