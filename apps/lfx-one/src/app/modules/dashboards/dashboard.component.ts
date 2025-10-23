// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { PersonaService } from '@app/shared/services/persona.service';
import { PersonaType } from '@lfx-one/shared/interfaces';

import { HomeComponent } from '../pages/home/home.component';
import { CoreDeveloperDashboardComponent } from './core-developer/core-developer-dashboard.component';
import { MaintainerDashboardComponent } from './maintainer/maintainer-dashboard.component';

/**
 * Main dashboard component that dynamically renders persona-specific dashboards
 * based on the user's selected persona type
 */
@Component({
  selector: 'lfx-dashboard',
  standalone: true,
  imports: [CoreDeveloperDashboardComponent, MaintainerDashboardComponent, HomeComponent],
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
