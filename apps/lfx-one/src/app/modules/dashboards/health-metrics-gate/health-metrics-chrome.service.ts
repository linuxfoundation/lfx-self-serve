// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';
import { buildHealthMetricsOverviewPeriods } from '@lfx-one/shared/constants';

import type { HealthMetricsRange, HealthMetricsYearOption } from '@lfx-one/shared/interfaces';

/**
 * Chrome state shared by every Health Metrics tab — the period selection and the measured height of
 * the sticky page header. Provided by HealthMetricsGateComponent (never `providedIn: 'root'`) so the
 * selection survives tab switches under one gate instance but resets on leaving the page.
 */
@Injectable()
export class HealthMetricsChromeService {
  // Built per instance, not module-level, so derived labels stay correct across a calendar-year
  // rollover in a long-running SSR process.
  public readonly periods: readonly HealthMetricsYearOption[] = buildHealthMetricsOverviewPeriods();
  public readonly selectedRange = signal<HealthMetricsRange>('YTD');

  // Measured client-side from the sticky header by the gate; this fallback only shows pre-hydration
  // and approximates the header's real rendered height.
  public readonly headerHeightPx = signal(72);
  /** Sticky offset for anything that pins below the page header (the Overview rail, the sub-nav). */
  public readonly stickyTopPx = computed(() => this.headerHeightPx() + 16);

  public setPeriod(period: HealthMetricsYearOption): void {
    this.selectedRange.set(period.range);
  }
}
