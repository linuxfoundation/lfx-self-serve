// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { toHealthMetricsOverviewKpiStripLayout } from '@lfx-one/shared/utils';

import { OverviewInfoTipComponent } from '../overview-info-tip/overview-info-tip.component';

import type { HealthMetricsOverviewKpiStripLayout, HealthMetricsOverviewKpiView } from '@lfx-one/shared/interfaces';

/**
 * The design's ruled KPI row: a 12px label (with its tooltip, where given) over a light 34px figure, an optional change
 * and a note. It measures its own width, so a narrow card stacks it, or makes four items a 2 × 2 grid.
 */
@Component({
  selector: 'lfx-overview-kpi-strip',
  imports: [OverviewInfoTipComponent],
  templateUrl: './overview-kpi-strip.component.html',
  host: { class: 'block' },
})
export class OverviewKpiStripComponent {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly kpis = input.required<readonly HealthMetricsOverviewKpiView[]>();
  public readonly testId = input.required<string>();

  /** `null` until measured, so the server and the first paint keep the one-row layout. */
  private readonly widthPx = signal<number | null>(null);
  protected readonly layout = computed<HealthMetricsOverviewKpiStripLayout>(() => toHealthMetricsOverviewKpiStripLayout(this.widthPx(), this.kpis().length));
  protected readonly columns = computed(() => {
    const layout = this.layout();
    if (layout === 'stack') return 'minmax(0, 1fr)';
    return `repeat(${layout === 'grid' ? 2 : this.kpis().length}, minmax(0, 1fr))`;
  });
  /** Dividers and padding per item: the design's left rule between columns, a top rule between stacked rows. */
  protected readonly itemClasses = computed(() => {
    const layout = this.layout();
    return this.kpis().map((_, index) => itemClass(layout, index));
  });

  public constructor() {
    afterNextRender(() => this.observeWidth());
  }

  private observeWidth(): void {
    if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => this.widthPx.set(entry.contentRect.width));
    observer.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}

function itemClass(layout: HealthMetricsOverviewKpiStripLayout, index: number): string {
  switch (layout) {
    case 'stack':
      return index === 0 ? 'pl-0' : 'border-t border-gray-200 pl-0';
    case 'grid':
      return [index % 2 === 0 ? 'pl-0' : 'border-l border-gray-200 pl-[20px]', index >= 2 ? 'border-t border-gray-200' : ''].join(' ');
    default:
      return index === 0 ? 'pl-0' : 'border-l border-gray-200 pl-[20px]';
  }
}
