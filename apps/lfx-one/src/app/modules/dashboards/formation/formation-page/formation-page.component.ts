// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { ProjectContextService } from '@services/project-context.service';

import { FormationChecklistSectionComponent } from '../../components/formation-checklist-section/formation-checklist-section.component';

@Component({
  selector: 'lfx-formation-page',
  imports: [FormationChecklistSectionComponent],
  templateUrl: './formation-page.component.html',
  styleUrl: './formation-page.component.scss',
})
export class FormationPageComponent {
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly selectedProject = computed(() => this.projectContextService.activeContext());
}
