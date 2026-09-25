// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, output } from '@angular/core';

import type { HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Sticky left rail for a Health Metrics Level 2 tab (the design's `.subnav2`). Purely presentational —
 * the shell owns scroll-spy and scrolling; this emits the picked section and renders the badges.
 */
@Component({
  selector: 'lfx-health-metrics-l2-sub-nav',
  imports: [NgClass],
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
  /** Static note under the items; omitted when empty. */
  public readonly crossReferenceNote = input('');

  public readonly sectionPicked = output<string>();
}
