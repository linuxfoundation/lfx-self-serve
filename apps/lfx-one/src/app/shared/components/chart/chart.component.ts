// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { Chart } from 'chart.js';
import { Flow, SankeyController } from 'chartjs-chart-sankey';
import { ZERO_BAR_STUB_PLUGIN } from '@lfx-one/shared/constants';

export type ChartType = 'bar' | 'line' | 'scatter' | 'bubble' | 'pie' | 'doughnut' | 'polarArea' | 'radar' | 'sankey';

@Component({
  selector: 'lfx-chart',
  imports: [ChartModule],
  templateUrl: './chart.component.html',
})
export class ChartComponent {
  // Register the zero-bar stub plugin once globally so any chart host (cards,
  // drawers) that opts a dataset in via `zeroStub: true` gets the 4px gray stub.
  // The plugin no-ops for datasets that don't opt in, so other charts are unaffected.
  // Sankey is registered alongside it: the controller and its Flow element come from
  // chartjs-chart-sankey rather than chart.js core, so `type="sankey"` throws
  // "sankey is not a registered controller" without this.
  private static readonly chartExtensionsRegistered = (() => {
    Chart.register(ZERO_BAR_STUB_PLUGIN, SankeyController, Flow);
    return true;
  })();

  public readonly type = input.required<ChartType>();
  public readonly data = input.required<any>();
  public readonly options = input<any>({});
  public readonly style = input<any>();
  public readonly width = input<string>('100%');
  public readonly height = input<string>('100%');

  /**
   * PrimeNG types its own `type` input against a fixed union of core Chart.js types, so a type
   * contributed by a registered plugin cannot be passed through it as-is. Only the compile-time
   * union is narrow — at runtime PrimeNG forwards the string to Chart.js, which accepts any
   * registered controller id. Widened here, at the one boundary that needs it, rather than by
   * loosening the `ChartType` this component exposes to its callers.
   */
  protected readonly primeChartType: Signal<any> = computed(() => this.type());
}
