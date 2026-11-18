// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';

import { HealthMetricsTierIconComponent } from '../health-metrics-tier-icon/health-metrics-tier-icon.component';

import type { HealthMetricsBarListRow } from '@lfx-one/shared/interfaces';

/**
 * The design's horizontal bars: a label led by a tier icon, a plain icon or a company logo, a 6px blue-500 bar on no
 * track, and the value at the right. The widget sets the grid columns and the label's weight.
 */
@Component({
  selector: 'lfx-health-metrics-bar-list',
  imports: [HealthMetricsTierIconComponent, UiAvatarComponent],
  templateUrl: './health-metrics-bar-list.component.html',
  host: { class: 'block' },
})
export class HealthMetricsBarListComponent {
  public readonly rows = input.required<readonly HealthMetricsBarListRow[]>();
  /** The grid's three columns as a Tailwind class, e.g. `grid-cols-[minmax(110px,150px)_1fr_40px]`. */
  public readonly gridClass = input.required<string>();
  /** The label's weight, `font-normal` or `font-medium`. */
  public readonly labelClass = input<string>('font-normal');
  public readonly testId = input<string>('health-metrics-bar-list');
}
