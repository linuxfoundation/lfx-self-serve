// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE_NOTE } from '@lfx-one/shared/constants';

import type { HealthMetricsEngagementSectionKey, HealthMetricsEngagementSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Sticky left rail for the Engagement page (the design's `.subnav2`). Purely presentational — the
 * container owns scroll-spy and scrolling; this emits the picked section and renders the badges.
 */
@Component({
  selector: 'lfx-engagement-sub-nav',
  imports: [NgClass],
  templateUrl: './engagement-sub-nav.component.html',
})
export class EngagementSubNavComponent {
  public readonly items = input.required<readonly HealthMetricsEngagementSubNavItem[]>();
  public readonly activeKey = input.required<HealthMetricsEngagementSectionKey>();
  /** Sticky offset measured from the page header, so the rail pins directly below it. */
  public readonly topPx = input.required<number>();

  public readonly sectionPicked = output<HealthMetricsEngagementSectionKey>();

  protected readonly crossReferenceNote = HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE_NOTE;
}
