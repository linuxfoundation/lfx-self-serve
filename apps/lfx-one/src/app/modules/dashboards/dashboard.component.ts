// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { PersonaService } from '@app/shared/services/persona.service';
import { CoreDeveloperDashboardComponent } from './core-developer/core-developer-dashboard.component';
import { MaintainerDashboardComponent } from './maintainer/maintainer-dashboard.component';

/**
 * Main dashboard component that dynamically renders persona-specific dashboards
 * based on the user's selected persona type
 */
@Component({
  selector: 'lfx-dashboard',
  standalone: true,
  imports: [CoreDeveloperDashboardComponent, MaintainerDashboardComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly personaService = inject(PersonaService);

  /**
   * Computed signal that determines which dashboard to display
   * based on the current persona selection
   */
  protected readonly dashboardType = computed(() => {
    const persona = this.personaService.currentPersona();
    // Filter out 'old-ui' as it has its own route
    return persona === 'old-ui' ? 'core-developer' : persona;
  });
}
