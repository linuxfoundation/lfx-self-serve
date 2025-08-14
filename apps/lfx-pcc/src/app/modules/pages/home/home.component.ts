// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ProjectCardComponent } from '@components/project-card/project-card.component';
import { Project, ProjectCard, ProjectCardMetric } from '@lfx-pcc/shared/interfaces';
import { ProjectService } from '@shared/services/project.service';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, of, startWith, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-home',
  imports: [InputTextComponent, ProjectCardComponent, AnimateOnScrollModule, SkeletonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  // 1. Injected services (readonly)
  private readonly projectService = inject(ProjectService);

  public form: FormGroup;
  public projectsLoading: WritableSignal<boolean>;
  public projects: Signal<Project[]>;
  public projectCards: Signal<ProjectCard[]>;
  public filteredProjects: Signal<ProjectCard[]>;
  public isSearching: WritableSignal<boolean>;

  public constructor() {
    this.form = this.initializeSearchForm();
    this.isSearching = signal(false);
    this.projectsLoading = signal(true);
    this.projects = this.initializeProjects();
    this.projectCards = this.initializeProjectCards();
    this.filteredProjects = this.initializeFilteredProjects();
  }

  public onClearSearch(): void {
    this.form.get('search')?.setValue('');
  }

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
      uid: project.uid,
      name: project.name,
      description: project.description,
      logo_url: project.logo_url,
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
    // Create search stream that responds to form changes
    const searchResults$ = this.form.get('search')!.valueChanges.pipe(
      startWith(''), // Start with empty search to load all projects initially
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((searchTerm: string) => {
        const trimmedTerm = searchTerm?.trim() || '';

        if (!trimmedTerm) {
          // If search is empty or too short, return all projects
          this.isSearching.set(false);
          return this.projectService.getProjects();
        }

        // Otherwise, search for projects
        this.isSearching.set(true);
        return this.projectService.searchProjects(trimmedTerm).pipe(tap(() => this.isSearching.set(false)));
      }),
      catchError((error) => {
        console.error('Error searching projects:', error);
        return of([]);
      }),
      tap(() => this.projectsLoading.set(false))
    );

    return toSignal(searchResults$, {
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
    return this.projectCards;
  }
}
