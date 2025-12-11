// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ChartModule } from 'primeng/chart';

export type ChartType = 'bar' | 'line' | 'scatter' | 'bubble' | 'pie' | 'doughnut' | 'polarArea' | 'radar';

@Component({
  selector: 'lfx-chart',
  imports: [ChartModule],
  templateUrl: './chart.component.html',
})
export class ChartComponent {
  public readonly type = input.required<ChartType>();
  public readonly data = input.required<any>();
  public readonly options = input<any>({});
  public readonly style = input<any>();
  public readonly width = input<string>('100%');
  public readonly height = input<string>('100%');
}
