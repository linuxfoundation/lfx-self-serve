// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS, HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE } from '@lfx-one/shared/constants';
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
  // Mirrors the label's own rule rather than reading its text: below the confidence threshold a
  // filled bar would read as a real measurement, and a copy change must not silently zero the bar.
  protected readonly widthPct = computed(() => {
    const share = this.attendancePct();
    if (share === null || this.meetingsHeld() < HEALTH_METRICS_ENGAGEMENT_MIN_MEETINGS_FOR_RATE) return 0;
    return Math.round(Math.min(Math.max(share, 0), 1) * 100);
  });
  protected readonly fillClass = computed(() => HEALTH_METRICS_ENGAGEMENT_ATTENDANCE_FILL_CLASS[this.tone()]);
}
