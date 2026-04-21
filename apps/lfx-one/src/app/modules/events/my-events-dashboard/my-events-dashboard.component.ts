// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal, viewChild } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { MY_EVENT_STATUS_OPTIONS, VISA_REQUEST_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { EventTabId, FilterOption, FilterPillOption } from '@lfx-one/shared/interfaces';
import { Tooltip } from 'primeng/tooltip';
import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventsTopBarComponent } from '../components/events-top-bar/events-top-bar.component';
import { EventsListComponent } from './components/events-list/events-list.component';

@Component({
  selector: 'lfx-my-events-dashboard',
  imports: [ButtonComponent, CardComponent, CardTabsBarComponent, DiscoverEventsButtonComponent, EventsTopBarComponent, EventsListComponent, Tooltip],
  templateUrl: './my-events-dashboard.component.html',
})
export class MyEventsDashboardComponent {
  private readonly eventsListRef = viewChild(EventsListComponent);

  protected readonly activeTab = signal<EventTabId>('upcoming');

  protected readonly tabOptions: FilterPillOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
    { id: 'visa-letters', label: 'Visa Letters' },
    { id: 'travel-funding', label: 'Travel Funding' },
  ];
  protected readonly selectedFoundation = signal<string | null>(null);
  protected readonly selectedRole = signal<string | null>(null);
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly selectedSearchQuery = signal('');

  protected readonly isPast = computed(() => this.activeTab() === 'past');

  /** True when the active tab uses request-style filters (no role, no foundation, different statuses). */
  protected readonly isRequestTab = computed(() => this.activeTab() === 'visa-letters' || this.activeTab() === 'travel-funding');

  protected readonly currentStatusOptions = computed<FilterOption[]>(() => (this.isRequestTab() ? VISA_REQUEST_STATUS_OPTIONS : MY_EVENT_STATUS_OPTIONS));

  protected readonly searchPlaceholder = computed(() => {
    if (this.activeTab() === 'visa-letters') return 'Search visa letters...';
    if (this.activeTab() === 'travel-funding') return 'Search travel funding...';
    return 'Search events...';
  });

  protected readonly requestButtonLabel = computed(() => (this.activeTab() === 'visa-letters' ? 'New Letter Application' : 'New Funding Application'));

  /** Delegates to EventsListComponent — lifted here to avoid template forward-reference issues. */
  protected readonly showFiltersBar = computed(() => this.eventsListRef()?.showFiltersBar() ?? true);
  protected readonly eventsStatsLoading = computed(() => this.eventsListRef()?.eventsStatsLoading() ?? true);
  protected readonly registeredCount = computed(() => this.eventsListRef()?.registeredCount() ?? 0);
  protected readonly attendedCount = computed(() => this.eventsListRef()?.attendedCount() ?? 0);
  protected readonly nextEventName = computed(() => this.eventsListRef()?.nextEventName() ?? '');
  protected readonly upcomingCount = computed(() => this.eventsListRef()?.tabCounts().upcoming ?? 0);

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

  protected onActiveTabChange(tab: string): void {
    this.activeTab.set(tab as EventTabId);
    // Reset all filters when switching tabs — each tab has different filter sets
    this.selectedFoundation.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }

  protected openCurrentRequestDialog(): void {
    this.eventsListRef()?.openCurrentRequestDialog();
  }

  protected resetFilters(): void {
    this.selectedFoundation.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }
}
