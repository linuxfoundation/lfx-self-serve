// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, linkedSignal, signal, viewChild, WritableSignal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { OCG_MEETUP_BASE_URL } from '@lfx-one/shared/constants';
import { FilterPillOption, MeetupTabId } from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';

import { MeetupsListComponent } from './components/meetups-list/meetups-list.component';
import { MeetupsTopBarComponent } from './components/meetups-top-bar/meetups-top-bar.component';

@Component({
  selector: 'lfx-meetups-dashboard',
  imports: [ButtonComponent, CardComponent, CardTabsBarComponent, MeetupsListComponent, MeetupsTopBarComponent, TooltipModule],
  templateUrl: './meetups-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetupsDashboardComponent {
  private readonly meetupsListRef = viewChild(MeetupsListComponent);

  protected readonly activeTab = signal<MeetupTabId>('upcoming');

  protected readonly selectedRole = signal<string | null>(null);

  protected readonly selectedSearchQuery = signal('');

  protected readonly tabOptions: FilterPillOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  protected readonly discoverUrl = OCG_MEETUP_BASE_URL;
  protected readonly isPast = computed(() => this.activeTab() === 'past');
  protected readonly upcomingRegisteredOnly = computed(() =>
    this.activeTab() === 'upcoming' ? (this.meetupsListRef()?.upcomingRegisteredOnly() ?? null) : false
  );
  protected readonly selectedCommunity = this.initSelectedCommunity();
  /** Delegates to MeetupsListComponent - lifted here to avoid template forward-reference issues. */
  protected readonly showFiltersBar = computed(() => this.meetupsListRef()?.showFiltersBar() ?? true);

  protected onActiveTabChange(tab: string): void {
    this.activeTab.set(tab as MeetupTabId);
    // Reset all filters when switching tabs - each tab has different filter sets
    this.selectedCommunity.set(null);
    this.selectedRole.set(null);

    this.selectedSearchQuery.set('');
  }

  protected onCommunityChange(value: string | null): void {
    this.selectedCommunity.set(value);
  }

  protected onRoleChange(value: string | null): void {
    this.selectedRole.set(value);
  }

  protected onSearchQueryChange(value: string): void {
    this.selectedSearchQuery.set(value);
  }

  protected resetFilters(): void {
    this.selectedCommunity.set(null);
    this.selectedRole.set(null);

    this.selectedSearchQuery.set('');
  }

  private initSelectedCommunity(): WritableSignal<string | null> {
    return linkedSignal({
      source: () => ({ tab: this.activeTab(), registeredOnly: this.upcomingRegisteredOnly() }),
      computation: () => null,
    });
  }
}
