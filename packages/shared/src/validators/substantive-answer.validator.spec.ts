// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { substantiveAnswerValidator } from './substantive-answer.validator';

describe('substantiveAnswerValidator', () => {
  // ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
  const validate = (value: unknown): Record<string, unknown> | null => substantiveAnswerValidator()({ value } as AbstractControl);

  it('refuses an empty answer, a skip and a TBD — the questions step takes none of them', () => {
    for (const value of ['', '   ', null, 'TBD', 'tbd', 'Skip', 'n/a', '-']) {
      expect(validate(value)).toEqual({ substantiveAnswer: true });
    }
  });

  it('takes a real answer, including one that merely contains such a word', () => {
    expect(validate('Platform teams; SREs.')).toBeNull();
    expect(validate('Skip the Silver tier; name Gold.')).toBeNull();
  });
});
