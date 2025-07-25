// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { MeetingCardComponent } from '@app/shared/components/meeting-card/meeting-card.component';
import { MeetingFormComponent } from '@app/shared/components/meeting-form/meeting-form.component';
import { Meeting } from '@lfx-pcc/shared/interfaces';
import { MenuItem } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-meeting-modal',
  standalone: true,
  imports: [MeetingCardComponent, MeetingFormComponent],
  templateUrl: './meeting-modal.component.html',
})
export class MeetingModalComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  public readonly meeting = signal<Meeting>(this.config.data?.meeting);
  public readonly actionMenuItems = signal<MenuItem[]>(this.config.data?.actionMenuItems || []);

  // Show form when isEditing is defined (true for edit, false for create)
  public readonly showForm = computed(() => this.config.data?.isEditing !== undefined);

  public onMenuToggle(event: any): void {
    // Handle menu toggle - we can just pass it through or close the dialog
    // For now, let's close the dialog when a menu action is triggered
    event.menuComponent.toggle(event.event);
  }
}
