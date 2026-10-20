// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE } from '@lfx-one/shared/constants';
import {
  formatHealthMetricsEngagementAttendance,
  formatHealthMetricsEngagementCount,
  resolveHealthMetricsEngagementAttendanceTone,
} from '@lfx-one/shared/utils';

/**
 * Track + fill + numeric label, shared by the three attendance tables. Three tones only, not the
 * Overview's five classification codes — amber marks the one threshold that matters. With
 * `countMax` set it draws `meetingsHeld` as a count against that max instead (the design's `meetCell`).
 */
@Component({
  selector: 'lfx-engagement-attendance-bar',
  templateUrl: './engagement-attendance-bar.component.html',
})
export class EngagementAttendanceBarComponent {
  /** 0-1 share; `null` means no invited population at all. Ignored in count mode. */
  public readonly attendancePct = input<number | null>(null);
  public readonly meetingsHeld = input.required<number | null>();
  /** Count mode: the largest count in the table, which fills the track. */
  public readonly countMax = input<number | null>(null);

  private readonly countMode = computed(() => this.countMax() !== null);

  protected readonly label = computed(() =>
    this.countMode()
      ? formatHealthMetricsEngagementCount(this.meetingsHeld())
      : formatHealthMetricsEngagementAttendance(this.attendancePct(), this.meetingsHeld())
  );
  protected readonly fillClass = computed(
    () => HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS[this.countMode() ? 'ok' : resolveHealthMetricsEngagementAttendanceTone(this.attendancePct())]
  );
  // Mirrors the label's own rule rather than reading its text: below the confidence threshold a
  // filled bar would read as a real measurement, and a copy change must not silently zero the bar.
  protected readonly widthPct = computed(() => {
    const meetings = this.meetingsHeld();
    const max = this.countMax();
    if (max !== null) return meetings === null || max <= 0 ? 0 : Math.round(Math.min(Math.max(meetings / max, 0), 1) * 100);

    const share = this.attendancePct();
    if (share === null || meetings === null || meetings < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE) return 0;
    return Math.round(Math.min(Math.max(share, 0), 1) * 100);
  });
}
