// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import {
  HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS,
  HEALTH_METRICS_ENGAGEMENT_SPARKLINE_HEIGHT_PX,
  HEALTH_METRICS_ENGAGEMENT_SPARKLINE_WIDTH_PX,
} from '@lfx-one/shared/constants';

/**
 * 60px inline sparkline for one group's attendance history. Scales to the series' own min-max, not
 * from zero: a run of 54/58/59/62 drawn from zero reads as four identical bars and hides the move.
 */
@Component({
  selector: 'lfx-engagement-sparkline',
  templateUrl: './engagement-sparkline.component.html',
})
export class EngagementSparklineComponent {
  /** Oldest → current; `null` where the period had no invited population. */
  public readonly series = input.required<(number | null)[]>();
  public readonly ariaLabel = input<string>('Attendance history');

  protected readonly width = HEALTH_METRICS_ENGAGEMENT_SPARKLINE_WIDTH_PX;
  protected readonly height = HEALTH_METRICS_ENGAGEMENT_SPARKLINE_HEIGHT_PX;

  private readonly values = computed(() => this.series().filter((value): value is number => value !== null));
  /** Two points is the minimum that can express a direction; below that the cell stays empty. */
  protected readonly hasLine = computed(() => this.values().length >= HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS);

  protected readonly path = computed(() => {
    const series = this.series();
    const values = this.values();
    if (values.length < HEALTH_METRICS_ENGAGEMENT_MIN_TREND_POINTS) return '';

    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    // x comes from the slot in the full series, not the compacted array, so a missing period leaves
    // a gap in time rather than sliding later periods left and faking a shorter history.
    const step = HEALTH_METRICS_ENGAGEMENT_SPARKLINE_WIDTH_PX / Math.max(series.length - 1, 1);

    let penDown = false;
    return series
      .map((value, index) => {
        if (value === null) {
          penDown = false;
          return '';
        }
        const command = penDown ? 'L' : 'M';
        penDown = true;
        const y = HEALTH_METRICS_ENGAGEMENT_SPARKLINE_HEIGHT_PX - ((value - min) / span) * HEALTH_METRICS_ENGAGEMENT_SPARKLINE_HEIGHT_PX;
        return `${command}${(index * step).toFixed(1)} ${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  });
}
