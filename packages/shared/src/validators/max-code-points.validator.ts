// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { codePointLength } from '../utils/string.utils';

/**
 * Reactive-form validator that caps a string control by Unicode code-point count
 * (like Go's `[]rune(s)`), not the UTF-16 code units `Validators.maxLength` counts.
 * Keeps the client-side bio limit aligned with the auth-service 2000-rune cap so
 * emoji/non-BMP characters aren't double-counted and rejected below the real limit.
 * Mirrors Angular's maxlength error shape: `{ maxCodePoints: { requiredLength, actualLength } }`.
 * @param max - The maximum allowed number of code points
 */
export function maxCodePointsValidator(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return null;

    const actualLength = codePointLength(value);
    return actualLength > max ? { maxCodePoints: { requiredLength: max, actualLength } } : null;
  };
}
