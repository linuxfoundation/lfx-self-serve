// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { FOUNDATION_EVENT_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventsTopBarComponent } from '../components/events-top-bar/events-top-bar.component';
import { EventsListComponent } from './components/events-list/events-list.component';

@Component({
  selector: 'lfx-foundation-event-dashboard',
  imports: [DiscoverEventsButtonComponent, EventsTopBarComponent, EventsListComponent],
  templateUrl: './foundation-event-dashboard.component.html',
  styleUrl: './foundation-event-dashboard.component.scss',
})
export class FoundationEventDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly foundationStatusOptions = FOUNDATION_EVENT_STATUS_OPTIONS;

  protected readonly selectedSearchQuery = signal('');
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly userFoundation = computed(() => this.projectContextService.selectedFoundation()?.name ?? null);

  protected onSearchQueryChange(value: string): void {
    this.selectedSearchQuery.set(value);
  }

  protected onStatusChange(value: string | null): void {
    this.selectedStatus.set(value);
  }
}
