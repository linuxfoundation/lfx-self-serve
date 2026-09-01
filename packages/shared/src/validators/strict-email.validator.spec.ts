// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { strictEmailValidator } from './strict-email.validator';

// ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl —
// avoids a runtime `@angular/forms` import, which can hit the JIT-compiler crash described on
// formation-validation.helper.ts's deep import (this package's own vitest workers, not just the
// server's, can load @angular/common's Location module before @angular/compiler is warmed up).
function control(value: unknown): AbstractControl {
  return { value } as AbstractControl;
}

describe('strictEmailValidator', () => {
  const validate = (value: unknown): ReturnType<ReturnType<typeof strictEmailValidator>> => strictEmailValidator()(control(value));

  it('allows an empty value (pair with Validators.required if the field is mandatory)', () => {
    expect(validate('')).toBeNull();
    expect(validate(null)).toBeNull();
  });

  it('allows a well-formed email', () => {
    expect(validate('jane@example.test')).toBeNull();
  });

  it("rejects a dotless domain — matches the server validator, unlike Angular's own Validators.email", () => {
    expect(validate('someone@localhost')).toEqual({ email: true });
  });

  it('rejects a value with no @', () => {
    expect(validate('not-an-email')).toEqual({ email: true });
  });
});
