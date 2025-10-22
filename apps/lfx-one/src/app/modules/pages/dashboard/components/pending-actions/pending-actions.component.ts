// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  public readonly actionClick = output<PendingActionItem>();
  public readonly viewAll = output<void>();

  protected readonly pendingActions: PendingActionItem[] = [
    {
      type: 'Issue',
      badge: 'Kubernetes',
      text: 'Maintainer tagged you for clarification on issue #238: Pod Autoscaler UI.',
      icon: 'fa-light fa-envelope',
      color: 'amber',
      buttonText: 'Add Comment',
    },
    {
      type: 'PR Review',
      badge: 'Linux Kernel',
      text: 'Code review requested for pull request #456: Memory management optimization.',
      icon: 'fa-light fa-code-pull-request',
      color: 'blue',
      buttonText: 'Review PR',
    },
    {
      type: 'Meeting',
      badge: 'CNCF',
      text: 'Technical Steering Committee meeting agenda review needed by EOD.',
      icon: 'fa-light fa-calendar',
      color: 'green',
      buttonText: 'View Agenda',
    },
  ];

  public handleViewAll(): void {
    this.viewAll.emit();
  }

  protected handleActionClick(item: PendingActionItem): void {
    this.actionClick.emit(item);
  }
}
