// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ChartModule } from 'primeng/chart';
import { Chart } from 'chart.js';
import { ZERO_BAR_STUB_PLUGIN } from '@lfx-one/shared/constants';

export type ChartType = 'bar' | 'line' | 'scatter' | 'bubble' | 'pie' | 'doughnut' | 'polarArea' | 'radar';

@Component({
  selector: 'lfx-chart',
  imports: [ChartModule],
  templateUrl: './chart.component.html',
})
export class ChartComponent {
  // Register the zero-bar stub plugin once globally so any chart host (cards,
  // drawers) that opts a dataset in via `zeroStub: true` gets the 4px gray stub.
  // The plugin no-ops for datasets that don't opt in, so other charts are unaffected.
  private static readonly zeroBarStubRegistered = (() => {
    Chart.register(ZERO_BAR_STUB_PLUGIN);
    return true;
  })();

  public readonly type = input.required<ChartType>();
  public readonly data = input.required<any>();
  public readonly options = input<any>({});
  public readonly style = input<any>();
  public readonly width = input<string>('100%');
  public readonly height = input<string>('100%');
}
