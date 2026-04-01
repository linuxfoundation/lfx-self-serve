// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { JoinApplicationDialogResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-join-application-dialog',
  imports: [ButtonComponent, ReactiveFormsModule, TextareaComponent],
  templateUrl: './join-application-dialog.component.html',
})
export class JoinApplicationDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly committeeName: string = this.config.data.committeeName;
  public readonly mode: 'application' | 'invite_only' = this.config.data.mode;

  public applicationForm = new FormGroup({
    message: new FormControl(''),
  });

  public submit(): void {
    const message = this.applicationForm.get('message')?.value?.trim() || undefined;
    this.dialogRef.close({ message } as JoinApplicationDialogResult);
  }

  public cancel(): void {
    this.dialogRef.close(null);
  }
}
