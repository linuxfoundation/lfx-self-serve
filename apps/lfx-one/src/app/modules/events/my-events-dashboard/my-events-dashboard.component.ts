// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { TagComponent } from '@app/shared/components/tag/tag.component';
import { PersonaService } from '@app/shared/services/persona.service';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { LINKS_CONFIG } from '@lfx-one/shared/constants';
import { EventTabId } from '@lfx-one/shared/interfaces';
import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventsTopBarComponent } from '../components/events-top-bar/events-top-bar.component';
import { EventsInfoBannersComponent } from './components/events-info-banners/events-info-banners.component';
import { EventsListComponent } from './components/events-list/events-list.component';

@Component({
  selector: 'lfx-my-events-dashboard',
  imports: [TagComponent, DiscoverEventsButtonComponent, EventsTopBarComponent, EventsInfoBannersComponent, EventsListComponent],
  templateUrl: './my-events-dashboard.component.html',
  styleUrl: './my-events-dashboard.component.scss',
})
export class MyEventsDashboardComponent {
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly linksConfig = LINKS_CONFIG;

  protected readonly activeTab = signal<EventTabId>('upcoming');
  protected readonly isPast = computed(() => this.activeTab() === 'past');

  protected readonly selectedFoundation = signal<string | null>(null);
  protected readonly selectedRole = signal<string | null>(null);
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly selectedSearchQuery = signal('');

  protected readonly foundationLabel: Signal<string> = this.initFoundationLabel();

  protected onFoundationChange(value: string | null): void {
    this.selectedFoundation.set(value);
  }

  protected onRoleChange(value: string | null): void {
    this.selectedRole.set(value);
  }

  protected onStatusChange(value: string | null): void {
    this.selectedStatus.set(value);
  }

  protected onSearchQueryChange(value: string): void {
    this.selectedSearchQuery.set(value);
  }

  protected onActiveTabChange(tab: EventTabId): void {
    this.activeTab.set(tab);
    // Reset foundation filter when switching tabs — each tab has a different foundation list
    this.selectedFoundation.set(null);
  }

  private initFoundationLabel(): Signal<string> {
    return computed(() => {
      if (this.personaService.multiFoundation() || this.personaService.multiProject()) {
        return 'Cross-foundation';
      }

      // Board-scoped persona (board member / executive director) — use the selected foundation directly
      if (this.personaService.isBoardScoped()) {
        const foundation = this.projectContextService.selectedFoundation();
        return foundation?.name ?? 'Cross-foundation';
      }

      const projects = this.projectContextService.availableProjects();
      const selectedProject = this.projectContextService.selectedProject();
      if (selectedProject) {
        const fullProject = projects.find((p) => p.uid === selectedProject.uid);
        if (fullProject?.parent_uid) {
          const parentFoundation = projects.find((p) => p.uid === fullProject.parent_uid);
          if (parentFoundation) {
            return parentFoundation.name;
          }
        }
      }

      // The sidebar may assign selectedFoundation to a sub-project when its parent foundation is not
      // in the user's available projects. Try to resolve the parent before falling back to the name.
      const foundation = this.projectContextService.selectedFoundation();
      if (foundation) {
        const fullProject = projects.find((p) => p.uid === foundation.uid);
        if (fullProject?.parent_uid) {
          const parentFoundation = projects.find((p) => p.uid === fullProject.parent_uid);
          if (parentFoundation) {
            return parentFoundation.name;
          }
        }
        return foundation.name;
      }

      return 'Cross-foundation';
    });
  }
}
