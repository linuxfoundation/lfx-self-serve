// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal } from '@angular/core';
import {
  buildHealthMetricsOverviewPeriods,
  IMPERSONATION_BANNER_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX,
  NAVBAR_MOBILE_TOP_BAR_MEDIA_QUERY,
} from '@lfx-one/shared/constants';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { UserService } from '@services/user.service';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';

import type { HealthMetricsRange, HealthMetricsYearOption } from '@lfx-one/shared/interfaces';

/**
 * Chrome state shared by every Health Metrics tab — the period selection and the measured height of
 * the sticky page header. Provided by HealthMetricsGateComponent (never `providedIn: 'root'`) so the
 * selection survives tab switches under one gate instance but resets on leaving the page.
 */
@Injectable()
export class HealthMetricsChromeService {
  private readonly userService = inject(UserService);
  private readonly navbarCollapse = inject(NavbarCollapseService);
  private readonly belowLg = injectIsMobileViewport(NAVBAR_MOBILE_TOP_BAR_MEDIA_QUERY);

  // Built per instance, not module-level, so derived labels stay correct across a calendar-year
  // rollover in a long-running SSR process.
  public readonly periods: readonly HealthMetricsYearOption[] = buildHealthMetricsOverviewPeriods();
  public readonly selectedRange = signal<HealthMetricsRange>('YTD');

  // Measured client-side from the sticky header by the gate; this fallback only shows pre-hydration
  // and approximates the header's real rendered height.
  public readonly headerHeightPx = signal(136);
  /**
   * Where the sticky page header pins: under the fixed impersonation banner while impersonating, and below `lg` on a
   * touch device also under the layout's sticky top bar (a non-touch device keeps the navbar rail and has no bar).
   */
  public readonly headerTopPx = computed(
    () =>
      (this.userService.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0) +
      (this.belowLg() && !this.navbarCollapse.railAtAnyWidth() ? NAVBAR_MOBILE_TOP_BAR_HEIGHT_PX : 0)
  );
  /** Sticky offset for anything that pins below the page header (the section nav, a section's scroll margin). */
  public readonly stickyTopPx = computed(() => this.headerTopPx() + this.headerHeightPx() + 16);

  public setPeriod(period: HealthMetricsYearOption): void {
    this.selectedRange.set(period.range);
  }
}
