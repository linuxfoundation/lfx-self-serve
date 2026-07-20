// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { BASE_BAR_CHART_OPTIONS, DEMO_ORG_MEETINGS_TRENDS, lfxColors } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';
import { hexToRgba } from '@lfx-one/shared/utils';

import { MetricCardComponent } from '@components/metric-card/metric-card.component';

import type { ChartData, ChartType } from 'chart.js';

// Per-metric header icons, matching the org KPI card iconography.
const TREND_ICON: Record<string, string> = {
  'Meetings Attended': 'fa-light fa-video',
  'Employees Active': 'fa-light fa-users',
  'Projects Supported': 'fa-light fa-diagram-project',
};

// Descriptive footer subtitle per metric, matching the org-overview involvement cards' subtitle line.
const TREND_SUBTITLE: Record<string, string> = {
  'Meetings Attended': 'Meetings your employees attended',
  'Employees Active': 'Employees active in project meetings',
  'Projects Supported': 'Projects your employees support',
};

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
        testId: 'org-meetings-trend-' + trend.label,
        icon: TREND_ICON[trend.label] ?? 'fa-light fa-chart-line',
        value: String(trend.value),
        subtitle: TREND_SUBTITLE[trend.label] ?? '',
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
