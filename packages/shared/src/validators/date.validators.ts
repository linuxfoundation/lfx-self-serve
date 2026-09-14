// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function notPastDateValidator(today: Date): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as Date | null;
    if (!value) return null;

    const date = new Date(value);
    date.setHours(0, 0, 0, 0);

    return date.getTime() < today.getTime() ? { pastDate: true } : null;
  };
}

/**
 * Validates a 12-hour time string (e.g. "11:59 PM") — format and range (hour 1-12, minute 0-59).
 * Empty values pass so Validators.required owns the empty message. Free-typed time-picker input
 * preserves unrecognized text, so without this a garbage value would satisfy `required` and reach
 * the API builders as an unparseable time.
 */
export function validTimeFormat(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string | null | undefined;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return { invalidTimeFormat: true };

    const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return { invalidTimeFormat: true };

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours >= 1 && hours <= 12 && minutes <= 59 ? null : { invalidTimeFormat: true };
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
