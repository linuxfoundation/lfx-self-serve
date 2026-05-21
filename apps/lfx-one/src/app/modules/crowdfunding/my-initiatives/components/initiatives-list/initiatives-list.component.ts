// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal, Signal } from '@angular/core';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { CrowdfundingInitiative, CrowdfundingInitiativeStatus, FilterPillOption } from '@lfx-one/shared/interfaces';
import { InitiativeCardComponent } from '../initiative-card/initiative-card.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-initiatives-list',
  imports: [CardComponent, FilterPillsComponent, InitiativeCardComponent],
  templateUrl: './initiatives-list.component.html',
  styleUrl: './initiatives-list.component.scss',
})
export class InitiativesListComponent {
  public readonly initiatives = input.required<CrowdfundingInitiative[]>();
  public readonly initiativeClick = output<string>();

  protected readonly activeFilter = signal<CrowdfundingInitiativeStatus>('active');

  protected readonly statusCounts = this.initStatusCounts();
  protected readonly filterOptions = this.initFilterOptions();
  protected readonly filteredInitiatives = computed(() => this.initiatives().filter((i) => i.status === this.activeFilter()));

  protected setFilter(status: string): void {
    this.activeFilter.set(status as CrowdfundingInitiativeStatus);
  }

  protected onCardClick(id: string): void {
    this.initiativeClick.emit(id);
  }

  private initStatusCounts(): Signal<{ active: number; pending: number; closed: number }> {
    return computed(() => {
      const all = this.initiatives();
      return {
        active: all.filter((i) => i.status === 'active').length,
        pending: all.filter((i) => i.status === 'pending').length,
        closed: all.filter((i) => i.status === 'closed').length,
      };
    });
  }

  private initFilterOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const counts = this.statusCounts();
      return [
        { id: 'active', label: `Active (${counts.active})` },
        { id: 'pending', label: `Pending (${counts.pending})` },
        { id: 'closed', label: `Closed (${counts.closed})` },
      ];
    });
  }
}
