// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';

import { HealthMetricsComponent } from '../health-metrics/health-metrics.component';
import { HealthMetricsOverviewComponent } from '../health-metrics-overview/health-metrics-overview.component';

/**
 * Route target for `foundation/health-metrics`. Renders the legacy page by default (server and
 * client agree on this until the flag resolves) and swaps to the LFXV2-3365 overview page once
 * `health-metrics-overview-enabled` flips true — a signal-driven `@if` inside one stable route,
 * not a router-level component swap, so hydration never has to reconcile two different trees.
 */
@Component({
  selector: 'lfx-health-metrics-gate',
  imports: [HealthMetricsComponent, HealthMetricsOverviewComponent],
  templateUrl: './health-metrics-gate.component.html',
  styleUrl: './health-metrics-gate.component.scss',
})
export class HealthMetricsGateComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  protected readonly overviewEnabled = this.featureFlagService.getBooleanFlag(HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, false);
}
