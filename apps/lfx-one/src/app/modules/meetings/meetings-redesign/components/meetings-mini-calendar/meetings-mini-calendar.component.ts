// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, linkedSignal, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  MEETINGS_HOME_CALENDAR_WEEKDAYS,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_HIDE_MS,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_MAX_HEIGHT_PX,
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
import { distinctUntilChanged, filter } from 'rxjs';

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
  private static nextTooltipId = 0;
  private readonly destroyRef = inject(DestroyRef);

  public readonly upcomingRows = input.required<MeetingHomeRow[]>();
  public readonly pastRows = input.required<MeetingHomeRow[]>();
  public readonly now = input.required<Date>();
  /** The feeds are loading: the grid shows placeholders. */
  public readonly loading = input<boolean>(false);
  /** Changes with the viewer and project the meetings come from; the calendar then goes back to the current month. */
  public readonly scope = input<string>('');
  /** A day with meetings was clicked. */
  public readonly daySelected = output<MeetingMiniCalendarDay>();
  /** The current month or an older one is shown: the local day (`YYYY-MM-DD`) it starts on, so its past meetings can load. */
  public readonly olderMonthShown = output<string>();
  /** Expand was clicked, to open the full calendar. */
  public readonly expand = output<Date>();

  protected readonly weekdays = MEETINGS_HOME_CALENDAR_WEEKDAYS;
  protected readonly skeletonWeeks = [0, 1, 2, 3, 4];
  protected readonly skeletonDays = [0, 1, 2, 3, 4, 5, 6];
  protected readonly tooltipId = `meetings-mini-calendar-tooltip-${MeetingsMiniCalendarComponent.nextTooltipId++}`;
  /** Months away from the current one. */
  protected readonly monthOffset = linkedSignal({ source: this.scope, computation: () => 0 });
  protected readonly tooltip = linkedSignal<string, MeetingMiniCalendarTooltip | null>({ source: this.scope, computation: () => null });

  protected readonly month: Signal<Date> = computed(() => new Date(this.now().getFullYear(), this.now().getMonth() + this.monthOffset(), 1));
  protected readonly title: Signal<string> = computed(() => formatMeetingCalendarMonth(this.month()));
  protected readonly weeks: Signal<MeetingMiniCalendarWeek[]> = computed(() =>
    buildMeetingMiniCalendarWeeks(this.month(), groupMeetingCalendarEntries(this.upcomingRows(), this.pastRows()), this.now())
  );
  /** First day of the shown month while it can hold past meetings; null for a later month. */
  private readonly pastMonthStart: Signal<string | null> = computed(() => (this.monthOffset() <= 0 ? getLocalDayKey(this.month()) : null));

  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.hideTimer));
    // Asks again for a new scope, whose past rows start over from their first page.
    toObservable(computed(() => ({ start: this.pastMonthStart(), scope: this.scope() })))
      .pipe(
        distinctUntilChanged((a, b) => a.start === b.start && a.scope === b.scope),
        filter((shown): shown is { start: string; scope: string } => shown.start !== null),
        takeUntilDestroyed()
      )
      .subscribe(({ start }) => this.olderMonthShown.emit(start));
  }

  protected step(offset: -1 | 1): void {
    this.monthOffset.update((value) => value + offset);
    this.hideTooltip();
  }

  protected select(day: MeetingMiniCalendarDay): void {
    this.hideTooltip();
    this.daySelected.emit(day);
  }

  protected hideTooltip(): void {
    clearTimeout(this.hideTimer);
    this.tooltip.set(null);
  }

  /** Leaving a day waits a moment, so the pointer can move onto the tooltip to read it. */
  protected scheduleHideTooltip(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.tooltip.set(null), MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_HIDE_MS);
  }

  protected keepTooltip(): void {
    clearTimeout(this.hideTimer);
  }

  protected showTooltip(day: MeetingMiniCalendarDay, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    clearTimeout(this.hideTimer);
    const rect = target.getBoundingClientRect();
    const above = rect.top >= MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_MAX_HEIGHT_PX || rect.top >= window.innerHeight - rect.bottom;
    this.tooltip.set({
      day: day.key,
      left: Math.round(Math.min(window.innerWidth - MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX, rect.left + rect.width / 2)),
      top: Math.round(above ? rect.top - 6 : rect.bottom + 6),
      above,
      head: day.label,
      items: day.entries
        .slice(0, MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS)
        .map((entry) => ({ key: entry.row.key, time: formatMeetingCalendarTime(entry.row.startTime), title: entry.row.title })),
      more: Math.max(0, day.entries.length - MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_ITEMS),
    });
  }
}
