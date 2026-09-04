// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { combineDateTime, isDateTimeInFutureForTimezone } from '../utils/date-time.utils';

export function notPastDateValidator(today: Date): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as Date | null;
    if (!value) return null;

    const date = new Date(value);
    date.setHours(0, 0, 0, 0);

    return date.getTime() < today.getTime() ? { pastDate: true } : null;
  };
}

export function notFutureDateValidator(today: Date): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as Date | null;
    if (!value) return null;

    const date = new Date(value);
    date.setHours(0, 0, 0, 0);

    return date.getTime() > today.getTime() ? { futureDate: true } : null;
  };
}

/** Group validator: the vote close date/time must be in the future in the chosen timezone (same-day deadlines allowed). Mirrors futureDateTimeValidator with vote control names. */
export function voteDeadlineValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const formGroup = control as any; // FormGroup
    const closeDate = formGroup.get?.('close_date')?.value;
    const closeTime = formGroup.get?.('close_time')?.value;
    const timezone = formGroup.get?.('timezone')?.value;

    if (!closeDate || !closeTime || !timezone) {
      return null; // Don't validate if values are not set
    }

    const combinedDateTime = combineDateTime(closeDate, closeTime, timezone);
    if (!combinedDateTime) {
      return null; // Invalid time format
    }

    if (!isDateTimeInFutureForTimezone(combinedDateTime, timezone)) {
      return { futureDateTime: true };
    }

    return null;
  };
}
