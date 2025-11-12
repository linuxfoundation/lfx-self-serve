// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { BadgeComponent } from '@components/badge/badge.component';
import { ProjectSelectorComponent } from '@components/project-selector/project-selector.component';
import { Project, ProjectContext, SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { tap } from 'rxjs';

@Component({
  selector: 'lfx-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, BadgeComponent, ProjectSelectorComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);

  // Input properties
  public readonly items = input.required<SidebarMenuItem[]>();
  public readonly footerItems = input<SidebarMenuItem[]>([]);
  public readonly collapsed = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly showProjectSelector = input<boolean>(false);

  // Load all projects using toSignal
  protected readonly projects = toSignal(this.projectService.getProjects().pipe(tap(console.log)), {
    initialValue: [],
  });

  protected readonly selectedProject = computed(() => {
    const foundation = this.projectContextService.selectedFoundation();
    if (!foundation) {
      return null;
    }

    return this.projects().find((p: Project) => p.uid === foundation.projectId) || null;
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
   * Handle foundation project selection change
   */
  protected onProjectChange(project: Project): void {
    const projectContext: ProjectContext = {
      projectId: project.uid,
      name: project.name,
      slug: project.slug,
    };
    this.projectContextService.setFoundation(projectContext);
  }
}
