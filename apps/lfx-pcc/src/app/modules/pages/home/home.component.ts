// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ProjectCardComponent } from '@components/project-card/project-card.component';
import { Project, ProjectCard, ProjectCardMetric } from '@lfx-pcc/shared/interfaces';
import { ProjectService } from '@shared/services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { SkeletonModule } from 'primeng/skeleton';

@Component({
  selector: 'lfx-home',
  imports: [InputTextComponent, ProjectCardComponent, AnimateOnScrollModule, SkeletonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  // 1. Injected services (readonly)
  private readonly projectService = inject(ProjectService);

  // 2. Class variables with explicit types
  public form: FormGroup;
  public projects: Signal<Project[]>;
  public projectCards: Signal<ProjectCard[]>;
  public filteredProjects: Signal<ProjectCard[]>;

  public constructor() {
    // 3. Initialize all class variables by calling private methods
    this.form = this.initializeSearchForm();
    this.projects = this.initializeProjects();
    this.projectCards = this.initializeProjectCards();
    this.filteredProjects = this.initializeFilteredProjects();
  }

  // 4. Public methods (lifecycle, event handlers, etc.)
  // No public methods in this component

  // 5. Private methods (business logic)
  private transformProjectToCard(project: Project): ProjectCard {
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
      name: project.name,
      description: project.description,
      logo: project.logo,
      slug: project.slug,
      metrics,
    };
  }

  // 6. Private initialization methods (at the end of class)
  private initializeSearchForm(): FormGroup {
    return new FormGroup({
      search: new FormControl(''),
    });
  }

  private initializeProjects(): Signal<Project[]> {
    return toSignal(this.projectService.getProjects(), {
      initialValue: [],
    });
  }

  private initializeProjectCards(): Signal<ProjectCard[]> {
    return computed(() => {
      const apiProjects = this.projects();
      return apiProjects.map((project) => this.transformProjectToCard(project));
    });
  }

  private initializeFilteredProjects(): Signal<ProjectCard[]> {
    return computed(() => {
      const searchTerm = this.form.get('search')?.value?.toLowerCase() || '';
      const allProjects = this.projectCards();

      if (!searchTerm) {
        return allProjects;
      }

      return allProjects.filter((project) => project.name?.toLowerCase().includes(searchTerm) || project.description?.toLowerCase().includes(searchTerm));
    });
  }
}
