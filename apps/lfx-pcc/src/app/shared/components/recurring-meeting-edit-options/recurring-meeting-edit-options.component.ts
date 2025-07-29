// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { RadioButtonComponent } from '@app/shared/components/radio-button/radio-button.component';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export interface RecurringEditOption {
  editType: 'single' | 'future';
  proceed: boolean;
}

@Component({
  selector: 'lfx-recurring-meeting-edit-options',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, RadioButtonComponent],
  templateUrl: './recurring-meeting-edit-options.component.html',
})
export class RecurringMeetingEditOptionsComponent {
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly meeting: Meeting = this.dialogConfig.data?.meeting;
  public readonly editForm: FormGroup = this.initializeEditForm();

  public onConfirm(): void {
    const result: RecurringEditOption = {
      editType: this.editForm.get('editType')?.value || 'single',
      proceed: true,
    };
    this.dialogRef.close(result);
  }

  public onCancel(): void {
    const result: RecurringEditOption = {
      editType: 'single',
      proceed: false,
    };
    this.dialogRef.close(result);
  }

  private initializeEditForm(): FormGroup {
    return new FormGroup({
      editType: new FormControl('single'),
    });
  }
}
