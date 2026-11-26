// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MeetingCalendarDialogData, MeetingCalendarEntry, MeetingCalendarGridEntry, MeetingCalendarView } from '@lfx-one/shared/interfaces';
import {
  getLocalDayKey,
  getMeetingCalendarMonthDates,
  getMeetingCalendarWeekStart,
  groupMeetingCalendarEntries,
  toMeetingCalendarGridEntry,
} from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { distinctUntilChanged, filter } from 'rxjs';

import { MeetingProjectLogoComponent } from '../meeting-project-logo/meeting-project-logo.component';
import { MeetingsCalendarGridComponent } from '../meetings-calendar-grid/meetings-calendar-grid.component';

/**
 * Full-window calendar of a project's meetings, opened from the mini calendar's Expand: a month grid or a week of hours.
 * @description Chips take their meeting type's colour, faded for past meetings, with a tooltip each. Clicking one opens the
 * meeting details drawer above the dialog, which stays open. Open it with `UiModalService` and {@link MeetingCalendarDialogData}.
 */
@Component({
  selector: 'lfx-meetings-calendar-dialog',
  imports: [MeetingProjectLogoComponent, MeetingsCalendarGridComponent, UiButtonComponent],
  templateUrl: './meetings-calendar-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex h-full w-[calc(100vw-32px)] flex-col overflow-hidden rounded-ui-lg bg-white shadow-modal',
    'data-testid': 'meetings-calendar-dialog',
  },
})
export class MeetingsCalendarDialogComponent {
  private readonly dialogRef = inject(DialogRef);
  protected readonly data = inject<MeetingCalendarDialogData>(DIALOG_DATA);

  /** `UiModalService` labels the dialog by this id. */
  protected readonly titleId = `${this.dialogRef.id}-title`;

  protected readonly view = signal<MeetingCalendarView>('month');
  /** A date in the shown month or week. */
  protected readonly focus = signal<Date>(this.initFocus());

  private readonly entries: Signal<MeetingCalendarEntry[]> = computed(() =>
    [...groupMeetingCalendarEntries(this.data.upcomingRows(), this.data.pastRows()).values()].flat()
  );
  protected readonly gridEntries: Signal<MeetingCalendarGridEntry[]> = computed(() => this.entries().map(toMeetingCalendarGridEntry));
  private readonly weekStart: Signal<Date> = computed(() => getMeetingCalendarWeekStart(this.focus()));

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

  public constructor() {
    toObservable(this.pastShownFrom)
      .pipe(
        distinctUntilChanged(),
        filter((from): from is string => from !== null),
        takeUntilDestroyed()
      )
      .subscribe((from) => this.data.showPastFrom(from));
  }

  protected retryPast(): void {
    const from = this.pastShownFrom();
    if (from) this.data.retryPast(from);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected open(entry: MeetingCalendarGridEntry): void {
    const row = this.entries().find((item) => item.row.key === entry.key)?.row;
    if (row) this.data.openMeeting(row);
  }

  /** The month it was opened on; today when that month holds it, so Week opens on today's week. */
  private initFocus(): Date {
    const now = this.data.now();
    const month = this.data.month;
    return month && (month.getFullYear() !== now.getFullYear() || month.getMonth() !== now.getMonth()) ? month : now;
  }
}
