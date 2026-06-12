// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InitiativeBase, FilterPillOption } from '@lfx-one/shared/interfaces';
import { InitiativeCardComponent } from '../initiative-card/initiative-card.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-initiatives-list',
  imports: [ButtonComponent, CardComponent, FilterPillsComponent, InitiativeCardComponent],
  templateUrl: './initiatives-list.component.html',
  styleUrl: './initiatives-list.component.scss',
})
export class InitiativesListComponent {
  public readonly initiatives = input.required<InitiativeBase[]>();
  public readonly hasMore = input<boolean>(false);
  public readonly loadingMore = input<boolean>(false);
  public readonly initiativeClick = output<string>();
  public readonly loadMore = output<void>();

  protected readonly activeFilter = signal<'active' | 'pending' | 'archived'>('active');

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

  protected setFilter(value: string): void {
    if (value === 'active' || value === 'pending' || value === 'archived') {
      this.activeFilter.set(value);
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
