// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { asRecord, asString, asStringArray } from './mentorship-profile-columns.helper';

describe('mentorship profile column narrowers', () => {
  it('treats only a plain object as a record', () => {
    expect(asRecord({ skills: [] })).toEqual({ skills: [] });
    expect(asRecord(['a'])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord('text')).toBeUndefined();
  });

  it('treats a blank string as missing', () => {
    expect(asString('Go')).toBe('Go');
    expect(asString('   ')).toBeUndefined();
    expect(asString(3)).toBeUndefined();
  });

  it('keeps only the non-blank strings of a list', () => {
    expect(asStringArray(['Go', '', 4, ' ', 'Rust'])).toEqual(['Go', 'Rust']);
    expect(asStringArray('Go')).toEqual([]);
  });
});
