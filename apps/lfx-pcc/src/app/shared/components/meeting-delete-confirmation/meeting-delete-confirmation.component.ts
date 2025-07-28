// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { RadioButtonComponent } from '@app/shared/components/radio-button/radio-button.component';
import { MeetingTimePipe } from '@app/shared/pipes/meeting-time.pipe';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export interface MeetingDeleteResult {
  confirmed: boolean;
  deleteType?: 'single' | 'series';
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

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly participantCount: number = this.meeting.individual_participants_count + this.meeting.committee_members_count;
  public readonly isRecurring: boolean = !!this.meeting.recurrence;
  public readonly deleteForm: FormGroup = this.initializeDeleteForm();

  public onConfirm(): void {
    const result: MeetingDeleteResult = {
      confirmed: true,
      deleteType: this.isRecurring ? this.deleteForm.get('deleteType')?.value : undefined,
    };
    this.dialogRef.close(result);
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
