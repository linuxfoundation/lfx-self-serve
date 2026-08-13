// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-reject-application-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './reject-application-dialog.component.html',
})
export class RejectApplicationDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly applicantEmail: string = this.config.data?.applicantEmail ?? 'this applicant';

  public readonly form = new FormGroup({
    reviewer_notes: new FormControl<string>('', { nonNullable: true }),
  });

  public cancel(): void {
    this.dialogRef.close(undefined);
  }

  public submit(): void {
    const notes = this.form.get('reviewer_notes')?.value?.trim() || '';
    this.dialogRef.close(notes);
  }
}
