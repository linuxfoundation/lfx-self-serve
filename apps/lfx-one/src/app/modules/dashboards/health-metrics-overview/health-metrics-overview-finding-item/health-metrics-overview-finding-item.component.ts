// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';

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
      const rawGroups = visual.groups.filter((group) => group.total > 0);
      if (rawGroups.length === 0) {
        return null;
      }
      // The design flattens every group into one dots row (worst state first, per authoring order) with one
      // free-text caption below it (`fviz`'s `z.sub`) — independent of any per-group label, so a multi-group
      // visual isn't captioned with just the first group's own label. Each group's own dot count is budgeted
      // proportionally to its share of MAX_RENDERED_DOTS (rather than capped-then-sliced independently), so a
      // large first group can't crowd out later groups entirely.
      const budgets = HealthMetricsOverviewFindingItemComponent.allocateDotsBudget(
        rawGroups.map((group) => group.total),
        MAX_RENDERED_DOTS
      );
      const groups = rawGroups.map((group, index) => HealthMetricsOverviewFindingItemComponent.toDotsGroupViewModel(group, budgets[index]));
      const dots = groups.flatMap((group) => group.dots);
      return { dots, caption: visual.caption ?? groups[0].label };
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

  // `budget` is this group's own share of MAX_RENDERED_DOTS (see allocateDotsBudget) — a group with
  // no dots to render (total 0) is filtered out before this runs. A non-zero `filled` is clamped to
  // at least 1 rendered dot so e.g. "1 of 60" doesn't round down to none, unless its budget is 0.
  private static toDotsGroupViewModel(group: HealthMetricsFindingVisualDotGroup, budget: number): { label: string; dots: boolean[] } {
    const shown = Math.min(group.total, budget);
    const rawFilledShown = Math.round((group.filled / group.total) * shown);
    const filledShown = group.filled > 0 ? Math.min(shown, Math.max(1, rawFilledShown)) : rawFilledShown;
    return { label: group.label, dots: Array.from({ length: shown }, (_unused, index) => index < filledShown) };
  }

  // Splits MAX_RENDERED_DOTS proportionally across groups by each group's share of the combined
  // total (largest-remainder method), rather than letting each group claim up to the full cap
  // independently. Groups whose combined total already fits within the cap keep their full total.
  private static allocateDotsBudget(totals: number[], cap: number): number[] {
    const combinedTotal = totals.reduce((sum, total) => sum + total, 0);
    if (combinedTotal <= cap) {
      return totals;
    }
    const rawShares = totals.map((total) => (total / combinedTotal) * cap);
    const budgets = rawShares.map(Math.floor);
    const shortfall = cap - budgets.reduce((sum, budget) => sum + budget, 0);
    const byRemainderDesc = rawShares.map((share, index) => ({ index, remainder: share - Math.floor(share) })).sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < shortfall; i++) {
      budgets[byRemainderDesc[i].index] += 1;
    }
    return budgets;
  }

  // A bar is a single fill sized to the parts that share the finding's own classification tone
  // (e.g. "65% at risk" out of an at-risk/healthy split), tinted with that tone — never per-part
  // colors. Falls back to summing every part when none carry a matching tone, so an
  // authoring-only breakdown still renders something rather than a zero-width bar.
  private static toBarViewModel(
    bar: HealthMetricsFindingVisualBar,
    classification: HealthMetricsOverviewClassification
  ): HealthMetricsFindingVisualBarViewModel {
    const matchingParts = bar.parts.filter((part) => part.tone === classification);
    const partsToSum = matchingParts.length > 0 ? matchingParts : bar.parts;
    const fillPercent = Math.min(
      100,
      partsToSum.reduce((sum, part) => sum + part.value, 0)
    );
    return {
      fillPercent,
      toneClass: (HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[classification] ?? HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS.none).dotClass,
      caption: bar.caption,
    };
  }
}
