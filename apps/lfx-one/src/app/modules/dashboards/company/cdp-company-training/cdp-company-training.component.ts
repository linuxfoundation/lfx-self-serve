// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, Signal } from '@angular/core';
import { CDP_COMPANY_HIDDEN_COUNT_LABEL } from '@lfx-one/shared/constants';
import type { StatCardItem } from '@lfx-one/shared/interfaces';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';

import { CdpCompanySectionFrameComponent } from '../components/cdp-company-section-frame/cdp-company-section-frame.component';
import { CdpCompanySectionLoader } from '../cdp-company-section.loader';

/**
 * CDP Training & Certification (spec 062 FR-029, FR-030): two totals, each withheld by the server under 5 people and
 * shown here as "Fewer than 5". Course and certification names are never shown (FR-018).
 */
@Component({
  selector: 'lfx-cdp-company-training',
  imports: [CdpCompanySectionFrameComponent, StatCardGridComponent],
  templateUrl: './cdp-company-training.component.html',
})
export class CdpCompanyTrainingComponent {
  protected readonly section = new CdpCompanySectionLoader('training');

  protected readonly cards: Signal<StatCardItem[]> = this.initCards();

  private initCards(): Signal<StatCardItem[]> {
    return computed((): StatCardItem[] => {
      const data = this.section.data();
      if (!data) return [];
      return [
        {
          value: this.countLabel(data.enrollments),
          label: 'Training enrollments',
          subLine: 'Last 5 years',
          icon: 'fa-light fa-graduation-cap',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: this.countLabel(data.certifications),
          label: 'Certifications',
          subLine: 'Last 5 years',
          icon: 'fa-light fa-certificate',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
        },
      ];
    });
  }

  private countLabel(count: number | undefined): string {
    return typeof count === 'number' ? count.toLocaleString('en-US') : CDP_COMPANY_HIDDEN_COUNT_LABEL;
  }
}
