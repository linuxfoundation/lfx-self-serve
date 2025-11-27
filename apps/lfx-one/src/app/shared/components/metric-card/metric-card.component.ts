// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, ContentChild, input, TemplateRef } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

import type { ChartData, ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-metric-card',
  standalone: true,
  imports: [CommonModule, ChartComponent, SkeletonModule, TooltipModule],
  templateUrl: './metric-card.component.html',
})
export class MetricCardComponent {
  @ContentChild('customContent', { static: false }) public customContentTemplate?: TemplateRef<unknown>;

  // Header inputs
  public readonly title = input.required<string>();
  public readonly icon = input<string>();
  public readonly testId = input<string>();

  // Chart inputs
  public readonly chartType = input.required<ChartType>();
  public readonly chartData = input<ChartData<ChartType>>();
  public readonly chartOptions = input<ChartOptions<ChartType>>();

  // Footer inputs
  public readonly value = input<string>();
  public readonly subtitle = input<string>();
  public readonly valueTooltip = input<string>();

  // Loading state
  public readonly loading = input<boolean | undefined>(undefined);
}
