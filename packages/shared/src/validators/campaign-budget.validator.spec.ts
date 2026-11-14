// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { campaignBudgetAmountValidator } from './campaign-budget.validator';

// The validator only reads `control.value`, so a minimal stub is sufficient.
const control = (value: unknown): AbstractControl => ({ value }) as AbstractControl;
const validate = (value: unknown): ValidationErrors | null => campaignBudgetAmountValidator()(control(value));

describe('campaignBudgetAmountValidator', () => {
  it.each([null, undefined, ''])('requires a value (%s)', (value) => {
    expect(validate(value)).toEqual({ budgetRequired: true });
  });

  it.each([0, -1, -0.01])('refuses a non-positive amount (%s)', (value) => {
    expect(validate(value)).toEqual({ budgetNotPositive: true });
  });

  // A numeric string is refused rather than coerced, matching the BFF.
  it.each(['25', Number.NaN, Number.POSITIVE_INFINITY, {}])('refuses a value that is not a finite number (%s)', (value) => {
    expect(validate(value)).toEqual({ budgetNotNumber: true });
  });

  it.each([0.000001, 0.01, 1, 2500, 1234.567])('accepts a positive amount (%s)', (value) => {
    expect(validate(value)).toBeNull();
  });
});
