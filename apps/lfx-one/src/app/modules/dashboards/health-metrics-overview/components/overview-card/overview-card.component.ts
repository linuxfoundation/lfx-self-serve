// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_ERROR_COPY } from '@lfx-one/shared/constants';
import { SkeletonModule } from 'primeng/skeleton';

import { OverviewInfoTipComponent } from '../overview-info-tip/overview-info-tip.component';

import type { HealthMetricsOverviewCardStatus, HealthMetricsOverviewEmptyCopy } from '@lfx-one/shared/interfaces';

/** The design's bordered Overview card: a titled header, then a skeleton, an error, an empty state or the body. */
@Component({
  selector: 'lfx-overview-card',
  imports: [NgTemplateOutlet, OverviewInfoTipComponent, SkeletonModule],
  templateUrl: './overview-card.component.html',
  host: { class: 'flex min-w-0 flex-col gap-[18px] rounded-[12px] border border-gray-200 bg-white p-[20px]' },
})
export class OverviewCardComponent {
  public readonly heading = input.required<string>();
  public readonly info = input.required<string>();
  /** A line under the title; shown only once the body is. */
  public readonly subtitle = input<string>('');
  public readonly status = input.required<HealthMetricsOverviewCardStatus>();
  public readonly isEmpty = input<boolean>(false);
  public readonly emptyCopy = input.required<HealthMetricsOverviewEmptyCopy>();
  public readonly testId = input.required<string>();

  protected readonly errorCopy = HEALTH_METRICS_OVERVIEW_ERROR_COPY;
}
