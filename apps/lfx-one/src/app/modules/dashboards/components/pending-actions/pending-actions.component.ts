// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, output } from '@angular/core';
import { PersonaService } from '@app/shared/services/persona.service';
import { ButtonComponent } from '@components/button/button.component';
import { CORE_DEVELOPER_ACTION_ITEMS, MAINTAINER_ACTION_ITEMS } from '@lfx-one/shared/constants';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-pending-actions',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly personaService = inject(PersonaService);

  public readonly actionClick = output<PendingActionItem>();
  public readonly viewAll = output<void>();

  /**
   * Computed signal that returns action items based on the current persona
   */
  protected readonly pendingActions = computed<PendingActionItem[]>(() => {
    const persona = this.personaService.currentPersona();

    switch (persona) {
      case 'maintainer':
        return MAINTAINER_ACTION_ITEMS;
      case 'core-developer':
      default:
        return CORE_DEVELOPER_ACTION_ITEMS;
    }
  });

  public handleViewAll(): void {
    this.viewAll.emit();
  }

  protected handleActionClick(item: PendingActionItem): void {
    this.actionClick.emit(item);
  }
}
