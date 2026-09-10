// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_DATA_SOURCES } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewRevenueStreams, formatCurrency } from '@lfx-one/shared/utils';

import type {
  HealthMetricsOverviewFoundationSummary,
  HealthMetricsOverviewRevenue,
  HealthMetricsOverviewRevenueStreamViewModel,
} from '@lfx-one/shared/interfaces';

/**
 * Rail/sidebar matching the design's `railHTML(d)`: Foundation Revenue (total + segmented bar +
 * per-stream legend), Foundation (size/projects/tiers/board/next renewals), and a fixed Data
 * sources tag list. Rendered alongside the tile strip + findings list on wide viewports.
 */
@Component({
  selector: 'lfx-health-metrics-overview-rail',
  imports: [NgClass],
  templateUrl: './health-metrics-overview-rail.component.html',
  styleUrl: './health-metrics-overview-rail.component.scss',
})
export class HealthMetricsOverviewRailComponent {
  public readonly revenue = input.required<HealthMetricsOverviewRevenue>();
  public readonly foundationSummary = input.required<HealthMetricsOverviewFoundationSummary>();

  protected readonly dataSources = HEALTH_METRICS_OVERVIEW_DATA_SOURCES;

  protected readonly totalLabel = computed(() => formatCurrency(this.revenue().total));
  protected readonly streams: Signal<HealthMetricsOverviewRevenueStreamViewModel[]> = computed(() => buildHealthMetricsOverviewRevenueStreams(this.revenue()));
}
