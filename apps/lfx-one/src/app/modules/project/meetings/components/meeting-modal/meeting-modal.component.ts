// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { MeetingCardComponent } from '@components/meeting-card/meeting-card.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-meeting-modal',
  standalone: true,
  imports: [MeetingCardComponent],
  templateUrl: './meeting-modal.component.html',
})
export class MeetingModalComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly meeting = this.config.data?.meeting;
  public readonly occurrence = this.config.data?.occurrence;

  public onDelete(): void {
    this.dialogRef.close(true);
  }
}
