// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatIsoDateLabel } from '@lfx-one/shared/utils';

import type { HealthMetricsFindingVisualBarPart, HealthMetricsFindingVisualDotGroup, HealthMetricsOverviewFindingViewModel } from '@lfx-one/shared/interfaces';

// Dot clusters are capped so a "5 of 62" finding doesn't render 62 individual dots.
const MAX_RENDERED_DOTS = 20;

@Component({
  selector: 'lfx-health-metrics-overview-finding-item',
  imports: [NgClass],
  templateUrl: './health-metrics-overview-finding-item.component.html',
  styleUrl: './health-metrics-overview-finding-item.component.scss',
})
export class HealthMetricsOverviewFindingItemComponent {
  public readonly finding = input.required<HealthMetricsOverviewFindingViewModel>();

  protected readonly classificationMeta = computed(() => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.finding().classification]);
  protected readonly asOfLabel = computed(() => `as of ${formatIsoDateLabel(this.finding().evaluatedAt)}`);

  protected readonly dotsVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'dots' ? visual.groups : null;
  });

  protected readonly barVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'bar' ? visual : null;
  });

  protected readonly bandVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'band' ? visual : null;
  });

  protected readonly tagsVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'tags' ? visual.tags : null;
  });

  protected renderedDots(group: HealthMetricsFindingVisualDotGroup): boolean[] {
    const shown = Math.min(group.total, MAX_RENDERED_DOTS);
    const filledShown = group.total > 0 ? Math.round((group.filled / group.total) * shown) : 0;
    return Array.from({ length: shown }, (_unused, index) => index < filledShown);
  }

  protected toneClass(tone: HealthMetricsFindingVisualBarPart['tone']): string {
    return HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[tone].dotClass;
  }
}
