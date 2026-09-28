// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { parseTrimmedString } from './mentorship-params.helper';

describe('parseTrimmedString', () => {
  it('returns the trimmed value', () => {
    expect(parseTrimmedString('  abc  ')).toBe('abc');
  });

  it('treats a blank string as absent', () => {
    expect(parseTrimmedString('   ')).toBeUndefined();
  });

  it('treats a non-string value as absent', () => {
    expect(parseTrimmedString(undefined)).toBeUndefined();
    expect(parseTrimmedString(['a', 'b'])).toBeUndefined();
    expect(parseTrimmedString(42)).toBeUndefined();
  });
});
