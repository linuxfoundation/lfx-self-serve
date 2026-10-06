// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HEALTH_METRICS_BASE_PATH } from '@lfx-one/shared/constants';

import type { HealthMetricsL2CrossReference, HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Sticky left rail for a Health Metrics Level 2 tab (the design's `.subnav2`). Purely presentational —
 * the shell owns scroll-spy and scrolling; this emits the picked section and renders the badges.
 */
@Component({
  selector: 'lfx-health-metrics-l2-sub-nav',
  imports: [NgClass, RouterLink],
  templateUrl: './health-metrics-l2-sub-nav.component.html',
})
export class HealthMetricsL2SubNavComponent {
  public readonly items = input.required<readonly HealthMetricsL2SubNavItem[]>();
  public readonly activeKey = input.required<string>();
  /** Sticky offset measured from the page header, so the rail pins directly below it. */
  public readonly topPx = input.required<number>();
  public readonly ariaLabel = input.required<string>();
  /** Prefixes every `data-testid`, so each tab keeps its own test ids. */
  public readonly testIdPrefix = input.required<string>();
  /** Note under the items linking to another tab; omitted when `null`. */
  public readonly crossReference = input<HealthMetricsL2CrossReference | null>(null);

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;

  public readonly sectionPicked = output<string>();
}
