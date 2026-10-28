// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_ERROR_COPY } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewEmptyCopy, toHealthMetricsOverviewPastYear } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { OverviewEmptyTrackerService } from '../../overview-empty-tracker.service';
import { OverviewInfoTipComponent } from '../overview-info-tip/overview-info-tip.component';

import type {
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEmptyCopy,
  HealthMetricsOverviewEmptyStateCopy,
  HealthMetricsOverviewMetaPart,
} from '@lfx-one/shared/interfaces';

/** The design's bordered Overview card: a titled header, then a skeleton, an error, an empty state or the body. */
@Component({
  selector: 'lfx-overview-card',
  imports: [NgTemplateOutlet, OverviewInfoTipComponent, SkeletonModule],
  templateUrl: './overview-card.component.html',
  host: { class: 'flex min-w-0 flex-col gap-[18px] rounded-[20px] border border-gray-200 bg-white p-[20px]' },
})
export class OverviewCardComponent implements OnInit {
  private readonly chrome = inject(HealthMetricsChromeService, { optional: true });
  private readonly emptyTracker = inject(OverviewEmptyTrackerService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  public readonly heading = input.required<string>();
  public readonly info = input.required<string>();
  /** "Label: value" parts under the title, values darker than labels; shown only once the body is. */
  public readonly meta = input<readonly HealthMetricsOverviewMetaPart[]>([]);
  public readonly status = input.required<HealthMetricsOverviewCardStatus>();
  public readonly isEmpty = input<boolean>(false);
  public readonly emptyCopy = input.required<HealthMetricsOverviewEmptyStateCopy>();
  /** The card shows today's figures whatever the period, so its empty state always speaks of today. */
  public readonly snapshot = input<boolean>(false);
  public readonly testId = input.required<string>();

  protected readonly errorCopy = HEALTH_METRICS_OVERVIEW_ERROR_COPY;
  protected readonly resolvedEmptyCopy: Signal<HealthMetricsOverviewEmptyCopy> = this.initResolvedEmptyCopy();

  // Registers once the inputs are bound, so the page never reads a status the card has not been given yet.
  public ngOnInit(): void {
    this.emptyTracker?.register(
      computed(() => this.status() === 'ready' && this.isEmpty()),
      this.destroyRef
    );
  }

  private initResolvedEmptyCopy(): Signal<HealthMetricsOverviewEmptyCopy> {
    return computed(() => {
      const range = this.chrome?.selectedRange() ?? 'YTD';
      return buildHealthMetricsOverviewEmptyCopy(this.emptyCopy(), this.snapshot() ? null : toHealthMetricsOverviewPastYear(range));
    });
  }
}
