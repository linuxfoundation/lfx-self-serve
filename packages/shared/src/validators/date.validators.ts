// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

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
