// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { isBoardScopedPersona } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';

import { BoardMemberDashboardComponent } from './board-member/board-member-dashboard.component';
import { ExecutiveDirectorDashboardComponent } from './executive-director/executive-director-dashboard.component';
import { ProjectDashboardComponent } from './project-dashboard/project-dashboard.component';
import { UserDashboardComponent } from './user-dashboard/user-dashboard.component';

@Component({
  selector: 'lfx-dashboard',
  imports: [UserDashboardComponent, ProjectDashboardComponent, BoardMemberDashboardComponent, ExecutiveDirectorDashboardComponent],
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent {
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);

  protected readonly activeLens = this.lensService.activeLens;

  protected readonly foundationDashboardType = computed(() => {
    const persona = this.personaService.currentPersona();
    return isBoardScopedPersona(persona) ? persona : 'board-member';
  });
}
