// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HEALTH_METRICS_BASE_PATH } from '@lfx-one/shared/constants';

import type { HealthMetricsFootnotePart } from '@lfx-one/shared/interfaces';

/**
 * The design's section note: plain grey text, or a warning icon on an amber panel for a caution note. Text comes as parts so a run can be bold or link to another tab; projected content follows the parts.
 */
@Component({
  selector: 'lfx-health-metrics-footnote',
  imports: [RouterLink],
  templateUrl: './health-metrics-footnote.component.html',
})
export class HealthMetricsFootnoteComponent {
  public readonly parts = input<readonly HealthMetricsFootnotePart[]>([]);
  public readonly caution = input(false);

  protected readonly basePath = HEALTH_METRICS_BASE_PATH;
}
