// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs/operators';

export interface MeetingDeleteResult {
  confirmed: boolean;
  deleteType?: 'single' | 'series' | 'future';
}

@Component({
  selector: 'lfx-meeting-delete-confirmation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, RadioButtonComponent, MeetingTimePipe],
  templateUrl: './meeting-delete-confirmation.component.html',
  styleUrl: './meeting-delete-confirmation.component.scss',
})
export class MeetingDeleteConfirmationComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly participantCount: number = this.meeting.individual_participants_count + this.meeting.committee_members_count;
  public readonly isRecurring: boolean = !!this.meeting.recurrence;
  public readonly isPastMeeting: boolean = this.meeting.start_time ? new Date(this.meeting.start_time) < new Date() : false;
  public readonly deleteForm: FormGroup = this.initializeDeleteForm();
  public isDeleting: WritableSignal<boolean> = signal(false);

  public onConfirm(): void {
    this.isDeleting.set(true);
    const deleteType = this.isRecurring && !this.isPastMeeting ? this.deleteForm.get('deleteType')?.value : undefined;

    this.meetingService
      .deleteMeeting(this.meeting.uid, deleteType)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isDeleting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Meeting deleted successfully.',
            life: 3000,
          });

          const result: MeetingDeleteResult = {
            confirmed: true,
            deleteType,
          };
          this.dialogRef.close(result);
        },
        error: (error) => {
          console.error('Failed to delete meeting:', error);
          this.isDeleting.set(false);

          let errorMessage = 'Failed to delete meeting. Please try again.';

          // Provide more specific error messages based on error status
          if (error?.status === 404) {
            errorMessage = 'Meeting not found. It may have already been deleted.';
          } else if (error?.status === 403) {
            errorMessage = 'You do not have permission to delete this meeting.';
          } else if (error?.status === 500) {
            errorMessage = 'Server error occurred. Please try again later.';
          } else if (error?.status === 0) {
            errorMessage = 'Network error. Please check your connection and try again.';
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Delete Failed',
            detail: errorMessage,
            life: 5000,
          });

          // Don't close dialog on error, allow user to retry
        },
      });
  }

  public onCancel(): void {
    const result: MeetingDeleteResult = {
      confirmed: false,
    };
    this.dialogRef.close(result);
  }

  private initializeDeleteForm(): FormGroup {
    return new FormGroup({
      deleteType: new FormControl('single'),
    });
  }
}
