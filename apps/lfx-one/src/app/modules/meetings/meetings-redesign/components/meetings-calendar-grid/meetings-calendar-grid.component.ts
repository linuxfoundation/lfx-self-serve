// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, model, output, Signal, signal, viewChild } from '@angular/core';
import {
  MEETINGS_HOME_CALENDAR_CHIP_TOOLTIP_HEIGHT_PX,
  MEETINGS_HOME_CALENDAR_HOUR_PX,
  MEETINGS_HOME_CALENDAR_MONTH_CHIPS,
  MEETINGS_HOME_CALENDAR_START_HOUR,
  MEETINGS_HOME_CALENDAR_TYPE_COLORS,
  MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX,
  MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_HIDE_MS,
} from '@lfx-one/shared/constants';
import {
  MeetingCalendarChip,
  MeetingCalendarChipTooltip,
  MeetingCalendarDialogDay,
  MeetingCalendarGridEntry,
  MeetingCalendarGridLayout,
  MeetingCalendarView,
} from '@lfx-one/shared/interfaces';
import {
  buildMeetingCalendarDialogDays,
  formatMeetingCalendarHourLabel,
  formatMeetingCalendarMonth,
  formatMeetingCalendarWeekRange,
  getLocalDayKey,
  getMeetingCalendarMonthDates,
  getMeetingCalendarWeekStart,
  groupMeetingCalendarGridEntries,
} from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';

/**
 * Month grid or week of hours of meetings, with the view switch, paging, type legend and chip tooltips.
 * @description Chips take their meeting type's colour, faded for past meetings. Content projected into it shows between the
 * toolbar and the day header, above the scrolling body.
 */
