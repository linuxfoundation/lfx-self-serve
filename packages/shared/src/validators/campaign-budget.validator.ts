// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * A campaign budget amount: a finite number strictly greater than zero.
 *
 * Mirrors the BFF's own check on `PATCH /api/campaigns/:campaignId/budget`, which refuses a
 * numeric string, a non-finite value and anything `<= 0`. Zero is not a budget — stopping spend is
 * what pause is for. The platforms' own, stricter minimums are NOT checked here: they differ per
 * platform and per account currency, so campaign-service enforces them and its 400 names the floor.
 *
 * Returns `{ budgetRequired }` for an empty control, `{ budgetNotNumber }` for anything that is not
 * a finite number, and `{ budgetNotPositive }` for zero or below. Never rounds or coerces.
 */
export function campaignBudgetAmountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value: unknown = control.value;
    if (value === null || value === undefined || value === '') {
      return { budgetRequired: true };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { budgetNotNumber: true };
    }
    return value > 0 ? null : { budgetNotPositive: true };
  };
}
