// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewCodeView, buildLensAwareInsightsUrl } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewCodeView } from '@lfx-one/shared/interfaces';

/** Contributors in the period and the all-time roles; the detail lives in LFX Insights. */
@Component({
  selector: 'lfx-overview-code-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-code-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewCodeCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.code;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.code;
  protected readonly insightsUrl = computed(() => buildLensAwareInsightsUrl(this.projectContextService.selectedFoundation()?.slug, true));
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewCode({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewCodeView | null>(() => {
    const code = this.read.data();
    return code ? buildHealthMetricsOverviewCodeView(code, this.chrome.selectedRange()) : null;
  });
}
