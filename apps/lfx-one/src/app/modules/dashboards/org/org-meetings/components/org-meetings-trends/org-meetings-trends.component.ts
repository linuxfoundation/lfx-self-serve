// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { BASE_BAR_CHART_OPTIONS, DEMO_ORG_MEETINGS_TRENDS, lfxColors, ORG_MEETINGS_TREND_ICON, ORG_MEETINGS_TREND_SUBTITLE } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';
import { hexToRgba, slugify } from '@lfx-one/shared/utils';

import { MetricCardComponent } from '@components/metric-card/metric-card.component';

import type { ChartData, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-org-meetings-trends',
  imports: [MetricCardComponent],
  templateUrl: './org-meetings-trends.component.html',
})
export class OrgMeetingsTrendsComponent {
  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsTimeRange>();

  // Complex computed via init function
  protected readonly cards = this.initCards();

  // Reuse the shared bar-chart option preset the org-overview involvement cards use.
  protected readonly chartOptions = BASE_BAR_CHART_OPTIONS;

  private initCards() {
    return computed(() =>
      DEMO_ORG_MEETINGS_TRENDS.map((trend) => ({
        title: trend.label,
        testId: 'org-meetings-trend-' + slugify(trend.label),
        icon: ORG_MEETINGS_TREND_ICON[trend.label] ?? 'fa-light fa-chart-line',
        value: String(trend.value),
        subtitle: ORG_MEETINGS_TREND_SUBTITLE[trend.label] ?? '',
        chartData: this.buildChartData(trend.sparkline),
      }))
    );
  }

  private buildChartData(values: number[]): ChartData<ChartType> {
    return {
      labels: values.map((_, index) => String(index + 1)),
      datasets: [
        {
          data: values,
          borderColor: lfxColors.blue[500],
          backgroundColor: hexToRgba(lfxColors.blue[500], 0.5),
          borderRadius: 4,
        },
      ],
    };
  }
}
