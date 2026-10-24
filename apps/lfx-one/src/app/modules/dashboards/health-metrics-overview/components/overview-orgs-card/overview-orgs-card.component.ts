// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY, HEALTH_METRICS_OVERVIEW_STROKES } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewOrgsView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewParticipatingOrgsView } from '@lfx-one/shared/interfaces';

/** Members and non-members side by side, each with its KPIs and engagement donut. */
@Component({
  selector: 'lfx-overview-orgs-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-orgs-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewOrgsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.orgs;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.orgs;
  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewParticipatingOrgs({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewParticipatingOrgsView | null>(() => {
    const orgs = this.read.data();
    return orgs ? buildHealthMetricsOverviewOrgsView(orgs, this.chrome.selectedRange()) : null;
  });
}
