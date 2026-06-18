// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InitiativeBase, FilterPillOption } from '@lfx-one/shared/interfaces';
import { InitiativeCardComponent } from '../initiative-card/initiative-card.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-initiatives-list',
  imports: [ButtonComponent, CardComponent, EmptyStateComponent, FilterPillsComponent, InitiativeCardComponent],
  templateUrl: './initiatives-list.component.html',
  styleUrl: './initiatives-list.component.scss',
})
export class InitiativesListComponent {
  public readonly initiatives = input.required<InitiativeBase[]>();
  public readonly hasMore = input<boolean>(false);
  public readonly loadingMore = input<boolean>(false);
  public readonly initiativeClick = output<string>();
  public readonly loadMore = output<void>();

  private readonly userFilter = signal<'active' | 'pending' | 'archived' | null>(null);

  protected readonly activeFilter = computed<'active' | 'pending' | 'archived'>(() => {
    const pick = this.userFilter();
    if (pick !== null) return pick;
    const counts = this.statusCounts();
    if (counts.active === 0 && counts.pending > 0) return 'pending';
    if (counts.active === 0 && counts.pending === 0 && counts.archived > 0) return 'archived';
    return 'active';
  });

  protected readonly statusCounts = this.initStatusCounts();
  protected readonly filterOptions = this.initFilterOptions();
  protected readonly filteredInitiatives = computed(() => {
    const filter = this.activeFilter();
    return this.initiatives().filter((i) => {
      if (filter === 'active') return i.status === 'published';
      if (filter === 'pending') return i.status === 'pending' || i.status === 'submitted';
      return i.status === 'hidden' || i.status === 'declined';
    });
  });

  protected readonly emptyIcon = computed(() => {
    const filter = this.activeFilter();
    if (filter === 'archived') return 'fa-light fa-box-archive';
    if (filter === 'pending') return 'fa-light fa-hourglass';
    return 'fa-light fa-box-dollar';
  });

  protected readonly emptyTitle = computed(() => {
    const filter = this.activeFilter();
    if (filter === 'archived') return 'No archived initiatives';
    if (filter === 'pending') return 'No pending initiatives';
    return 'No active initiatives';
  });

  protected readonly emptySubtitle = computed(() => {
    const filter = this.activeFilter();
    if (filter === 'archived') return 'Hidden or declined initiatives will appear here.';
    if (filter === 'pending') return 'Initiatives awaiting review will appear here.';
    return 'Fundraising initiatives you publish will appear here.';
  });

  protected setFilter(value: string): void {
    if (value === 'active' || value === 'pending' || value === 'archived') {
      this.userFilter.set(value);
    }
  }

  protected onCardClick(slug: string): void {
    this.initiativeClick.emit(slug);
  }

  protected onLoadMore(): void {
    this.loadMore.emit();
  }

  private initStatusCounts(): Signal<{ active: number; pending: number; archived: number }> {
    return computed(() => {
      const all = this.initiatives();
      return {
        active: all.filter((i) => i.status === 'published').length,
        pending: all.filter((i) => i.status === 'pending' || i.status === 'submitted').length,
        archived: all.filter((i) => i.status === 'hidden' || i.status === 'declined').length,
      };
    });
  }

  private initFilterOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const counts = this.statusCounts();
      return [
        { id: 'active', label: `Active (${counts.active})` },
        { id: 'pending', label: `Pending (${counts.pending})` },
        { id: 'archived', label: `Archived (${counts.archived})` },
      ];
    });
  }
}
