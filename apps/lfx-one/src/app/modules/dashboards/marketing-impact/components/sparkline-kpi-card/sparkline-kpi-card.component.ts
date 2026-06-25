// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import type { PerformanceSummaryKpi } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-sparkline-kpi-card',
  imports: [NgClass],
  templateUrl: './sparkline-kpi-card.component.html',
  styleUrl: './sparkline-kpi-card.component.scss',
})
export class SparklineKpiCardComponent {
  public readonly kpi = input.required<PerformanceSummaryKpi>();
  public readonly section = input<string>('');
  protected readonly testId = computed(() => {
    const prefix = this.section();
    return prefix ? `${prefix}-kpi-card-${this.kpi().id}` : `kpi-card-${this.kpi().id}`;
  });
}
