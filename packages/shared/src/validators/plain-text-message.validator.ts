// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { codePointLength, sanitizePlainText } from '../utils/string.utils';

/**
 * Validates free text destined for a CLA backend endpoint that sanitizes before it validates.
 * Both checks run on the sanitized value, so the control agrees with the producer: text that is
 * only control characters is blank, and control characters do not consume the cap. Emits the same
 * error shapes as `trimmedRequired` and `maxCodePointsValidator` so existing error mapping holds.
 * @param options - `required` rejects a value that sanitizes to empty; `max` caps sanitized code points
 */
export function plainTextMessageValidator(options: { required: boolean; max: number }): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string') return null;

    const sanitized = sanitizePlainText(value);
    const actualLength = codePointLength(sanitized);
    if (actualLength > options.max) return { maxCodePoints: { requiredLength: options.max, actualLength } };
    if (options.required && !sanitized) return { trimmedRequired: true };
    return null;
  };
}
