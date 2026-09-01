// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { isValidEmail } from '../utils/email.utils';

/**
 * Validates against the same `EMAIL_REGEX` the server's formation intake validator checks
 * (`formation-validation.helper.ts`'s `parseContact`, via a deep import to avoid pulling
 * `@angular/forms` into a server-only vitest worker). Angular's own `Validators.email` uses a
 * looser regex that admits a dotless domain (e.g. `someone@localhost`), which the server then
 * 400s on with no inline error — this keeps the two checks provably identical instead of two
 * independently-drifting patterns.
 */
export function strictEmailValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return { email: true };

    return isValidEmail(value) ? null : { email: true };
  };
}
