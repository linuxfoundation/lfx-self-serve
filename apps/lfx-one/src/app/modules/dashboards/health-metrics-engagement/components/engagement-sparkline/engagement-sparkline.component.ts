// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

const WIDTH = 60;
const HEIGHT = 18;

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

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;

  private readonly points = computed(() => this.series().filter((value): value is number => value !== null));
  /** Two points is the minimum that can express a direction; below that the cell stays empty. */
  protected readonly hasLine = computed(() => this.points().length >= 2);

  protected readonly path = computed(() => {
    const values = this.points();
    if (values.length < 2) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = WIDTH / (values.length - 1);

    return values
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)} ${(HEIGHT - ((value - min) / span) * HEIGHT).toFixed(1)}`)
      .join(' ');
  });
}
