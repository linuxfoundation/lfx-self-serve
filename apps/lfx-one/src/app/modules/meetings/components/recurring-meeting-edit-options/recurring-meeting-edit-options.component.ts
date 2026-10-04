// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { Meeting, MeetingOccurrence, RecurringMeetingEditScope, RecurringMeetingEditScopeResult } from '@lfx-one/shared/interfaces';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-recurring-meeting-edit-options',
  imports: [ReactiveFormsModule, ButtonComponent, RadioButtonComponent, MeetingTimePipe],
  templateUrl: './recurring-meeting-edit-options.component.html',
})
export class RecurringMeetingEditOptionsComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly occurrence: MeetingOccurrence = this.dialogConfig.data?.occurrence;
  public readonly editForm: FormGroup = this.initializeEditForm();

  public onConfirm(): void {
    const result: RecurringMeetingEditScopeResult = {
      scope: this.editForm.get('scope')?.value || 'occurrence',
      proceed: true,
    };
    this.dialogRef.close(result);
  }

  public onCancel(): void {
    const result: RecurringMeetingEditScopeResult = {
      scope: 'occurrence',
      proceed: false,
    };
    this.dialogRef.close(result);
  }

  private initializeEditForm(): FormGroup {
    return new FormGroup({
      scope: new FormControl<RecurringMeetingEditScope>('occurrence'),
    });
  }
}
