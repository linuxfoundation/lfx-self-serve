// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { HttpParams } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import { Project, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-sidebar',
  imports: [NgClass, NgTemplateOutlet, RouterModule, BadgeComponent, ProjectSelectorComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);

  // Input properties
  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);

  // Load TLF project and its children, merging into a single array
  protected readonly projects = toSignal(
    // TODO: DEMO - Remove this once we are done with the demo and will use typeahead search
    this.projectService.getProject('tlf').pipe(
      distinctUntilChanged(),
      switchMap((tlfProject: Project | null) => {
        if (!tlfProject) {
          return of([]);
        }
        return this.projectService
          .getProjects(new HttpParams().set('tags', `parent_uid:${tlfProject.uid}`))
          .pipe(map((childProjects: Project[]) => [tlfProject, ...childProjects]));
      }),
      tap((loadedProjects: Project[]) => {
        this.projectContextService.availableProjects = loadedProjects;
        const currentFoundation = this.projectContextService.selectedFoundation();
        const currentProject = this.projectContextService.selectedProject();
        const foundationExists = loadedProjects.some((p: Project) => p.uid === currentFoundation?.uid);

        // Only set default if no foundation is selected, no project is selected, and projects exist
        if (loadedProjects.length > 0 && (!foundationExists || !currentFoundation) && !currentProject) {
          // Prefer "tlf" project, fallback to first available project
          const defaultProject = loadedProjects.find((p: Project) => p.slug === 'tlf') || loadedProjects[0];

          const projectContext: ProjectContext = {
            uid: defaultProject.uid,
            name: defaultProject.name,
            slug: defaultProject.slug,
          };
          this.projectContextService.setFoundation(projectContext);
        }
      })
    ),
    {
      initialValue: [],
    }
  );

  // TODO: DEMO - Remove this once we have proper project permissions
  public readonly isBoardMember = computed(() => this.personaService.currentPersona() === 'board-member');
  protected readonly foundationProjects = computed(() => this.projects().filter((p: Project) => (this.isBoardMember() ? p.slug === 'tlf' : true)));

  protected readonly selectedProject = computed(() => {
    // First check if a specific project is selected (child project)
    const project = this.projectContextService.selectedProject();
    if (project) {
      return this.projects().find((p: Project) => p.slug === project.slug) || null;
    }

    // Otherwise check for foundation selection
    const foundation = this.projectContextService.selectedFoundation();
    if (!foundation) {
      return null;
    }

    // TODO: DEMO - Remove when proper permissions are implemented
    if (this.isBoardMember()) {
      return this.foundationProjects().find((p: Project) => p.slug === 'tlf') || null;
    }

    return this.projects().find((p: Project) => p.slug === foundation.slug) || null;
  });

  // Section expanded state tracking - uses section labels as keys
  protected readonly sectionExpandedState = signal<Record<string, boolean>>({});

  // Computed items with test IDs, section state, isExpanded property, and external flag
  protected readonly itemsWithTestIds = computed(() =>
    this.items().map((item) => {
      const expandedState = this.sectionExpandedState();
      const defaultExpanded = item.expanded !== false;
      const isExpanded = expandedState[item.label] ?? defaultExpanded;

      return {
        ...item,
        testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
        isExpanded,
        external: item.url ? this.isExternalUrl(item.url) : undefined,
        items: item.items?.map((childItem) => ({
          ...childItem,
          testId: childItem.testId || `sidebar-item-${childItem.label.toLowerCase().replace(/\s+/g, '-')}`,
          external: childItem.url ? this.isExternalUrl(childItem.url) : undefined,
        })),
      };
    })
  );

  protected readonly footerItemsWithTestIds = computed(() =>
    this.footerItems().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      external: item.url ? this.isExternalUrl(item.url) : undefined,
    }))
  );

  /**
   * Toggle section expanded state
   */
  protected onSectionToggle(sectionLabel: string, currentExpanded: boolean): void {
    this.sectionExpandedState.update((state) => ({
      ...state,
      [sectionLabel]: !currentExpanded,
    }));
  }

  /**
   * Handle project selection change - distinguish between foundation and non-foundation projects
   */
  protected onProjectChange(project: Project): void {
    const allProjects = this.projects();
    const validProjectIds = new Set(allProjects.map((p) => p.uid));

    // Determine if this is a foundation project (no parent or parent doesn't exist)
    const isFoundation = !project.parent_uid || project.parent_uid === '' || !validProjectIds.has(project.parent_uid);

    const projectContext: ProjectContext = {
      uid: project.uid,
      name: project.name,
      slug: project.slug,
    };

    if (isFoundation) {
      // Foundation project selected - set as foundation and clear selected project
      this.projectContextService.setFoundation(projectContext);
      this.projectContextService.clearProject();
    } else {
      // Child project selected - set as selected project and clear foundation
      this.projectContextService.setProject(projectContext);
      this.projectContextService.clearFoundation();
    }
  }

  /**
   * Handle logo click - navigate to home/overview
   */
  protected onLogoClick(): void {
    // Navigate to home page
    window.location.href = '/';
  }

  /**
   * Determine if a URL is external (not starting with environment home URL and is absolute)
   * A URL is considered external if it starts with http:// or https:// and does NOT start with the home URL
   * Relative URLs (starting with /) are always internal
   */
  private isExternalUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    // Relative URLs are internal
    if (url.startsWith('/')) {
      return false;
    }

    // Check if it's an absolute URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // External if it doesn't start with the home URL
      return !url.startsWith(environment.urls.home);
    }

    return false;
  }
}
