// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, type Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MEETING_START_TIME_SLOTS } from '@lfx-one/shared/constants';
import type { MeetingTimeSlot } from '@lfx-one/shared/interfaces';
import { getCurrentTimeInTimezone, parseTime12Hour } from '@lfx-one/shared/utils';
import { UiCalendarComponent } from '@shared/uikit/calendar/calendar.component';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { UiErrorComponent } from '@shared/uikit/error/error.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiPopoverDirective } from '@shared/uikit/popover/popover.directive';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';
import { UiTooltipDirective } from '@shared/uikit/tooltip/tooltip.directive';
import { controlValueSignal } from '@shared/utils/form-control-signals.util';

import { MeetingRecurrencePatternComponent } from '../../../components/meeting-recurrence-pattern/meeting-recurrence-pattern.component';
import { ComposerDateScheduleComponent } from '../../sections/composer-date-schedule.component';

/**
 * Date & schedule section of the redesigned meeting composer.
 * @description Extends the drawer's section so the cadence mapping, timezone list, early-join retention and validators stay shared;
 * the template moves to uikit controls and the start time becomes a 15-minute list.
 */
@Component({
  selector: 'lfx-composer-date-schedule-redesign',
  imports: [
    ReactiveFormsModule,
    UiCalendarComponent,
    UiComboboxComponent,
    UiErrorComponent,
    UiInputComponent,
    UiOptionComponent,
    UiPopoverDirective,
    UiSelectComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
    UiToggleComponent,
    UiTooltipDirective,
    MeetingRecurrencePatternComponent,
  ],
  templateUrl: './composer-date-schedule-redesign.component.html',
})
export class ComposerDateScheduleRedesignComponent extends ComposerDateScheduleComponent {
  protected readonly startDate = controlValueSignal<Date>(this.form, 'startDate');
  protected readonly startDateLabel: Signal<string> = computed(() => {
    const date = this.startDate();
    return date ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  });
  protected readonly isDateDisabled: Signal<(date: Date) => boolean> = computed(() => {
    const min = this.minDate();
    return (date: Date) => date < min;
  });

  private readonly startTime = controlValueSignal<string>(this.form, 'startTime');
  private readonly timezone = controlValueSignal<string>(this.form, 'timezone');
  protected readonly timeSlots: Signal<MeetingTimeSlot[]> = this.initTimeSlots();

  private readonly duration = controlValueSignal<number | string>(this.form, 'duration');
  protected readonly durationChoice: Signal<string | null> = computed(() => this.toChoice(this.duration()));
  private readonly customDuration = controlValueSignal<number | string>(this.form, 'customDuration');
  protected readonly customDurationText: Signal<string> = computed(() => this.toChoice(this.customDuration()) ?? '');
  protected readonly customDurationError: Signal<string> = this.initCustomDurationError();
  private readonly earlyJoin = controlValueSignal<number>(this.form, 'early_join_time_minutes');
  protected readonly earlyJoinChoice: Signal<string | null> = computed(() => this.toChoice(this.earlyJoin()));

  protected pickStartDate(date: Date | null, close: () => void): void {
    this.writeControl('startDate', date);
    close();
  }

  protected setDuration(choice: string | null): void {
    this.writeControl('duration', choice === 'custom' ? 'custom' : Number(choice));
  }

  /** Keeps digits only, so the min and max validators always see a number. */
  protected setCustomDuration(text: string): void {
    const digits = text.replace(/\D/g, '');
    this.writeControl('customDuration', digits === '' ? '' : Number(digits));
  }

  protected setEarlyJoin(choice: string | null): void {
    this.writeControl('early_join_time_minutes', Number(choice));
  }

  private initCustomDurationError(): Signal<string> {
    return computed(() => {
      if (this.customDurationRequiredError() || this.customDurationMinError() || this.customDurationMaxError()) {
        return `Enter a duration between ${this.minCustomDuration} and ${this.maxCustomDuration} minutes`;
      }
      return '';
    });
  }

  /** 15-minute slots from the next whole hour when the date is today; a stored off-grid time keeps its own row. */
  private initTimeSlots(): Signal<MeetingTimeSlot[]> {
    return computed(() => {
      const date = this.startDate();
      const timezone = this.timezone();
      // Wall clock in the meeting's timezone, the one the future-time validator reads.
      const now = timezone ? getCurrentTimeInTimezone(timezone) : new Date();
      const isToday = !!date && date.toDateString() === now.toDateString();
      const firstMinute = isToday ? (now.getHours() + 1) * 60 : 0;
      const stored = this.startTime();
      const storedTime = stored ? parseTime12Hour(stored) : null;
      const storedMinute = storedTime ? storedTime.hours * 60 + storedTime.minutes : null;

      const hasUpcoming = MEETING_START_TIME_SLOTS.some((slot) => slot.minuteOfDay >= firstMinute);
      // Late in the day nothing is left; list every slot and let the future-time error explain.
      const slots = hasUpcoming
        ? MEETING_START_TIME_SLOTS.filter((slot) => slot.minuteOfDay >= firstMinute || slot.minuteOfDay === storedMinute)
        : [...MEETING_START_TIME_SLOTS];
      if (storedMinute === null || !stored) {
        return slots;
      }

      const onGrid = slots.some((slot) => slot.minuteOfDay === storedMinute);
      const withStored = onGrid ? slots : [...slots, { label: stored, value: stored, minuteOfDay: storedMinute }];
      // The stored string is the option value, so the select shows it picked whatever its padding.
      return withStored.map((slot) => (slot.minuteOfDay === storedMinute ? { ...slot, value: stored } : slot)).sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    });
  }

  private writeControl(controlName: string, value: unknown): void {
    const control = this.form().get(controlName);
    control?.setValue(value);
    control?.markAsDirty();
    control?.markAsTouched();
  }

  private toChoice(value: number | string | null): string | null {
    return value === null || value === undefined || value === '' ? null : String(value);
  }
}
