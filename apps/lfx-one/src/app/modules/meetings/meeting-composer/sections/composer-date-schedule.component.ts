// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  EARLY_JOIN_CHIP_OPTIONS,
  EARLY_JOIN_TOOLTIP,
  MAX_CUSTOM_DURATION,
  MAX_EARLY_JOIN_TIME,
  MEETING_DURATION_CHIP_OPTIONS,
  MIN_CUSTOM_DURATION,
  MIN_EARLY_JOIN_TIME,
  RECURRING_MEETING_FEATURE,
  TIMEZONES,
  WEEKDAY_CODES,
} from '@lfx-one/shared/constants';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { getTimezoneUtcOffsetString, getWeekOfMonth } from '@lfx-one/shared/utils';
import { TooltipModule } from 'primeng/tooltip';

import { MeetingRecurrencePatternComponent } from '../../components/meeting-recurrence-pattern/meeting-recurrence-pattern.component';

/**
 * Date & Schedule section of the meeting composer (LFXV2-3236).
 * @description Owns `startDate`, `startTime`, `duration`/`customDuration`, `timezone`,
 * `early_join_time_minutes`, and the recurring card. Owns the simple-cadence → `recurrence` mapping
 * (daily / weekly / weekdays / monthly); `custom` is owned by `lfx-meeting-recurrence-pattern`. The
 * emitted `recurrence` group is unchanged from the wizard.
 */
