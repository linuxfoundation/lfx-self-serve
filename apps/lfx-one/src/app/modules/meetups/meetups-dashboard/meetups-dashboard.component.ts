// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { MEETUP_STATUS_OPTIONS } from '@lfx-one/shared/constants';
import { FilterPillOption, MeetupTabId } from '@lfx-one/shared/interfaces';

import { MeetupsListComponent } from './components/meetups-list/meetups-list.component';
import { MeetupsTopBarComponent } from './components/meetups-top-bar/meetups-top-bar.component';

@Component({
  selector: 'lfx-meetups-dashboard',
  imports: [CardComponent, CardTabsBarComponent, MeetupsListComponent, MeetupsTopBarComponent],
  templateUrl: './meetups-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetupsDashboardComponent {
  private readonly meetupsListRef = viewChild(MeetupsListComponent);

  protected readonly activeTab = signal<MeetupTabId>('upcoming');
  protected readonly selectedCommunity = signal<string | null>(null);
  protected readonly selectedRole = signal<string | null>(null);
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly selectedSearchQuery = signal('');

  protected readonly tabOptions: FilterPillOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  protected readonly statusOptions = MEETUP_STATUS_OPTIONS;
  protected readonly isPast = computed(() => this.activeTab() === 'past');
  protected readonly showStatusFilter = computed(() => !this.isPast());
  /** Delegates to MeetupsListComponent - lifted here to avoid template forward-reference issues. */
  protected readonly showFiltersBar = computed(() => this.meetupsListRef()?.showFiltersBar() ?? true);

  protected onActiveTabChange(tab: string): void {
    this.activeTab.set(tab as MeetupTabId);
    // Reset all filters when switching tabs - each tab has different filter sets
    this.selectedCommunity.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }

  protected onCommunityChange(value: string | null): void {
    this.selectedCommunity.set(value);
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

  protected resetFilters(): void {
    this.selectedCommunity.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }
}
