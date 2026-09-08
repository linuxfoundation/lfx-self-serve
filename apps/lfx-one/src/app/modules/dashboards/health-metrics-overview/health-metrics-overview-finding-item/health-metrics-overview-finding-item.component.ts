// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS } from '@lfx-one/shared/constants';
import { formatIsoDateLabel } from '@lfx-one/shared/utils';

import type {
  HealthMetricsFindingVisualBar,
  HealthMetricsFindingVisualBarViewModel,
  HealthMetricsFindingVisualDotGroup,
  HealthMetricsFindingVisualDotsGroupViewModel,
  HealthMetricsOverviewFindingViewModel,
  HealthMetricsSentenceSegment,
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

  protected readonly classificationMeta = computed(() => HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[this.finding().classification]);
  protected readonly asOfLabel = computed(() => `as of ${formatIsoDateLabel(this.finding().evaluatedAt)}`);

  protected readonly sentenceSegments: Signal<HealthMetricsSentenceSegment[]> = this.initSentenceSegments();
  protected readonly dotGroupsVisual: Signal<HealthMetricsFindingVisualDotsGroupViewModel[] | null> = this.initDotGroupsVisual();
  protected readonly barVisual: Signal<HealthMetricsFindingVisualBarViewModel | null> = this.initBarVisual();

  protected readonly bandVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'band' ? visual : null;
  });

  protected readonly tagsVisual = computed(() => {
    const visual = this.finding().visual;
    return visual?.kind === 'tags' ? visual.tags : null;
  });

  private initSentenceSegments(): Signal<HealthMetricsSentenceSegment[]> {
    return computed(() => {
      const { sentence, emphasis } = this.finding();
      const start = emphasis ? sentence.indexOf(emphasis) : -1;
      if (!emphasis || start === -1) {
        return [{ text: sentence, bold: false }];
      }

      const segments: HealthMetricsSentenceSegment[] = [];
      if (start > 0) {
        segments.push({ text: sentence.slice(0, start), bold: false });
      }
      segments.push({ text: sentence.slice(start, start + emphasis.length), bold: true });
      const rest = sentence.slice(start + emphasis.length);
      if (rest) {
        segments.push({ text: rest, bold: false });
      }
      return segments;
    });
  }

  private initDotGroupsVisual(): Signal<HealthMetricsFindingVisualDotsGroupViewModel[] | null> {
    return computed(() => {
      const visual = this.finding().visual;
      if (visual?.kind !== 'dots') {
        return null;
      }
      const groups = visual.groups.map(HealthMetricsOverviewFindingItemComponent.toDotsGroupViewModel).filter((group) => group !== null);
      return groups.length > 0 ? groups : null;
    });
  }

  private initBarVisual(): Signal<HealthMetricsFindingVisualBarViewModel | null> {
    return computed(() => {
      const visual = this.finding().visual;
      if (visual?.kind !== 'bar') {
        return null;
      }
      return HealthMetricsOverviewFindingItemComponent.toBarViewModel(visual);
    });
  }

  // A group with no dots to render (total 0) is skipped rather than shown empty. A non-zero
  // `filled` is clamped to at least 1 rendered dot so e.g. "1 of 60" doesn't round down to none.
  private static toDotsGroupViewModel(group: HealthMetricsFindingVisualDotGroup): HealthMetricsFindingVisualDotsGroupViewModel | null {
    if (group.total <= 0) {
      return null;
    }
    const shown = Math.min(group.total, MAX_RENDERED_DOTS);
    const rawFilledShown = Math.round((group.filled / group.total) * shown);
    const filledShown = group.filled > 0 ? Math.max(1, rawFilledShown) : rawFilledShown;
    return { label: group.label, dots: Array.from({ length: shown }, (_unused, index) => index < filledShown) };
  }

  private static toBarViewModel(bar: HealthMetricsFindingVisualBar): HealthMetricsFindingVisualBarViewModel {
    return {
      parts: bar.parts.map((part) => ({ ...part, toneClass: HEALTH_METRICS_OVERVIEW_CLASSIFICATIONS[part.tone].dotClass })),
      caption: bar.caption,
    };
  }
}
