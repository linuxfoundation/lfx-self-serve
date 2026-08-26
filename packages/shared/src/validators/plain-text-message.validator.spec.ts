// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { plainTextMessageValidator } from './plain-text-message.validator';

// ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
function control(value: unknown): AbstractControl {
  return { value } as AbstractControl;
}

describe('plainTextMessageValidator', () => {
  function validate(value: unknown, options: { required: boolean; max: number }) {
    return plainTextMessageValidator(options)(control(value));
  }

  const required = { required: true, max: 10 };
  const optional = { required: false, max: 10 };

  it('accepts text within the cap', () => {
    expect(validate('hello', required)).toBeNull();
  });

  it('rejects a required value that sanitizes to empty, which the producer would refuse', () => {
    expect(validate('\x07\x1b', required)).toEqual({ trimmedRequired: true });
    expect(validate('   ', required)).toEqual({ trimmedRequired: true });
  });

  it('allows an empty optional value', () => {
    expect(validate('', optional)).toBeNull();
    expect(validate('\x07', optional)).toBeNull();
  });

  it('does not let control characters consume the cap', () => {
    // Ten real characters plus stripped controls is within the cap, because the producer counts
    // only what survives sanitization.
    expect(validate(`0123456789${'\x07'.repeat(50)}`, required)).toBeNull();
  });

  it('rejects text whose sanitized length exceeds the cap', () => {
    expect(validate('01234567890', required)).toEqual({ maxCodePoints: { requiredLength: 10, actualLength: 11 } });
  });

  it('measures the cap in code points, so an emoji counts once', () => {
    expect(validate('😀'.repeat(10), required)).toBeNull();
    expect(validate('😀'.repeat(11), required)).toEqual({ maxCodePoints: { requiredLength: 10, actualLength: 11 } });
  });

  it('ignores a non-string value', () => {
    expect(validate(null, required)).toBeNull();
    expect(validate(undefined, required)).toBeNull();
  });
});