@Component({
  selector: 'lfx-composer-date-schedule',
  imports: [
    ReactiveFormsModule,
    TooltipModule,
    CalendarComponent,
    TimePickerComponent,
    SelectComponent,
    SelectButtonComponent,
    InputNumberComponent,
    FeatureToggleComponent,
    MeetingRecurrencePatternComponent,
  ],
  templateUrl: './composer-date-schedule.component.html',
})
export class ComposerDateScheduleComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  public readonly form = input.required<FormGroup>();
  /** Quick create labels its own columns and has no room for the section heading. */
  public readonly showHeading = input(true);
  /** Early join is an advanced setting the quick create dialog leaves at its default. */
  public readonly showEarlyJoin = input(true);

  protected readonly durationOptions = MEETING_DURATION_CHIP_OPTIONS;
  protected readonly earlyJoinOptions = EARLY_JOIN_CHIP_OPTIONS;
  protected readonly recurringFeature = RECURRING_MEETING_FEATURE;
  protected readonly minCustomDuration = MIN_CUSTOM_DURATION;
  protected readonly maxCustomDuration = MAX_CUSTOM_DURATION;
  protected readonly minEarlyJoinTime = MIN_EARLY_JOIN_TIME;
  protected readonly maxEarlyJoinTime = MAX_EARLY_JOIN_TIME;
  protected readonly earlyJoinTooltip = EARLY_JOIN_TOOLTIP;

  protected readonly showCustomRecurrence = signal<boolean>(false);
  // Cadence labels name the selected day ("Weekly on Thursday"), so they are rebuilt per start date.
  protected readonly cadenceOptions = signal<{ label: string; value: string }[]>([]);
  // Rebuilt whenever the meeting date changes so the listed DST offsets match that date.
  protected readonly timezoneOptions = signal<{ label: string; value: string }[]>(this.buildTimezoneOptions(new Date()));

  protected readonly minDate = computed(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  });

  public ngOnInit(): void {
    const startDate = this.form().get('startDate')?.value as Date | null;
    this.cadenceOptions.set(this.buildCadenceOptions(startDate));
    if (startDate) {
      this.timezoneOptions.set(this.buildTimezoneOptions(startDate));
    }

    this.showCustomRecurrence.set(this.form().get('recurrenceType')?.value === 'custom');

    this.form()
      .get('startDate')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((newDate: Date | null) => {
        this.handleStartDateChange(newDate);
        this.timezoneOptions.set(this.buildTimezoneOptions(newDate ?? new Date()));
      });

    this.form()
      .get('isRecurring')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isRecurring) => {
        const recurrenceType = this.form().get('recurrenceType');
        if (!isRecurring) {
          recurrenceType?.setValue('none');
          return;
        }

        if (!recurrenceType?.value || recurrenceType.value === 'none') {
          recurrenceType?.setValue('weekly');
        }
      });

    this.form()
      .get('recurrenceType')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recurrenceType) => {
        this.showCustomRecurrence.set(recurrenceType === 'custom');
        this.updateRecurrenceFormGroup(recurrenceType);
      });
  }

  private buildCadenceOptions(date: Date | null): { label: string; value: string }[] {
    // Without a date there is no day name to label the weekly/monthly cadences with.
    if (!date) {
      return [];
    }

    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const { weekOfMonth, isLastWeek } = getWeekOfMonth(date);
    const ordinals = ['', '1st', '2nd', '3rd', '4th'];
    const ordinal = ordinals[weekOfMonth] || `${weekOfMonth}th`;

    return [
      { label: 'Daily', value: 'daily' },
      { label: `Weekly on ${dayName}`, value: 'weekly' },
      { label: 'Every weekday', value: 'weekdays' },
      isLastWeek ? { label: `Monthly on the last ${dayName}`, value: 'monthly_last' } : { label: `Monthly on the ${ordinal} ${dayName}`, value: 'monthly_nth' },
      { label: 'Custom', value: 'custom' },
    ];
  }

  private handleStartDateChange(newDate: Date | null): void {
    this.cadenceOptions.set(this.buildCadenceOptions(newDate));

    const currentRecurrenceType = this.form().get('recurrenceType')?.value;
    // The calendar input is user-editable, so clearing it emits null; the day-derived cadences below
    // have no day to derive from until a date comes back.
    if (!newDate || !currentRecurrenceType || currentRecurrenceType === 'none') {
      return;
    }

    // 'custom' and 'daily'/'weekdays' patterns don't encode the start day, so only the day-derived
    // cadences need re-deriving; the pattern component owns 'custom'.
    if (currentRecurrenceType === 'weekly') {
      this.form()
        .get('recurrence')
        ?.patchValue({ weekly_days: String(newDate.getDay() + 1) });
      return;
    }

    if (currentRecurrenceType === 'monthly_nth' || currentRecurrenceType === 'monthly_last') {
      this.updateMonthlyPattern(newDate, currentRecurrenceType);
    }
  }

  private updateMonthlyPattern(newDate: Date, recurrenceType: string): void {
    const recurrence = this.form().get('recurrence');
    if (!recurrence) {
      return;
    }

    const { weekOfMonth, isLastWeek } = getWeekOfMonth(newDate);

    if ((recurrenceType === 'monthly_nth' && isLastWeek) || (recurrenceType === 'monthly_last' && !isLastWeek)) {
      this.form()
        .get('recurrenceType')
        ?.setValue(isLastWeek ? 'monthly_last' : 'monthly_nth');
    }

    recurrence.patchValue({
      monthly_week: isLastWeek ? -1 : weekOfMonth,
      monthly_week_day: newDate.getDay() + 1,
    });
  }

  private updateRecurrenceFormGroup(recurrenceType: string): void {
    const recurrence = this.form().get('recurrence');
    if (!recurrence) {
      return;
    }

    const startDate = this.form().get('startDate')?.value as Date | null;

    recurrence.patchValue({
      type: null,
      repeat_interval: 0,
      weekly_days: null,
      monthly_day: null,
      monthly_week: null,
      monthly_week_day: null,
      end_date_time: null,
      end_times: null,
    });

    switch (recurrenceType) {
      case 'daily':
        recurrence.patchValue({ type: RecurrenceType.DAILY, repeat_interval: 1 });
        break;

      case 'weekly':
        // weekly_days is 1-7 upstream while Date.getDay() is 0-6.
        recurrence.patchValue({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: startDate ? String(startDate.getDay() + 1) : null });
        break;

      case 'weekdays':
        recurrence.patchValue({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: WEEKDAY_CODES });
        break;

      case 'monthly_nth':
      case 'monthly_last': {
        if (!startDate) {
          break;
        }
        const { weekOfMonth, isLastWeek } = getWeekOfMonth(startDate);
        recurrence.patchValue({
          type: RecurrenceType.MONTHLY,
          repeat_interval: 1,
          monthly_week: isLastWeek ? -1 : weekOfMonth,
          monthly_week_day: startDate.getDay() + 1,
        });
        break;
      }

      // 'none' keeps the cleared group; 'custom' is filled in by the pattern component.
    }
  }

  private buildTimezoneOptions(date: Date): { label: string; value: string }[] {
    return TIMEZONES.map((timezone) => {
      const offset = getTimezoneUtcOffsetString(timezone.value, date);

      return {
        label: offset ? `${timezone.label} (${offset})` : timezone.label,
        value: timezone.value,
      };
    });
  }
}
