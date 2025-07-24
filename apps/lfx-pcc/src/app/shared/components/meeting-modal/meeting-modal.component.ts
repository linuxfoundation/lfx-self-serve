// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { MeetingCardComponent } from '@app/shared/components/meeting-card/meeting-card.component';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { MenuItem } from 'primeng/api';
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

  public readonly meeting = signal<Meeting>(this.config.data?.meeting);
  public readonly actionMenuItems = signal<MenuItem[]>(this.config.data?.actionMenuItems || []);

  public onMenuToggle(event: any): void {
    // Handle menu toggle - we can just pass it through or close the dialog
    // For now, let's close the dialog when a menu action is triggered
    event.menuComponent.toggle(event.event);
  }
}
