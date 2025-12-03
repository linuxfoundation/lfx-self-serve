// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';
import { TooltipModule } from 'primeng/tooltip';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';
@Component({
  selector: 'lfx-pending-actions',
  standalone: true,
  imports: [CommonModule, ButtonComponent, TagComponent, TooltipModule],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly pendingActions = input.required<PendingActionItem[]>();

  public readonly actionClick = output<PendingActionItem>();

  protected handleActionClick(item: PendingActionItem): void {
    this.hiddenActionsService.hideAction(item);
    this.actionClick.emit(item);
  }
}
