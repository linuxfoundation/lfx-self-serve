// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import type { FormationChecklistResponse } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';

import { FormationCardComponent } from '../../components/formation-card/formation-card.component';
import { FormationChecklistSectionComponent } from '../../components/formation-checklist-section/formation-checklist-section.component';
import { FormationPeopleCardComponent } from '../../components/formation-people-card/formation-people-card.component';

@Component({
  selector: 'lfx-formation-page',
  imports: [FormationCardComponent, FormationChecklistSectionComponent, FormationPeopleCardComponent],
  templateUrl: './formation-page.component.html',
  styleUrl: './formation-page.component.scss',
})
export class FormationPageComponent {
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly selectedProject = computed(() => this.projectContextService.activeContext());

  /**
   * The checklist the section below just fetched, which also feeds the sidebar card (#2719). The
   * rail used to gate on `ProjectContextService.activeProject` — a *separate* `GET
   * /api/projects/:slug` plus an `auditor`-gated settings read, each of which degrades to `null`
   * with no retry, so the rail could vanish beside a checklist that had loaded fine for the same
   * caller. Sourcing both from this one response means whoever can read the checklist sees the
   * card beside it, with its slug, sub-stage and announcement date already in hand. Only the
   * card's admin-tool deep link still probes separately, and it fails closed. The people card
   * (#2724) rides the same response for its slug, and gates the rail with it: an ungated `<aside>`
   * would reserve a blank fixed-width column while the checklist loads.
   */
  protected readonly checklist = signal<FormationChecklistResponse | null>(null);

  protected onChecklistLoaded(response: FormationChecklistResponse | null): void {
    this.checklist.set(response);
  }
}
