// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
  HEALTH_METRICS_OVERVIEW_STROKES,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewNpsView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';

import type { HealthMetricsOverviewNpsView } from '@lfx-one/shared/interfaces';

/** The Board audience's Net Promoter Score on the design's 240° gauge, with the response split under it. */
@Component({
  selector: 'lfx-overview-nps-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent],
  templateUrl: './overview-nps-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewNpsCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.nps;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.nps;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.nps;
  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewNps({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewNpsView | null>(() => {
    const nps = this.read.data();
    return nps ? buildHealthMetricsOverviewNpsView(nps, this.chrome.selectedRange()) : null;
  });
}
