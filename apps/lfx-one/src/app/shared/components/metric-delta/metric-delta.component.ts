// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import type { PeriodDelta } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-metric-delta',
  imports: [],
  templateUrl: './metric-delta.component.html',
})
export class MetricDeltaComponent {
  /** Structured period-over-period delta from `computePeriodDelta`. Renders nothing when null. */
  public readonly delta = input<PeriodDelta | null>(null);
  /** Test id applied to the rendered span; defaults to `metric-delta`. */
  public readonly testid = input<string>('metric-delta');
}
