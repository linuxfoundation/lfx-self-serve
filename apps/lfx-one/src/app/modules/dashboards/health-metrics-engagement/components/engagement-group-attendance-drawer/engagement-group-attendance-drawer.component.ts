// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import { DatePipe } from '@angular/common';
import { buildHealthMetricsOverviewPeriods } from '@lfx-one/shared/constants';
import { DrawerModule } from 'primeng/drawer';

import { EngagementAttendanceBarComponent } from '../engagement-attendance-bar/engagement-attendance-bar.component';

import type { HealthMetricsEngagementGroupRow } from '@lfx-one/shared/interfaces';

/**
 * Per-period breakdown for one group. Renders from the row already in hand — the view has one row
 * per committee and no deeper grain, so a detail fetch would return nothing the table lacks.
 */
@Component({
  selector: 'lfx-engagement-group-attendance-drawer',
  imports: [DatePipe, DrawerModule, EngagementAttendanceBarComponent],
  templateUrl: './engagement-group-attendance-drawer.component.html',
})
export class EngagementGroupAttendanceDrawerComponent {
  public readonly visible = model<boolean>(false);
  public readonly row = input<HealthMetricsEngagementGroupRow | null>(null);

  // Year labels come from the Overview's own period options, so the drawer cannot drift out of sync
  // with the period pill across a calendar-year rollover.
  private readonly labelByRange = new Map(buildHealthMetricsOverviewPeriods().map((period) => [period.range, period.label]));

  /** Most recent period first — the drawer reads as a history, the table as a ranking. */
  protected readonly periods = computed(() =>
    [...(this.row()?.periods ?? [])].reverse().map((period) => ({ ...period, label: this.labelByRange.get(period.range) ?? period.range }))
  );
}
