// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
  MeetingCalendarDialogData,
  MeetingCalendarDialogDay,
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
  groupMeetingCalendarEntries,
} from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { distinctUntilChanged, filter } from 'rxjs';

import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';

/**
 * Full-window calendar of a project's meetings, opened from the mini calendar's Expand: a month grid or a week of hours.
 * @description Chips take their meeting type's colour, faded for past meetings, with a tooltip each. Clicking one opens the
 * meeting details drawer above the dialog, which stays open. Open it with `UiModalService` and {@link MeetingCalendarDialogData}.
 */
@Component({
  selector: 'lfx-meetings-calendar-dialog',
  imports: [NgTemplateOutlet, MeetingProjectLogoComponent, UiButtonComponent, UiSwitchComponent, UiSwitchOptionComponent],
  templateUrl: './meetings-calendar-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full w-[calc(100vw-32px)] flex-col overflow-hidden rounded-ui-lg bg-white shadow-modal',
    'data-testid': 'meetings-calendar-dialog',
  },
})
export class MeetingsCalendarDialogComponent {
  private readonly dialogRef = inject(DialogRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = inject<MeetingCalendarDialogData>(DIALOG_DATA);
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  /** `UiModalService` labels the dialog by this id. */
  protected readonly titleId = `${this.dialogRef.id}-title`;
  protected readonly legend = MEETINGS_HOME_CALENDAR_TYPE_COLORS;
  protected readonly weekdays = MEETINGS_HOME_CALENDAR_WEEKDAY_NAMES;
  protected readonly hourPx = MEETINGS_HOME_CALENDAR_HOUR_PX;
  protected readonly hours: string[] = Array.from({ length: 24 }, (_, hour) => formatMeetingCalendarHourLabel(hour));

  protected readonly view = signal<MeetingCalendarView>('month');
  /** A date in the shown month or week. */
  protected readonly focus = signal<Date>(this.initFocus());
  protected readonly scrolled = signal(false);
  protected readonly tooltip = signal<MeetingCalendarChipTooltip | null>(null);

  private readonly entries = computed(() => groupMeetingCalendarEntries(this.data.upcomingRows(), this.data.pastRows()));
  private readonly weekStart: Signal<Date> = computed(() => getMeetingCalendarWeekStart(this.focus()));
  protected readonly period: Signal<string> = computed(() =>
    this.view() === 'month' ? formatMeetingCalendarMonth(this.focus()) : formatMeetingCalendarWeekRange(this.weekStart())
  );
  protected readonly todayInView: Signal<boolean> = this.initTodayInView();
  /** Month view: rows of seven cells. */
  protected readonly monthWeeks: Signal<MeetingCalendarDialogDay[][]> = this.initMonthWeeks();
  /** Week view: the seven day columns. */
  protected readonly weekDays: Signal<MeetingCalendarDialogDay[]> = this.initWeekDays();

  /** First day whose meetings can show while it is not after today, so past meetings from it load; null for a later period. */
  private readonly pastShownFrom: Signal<string | null> = computed(() => {
    const start = this.weekStart();
    // A week's Sunday shows meetings that started the Saturday before and ran past midnight.
    const week = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    const first = getLocalDayKey(this.view() === 'month' ? getMeetingCalendarMonthDates(this.focus())[0] : week);
    return first <= getLocalDayKey(this.data.now()) ? first : null;
  });
  /** Older past meetings for the shown period failed to load, so its earlier days may be missing some. */
  protected readonly pastFailed: Signal<boolean> = computed(() => this.pastShownFrom() !== null && this.data.pastFailed());

  /** Upcoming meetings failed to load while the shown period reaches today or later. */
  protected readonly upcomingFailed: Signal<boolean> = computed(() => {
    const start = this.weekStart();
    const last =
      this.view() === 'month' ? getMeetingCalendarMonthDates(this.focus()).at(-1) : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return this.data.upcomingFailed() && !!last && getLocalDayKey(last) >= getLocalDayKey(this.data.now());
  });

  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.scrollTimer);
      clearTimeout(this.hideTimer);
    });
    toObservable(this.pastShownFrom)
      .pipe(
        distinctUntilChanged(),
        filter((from): from is string => from !== null),
        takeUntilDestroyed()
      )
      .subscribe((from) => this.data.showPastFrom(from));
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

  protected retryPast(): void {
    const from = this.pastShownFrom();
    if (from) this.data.retryPast(from);
  }

  protected close(): void {
    this.dialogRef.close();
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
    this.focus.set(this.data.now());
    this.hideTooltip();
  }

  /** "+N more": that day's week, at 8 AM. */
  protected showWeek(day: MeetingCalendarDialogDay): void {
    this.focus.set(day.date);
    this.view.set('week');
    this.hideTooltip();
    this.scrollToStartHour();
  }

  protected open(chip: MeetingCalendarChip): void {
    this.hideTooltip();
    this.data.openMeeting(chip.entry.row);
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

  /** The month it was opened on; today when that month holds it, so Week opens on today's week. */
  private initFocus(): Date {
    const now = this.data.now();
    const month = this.data.month;
    return month && (month.getFullYear() !== now.getFullYear() || month.getMonth() !== now.getMonth()) ? month : now;
  }

  private initTodayInView(): Signal<boolean> {
    return computed(() => {
      const now = this.data.now();
      if (this.view() === 'month') return now.getFullYear() === this.focus().getFullYear() && now.getMonth() === this.focus().getMonth();
      return getLocalDayKey(getMeetingCalendarWeekStart(now)) === getLocalDayKey(this.weekStart());
    });
  }

  private initMonthWeeks(): Signal<MeetingCalendarDialogDay[][]> {
    return computed(() => {
      const days = buildMeetingCalendarDialogDays(
        getMeetingCalendarMonthDates(this.focus()),
        this.entries(),
        this.data.now(),
        this.focus().getMonth(),
        MEETINGS_HOME_CALENDAR_MONTH_CHIPS
      );
      return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
    });
  }

  private initWeekDays(): Signal<MeetingCalendarDialogDay[]> {
    return computed(() => {
      const start = this.weekStart();
      const dates = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
      return buildMeetingCalendarDialogDays(dates, this.entries(), this.data.now(), null, 0);
    });
  }

  private scrollToStartHour(): void {
    clearTimeout(this.scrollTimer);
    // After the week grid renders.
    this.scrollTimer = setTimeout(() => (this.body().nativeElement.scrollTop = MEETINGS_HOME_CALENDAR_START_HOUR * MEETINGS_HOME_CALENDAR_HOUR_PX - 8), 40);
  }
}
