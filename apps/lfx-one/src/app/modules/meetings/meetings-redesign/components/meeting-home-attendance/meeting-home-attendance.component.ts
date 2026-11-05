// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { MEETING_HOME_ATTENDANCE_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingHomeAttendance, UiTooltipItem } from '@lfx-one/shared/interfaces';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';

/**
 * The organizer's attendance block on a meetings home row or card: "X of Y attending" with a Yes / Maybe / No bar, or
 * "X of Y attended" with the poorly-attended note under 50%.
 * @description Cards list the answers under the bar; rows show them in a tooltip on the bar.
 */
@Component({
  selector: 'lfx-meeting-home-attendance',
  imports: [NgTemplateOutlet, UiTooltipDirective],
  templateUrl: './meeting-home-attendance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeAttendanceComponent {
  public readonly attendance = input.required<MeetingHomeAttendance>();
  public readonly variant = input<'card' | 'row'>('card');

  protected readonly segmentBg = MEETING_HOME_ATTENDANCE_BG_CLASSES;
  protected readonly tooltipItems: Signal<UiTooltipItem[]> = this.initTooltipItems();

  private initTooltipItems(): Signal<UiTooltipItem[]> {
    return computed(() => {
      const { answers, noResponse } = this.attendance();
      if (noResponse === null) return [];
      return [
        ...answers.map((answer) => ({ label: answer.label, value: String(answer.count), dotClass: this.segmentBg[answer.kind] })),
        { label: 'No response', value: String(noResponse) },
      ];
    });
  }
}
