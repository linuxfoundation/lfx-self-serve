// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import type { HealthMetricsOverviewKpiView } from '@lfx-one/shared/interfaces';

/** The design's ruled KPI row: a light 34px figure per cell, an optional change beside it and a note under it. */
@Component({
  selector: 'lfx-overview-kpi-strip',
  templateUrl: './overview-kpi-strip.component.html',
  host: { class: 'block' },
})
export class OverviewKpiStripComponent {
  public readonly kpis = input.required<readonly HealthMetricsOverviewKpiView[]>();
  /** The participating organizations card marks each label with an info glyph. */
  public readonly labelInfo = input<boolean>(false);
  public readonly testId = input.required<string>();
}
