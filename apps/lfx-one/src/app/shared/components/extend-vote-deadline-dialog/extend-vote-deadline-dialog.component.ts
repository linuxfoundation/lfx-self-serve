// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { SelectComponent } from '@components/select/select.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { ExtendVoteDeadlineDialogData, ExtendVoteDeadlineDialogResult } from '@lfx-one/shared/interfaces';
import { buildTimezoneOptions, combineDateTime, formatTo12HourInTimezone, getUserTimezone, toZonedDateCarrier } from '@lfx-one/shared/utils';
import { validTimeFormat, voteExtendDeadlineValidator } from '@lfx-one/shared/validators';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Prompts for a new close date/time/timezone later than the vote's current deadline, then resolves
 * with the combined `end_time`/`end_time_timezone` for `VoteService.extendVote` to submit.
 */
@Component({
  selector: 'lfx-extend-vote-deadline-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CalendarComponent, TimePickerComponent, SelectComponent],
  templateUrl: './extend-vote-deadline-dialog.component.html',
})
export class ExtendVoteDeadlineDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<ExtendVoteDeadlineDialogData>);

  public readonly data = this.dialogConfig.data as ExtendVoteDeadlineDialogData;

  public readonly form = new FormGroup(
    {
      close_date: new FormControl<Date | null>(this.initCloseDate(), { nonNullable: false, validators: [Validators.required] }),
      close_time: new FormControl<string>(this.initCloseTime(), { nonNullable: true, validators: [Validators.required, validTimeFormat()] }),
      timezone: new FormControl<string>(this.initTimezone(), { nonNullable: true, validators: [Validators.required] }),
    },
    { validators: voteExtendDeadlineValidator(this.data.currentEndTime) }
  );

  public readonly timezoneOptions: Signal<{ label: string; value: string }[]> = this.initTimezoneOptions();
  public readonly minDate: Signal<Date> = this.initMinDate();

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  private readonly formStatus = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  protected readonly canConfirm: Signal<boolean> = computed(() => this.formStatus() === 'VALID');

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onConfirm(): void {
    const { close_date, close_time, timezone } = this.form.getRawValue();
    if (!close_date || !close_time || !timezone || this.form.invalid) return;

    const endTime = combineDateTime(close_date, close_time, timezone);
    if (!endTime) return;

    this.dialogRef.close({ end_time: endTime, end_time_timezone: timezone } satisfies ExtendVoteDeadlineDialogResult);
  }

  private initCloseDate(): Date {
    return toZonedDateCarrier(new Date(this.data.currentEndTime), this.data.currentEndTimeTimezone ?? getUserTimezone());
  }

  private initCloseTime(): string {
    return formatTo12HourInTimezone(new Date(this.data.currentEndTime), this.data.currentEndTimeTimezone ?? getUserTimezone());
  }

  private initTimezone(): string {
    return this.data.currentEndTimeTimezone ?? getUserTimezone();
  }

  private initTimezoneOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => buildTimezoneOptions(new Date(this.data.currentEndTime)));
  }

  private initMinDate(): Signal<Date> {
    return computed(() => toZonedDateCarrier(new Date(this.data.currentEndTime), this.formValue().timezone ?? this.initTimezone()));
  }
}
