// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function httpsUrlValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return { httpsUrl: true };

    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'https:' ? null : { httpsUrl: true };
    } catch {
      return { httpsUrl: true };
    }
  };
}
