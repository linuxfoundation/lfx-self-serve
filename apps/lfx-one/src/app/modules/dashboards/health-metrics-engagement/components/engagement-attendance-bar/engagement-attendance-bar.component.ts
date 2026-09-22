// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { formatHealthMetricsEngagementAttendance, resolveHealthMetricsEngagementAttendanceTone } from '@lfx-one/shared/utils';

/**
 * Track + fill + numeric label, shared by the three attendance tables. Three tones only, not the
 * Overview's five classification codes — amber marks the one threshold that matters.
 */
@Component({
  selector: 'lfx-engagement-attendance-bar',
  templateUrl: './engagement-attendance-bar.component.html',
})
export class EngagementAttendanceBarComponent {
  /** 0-1 share; `null` means no invited population at all. */
  public readonly attendancePct = input.required<number | null>();
  public readonly meetingsHeld = input.required<number>();

  protected readonly label = computed(() => formatHealthMetricsEngagementAttendance(this.attendancePct(), this.meetingsHeld()));
  protected readonly tone = computed(() => resolveHealthMetricsEngagementAttendanceTone(this.attendancePct()));
  // A bar is only honest once the label is a percentage; "—" and "No data" render the track alone.
  protected readonly widthPct = computed(() => (this.label().endsWith('%') ? Math.round((this.attendancePct() ?? 0) * 100) : 0));
  protected readonly fillClass = computed(() => FILL_CLASS[this.tone()]);
}

const FILL_CLASS: Record<'empty' | 'low' | 'ok', string> = {
  empty: 'bg-gray-300',
  low: 'bg-amber-500',
  ok: 'bg-blue-500',
};
