// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { campaignBidAmountValidator } from './campaign-bid.validator';

const control = (value: unknown): AbstractControl => ({ value }) as AbstractControl;
const validate = (value: unknown): ValidationErrors | null => campaignBidAmountValidator()(control(value));

describe('campaignBidAmountValidator', () => {
  it.each([null, undefined, ''])('requires a value (%s)', (value) => {
    expect(validate(value)).toEqual({ bidRequired: true });
  });

  it.each([0, -1, -0.01])('refuses a non-positive bid (%s)', (value) => {
    expect(validate(value)).toEqual({ bidNotPositive: true });
  });

  // A numeric string is refused rather than coerced, matching the BFF.
  it.each(['1.25', Number.NaN, Number.POSITIVE_INFINITY, {}])('refuses a value that is not a finite number (%s)', (value) => {
    expect(validate(value)).toEqual({ bidNotNumber: true });
  });

  // The platform's own floor and ceiling are upstream's to enforce; no client-side cap.
  it.each([0.001, 0.01, 1.25, 1000, 5000])('accepts a positive bid (%s)', (value) => {
    expect(validate(value)).toBeNull();
  });
});
