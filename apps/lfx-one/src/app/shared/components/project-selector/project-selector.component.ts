// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { EnrichedPersonaProject } from '@lfx-one/shared/interfaces';
import { isFoundationProject } from '@lfx-one/shared/utils';
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
  public readonly projects = input.required<EnrichedPersonaProject[]>();
  public readonly selectedProject = input<EnrichedPersonaProject | null>(null);

  public readonly projectChange = output<EnrichedPersonaProject>();

  protected readonly searchQuery = signal<string>('');

  private readonly validProjectIds = computed(() => new Set(this.projects().map((p) => p.projectUid)));
  protected readonly displayName = this.initializeDisplayName();
  protected readonly displayLogo = this.initializeDisplayLogo();
  protected readonly foundations = this.initializeFoundations();
  protected readonly childProjectsMap = this.initializeChildProjectsMap();
  protected readonly hasResults = this.initializeHasResults();

  protected selectProject(project: EnrichedPersonaProject, popover: Popover): void {
    this.projectChange.emit(project);
    this.searchQuery.set('');
    popover.hide();
  }

  protected togglePanel(event: Event, popover: Popover): void {
    popover.toggle(event);
  }

  protected onPopoverHide(): void {
    this.searchQuery.set('');
  }

  private initializeDisplayName() {
    return computed(() => {
      const project = this.selectedProject();
      return project?.projectName?.trim() || 'Select Project';
    });
  }

  private initializeDisplayLogo() {
    return computed(() => {
      const project = this.selectedProject();
      return project?.logoUrl || '';
    });
  }

  private initializeFoundations() {
    return computed(() => {
      const allProjects = this.projects();
      const query = this.searchQuery().toLowerCase().trim();
      const ids = this.validProjectIds();

      const foundationList = allProjects.filter((p) => isFoundationProject(p, ids));

      if (!query) {
        return foundationList;
      }

      const matchingFoundations = foundationList.filter((f) => f.projectName?.toLowerCase().includes(query) || f.description?.toLowerCase().includes(query));

      const foundationsWithMatchingChildren = foundationList.filter((foundation) => {
        const children = allProjects.filter(
          (p) => p.parentProjectUid === foundation.projectUid && (p.projectName?.toLowerCase().includes(query) || p.description?.toLowerCase().includes(query))
        );
        return children.length > 0;
      });

      const uniqueFoundations = new Map<string, EnrichedPersonaProject>();
      [...matchingFoundations, ...foundationsWithMatchingChildren].forEach((f) => {
        uniqueFoundations.set(f.projectUid, f);
      });

      return Array.from(uniqueFoundations.values());
    });
  }

  private initializeChildProjectsMap() {
    return computed(() => {
      const allProjects = this.projects();
      const query = this.searchQuery().toLowerCase().trim();
      const ids = this.validProjectIds();

      const map = new Map<string, EnrichedPersonaProject[]>();

      allProjects.forEach((project) => {
        if (!isFoundationProject(project, ids) && project.parentProjectUid) {
          const children = map.get(project.parentProjectUid) || [];
          children.push(project);
          map.set(project.parentProjectUid, children);
        }
      });

      if (!query) {
        return map;
      }

      const filteredMap = new Map<string, EnrichedPersonaProject[]>();
      map.forEach((children, parentId) => {
        const filtered = children.filter((c) => c.projectName?.toLowerCase().includes(query) || c.description?.toLowerCase().includes(query));
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
