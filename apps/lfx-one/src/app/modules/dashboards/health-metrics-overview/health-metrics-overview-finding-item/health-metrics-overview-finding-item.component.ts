// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatHealthMetricsOverviewAsOfLabel } from '@lfx-one/shared/utils';

import type {
  HealthMetricsFindingVisualBar,
  HealthMetricsFindingVisualBarViewModel,
  HealthMetricsFindingVisualDotGroup,
  HealthMetricsFindingVisualDotsViewModel,
  HealthMetricsOverviewClassification,
  HealthMetricsOverviewFindingViewModel,
} from '@lfx-one/shared/interfaces';

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
  /** Set by the parent's `@for ... let last = $last` — suppresses the row divider on the group's last row. */
  public readonly isLast = input(false);

  protected readonly classificationMeta = computed(
    () => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.finding().classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none
  );
  protected readonly asOfLabel = computed(() => formatHealthMetricsOverviewAsOfLabel(this.finding().evaluatedAt));

  protected readonly dotsVisual: Signal<HealthMetricsFindingVisualDotsViewModel | null> = this.initDotsVisual();
  protected readonly barVisual: Signal<HealthMetricsFindingVisualBarViewModel | null> = this.initBarVisual();

  protected readonly bandVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'band' ? visual : null;
  });

  protected readonly tagsVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'tags' ? visual.tags : null;
  });

  private initDotsVisual(): Signal<HealthMetricsFindingVisualDotsViewModel | null> {
    return computed(() => {
      const visual = this.finding().visual;
      if (visual?.kind !== 'dots') {
        return null;
      }
      const groups = visual.groups.map(HealthMetricsOverviewFindingItemComponent.toDotsGroupViewModel).filter((group) => group !== null);
      if (groups.length === 0) {
        return null;
      }
      // The design flattens every group into one dots row (worst state first, per authoring order) with one caption below it.
      return { dots: groups.flatMap((group) => group.dots), caption: groups[0].label };
    });
  }

  private initBarVisual(): Signal<HealthMetricsFindingVisualBarViewModel | null> {
    return computed(() => {
      const visual = this.finding().visual;
      if (visual?.kind !== 'bar') {
        return null;
      }
      return HealthMetricsOverviewFindingItemComponent.toBarViewModel(visual, this.finding().classification);
    });
  }

  // A group with no dots to render (total 0) is skipped rather than shown empty. A non-zero
  // `filled` is clamped to at least 1 rendered dot so e.g. "1 of 60" doesn't round down to none.
  private static toDotsGroupViewModel(group: HealthMetricsFindingVisualDotGroup): { label: string; dots: boolean[] } | null {
    if (group.total <= 0) {
      return null;
    }
    const shown = Math.min(group.total, MAX_RENDERED_DOTS);
    const rawFilledShown = Math.round((group.filled / group.total) * shown);
    const filledShown = group.filled > 0 ? Math.max(1, rawFilledShown) : rawFilledShown;
    return { label: group.label, dots: Array.from({ length: shown }, (_unused, index) => index < filledShown) };
  }

  // A bar is a single fill sized to the sum of the authored parts (design's `fviz()`), clamped to
  // 100 and tinted with the finding's own classification tone — never per-part colors.
  private static toBarViewModel(
    bar: HealthMetricsFindingVisualBar,
    classification: HealthMetricsOverviewClassification
  ): HealthMetricsFindingVisualBarViewModel {
    const fillPercent = Math.min(
      100,
      bar.parts.reduce((sum, part) => sum + part.value, 0)
    );
    return {
      fillPercent,
      toneClass: (HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none).dotClass,
      caption: bar.caption,
    };
  }
}
