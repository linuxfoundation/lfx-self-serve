// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { PersonaSelectorComponent } from '@components/persona-selector/persona-selector.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { Project, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { tap } from 'rxjs';

@Component({
  selector: 'lfx-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, BadgeComponent, PersonaSelectorComponent, ProjectSelectorComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);

  // Input properties
  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);

  // Feature flags
  protected readonly showRoleSelector = this.featureFlagService.getBooleanFlag('role-selector', true);

  // Load all projects using toSignal with tap to set default
  protected readonly projects = toSignal(
    this.projectService.getProjects().pipe(
      tap((loadedProjects: Project[]) => {
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

  // Computed items
  protected readonly itemsWithTestIds = computed(() =>
    this.items().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
    }))
  );

  protected readonly footerItemsWithTestIds = computed(() =>
    this.footerItems().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
    }))
  );

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
}
