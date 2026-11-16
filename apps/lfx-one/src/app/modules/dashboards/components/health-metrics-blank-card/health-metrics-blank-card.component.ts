// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import type { HealthMetricsBlankCopy, HealthMetricsBlankTile } from '@lfx-one/shared/interfaces';

/**
 * The single card that replaces a Health Metrics page with nothing for the period: the Overview's curved row of
 * icon tiles or a tab's one tile, then a title, a lead and the reasons divided by rules.
 */
@Component({
  selector: 'lfx-health-metrics-blank-card',
  templateUrl: './health-metrics-blank-card.component.html',
  host: { class: 'block' },
})
export class HealthMetricsBlankCardComponent {
  public readonly tiles = input.required<readonly HealthMetricsBlankTile[]>();
  public readonly copy = input.required<HealthMetricsBlankCopy>();
  public readonly testId = input.required<string>();
}