@Component({
  selector: 'lfx-meetings-calendar-grid',
  imports: [NgTemplateOutlet, UiButtonComponent, UiSwitchComponent, UiSwitchOptionComponent],
  templateUrl: './meetings-calendar-grid.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The tooltip is fixed, so a page scroll would leave it behind.
  host: { '(window:scroll)': 'hideTooltip()' },
})
export class MeetingsCalendarGridComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  public readonly entries = input.required<MeetingCalendarGridEntry[]>();
  public readonly now = input.required<Date>();
  /** Starts every `data-testid` inside the grid, so each host keeps its own. */
  public readonly testIdPrefix = input<string>('meetings-calendar-grid');
  /** `dialog` fills a dialog and scrolls inside it; `page` flows with the page, and only the week view scrolls. */
  public readonly layout = input<MeetingCalendarGridLayout>('dialog');
  /** Offers the week view; without it, month cells list every meeting instead of "+N more". */
  public readonly weekView = input<boolean>(true);
  public readonly view = model<MeetingCalendarView>('month');
  /** A date in the shown month or week. */
  public readonly focus = model.required<Date>();
  public readonly entryClick = output<MeetingCalendarGridEntry>();

  protected readonly legend = MEETINGS_HOME_CALENDAR_TYPE_COLORS;
  protected readonly weekdays = MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES;
  protected readonly hourPx = MEETINGS_HOME_CALENDAR_HOUR_PX;
  protected readonly hours: string[] = Array.from({ length: 24 }, (_, hour) => formatMeetingCalendarHourLabel(hour));

  protected readonly scrolled = signal(false);
  protected readonly tooltip = signal<MeetingCalendarChipTooltip | null>(null);

  private readonly days = computed(() => groupMeetingCalendarGridEntries(this.entries()));
  private readonly weekStart: Signal<Date> = computed(() => getMeetingCalendarWeekStart(this.focus()));
  protected readonly period: Signal<string> = computed(() =>
    this.view() === 'month' ? formatMeetingCalendarMonth(this.focus()) : formatMeetingCalendarWeekRange(this.weekStart())
  );
  protected readonly todayInView: Signal<boolean> = this.initTodayInView();
  /** Month view: rows of seven cells. */
  protected readonly monthWeeks: Signal<MeetingCalendarDialogDay[][]> = this.initMonthWeeks();
  protected readonly bodyClass: Signal<string> = this.initBodyClass();
  /** Week view: the seven day columns. */
  protected readonly weekDays: Signal<MeetingCalendarDialogDay[]> = this.initWeekDays();

  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.scrollTimer);
      clearTimeout(this.hideTimer);
    });
  }

  protected hideTooltip(): void {
    clearTimeout(this.hideTimer);
    this.tooltip.set(null);
  }

  /** Leaving a chip waits a moment, so the pointer can move onto the tooltip to read it. */
  protected scheduleHideTooltip(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.tooltip.set(null), MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_HIDE_MS);
  }

  protected keepTooltip(): void {
    clearTimeout(this.hideTimer);
  }

  protected setView(value: string | null): void {
    const view: MeetingCalendarView = value === 'week' ? 'week' : 'month';
    if (view === this.view()) return;
    this.view.set(view);
    this.hideTooltip();
    if (view === 'week') {
      this.scrollToStartHour();
      return;
    }
    // The month starts at its top, not at the week's 8 AM.
    clearTimeout(this.scrollTimer);
    this.body().nativeElement.scrollTop = 0;
    this.scrolled.set(false);
  }

  protected step(direction: -1 | 1): void {
    const focus = this.focus();
    this.focus.set(
      this.view() === 'month'
        ? new Date(focus.getFullYear(), focus.getMonth() + direction, 1)
        : new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + direction * 7)
    );
    this.hideTooltip();
  }

  protected goToToday(): void {
    this.focus.set(this.now());
    this.hideTooltip();
  }

  /** "+N more": that day's week, at 8 AM. */
  protected showWeek(day: MeetingCalendarDialogDay): void {
    this.focus.set(day.date);
    this.view.set('week');
    this.hideTooltip();
    this.scrollToStartHour();
  }

  protected open(entry: MeetingCalendarGridEntry): void {
    this.hideTooltip();
    this.entryClick.emit(entry);
  }

  protected showTooltip(chip: MeetingCalendarChip, target: EventTarget | null): void {
    if (!(target instanceof HTMLElement)) return;
    clearTimeout(this.hideTimer);
    const rect = target.getBoundingClientRect();
    const edge = MEETINGS_HOME_MINI_CALENDAR_TOOLTIP_EDGE_PX;
    const left = Math.max(edge, Math.min(window.innerWidth - edge, rect.left + rect.width / 2));
    // Anchors to the part of the chip the body shows, so a long week event scrolled half out keeps its tooltip on screen.
    const body = this.body().nativeElement.getBoundingClientRect();
    const top = Math.max(rect.top, body.top);
    const above = top >= MEETINGS_HOME_CALENDAR_CHIP_TOOLTIP_HEIGHT_PX;
    const anchor = above ? top - 6 : Math.min(rect.bottom, body.bottom) + 6;
    this.tooltip.set({ left: Math.round(left), top: Math.round(anchor), above, title: chip.title, detail: chip.detail });
  }

  protected onScroll(): void {
    this.scrolled.set(this.body().nativeElement.scrollTop > 2);
    this.hideTooltip();
  }

  private initTodayInView(): Signal<boolean> {
    return computed(() => {
      const now = this.now();
      if (this.view() === 'month') return now.getFullYear() === this.focus().getFullYear() && now.getMonth() === this.focus().getMonth();
      return getLocalDayKey(getMeetingCalendarWeekStart(now)) === getLocalDayKey(this.weekStart());
    });
  }

  private initMonthWeeks(): Signal<MeetingCalendarDialogDay[][]> {
    return computed(() => {
      const days = buildMeetingCalendarDialogDays(
        getMeetingCalendarMonthDates(this.focus()),
        this.days(),
        this.now(),
        this.focus().getMonth(),
        this.weekView() ? MEETINGS_HOME_CALENDAR_MONTH_CHIPS : Infinity
      );
      return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
    });
  }

  private initBodyClass(): Signal<string> {
    return computed(() => {
      const scroll = 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
      if (this.layout() === 'dialog') return `min-h-0 flex-auto px-[24px] pb-[24px] ${scroll}`;
      return this.view() === 'week' ? `max-h-[min(640px,calc(100vh-340px))] ${scroll}` : '';
    });
  }

  private initWeekDays(): Signal<MeetingCalendarDialogDay[]> {
    return computed(() => {
      const start = this.weekStart();
      const dates = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
      return buildMeetingCalendarDialogDays(dates, this.days(), this.now(), null, 0);
    });
  }

  private scrollToStartHour(): void {
    clearTimeout(this.scrollTimer);
    // After the week grid renders.
    this.scrollTimer = setTimeout(() => (this.body().nativeElement.scrollTop = MEETINGS_HOME_CALENDAR_START_HOUR * MEETINGS_HOME_CALENDAR_HOUR_PX - 8), 40);
  }
}
