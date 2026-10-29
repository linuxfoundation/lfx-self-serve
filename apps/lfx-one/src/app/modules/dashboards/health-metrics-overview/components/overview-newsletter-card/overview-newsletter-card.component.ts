// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_CREATE_NEWSLETTER_LINK,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_FILL_CLASSES,
  HEALTH_METRICS_OVERVIEW_NEWSLETTER_AREA_FILL,
  HEALTH_METRICS_OVERVIEW_STROKES,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewNewsletterView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewNewsletterView } from '@lfx-one/shared/interfaces';

/** Newsletters sent in the period: the summary, each newsletter's open and click rate, and how engaged subscribers are. */
@Component({
  selector: 'lfx-overview-newsletter-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent],
  templateUrl: './overview-newsletter-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewNewsletterCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContext = inject(ProjectContextService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.newsletter;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.newsletter;
  protected readonly strokes = HEALTH_METRICS_OVERVIEW_STROKES;
  protected readonly fills = HEALTH_METRICS_OVERVIEW_FILL_CLASSES;
  protected readonly areaFill = HEALTH_METRICS_OVERVIEW_NEWSLETTER_AREA_FILL;
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewNewsletters({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewNewsletterView | null>(() => {
    const newsletters = this.read.data();
    return newsletters ? buildHealthMetricsOverviewNewsletterView(newsletters, this.chrome.selectedRange()) : null;
  });
  // A newsletter sent now counts toward the current year, so only YTD offers to write one.
  protected readonly isYtd = computed(() => this.chrome.selectedRange() === 'YTD');
  protected readonly createNewsletterLink = computed(() => ({
    ...HEALTH_METRICS_OVERVIEW_CREATE_NEWSLETTER_LINK,
    queryParams: { project: this.projectContext.selectedFoundation()?.slug ?? null },
  }));
}
