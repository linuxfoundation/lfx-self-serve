// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { maxCodePointsValidator } from './max-code-points.validator';

// ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
function control(value: unknown): AbstractControl {
  return { value } as AbstractControl;
}

describe('maxCodePointsValidator', () => {
  const validate = maxCodePointsValidator(2000);

  it('passes for null, undefined, and empty string (optional field)', () => {
    expect(validate(control(null))).toBeNull();
    expect(validate(control(undefined))).toBeNull();
    expect(validate(control(''))).toBeNull();
  });

  it('passes a value exactly at the code-point limit', () => {
    expect(validate(control('a'.repeat(2000)))).toBeNull();
  });

  it('fails a value one code point over the limit with the maxlength-style error shape', () => {
    expect(validate(control('a'.repeat(2001)))).toEqual({ maxCodePoints: { requiredLength: 2000, actualLength: 2001 } });
  });

  it('accepts 2000 emoji even though String.length is 4000 (the bug this fixes)', () => {
    expect(validate(control('😀'.repeat(2000)))).toBeNull();
  });

  it('rejects 2001 emoji, counting code points not UTF-16 units', () => {
    expect(validate(control('😀'.repeat(2001)))).toEqual({ maxCodePoints: { requiredLength: 2000, actualLength: 2001 } });
  });

  it('ignores non-string values (other validators own type-shape errors)', () => {
    expect(validate(control(12345))).toBeNull();
  });
});
