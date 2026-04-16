// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { isBoardScopedPersona } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';

import { BoardMemberDashboardComponent } from './board-member/board-member-dashboard.component';
import { ExecutiveDirectorDashboardComponent } from './executive-director/executive-director-dashboard.component';
import { MultiPersonaDashboardComponent } from './multi-persona/multi-persona-dashboard.component';
import { ProjectDashboardComponent } from './project-dashboard/project-dashboard.component';
import { UserDashboardComponent } from './user-dashboard/user-dashboard.component';

const LOADING_MESSAGES = [
  'Loading your dashboard...',
  'Detecting your roles and projects...',
  'Fetching your foundation data...',
  'Preparing your personalized view...',
  'Almost there...',
];

@Component({
  selector: 'lfx-dashboard',
  imports: [
    UserDashboardComponent,
    ProjectDashboardComponent,
    BoardMemberDashboardComponent,
    ExecutiveDirectorDashboardComponent,
    MultiPersonaDashboardComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly activeLens = this.lensService.activeLens;
  protected readonly personaLoaded = this.personaService.personaLoaded;
  protected readonly loadingText = signal(LOADING_MESSAGES[0]);

  protected readonly isMultiPersonaView = computed(() => {
    return this.personaService.allPersonas().length > 1;
  });

  protected readonly foundationDashboardType = computed(() => {
    const persona = this.personaService.currentPersona();
    return isBoardScopedPersona(persona) ? persona : 'board-member';
  });

  public constructor() {
    afterNextRender(() => {
      let index = 0;
      const interval = setInterval(() => {
        if (this.personaLoaded()) {
          clearInterval(interval);
          return;
        }
        index = (index + 1) % LOADING_MESSAGES.length;
        this.loadingText.set(LOADING_MESSAGES[index]);
      }, 2000);

      this.destroyRef.onDestroy(() => clearInterval(interval));
    });
  }
}
