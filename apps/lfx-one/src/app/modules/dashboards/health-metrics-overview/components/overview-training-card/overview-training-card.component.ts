// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY, HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewTrainingView } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';

import type { HealthMetricsOverviewTrainingMetric, HealthMetricsOverviewTrainingView } from '@lfx-one/shared/interfaces';

/** Enrollments or revenue against the year's goal on a 270° arc, and each program's share beside it. */
@Component({
  selector: 'lfx-overview-training-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent],
  templateUrl: './overview-training-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewTrainingCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.training;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.training;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.training;
  protected readonly metrics: readonly { id: HealthMetricsOverviewTrainingMetric; label: string }[] = [
    { id: 'enrollments', label: 'Enrollment' },
    { id: 'revenue', label: 'Revenue' },
  ];
  protected readonly metric = signal<HealthMetricsOverviewTrainingMetric>('enrollments');
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getTrainingEnrollment({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewTrainingView | null>(() => {
    const enrollment = this.read.data();
    return enrollment ? buildHealthMetricsOverviewTrainingView(enrollment, this.chrome.selectedRange(), this.metric()) : null;
  });
}
