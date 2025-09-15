// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  RECURRENCE_DAYS_OF_WEEK,
  RECURRENCE_END_TYPE_OPTIONS,
  RECURRENCE_MONTHLY_TYPE_OPTIONS,
  RECURRENCE_PATTERN_TYPE_OPTIONS,
  RECURRENCE_WEEKLY_ORDINALS,
} from '@lfx-pcc/shared/constants';
import { getWeekOfMonth } from '@lfx-pcc/shared/utils';

@Component({
  selector: 'lfx-meeting-recurrence-pattern',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CalendarComponent, InputTextComponent, RadioButtonComponent, SelectComponent],
  templateUrl: './meeting-recurrence-pattern.component.html',
})
export class MeetingRecurrencePatternComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  public readonly form = input.required<FormGroup>();

  // UI state signals that react to form changes
  public readonly patternType = signal<string>('weekly');
  public readonly monthlyType = signal<string>('dayOfMonth');
  public readonly endType = signal<string>('never');
  public readonly weeklyDaysArray = signal<number[]>([]);
  public readonly patternTypeOptions = RECURRENCE_PATTERN_TYPE_OPTIONS;
  public readonly endTypeOptions = RECURRENCE_END_TYPE_OPTIONS;
  public readonly monthlyTypeOptions = RECURRENCE_MONTHLY_TYPE_OPTIONS;
  public readonly daysOfWeek = RECURRENCE_DAYS_OF_WEEK;
  public readonly weeklyOrdinals = RECURRENCE_WEEKLY_ORDINALS;

  // Get the recurrence FormGroup from parent
  public readonly recurrenceForm = computed(() => this.form().get('recurrence') as FormGroup);
  public readonly startDate: Signal<Date> = computed(() => this.form().get('startDate')?.value as Date);
  public readonly minEndDate = computed(() => {
    const start = this.startDate();
    if (!start) return new Date();
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });

  public ngOnInit(): void {
    // Initialize defaults if needed
    this.initializeDefaults();

    // Subscribe to form value changes to update signals
    this.setupFormSubscriptions();
  }

  // Pattern type change handlers

  // Weekly days handlers
  public onWeeklyDayChange(dayIndex: number, event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    const checked = checkbox.checked;
    const currentDays = this.weeklyDaysArray();
    let newDays: number[];

    if (checked) {
      newDays = [...currentDays, dayIndex].sort();
    } else {
      newDays = currentDays.filter((day: number) => day !== dayIndex);
    }

    // Convert back to 1-7 format and create comma-separated string
    const weeklyDaysString = newDays.map((day) => day + 1).join(',');
    this.recurrenceForm()
      ?.get('weekly_days')
      ?.setValue(weeklyDaysString || null);
  }

  public isWeeklyDaySelected(dayIndex: number): boolean {
    return this.weeklyDaysArray().includes(dayIndex);
  }

  // Monthly handlers
  public onMonthlyTypeChange(monthlyType: string): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    if (monthlyType === 'dayOfMonth') {
      recurrenceForm.patchValue({
        monthly_day: this.startDate().getDate(),
        monthly_week: null,
        monthly_week_day: null,
      });
    } else {
      // dayOfWeek
      const startDate = this.startDate();
      const { weekOfMonth } = getWeekOfMonth(startDate);
      recurrenceForm.patchValue({
        monthly_day: null,
        monthly_week: weekOfMonth,
        monthly_week_day: startDate.getDay() + 1, // Convert 0-6 to 1-7
      });
    }
  }

  // End condition handlers
  public onEndTypeChange(endType: string): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    const currentValue = recurrenceForm.value;
    const updateData: any = {};

    // Only clear end_date_time if switching away from 'date' type
    if (endType !== 'date') {
      updateData.end_date_time = null;
    }

    // Only clear end_times if switching away from 'occurrences' type
    if (endType === 'occurrences') {
      // If there's no existing end_times value, set default of 10
      if (!currentValue.end_times) {
        updateData.end_times = 10;
      }
    } else if (endType !== 'occurrences') {
      updateData.end_times = null;
    }

    // Only update if there are changes to make
    if (Object.keys(updateData).length > 0) {
      recurrenceForm.patchValue(updateData);
    }
  }

  public updateForNewStartDate(newDate: Date): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    const patternType = this.patternType();
    const currentValue = recurrenceForm.value;

    if (!currentValue.type) return; // No recurrence pattern set

    switch (patternType) {
      case 'daily':
        // Daily patterns don't need updates for date changes
        break;

      case 'weekly':
        this.updateWeeklyPatternForNewDate(newDate, currentValue);
        break;

      case 'monthly':
        this.updateMonthlyPatternForNewDate(newDate);
        break;
    }
  }

  private handlePatternTypeChange(patternType: string): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    // Set the type based on pattern
    let type = 2; // default to weekly
    if (patternType === 'daily') type = 1;
    else if (patternType === 'weekly') type = 2;
    else if (patternType === 'monthly') type = 3;

    recurrenceForm.patchValue({
      type: type,
      // Clear pattern-specific fields when changing pattern type
      weekly_days: patternType === 'weekly' ? this.getDefaultWeeklyDays() : null,
      monthly_day: patternType === 'monthly' ? this.startDate().getDate() : null,
      monthly_week: null,
      monthly_week_day: null,
    });
  }

  // Helper methods
  private setupFormSubscriptions(): void {
    // Subscribe to patternTypeUI changes
    this.form()
      .get('patternTypeUI')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.patternType.set(value || 'weekly');
        this.handlePatternTypeChange(value);
      });

    // Subscribe to monthlyTypeUI changes
    this.recurrenceForm()
      ?.get('monthlyTypeUI')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.monthlyType.set(value || 'dayOfMonth');
        this.onMonthlyTypeChange(value);
      });

    // Subscribe to endTypeUI changes
    this.recurrenceForm()
      ?.get('endTypeUI')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.endType.set(value || 'never');
        this.onEndTypeChange(value);
      });

    // Subscribe to recurrence form changes for UI state
    this.recurrenceForm()
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.updateUISignals(value);
      });

    // Subscribe to start date changes for custom recurrence updates
    this.form()
      .get('startDate')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((newDate) => {
        if (newDate) {
          this.updateForNewStartDate(newDate as Date);
        }
      });

    // Initialize signals with current values
    const currentPatternType = this.form().get('patternTypeUI')?.value;
    this.patternType.set(currentPatternType || 'weekly');
    this.updateUISignals(this.recurrenceForm()?.value || {});
  }

  private updateUISignals(recurrenceValue: any): void {
    // Update monthlyType signal from UI control
    if (recurrenceValue.monthlyTypeUI) {
      this.monthlyType.set(recurrenceValue.monthlyTypeUI);
    } else {
      // Fallback to data-based detection
      if (recurrenceValue.monthly_day) {
        this.monthlyType.set('dayOfMonth');
      } else if (recurrenceValue.monthly_week && recurrenceValue.monthly_week_day) {
        this.monthlyType.set('dayOfWeek');
      } else {
        this.monthlyType.set('dayOfMonth');
      }
    }

    // Update endType signal from UI control
    if (recurrenceValue.endTypeUI) {
      this.endType.set(recurrenceValue.endTypeUI);
    } else {
      // Fallback to data-based detection
      if (recurrenceValue.end_date_time) {
        this.endType.set('date');
      } else if (recurrenceValue.end_times) {
        this.endType.set('occurrences');
      } else {
        this.endType.set('never');
      }
    }

    // Update weeklyDaysArray signal
    if (recurrenceValue.weekly_days) {
      const daysArray = recurrenceValue.weekly_days
        .split(',')
        .map((d: string) => {
          const num = Number(d.trim());
          return isNaN(num) ? null : num - 1;
        })
        .filter((d: number | null): d is number => d !== null);
      this.weeklyDaysArray.set(daysArray);
    } else {
      this.weeklyDaysArray.set([]);
    }
  }

  private initializeDefaults(): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    const currentValue = recurrenceForm.value;

    // Set defaults if not already set
    if (!currentValue.type) {
      recurrenceForm.patchValue({
        type: 2, // Weekly
        repeat_interval: 1,
        weekly_days: this.getDefaultWeeklyDays(),
      });
    }
  }

  private getDefaultWeeklyDays(): string {
    // Default to the current start date's day of week
    const startDate = this.startDate();
    return String(startDate.getDay() + 1); // Convert 0-6 to 1-7
  }

  private updateWeeklyPatternForNewDate(newDate: Date, currentValue: any): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm || !currentValue.weekly_days) return;

    const currentDays = currentValue.weekly_days
      .split(',')
      .map((d: string) => {
        const num = Number(d.trim());
        return isNaN(num) ? null : num;
      })
      .filter((d: number | null): d is number => d !== null);

    // If only one day is selected, update it to the new day
    if (currentDays.length === 1) {
      const newDay = newDate.getDay() + 1; // Convert 0-6 to 1-7
      recurrenceForm.patchValue({
        weekly_days: String(newDay),
      });
    }
    // If multiple days are selected, preserve the selection
    // (user has specifically chosen multiple days)
  }

  private updateMonthlyPatternForNewDate(newDate: Date): void {
    const recurrenceForm = this.recurrenceForm();
    if (!recurrenceForm) return;

    // Check the monthlyTypeUI control or monthlyType signal to determine pattern type
    const monthlyTypeUI = recurrenceForm.get('monthlyTypeUI')?.value || this.monthlyType();

    if (monthlyTypeUI === 'dayOfMonth') {
      // Day of month pattern - update to new date's day of month
      recurrenceForm.patchValue({
        monthly_day: newDate.getDate(),
        // Clear day of week fields
        monthly_week: null,
        monthly_week_day: null,
      });
    } else if (monthlyTypeUI === 'dayOfWeek') {
      // Day of week pattern - recalculate week position for new date
      const { weekOfMonth, isLastWeek } = getWeekOfMonth(newDate);
      recurrenceForm.patchValue({
        // Clear day of month field
        monthly_day: null,
        monthly_week: isLastWeek ? -1 : weekOfMonth,
        monthly_week_day: newDate.getDay() + 1, // Convert 0-6 to 1-7
      });
    }
  }
}
