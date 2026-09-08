// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatIsoDateLabel } from '@lfx-one/shared/utils';

import type { HealthMetricsOverviewTileViewModel } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview-tile',
  imports: [NgClass],
  templateUrl: './health-metrics-overview-tile.component.html',
  styleUrl: './health-metrics-overview-tile.component.scss',
})
export class HealthMetricsOverviewTileComponent {
  public readonly tile = input.required<HealthMetricsOverviewTileViewModel>();

  protected readonly classificationMeta = computed(() => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.tile().classification]);
  protected readonly asOfLabel = computed(() => `as of ${formatIsoDateLabel(this.tile().evaluatedAt)}`);
}
