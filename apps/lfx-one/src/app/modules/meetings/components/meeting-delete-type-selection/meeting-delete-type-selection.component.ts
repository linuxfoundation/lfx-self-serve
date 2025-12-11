// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { Meeting } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export interface MeetingDeleteTypeResult {
  deleteType: 'occurrence' | 'series';
}

@Component({
  selector: 'lfx-meeting-delete-type-selection',
  imports: [NgClass, ButtonComponent],
  templateUrl: './meeting-delete-type-selection.component.html',
})
export class MeetingDeleteTypeSelectionComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);

  public readonly meeting: Meeting = this.dialogConfig.data.meeting;
  public selectedType: 'occurrence' | 'series' | null = null;

  public selectType(type: 'occurrence' | 'series'): void {
    this.selectedType = type;
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  public onContinue(): void {
    if (this.selectedType) {
      const result: MeetingDeleteTypeResult = {
        deleteType: this.selectedType,
      };
      this.dialogRef.close(result);
    }
  }
}
