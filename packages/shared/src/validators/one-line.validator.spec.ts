// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { oneLineValidator } from './one-line.validator';

describe('oneLineValidator', () => {
  // ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
  const validate = (value: unknown): Record<string, unknown> | null => oneLineValidator()({ value } as AbstractControl);

  it('takes blank and any one-line value, inner spaces included', () => {
    expect(validate('')).toBeNull();
    expect(validate('   ')).toBeNull();
    expect(validate('An open release toolkit for platform teams.')).toBeNull();
    expect(validate(null)).toBeNull();
  });

  it('refuses a value with a line break inside it, LF or CRLF', () => {
    expect(validate('Line one.\nLine two.')).toEqual({ oneLine: true });
    expect(validate('Line one.\r\n\r\nLine two.')).toEqual({ oneLine: true });
  });

  it('ignores a leading or trailing line break, which the submission trims anyway', () => {
    expect(validate('Line one.\n')).toBeNull();
    expect(validate('\r\n  Line one.  \n')).toBeNull();
  });
});
