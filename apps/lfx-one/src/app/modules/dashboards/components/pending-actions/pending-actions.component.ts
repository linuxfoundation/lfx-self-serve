// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions',
  standalone: true,
  imports: [CommonModule, TagComponent],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  /**
   * Required input signal for pending action items
   */
  public readonly pendingActions = input.required<PendingActionItem[]>();

  public readonly actionClick = output<PendingActionItem>();

  protected handleActionClick(item: PendingActionItem): void {
    this.actionClick.emit(item);
  }
}
