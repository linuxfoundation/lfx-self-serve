// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { SelectComponent } from '@components/select/select.component';
import { SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS, SURVEY_DISTRIBUTION_OPTIONS, SURVEY_REMINDER_TYPE_OPTIONS } from '@lfx-one/shared/constants';
import { SurveyDistributionMethod, SurveyReminderType } from '@lfx-one/shared/interfaces';
import { map, startWith, switchMap, of } from 'rxjs';

@Component({
  selector: 'lfx-survey-timing-reminders',
  imports: [ReactiveFormsModule, CalendarComponent, SelectComponent],
  templateUrl: './survey-timing-reminders.component.html',
})
export class SurveyTimingRemindersComponent {
  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);

  // Constants for template
  public readonly distributionOptions = [...SURVEY_DISTRIBUTION_OPTIONS];
  public readonly reminderTypeOptions = [...SURVEY_REMINDER_TYPE_OPTIONS];
  public readonly reminderFrequencyOptions = [...SURVEY_AUTO_REMINDER_FREQUENCY_OPTIONS];

  // Computed signals for conditional rendering
  public readonly distributionMethod: Signal<SurveyDistributionMethod> = this.initDistributionMethod();
  public readonly reminderType: Signal<SurveyReminderType> = this.initReminderType();
  public readonly scheduledDate: Signal<Date | null> = this.initScheduledDate();
  public readonly isScheduled: Signal<boolean> = computed(() => this.distributionMethod() === 'scheduled');
  public readonly isAutomatic: Signal<boolean> = computed(() => this.reminderType() === 'automatic');

  // Computed min dates
  public readonly todayDate: Date = new Date();
  public readonly minCutoffDate: Signal<Date> = this.initMinCutoffDate();

  /**
   * Set distribution method value
   */
  public setDistributionMethod(value: SurveyDistributionMethod): void {
    const control = this.form().get('distributionMethod');
    if (control) {
      control.setValue(value);
      control.markAsDirty();

      // Clear scheduled date if switching to immediate
      if (value === 'immediate') {
        this.form().get('scheduledDate')?.setValue(null);
      }
    }
  }

  /**
   * Set reminder type value
   */
  public setReminderType(value: SurveyReminderType): void {
    const control = this.form().get('reminderType');
    if (control) {
      control.setValue(value);
      control.markAsDirty();
    }
  }

  // Private initializer functions
  private initDistributionMethod(): Signal<SurveyDistributionMethod> {
    const formControl$ = toObservable(computed(() => this.form().get('distributionMethod')));

    return toSignal(
      formControl$.pipe(
        switchMap((formControl) => {
          if (!formControl) {
            return of('immediate' as SurveyDistributionMethod);
          }
          return formControl.valueChanges.pipe(
            startWith(formControl.value),
            map((value) => (value as SurveyDistributionMethod) || 'immediate')
          );
        })
      ),
      { initialValue: 'immediate' }
    );
  }

  private initReminderType(): Signal<SurveyReminderType> {
    const formControl$ = toObservable(computed(() => this.form().get('reminderType')));

    return toSignal(
      formControl$.pipe(
        switchMap((formControl) => {
          if (!formControl) {
            return of('automatic' as SurveyReminderType);
          }
          return formControl.valueChanges.pipe(
            startWith(formControl.value),
            map((value) => (value as SurveyReminderType) || 'automatic')
          );
        })
      ),
      { initialValue: 'automatic' }
    );
  }

  private initScheduledDate(): Signal<Date | null> {
    const formControl$ = toObservable(computed(() => this.form().get('scheduledDate')));

    return toSignal(
      formControl$.pipe(
        switchMap((formControl) => {
          if (!formControl) {
            return of(null);
          }
          return formControl.valueChanges.pipe(
            startWith(formControl.value),
            map((value) => (value as Date | null) || null)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initMinCutoffDate(): Signal<Date> {
    // Uses scheduledDate signal (not form control value directly) to establish proper
    // signal dependency. This ensures minCutoffDate re-evaluates when scheduledDate changes.
    return computed(() => {
      if (this.isScheduled()) {
        const scheduledDate = this.scheduledDate();
        if (scheduledDate) {
          return scheduledDate;
        }
      }
      return this.todayDate;
    });
  }
}
