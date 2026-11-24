// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { MeetingDashboardView, MeetingDayGroup } from '@lfx-one/shared/interfaces';
import { getLocalDayKey } from '@lfx-one/shared/utils';

import { MeetingHomeRowComponent } from '../meeting-home-row/meeting-home-row.component';

/** One day bucket of the meetings home list: a sticky separator with the bucket's total, then its loaded rows. */
@Component({
  selector: 'lfx-meetings-day-group',
  imports: [MeetingHomeRowComponent],
  templateUrl: './meetings-day-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
})
export class MeetingsDayGroupComponent {
  public readonly group = input.required<MeetingDayGroup>();
  public readonly view = input.required<MeetingDashboardView>();
  /** Where the label sticks while its rows scroll: right below the page's sticky tabs bar. */
  public readonly stickyTop = input<number>(0);

  /** Each row's local day, `YYYY-MM-DD`, so the page can find and scroll to a day picked on the calendar. */
  protected readonly rowDays: Signal<string[]> = computed(() => this.group().rows.map((row) => getLocalDayKey(row.startTime)));
}
