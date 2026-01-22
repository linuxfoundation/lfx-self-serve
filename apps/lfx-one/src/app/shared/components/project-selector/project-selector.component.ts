// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { Project } from '@lfx-one/shared/interfaces';
import { AutoFocus } from 'primeng/autofocus';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';

import { TagComponent } from '../tag/tag.component';

@Component({
  selector: 'lfx-project-selector',
  imports: [PopoverModule, ButtonComponent, InputTextModule, FormsModule, AutoFocus, TagComponent],
  templateUrl: './project-selector.component.html',
  styleUrl: './project-selector.component.scss',
})
export class ProjectSelectorComponent {
  public readonly projects = input.required<Project[]>();
  public readonly selectedProject = input<Project | null>(null);

  public readonly projectChange = output<Project>();

  protected readonly searchQuery = signal<string>('');

  protected readonly displayName = this.initializeDisplayName();
  protected readonly displayLogo = this.initializeDisplayLogo();
  protected readonly foundations = this.initializeFoundations();
  protected readonly childProjectsMap = this.initializeChildProjectsMap();
  protected readonly hasResults = this.initializeHasResults();

  protected selectProject(project: Project, popover: Popover): void {
    this.projectChange.emit(project);
    this.searchQuery.set(''); // Reset search on selection
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }

  protected onPopoverHide(): void {
    // Reset search when popover closes
    this.searchQuery.set('');
  }

  private initializeDisplayName() {
    return computed(() => {
      const project = this.selectedProject();
      return project?.name?.trim() ?? 'Select Project';
    });
  }

  private initializeDisplayLogo() {
    return computed(() => {
      const project = this.selectedProject();
      return project?.logo_url || '';
    });
  }

  private initializeFoundations() {
    return computed(() => {
      const allProjects = this.projects();
      const query = this.searchQuery().toLowerCase().trim();

      // Create a set of all valid project UIDs for quick lookup
      const validProjectIds = new Set(allProjects.map((p) => p.uid));

      // A project is a foundation if:
      // 1. It has no parent_uid OR
      // 2. Its parent_uid doesn't exist in the projects list
      const foundationList = allProjects.filter((p) => !p.parent_uid || p.parent_uid === '' || !validProjectIds.has(p.parent_uid));

      // Apply search filter if query exists
      if (!query) {
        return foundationList;
      }

      // Filter foundations that match the query
      const matchingFoundations = foundationList.filter((f) => f.name.toLowerCase().includes(query) || f.description.toLowerCase().includes(query));

      // Find foundations whose children match the query
      const foundationsWithMatchingChildren = foundationList.filter((foundation) => {
        const children = allProjects.filter(
          (p) =>
            p.parent_uid === foundation.uid &&
            validProjectIds.has(p.parent_uid) &&
            (p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query))
        );
        return children.length > 0;
      });

      // Combine and deduplicate using Set
      const uniqueFoundations = new Map<string, Project>();
      [...matchingFoundations, ...foundationsWithMatchingChildren].forEach((f) => {
        uniqueFoundations.set(f.uid, f);
      });

      return Array.from(uniqueFoundations.values());
    });
  }

  private initializeChildProjectsMap() {
    return computed(() => {
      const allProjects = this.projects();
      const query = this.searchQuery().toLowerCase().trim();

      // Create a set of all valid project UIDs for quick lookup
      const validProjectIds = new Set(allProjects.map((p) => p.uid));

      const map = new Map<string, Project[]>();

      // Group projects by parent_uid
      // Only include projects whose parent_uid exists in the projects list
      allProjects.forEach((project) => {
        if (project.parent_uid && project.parent_uid !== '' && validProjectIds.has(project.parent_uid)) {
          const children = map.get(project.parent_uid) || [];
          children.push(project);
          map.set(project.parent_uid, children);
        }
      });

      // If no search query, return the full map
      if (!query) {
        return map;
      }

      // Filter children by search query
      const filteredMap = new Map<string, Project[]>();
      map.forEach((children, parentId) => {
        const filtered = children.filter((c) => c.name.toLowerCase().includes(query) || c.description.toLowerCase().includes(query));
        if (filtered.length > 0) {
          filteredMap.set(parentId, filtered);
        }
      });

      return filteredMap;
    });
  }

  private initializeHasResults() {
    return computed(() => {
      return this.foundations().length > 0;
    });
  }
}
