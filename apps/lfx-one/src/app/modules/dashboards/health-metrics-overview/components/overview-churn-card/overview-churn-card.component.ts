// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY, HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewChurnView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewChurnView } from '@lfx-one/shared/interfaces';

/** The foundation's churn against last year, then every tier against the overall rate. */
@Component({
  selector: 'lfx-overview-churn-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-churn-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewChurnCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.churn;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.churn;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.churn;
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewChurn({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewChurnView | null>(() => {
    const data = this.read.data();
    return data ? buildHealthMetricsOverviewChurnView(data, this.chrome.selectedRange()) : null;
  });
}
