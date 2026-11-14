// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { buildHealthMetricsEngagementSparkBars } from '@lfx-one/shared/utils';

/**
 * The design's `spark2` bar sparkline for one group's attendance history. Scales to the series' own
 * min-max, not from zero: a run of 54/58/59/62 drawn from zero reads as four identical bars.
 */
@Component({
  selector: 'lfx-engagement-sparkline',
  templateUrl: './engagement-sparkline.component.html',
})
export class EngagementSparklineComponent {
  /** Oldest → current; `null` where the period had no invited population. */
  public readonly series = input.required<(number | null)[]>();
  public readonly ariaLabel = input<string>('Attendance history');

  protected readonly bars = computed(() => buildHealthMetricsEngagementSparkBars(this.series()));
}
