// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ProjectCardComponent } from '@components/project-card/project-card.component';
import { Project, ProjectCardMetric } from '@lfx-pcc/shared/interfaces';
import { ProjectService } from '@shared/services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';

@Component({
  selector: 'lfx-home',
  imports: [InputTextComponent, ProjectCardComponent, AnimateOnScrollModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  private readonly projectService = inject(ProjectService);

  public readonly form = new FormGroup({
    search: new FormControl(''),
  });

  // Convert Observable to Signal
  public readonly projects = toSignal(this.projectService.getProjects(), {
    initialValue: [],
  });

  // Transform API projects to card format
  public readonly projectCards = computed(() => {
    const apiProjects = this.projects();
    return apiProjects.map(this.transformProjectToCard);
  });

  // Computed signal for filtered projects based on search
  public readonly filteredProjects = computed(() => {
    const searchTerm = this.form.get('search')?.value?.toLowerCase() || '';
    const allProjects = this.projectCards();

    if (!searchTerm) {
      return allProjects;
    }

    return allProjects.filter((project) => project.title.toLowerCase().includes(searchTerm) || project.description.toLowerCase().includes(searchTerm));
  });

  private transformProjectToCard = (project: Project) => {
    const metrics: ProjectCardMetric[] = [
      {
        label: 'Meetings',
        value: project.meetings_count,
        icon: 'fa-light fa-calendar-days text-blue-500',
      },
      {
        label: 'Committees',
        value: project.committees_count,
        icon: 'fa-light fa-people-group text-green-500',
      },
      {
        label: 'Mailing Lists',
        value: project.mailing_list_count,
        icon: 'fa-light fa-envelope text-amber-500',
      },
    ];

    return {
      id: project.slug,
      title: project.name,
      description: project.description,
      logoUrl: project.logo,
      url: `/project/${project.slug}`,
      metrics,
    };
  };
}
