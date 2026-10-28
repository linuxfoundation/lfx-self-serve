// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import { OverviewInfoTipComponent } from '../overview-info-tip/overview-info-tip.component';

import type { HealthMetricsOverviewKpiView } from '@lfx-one/shared/interfaces';

/** The design's ruled KPI row: a 12px label (with its tooltip, where given) over a light 34px figure, an optional change and a note. */
@Component({
  selector: 'lfx-overview-kpi-strip',
  imports: [OverviewInfoTipComponent],
  templateUrl: './overview-kpi-strip.component.html',
  host: { class: 'block' },
})
export class OverviewKpiStripComponent {
  public readonly kpis = input.required<readonly HealthMetricsOverviewKpiView[]>();
  public readonly testId = input.required<string>();
}
