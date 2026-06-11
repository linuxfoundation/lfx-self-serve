// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import type { WhyCantEditBoardDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/** Explains why a board seat/member is read-only (foundation-controlled or no writer authority). Buttons close-only for now. */
@Component({
  selector: 'lfx-why-cant-edit-board-modal',
  standalone: true,
  imports: [],
  templateUrl: './why-cant-edit-board-modal.component.html',
})
export class WhyCantEditBoardModalComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<WhyCantEditBoardDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly reason: string = this.dialogConfig.data?.reason ?? '';

  protected onClose(): void {
    this.dialogRef.close(null);
  }
}
