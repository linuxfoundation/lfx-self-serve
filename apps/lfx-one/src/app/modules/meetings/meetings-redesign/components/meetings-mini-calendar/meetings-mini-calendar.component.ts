// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, Signal, signal } from '@angular/core';
import {
  MEETINGS_HOME_CALENDAR_WEEKDAYS,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS,
} from '@lfx-one/shared/constants';
import { MeetingHomeRow, MeetingMiniCalendarDay, MeetingMiniCalendarTooltip, MeetingMiniCalendarWeek } from '@lfx-one/shared/interfaces';
import {
  buildMeetingMiniCalendarWeeks,
  formatMeetingCalendarMonth,
  formatMeetingCalendarTime,
  getLocalDayKey,
  groupMeetingCalendarEntries,
} from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';

/**
 * Month calendar at the top of a project's meetings right column: up to three dots per day with meetings, upcoming and past.
 * @description Hovering a day lists its meetings; clicking it asks the page to show that day in the list. Days of the
 * neighbouring months are muted and never interactive.
 */
@Component({
  selector: 'lfx-meetings-mini-calendar',
  imports: [UiButtonComponent, UiSkeletonComponent],
  templateUrl: './meetings-mini-calendar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-[8px]', role: 'group', 'aria-label': 'Meetings by day' },
})
export class MeetingsMiniCalendarComponent {
  public readonly upcomingRows = input.required<MeetingHomeRow[]>();
  public readonly pastRows = input.required<MeetingHomeRow[]>();
  public readonly now = input.required<Date>();
  /** The feeds are loading: the grid shows placeholders. */
  public readonly loading = input<boolean>(false);
  /** A day with meetings was clicked. */
  public readonly daySelected = output<MeetingMiniCalendarDay>();
  /** A month before the current one is shown: the local day (`YYYY-MM-DD`) it starts on, so older past meetings can load. */
  public readonly olderMonthShown = output<string>();

  protected readonly weekdays = MEETINGS_HOME_CALENDAR_WEEKDAYS;
  protected readonly skeletonWeeks = [0, 1, 2, 3, 4];
  protected readonly skeletonDays = [0, 1, 2, 3, 4, 5, 6];
  /** Months away from the current one. */
  protected readonly monthOffset = signal(0);
  protected readonly tooltip = signal<MeetingMiniCalendarTooltip | null>(null);

  protected readonly month: Signal<Date> = computed(() => new Date(this.now().getFullYear(), this.now().getMonth() + this.monthOffset(), 1));
  protected readonly title: Signal<string> = computed(() => formatMeetingCalendarMonth(this.month()));
  protected readonly weeks: Signal<MeetingMiniCalendarWeek[]> = computed(() =>
    buildMeetingMiniCalendarWeeks(this.month(), groupMeetingCalendarEntries(this.upcomingRows(), this.pastRows()), this.now())
  );

  protected step(offset: -1 | 1): void {
    this.monthOffset.update((value) => value + offset);
    this.tooltip.set(null);
    if (this.monthOffset() < 0) this.olderMonthShown.emit(getLocalDayKey(this.month()));
  }

  protected select(day: MeetingMiniCalendarDay): void {
    this.tooltip.set(null);
    this.daySelected.emit(day);
  }

  protected showTooltip(day: MeetingMiniCalendarDay, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    this.tooltip.set({
      left: Math.round(Math.min(window.innerWidth - MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX, rect.left + rect.width / 2)),
      top: Math.round(rect.top - 6),
      head: day.label,
      items: day.entries
        .slice(0, MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS)
        .map((entry) => ({ key: entry.row.key, time: formatMeetingCalendarTime(entry.row.startTime), title: entry.row.title })),
      more: Math.max(0, day.entries.length - MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS),
    });
  }
}
