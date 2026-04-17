// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { MY_EVENT_STATUS_OPTIONS, VISA_REQUEST_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { EventTabId, FilterOption } from '@lfx-one/shared/interfaces';
import { Tooltip } from 'primeng/tooltip';
import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventsTopBarComponent } from '../components/events-top-bar/events-top-bar.component';
import { EventsListComponent } from './components/events-list/events-list.component';

@Component({
  selector: 'lfx-my-events-dashboard',
  imports: [CardComponent, DiscoverEventsButtonComponent, EventsTopBarComponent, EventsListComponent, Tooltip],
  templateUrl: './my-events-dashboard.component.html',
})
export class MyEventsDashboardComponent {
  protected readonly activeTab = signal<EventTabId>('upcoming');
  protected readonly selectedFoundation = signal<string | null>(null);
  protected readonly selectedRole = signal<string | null>(null);
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly selectedSearchQuery = signal('');

  protected readonly isPast = computed(() => this.activeTab() === 'past');

  /** True when the active tab uses request-style filters (no role, no foundation, different statuses). */
  protected readonly isRequestTab = computed(() => this.activeTab() === 'visa-letters' || this.activeTab() === 'travel-funding');

  protected readonly currentStatusOptions = computed<FilterOption[]>(() => (this.isRequestTab() ? VISA_REQUEST_STATUS_OPTIONS : MY_EVENT_STATUS_OPTIONS));

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
    // Reset all filters when switching tabs — each tab has different filter sets
    this.selectedFoundation.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }
}
