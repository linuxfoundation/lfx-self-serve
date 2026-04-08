// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';

import { BoardMemberDashboardComponent } from './board-member/board-member-dashboard.component';
import { ContributorDashboardComponent } from './contributor/contributor-dashboard.component';
import { ExecutiveDirectorDashboardComponent } from './executive-director/executive-director-dashboard.component';
import { MaintainerDashboardComponent } from './maintainer/maintainer-dashboard.component';

/**
 * Main dashboard component that dynamically renders persona-specific dashboards
 * based on the user's selected persona type
 */
@Component({
  selector: 'lfx-dashboard',
  imports: [ContributorDashboardComponent, MaintainerDashboardComponent, BoardMemberDashboardComponent, ExecutiveDirectorDashboardComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly personaService = inject(PersonaService);

  /**
   * Computed signal that determines which dashboard to display
   * based on the current persona selection
   */
  protected readonly dashboardType: Signal<PersonaType> = computed(() => {
    const persona = this.personaService.currentPersona();
    return persona;
  });
}
