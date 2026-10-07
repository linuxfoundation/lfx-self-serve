// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatHealthMetricsOverviewAsOfLabel } from '@lfx-one/shared/utils';

import type { HealthMetricsOverviewTileViewModel } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-health-metrics-overview-tile',
  imports: [NgClass, RouterLink],
  templateUrl: './health-metrics-overview-tile.component.html',
  styleUrl: './health-metrics-overview-tile.component.scss',
})
export class HealthMetricsOverviewTileComponent {
  public readonly tile = input.required<HealthMetricsOverviewTileViewModel>();

  protected readonly classificationMeta = computed(
    () => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.tile().classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none
  );
  // An untoned detail line reads as neutral, the same gray as an unclassified tile.
  protected readonly statDetailTextClass = computed(() => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.tile().statDetail?.tone ?? 'none'].textClass);
  protected readonly asOfLabel = computed(() => formatHealthMetricsOverviewAsOfLabel(this.tile().evaluatedAt));
}
