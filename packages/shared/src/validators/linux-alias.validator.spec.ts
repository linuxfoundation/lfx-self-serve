// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { LINUX_ALIAS_BANNED_CHARS, LINUX_ALIAS_MAX_LENGTH, LINUX_ALIAS_RESERVED_NAMES } from '../constants/linux-email.constants';
import { linuxAliasValidator } from './linux-alias.validator';

// The validator only reads `control.value`, so a minimal stub is sufficient.
const control = (value: unknown): AbstractControl => ({ value }) as AbstractControl;
const validate = (value: unknown) => linuxAliasValidator()(control(value));

describe('linuxAliasValidator', () => {
  it('defers empty/nullish input to the required validator (returns null)', () => {
    expect(validate('')).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });

  it('flags required when the value is only whitespace', () => {
    expect(validate('   ')).toEqual({ required: true });
  });

  it('flags aliasInvalidChars for non-string input', () => {
    expect(validate(123)).toEqual({ aliasInvalidChars: true });
  });

  describe('length', () => {
    it('accepts a value at the max length', () => {
      expect(validate('a'.repeat(LINUX_ALIAS_MAX_LENGTH))).toBeNull();
    });

    it('flags aliasMaxLength when over the limit, reporting lengths', () => {
      const actualLength = LINUX_ALIAS_MAX_LENGTH + 1;
      expect(validate('a'.repeat(actualLength))).toEqual({
        aliasMaxLength: { requiredLength: LINUX_ALIAS_MAX_LENGTH, actualLength },
      });
    });

    it('measures length after trimming', () => {
      const padded = `  ${'a'.repeat(LINUX_ALIAS_MAX_LENGTH)}  `;
      expect(validate(padded)).toBeNull();
    });
  });

  describe('banned characters', () => {
    it.each([...LINUX_ALIAS_BANNED_CHARS])('flags aliasInvalidChars for %p', (char) => {
      expect(validate(`alice${char}bob`)).toEqual({ aliasInvalidChars: true });
    });
  });

  describe('reserved names', () => {
    it.each([...LINUX_ALIAS_RESERVED_NAMES])('flags aliasReserved for %p', (name) => {
      expect(validate(name)).toEqual({ aliasReserved: true });
    });

    it('matches reserved names case-insensitively', () => {
      expect(validate('Postmaster')).toEqual({ aliasReserved: true });
      expect(validate('  ADMIN  ')).toEqual({ aliasReserved: true });
    });
  });

  describe('valid aliases', () => {
    it.each([['alice'], ['bob.smith'], ['jane-doe'], ['user123'], ['a']])('accepts %p', (value) => {
      expect(validate(value)).toBeNull();
    });

    it('normalizes case/whitespace before accepting', () => {
      expect(validate('  Alice.Smith  ')).toBeNull();
    });
  });
});
