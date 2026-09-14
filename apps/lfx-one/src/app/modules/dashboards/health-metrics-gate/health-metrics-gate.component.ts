// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';

import { HealthMetricsComponent } from '../health-metrics/health-metrics.component';
import { HealthMetricsOverviewComponent } from '../health-metrics-overview/health-metrics-overview.component';

/**
 * Route target for `foundation/health-metrics`. Renders the legacy page by default (server and
 * client agree on this until the flag resolves) and swaps to the LFXV2-3365 overview page once
 * `health-metrics-overview-enabled` flips true — a signal-driven `@if` inside one stable route,
 * not a router-level component swap, so hydration never has to reconcile two different trees.
 *
 * Accepted trade-off: on a flag-on load the flag still reads false through SSR and hydration, so
 * `HealthMetricsComponent` mounts server-side, its data fetches run to completion there (SSR waits
 * for them before serializing), and the legacy page stays rendered on the client until the flag
 * resolves post-hydration — only then does the swap happen. A `CanMatchFn` awaiting flag
 * readiness (the `org-lens-enabled.guard.ts` pattern) would skip that duplicate legacy render, but
 * it would hold the whole route's client-side render until the provider reports for the ~100% of
 * users the flag is still off for — a worse trade while this page is dark-launched to a small
 * cohort; remove this gate rather than ramping the flag to 100% through it.
 *
 * `overviewEnabled` is forced false until `hydrated` latches true in `afterNextRender` (a no-op on
 * the server, so this never fires there). Without the latch, the non-production localStorage flag
 * override in `FeatureFlagService` reads synchronously ahead of `isInitialized()`, so a pre-seeded
 * override (as e2e helpers for other flags do) would swap pages on the very first client render
 * and mismatch the SSR-rendered legacy DOM.
 */
@Component({
  selector: 'lfx-health-metrics-gate',
  imports: [HealthMetricsComponent, HealthMetricsOverviewComponent],
  templateUrl: './health-metrics-gate.component.html',
  styleUrl: './health-metrics-gate.component.scss',
})
export class HealthMetricsGateComponent {
  private readonly featureFlagService = inject(FeatureFlagService);

  private readonly hydrated = signal(false);
  private readonly rawOverviewEnabled = this.featureFlagService.getBooleanFlag(HEALTH_METRICS_OVERVIEW_ENABLED_FLAG, false);

  protected readonly overviewEnabled = computed(() => this.hydrated() && this.rawOverviewEnabled());

  public constructor() {
    afterNextRender(() => this.hydrated.set(true));
  }
}
