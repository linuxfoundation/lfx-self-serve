// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY, HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewBalanceView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';

import type { HealthMetricsOverviewBalanceView } from '@lfx-one/shared/interfaces';

/** Overdue membership invoices today, split into the high and medium risk bands; the same in every period. */
@Component({
  selector: 'lfx-overview-balance-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent],
  templateUrl: './overview-balance-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewBalanceCardComponent {
  private readonly analyticsService = inject(AnalyticsService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.balance;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.balance;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.balance;
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewOutstandingBalance({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewBalanceView | null>(() => {
    const data = this.read.data();
    return data ? buildHealthMetricsOverviewBalanceView(data) : null;
  });
}
