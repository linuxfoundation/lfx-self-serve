// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { ButtonComponent } from '@components/button/button.component';
import { MKTG_KIT_FILTERS, MKTG_KIT_FAMILIES } from '@lfx-one/shared/constants';
import { MktgKitFilter } from '@lfx-one/shared/interfaces';
import { MktgKitService } from '@services/mktg-kit.service';
import { MktgKitTabsComponent } from '../components/mktg-kit-tabs/mktg-kit-tabs.component';
import { MktgKitStatusComponent } from '../components/mktg-kit-status/mktg-kit-status.component';
import { MktgKitHeaderComponent } from '../components/mktg-kit-header/mktg-kit-header.component';

@Component({
  selector: 'lfx-mktg-kit',
  imports: [RouterLink, ButtonComponent, FilterPillsComponent, MktgKitHeaderComponent, MktgKitTabsComponent, MktgKitStatusComponent],
  providers: [MktgKitService],
  templateUrl: './mktg-kit.component.html',
})
export class MktgKitComponent {
  protected readonly kit = inject(MktgKitService);
  protected readonly filters = MKTG_KIT_FILTERS;
  protected readonly familyCount = MKTG_KIT_FAMILIES.length;
  protected readonly selectedFilter = signal<MktgKitFilter>('all');
  protected readonly cards = this.initCards();

  protected selectFilter(id: string): void {
    const filter = this.filters.find((option) => option.id === id);
    if (filter) this.selectedFilter.set(filter.id);
  }

  private initCards() {
    return computed(() =>
      this.kit.families().map((family) => ({
        ...family,
        rows: family.live ? family.rows.filter((row) => this.selectedFilter() === 'all' || row.state === this.selectedFilter()) : [],
        agentNames: family.family.leadSummary ?? family.agents.map((agent) => agent.name).join(', '),
      }))
    );
  }
}
