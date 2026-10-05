// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { constantTimeEquals, validatePassword } from './security.util';

describe('constantTimeEquals', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('s3cret', 's3cret')).toBe(true);
    expect(constantTimeEquals('s3cret', 's3creT')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });

  it('is false, without throwing, when the lengths differ', () => {
    expect(constantTimeEquals('s3cret', 's3cret!')).toBe(false);
    expect(constantTimeEquals('s3cret!', 's3cret')).toBe(false);
    expect(constantTimeEquals('', 's3cret')).toBe(false);
  });

  it('compares multi-byte characters by their UTF-8 bytes', () => {
    expect(constantTimeEquals('pässwörd', 'pässwörd')).toBe(true);
    expect(constantTimeEquals('pässwörd', 'passwörd')).toBe(false);
  });

  it('is false when either side is null or undefined', () => {
    expect(constantTimeEquals(null, 's3cret')).toBe(false);
    expect(constantTimeEquals('s3cret', undefined)).toBe(false);
    expect(constantTimeEquals(null, null)).toBe(false);
  });
});

describe('validatePassword', () => {
  it('delegates to the constant-time comparison', () => {
    expect(validatePassword('123456', '123456')).toBe(true);
    expect(validatePassword('123456', '654321')).toBe(false);
    expect(validatePassword('', '123456')).toBe(false);
  });
});
