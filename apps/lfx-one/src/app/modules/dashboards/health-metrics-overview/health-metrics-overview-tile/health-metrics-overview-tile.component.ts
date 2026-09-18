// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatHealthMetricsOverviewAsOfLabel } from '@lfx-one/shared/utils';

import type { HealthMetricsOverviewTileViewModel } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview-tile',
  imports: [NgClass],
  templateUrl: './health-metrics-overview-tile.component.html',
  styleUrl: './health-metrics-overview-tile.component.scss',
})
export class HealthMetricsOverviewTileComponent {
  public readonly tile = input.required<HealthMetricsOverviewTileViewModel>();

  protected readonly classificationMeta = computed(
    () => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.tile().classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none
  );
  // Empty for a neutral "no data" tile (never actually evaluated) — no label rather than a fabricated date.
  protected readonly asOfLabel = computed(() => {
    const evaluatedAt = this.tile().evaluatedAt;
    return evaluatedAt ? formatHealthMetricsOverviewAsOfLabel(evaluatedAt) : '';
  });
}
