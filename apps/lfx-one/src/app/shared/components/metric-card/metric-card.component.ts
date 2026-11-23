// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, computed, contentChild, input, output, Signal, TemplateRef } from '@angular/core';
import { ChartComponent } from '@components/chart/chart.component';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

import type { ChartData, ChartOptions, ChartType } from 'chart.js';

@Component({
  selector: 'lfx-metric-card',
  imports: [NgClass, NgTemplateOutlet, ChartComponent, SkeletonModule, TooltipModule],
  templateUrl: './metric-card.component.html',
})
export class MetricCardComponent {
  public readonly customContentTemplate = contentChild<TemplateRef<unknown>>('customContent');

  // Header inputs
  public readonly title = input.required<string>();
  public readonly icon = input<string>();
  public readonly description = input<string>();
  public readonly infoTooltip = input<string>();
  public readonly testId = input<string>();

  // Chart inputs
  public readonly chartType = input.required<ChartType>();
  public readonly chartData = input<ChartData<ChartType>>();
  public readonly chartOptions = input<ChartOptions<ChartType>>();
  // Tailwind height/flex class(s) for the chart body; defaults to h-16. Use 'flex-1' to fill available card height.
  public readonly chartHeightClass = input<string>('');
  // Line under the chart stating its window, e.g. which months the bars cover.
  public readonly chartCaption = input<string>();
  /** Stat-only card: no chart area, skeleton or caption. */
  public readonly hideChart = input<boolean>(false);

  // Footer inputs
  public readonly value = input<string>();
  public readonly subtitle = input<string>();
  public readonly valueTooltip = input<string>();
  public readonly trend = input<'up' | 'down' | 'neutral'>();
  public readonly changePercentage = input<string>();

  // Styling
  public readonly styleClass = input<string>('');

  // Loading state
  public readonly loading = input<boolean | undefined>(undefined);

  // Interaction
  public readonly clickable = input<boolean>(false);
  public readonly cardClick = output<void>();

  /** Accessible name of the keyboard entry point: the card's title and value. */
  protected readonly actionLabel: Signal<string> = computed(() => [this.title(), this.value()].filter(Boolean).join(': '));

  protected handleKeyActivate(event: Event): void {
    // Space would scroll the page; Enter / Space activate like a click.
    event.preventDefault();
    this.handleClick();
  }

  protected handleClick(): void {
    if (this.clickable()) {
      this.cardClick.emit();
    }
  }
}
