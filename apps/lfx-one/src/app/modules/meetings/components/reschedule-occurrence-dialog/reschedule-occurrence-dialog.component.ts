// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { MessageComponent } from '@components/message/message.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { MAX_CUSTOM_DURATION, MIN_CUSTOM_DURATION } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence, MeetingRescheduleOccurrenceResult } from '@lfx-one/shared/interfaces';
import { combineDateTime, formatTo12HourInTimezone, getLongTimezoneName, getUserTimezone } from '@lfx-one/shared/utils';
import { futureDateTimeValidator, timeFormatValidator } from '@lfx-one/shared/validators';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { toZonedTime } from 'date-fns-tz';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-reschedule-occurrence-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CalendarComponent, InputNumberComponent, MessageComponent, TimePickerComponent, MeetingTimePipe],
  templateUrl: './reschedule-occurrence-dialog.component.html',
})
export class RescheduleOccurrenceDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);

  public readonly meeting: Meeting = this.config.data.meeting;
  public readonly occurrence: MeetingOccurrence = this.config.data.occurrence;
  // The occurrence endpoint takes no timezone, so the new time is always read in the series' own zone.
  public readonly timezone: string = this.meeting.timezone || getUserTimezone();
  public readonly timezoneLabel: string = getLongTimezoneName(this.occurrence.start_time, this.timezone) || this.timezone;
  public readonly minDuration = MIN_CUSTOM_DURATION;
  public readonly maxDuration = MAX_CUSTOM_DURATION;
  public readonly minDate: Date = new Date();
  public readonly form: FormGroup = this.initializeForm();

  public readonly isSaving = signal(false);
  public readonly errorMessage = signal<string | null>(null);

  private readonly formRevision: Signal<number> = this.initFormRevision();
  public readonly newStartTime: Signal<string> = computed(() => {
    this.formRevision();
    const { startDate, startTime } = this.form.getRawValue();
    return startDate && startTime ? combineDateTime(startDate, startTime, this.timezone) : '';
  });
  public readonly isUnchanged: Signal<boolean> = computed(() => {
    this.formRevision();
    const start = this.newStartTime();
    return (
      !!start &&
      new Date(start).getTime() === new Date(this.occurrence.start_time).getTime() &&
      Number(this.form.get('duration')?.value) === this.occurrence.duration
    );
  });
  public readonly showFutureError: Signal<boolean> = computed(() => {
    this.formRevision();
    return !!this.form.errors?.['futureDateTime'] && !!(this.form.get('startDate')?.touched || this.form.get('startTime')?.touched);
  });
  public readonly showTimeFormatError: Signal<boolean> = computed(() => {
    this.formRevision();
    const control = this.form.get('startTime');
    return !!control?.touched && !!control.errors?.['invalidTimeFormat'];
  });
  public readonly showDurationError: Signal<boolean> = computed(() => {
    this.formRevision();
    const control = this.form.get('duration');
    return !!control?.touched && control.invalid;
  });
  public readonly canSave: Signal<boolean> = computed(() => {
    this.formRevision();
    return this.form.valid && !!this.newStartTime() && !this.isUnchanged() && !this.isSaving();
  });

  public onCancel(): void {
    const result: MeetingRescheduleOccurrenceResult = { confirmed: false };
    this.dialogRef.close(result);
  }

  public onConfirm(): void {
    this.form.markAllAsTouched();
    if (!this.canSave()) {
      return;
    }

    const startTime = this.newStartTime();
    const duration = Number(this.form.get('duration')?.value);

    this.isSaving.set(true);
    this.errorMessage.set(null);

    this.meetingService.updateOccurrence(this.meeting.id, this.occurrence.occurrence_id, { start_time: startTime, duration }).subscribe({
      next: () => {
        this.isSaving.set(false);
        const result: MeetingRescheduleOccurrenceResult = { confirmed: true, start_time: startTime };
        this.dialogRef.close(result);
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.errorMessage.set(this.describeError(error));
      },
    });
  }

  private initializeForm(): FormGroup {
    const occurrenceStart = new Date(this.occurrence.start_time);

    return new FormGroup(
      {
        startDate: new FormControl<Date | null>(toZonedTime(occurrenceStart, this.timezone), [Validators.required]),
        startTime: new FormControl(formatTo12HourInTimezone(occurrenceStart, this.timezone), [Validators.required, timeFormatValidator()]),
        duration: new FormControl<number | null>(this.occurrence.duration, [
          Validators.required,
          Validators.min(MIN_CUSTOM_DURATION),
          Validators.max(MAX_CUSTOM_DURATION),
          Validators.pattern(/^\d+$/),
        ]),
        // Not user-editable; present only because `futureDateTimeValidator` reads the zone off the group.
        timezone: new FormControl(this.timezone),
      },
      { validators: futureDateTimeValidator() }
    );
  }

  private initFormRevision(): Signal<number> {
    let revision = 0;
    return toSignal(
      this.form.events.pipe(
        map(() => ++revision),
        startWith(0)
      ),
      { initialValue: 0 }
    );
  }

  private describeError(error: HttpErrorResponse): string {
    if (error.status === 400) {
      const upstreamMessage = error.error?.message ?? error.error?.error;
      return typeof upstreamMessage === 'string' && upstreamMessage ? upstreamMessage : 'This time could not be used for the occurrence. Please pick another.';
    }
    if (error.status === 403) {
      return 'You do not have permission to reschedule this occurrence.';
    }
    if (error.status === 404) {
      return 'This occurrence no longer exists. Please refresh the page.';
    }
    if (error.status === 0) {
      return 'Network error. Please check your connection and try again.';
    }
    return 'Failed to reschedule the occurrence. Please try again.';
  }
}
