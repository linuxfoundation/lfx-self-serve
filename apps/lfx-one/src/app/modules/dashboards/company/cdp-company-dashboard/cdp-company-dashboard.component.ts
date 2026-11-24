// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, Signal } from '@angular/core';
import type { StatCardGridColumns, StatCardItem } from '@lfx-one/shared/interfaces';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';
import { formatCdpCompanyMonth } from '../cdp-company.util';

/** CDP Dashboard (spec 062 FR-018, FR-019): two-year totals over every project Insights shows, the last active month and the top project. */
@Component({
  selector: 'lfx-cdp-company-dashboard',
  imports: [CdpCompanySectionFrameComponent, StatCardGridComponent],
  templateUrl: './cdp-company-dashboard.component.html',
})
export class CdpCompanyDashboardComponent {
  protected readonly section = new CdpCompanySectionLoader('dashboard');

  protected readonly cards: Signal<StatCardItem[]> = this.initCards();
  protected readonly columns: Signal<StatCardGridColumns> = computed(() => (this.cards().length === 4 ? 4 : 3));

  private initCards(): Signal<StatCardItem[]> {
    return computed((): StatCardItem[] => {
      const data = this.section.data();
      if (!data) return [];
      const cards: StatCardItem[] = [
        {
          value: data.contributors730d.toLocaleString('en-US'),
          label: 'Contributors',
          subLine: 'Last 2 years',
          icon: 'fa-light fa-people-group',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: data.activities730d.toLocaleString('en-US'),
          label: 'Activities',
          subLine: 'Last 2 years',
          icon: 'fa-light fa-code-commit',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
        },
        {
          value: formatCdpCompanyMonth(data.lastActiveMonth) ?? 'Unknown',
          label: 'Last active',
          icon: 'fa-light fa-calendar-clock',
          iconContainerClass: 'bg-gray-200 text-gray-500',
        },
      ];
      if (data.topProjectName) {
        cards.push({ value: data.topProjectName, label: 'Top project', icon: 'fa-light fa-star', iconContainerClass: 'bg-violet-100 text-violet-600' });
      }
      return cards;
    });
  }
}
