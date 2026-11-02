// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MeetingDayGroup } from '@lfx-one/shared/interfaces';

/** One day bucket of the meetings home list: a separator with the bucket's total, then its loaded rows. */
@Component({
  selector: 'lfx-meetings-day-group',
  imports: [DatePipe],
  templateUrl: './meetings-day-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
})
export class MeetingsDayGroupComponent {
  public readonly group = input.required<MeetingDayGroup>();
}
