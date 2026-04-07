// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { BadgeComponent } from '@components/badge/badge.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { environment } from '@environments/environment';
import { PERSONA_OPTIONS } from '@lfx-one/shared/constants';
import { Project, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { tap } from 'rxjs';

@Component({
  selector: 'lfx-sidebar',
  imports: [NgClass, NgTemplateOutlet, RouterModule, AvatarComponent, BadgeComponent, ProjectSelectorComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly personaService = inject(PersonaService);
  private readonly lensService = inject(LensService);
  private readonly userService = inject(UserService);

  // Input properties
  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);
  public readonly showMeSelector = input<boolean>(false);
  public readonly mobile = input<boolean>(false);

  // Load all available projects
  // so TransferState never captures it and client makes a duplicate call anyway.
  // shareReplay(1) in ProjectService deduplicates within the client runtime.
  protected readonly projects: Signal<Project[]> = this.initProjects();

  /** Projects passed to the selector — single item triggers read-only, full list triggers dropdown */
  protected readonly selectorProjects = this.initSelectorProjects();

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

    return this.projects().find((p: Project) => p.slug === foundation.slug) || null;
  });

  // Me selector signals
  protected readonly user = this.userService.user;
  protected readonly userInitials = this.userService.userInitials;
  protected readonly personaLabel: Signal<string> = this.initPersonaLabel();

  // Computed items with test IDs, external flag
  protected readonly itemsWithTestIds = computed(() =>
    this.items().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      external: item.url ? this.isExternalUrl(item.url) : undefined,
      items: item.items?.map((childItem) => ({
        ...childItem,
        testId: childItem.testId || `sidebar-item-${childItem.label.toLowerCase().replace(/\s+/g, '-')}`,
        external: childItem.url ? this.isExternalUrl(childItem.url) : undefined,
      })),
    }))
  );

  protected readonly footerItemsWithTestIds = computed(() =>
    this.footerItems().map((item) => ({
      ...item,
      testId: item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
      external: item.url ? this.isExternalUrl(item.url) : undefined,
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

  private initProjects(): Signal<Project[]> {
    return toSignal(
      this.projectService.getProjects().pipe(
        tap((loadedProjects: Project[]) => {
          this.projectContextService.availableProjects = loadedProjects;
          const currentFoundation = this.projectContextService.selectedFoundation();
          const currentProject = this.projectContextService.selectedProject();
          const foundationExists = loadedProjects.some((p: Project) => p.uid === currentFoundation?.uid);

          if (loadedProjects.length > 0 && (!foundationExists || !currentFoundation) && !currentProject) {
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
  }

  private initPersonaLabel(): Signal<string> {
    return computed(() => {
      const persona = this.personaService.currentPersona();
      const option = PERSONA_OPTIONS.find((o) => o.value === persona);
      return option?.label ?? persona;
    });
  }

  private initSelectorProjects(): Signal<Project[]> {
    return computed(() => {
      const all = this.projects();
      if (all.length === 0) {
        return all;
      }

      const activeLens = this.lensService.activeLens();

      // Determine if the current lens has multi-access
      const hasMultiAccess = activeLens === 'foundation' ? this.personaService.multiFoundation() : this.personaService.multiProject();

      if (!hasMultiAccess) {
        // Single access — pass only the selected project for read-only display
        const selected = this.selectedProject();
        return selected ? [selected] : [all[0]];
      }

      return all;
    });
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
