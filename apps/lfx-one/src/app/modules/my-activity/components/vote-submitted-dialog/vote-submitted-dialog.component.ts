// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-vote-submitted-dialog',
  imports: [ButtonComponent],
  templateUrl: './vote-submitted-dialog.component.html',
})
export class VoteSubmittedDialogComponent {
  protected readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected onClose(): void {
    this.dialogRef.close();
  }
}
