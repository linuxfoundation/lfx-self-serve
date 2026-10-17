// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * A single-line answer (an intake `text` field) holds no line break. The
 * browser strips newlines from what a text input DISPLAYS, so a value that
 * arrived by other means — a prefill from a multi-paragraph LFX description,
 * a restored or remembered answer, a paste the control kept as typed — can
 * carry line breaks the user never sees while the BFF refuses the request as
 * "must be one line". Raises `{ oneLine: true }` so the form says so and
 * blocks the submit; leading and trailing whitespace is ignored because the
 * submission trims it anyway.
 */
export function oneLineValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    return /[\r\n]/.test(value) ? { oneLine: true } : null;
  };
}
