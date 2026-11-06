// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MEETING_HOME_ATTENDANCE_BG_CLASSES } from '@lfx-one/shared/constants';
import { MeetingHomeAttendance } from '@lfx-one/shared/interfaces';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

/**
 * The organizer's attendance block on a meetings home row or card: "X of Y attending" with a Yes / Maybe / No bar, or
 * "X of Y attended" with the poorly-attended note under 50%.
 * @description Cards list the answers under the bar; rows show the invited people in a popup instead.
 */
@Component({
  selector: 'lfx-meeting-home-attendance',
  imports: [UiNoteComponent],
  templateUrl: './meeting-home-attendance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class MeetingHomeAttendanceComponent {
  public readonly attendance = input.required<MeetingHomeAttendance>();
  public readonly variant = input<'card' | 'row'>('card');

  protected readonly segmentBg = MEETING_HOME_ATTENDANCE_BG_CLASSES;
}
