// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal } from '@angular/core';
import { buildHealthMetricsOverviewPeriods, IMPERSONATION_BANNER_HEIGHT_PX } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';

import type { HealthMetricsRange, HealthMetricsYearOption } from '@lfx-one/shared/interfaces';

/**
 * Chrome state shared by every Health Metrics tab — the period selection and the measured height of
 * the sticky page header. Provided by HealthMetricsGateComponent (never `providedIn: 'root'`) so the
 * selection survives tab switches under one gate instance but resets on leaving the page.
 */
@Injectable()
export class HealthMetricsChromeService {
  private readonly userService = inject(UserService);

  // Built per instance, not module-level, so derived labels stay correct across a calendar-year
  // rollover in a long-running SSR process.
  public readonly periods: readonly HealthMetricsYearOption[] = buildHealthMetricsOverviewPeriods();
  public readonly selectedRange = signal<HealthMetricsRange>('YTD');

  // Measured client-side from the sticky header by the gate; this fallback only shows pre-hydration
  // and approximates the header's real rendered height.
  public readonly headerHeightPx = signal(72);
  /**
   * Sticky offset for anything that pins below the page header (the Overview rail, the sub-nav).
   * The header itself shifts down by the fixed impersonation banner while impersonating (see the
   * gate's template), so anything pinning below it must add the same amount.
   */
  public readonly stickyTopPx = computed(() => this.headerHeightPx() + 16 + (this.userService.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0));

  public setPeriod(period: HealthMetricsYearOption): void {
    this.selectedRange.set(period.range);
  }
}
