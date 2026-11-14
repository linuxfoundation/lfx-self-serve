// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * A campaign's manual max CPC bid: a finite number strictly greater than zero.
 *
 * Mirrors the BFF's own check on `PATCH /api/campaigns/:campaignId/bid`, which refuses a numeric
 * string, a non-finite value and anything `<= 0`. Each platform's own floor and ceiling (Microsoft's
 * 0.01 to 1000, and the others') is NOT checked here: it differs per platform and per account
 * currency, so campaign-service enforces it and its 400 names the bound.
 *
 * Returns `{ bidRequired }` for an empty control, `{ bidNotNumber }` for anything that is not a
 * finite number, and `{ bidNotPositive }` for zero or below. Never rounds or coerces.
 */
export function campaignBidAmountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (value === null || value === undefined || value === '') {
      return { bidRequired: true };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { bidNotNumber: true };
    }
    return value > 0 ? null : { bidNotPositive: true };
  };
}
