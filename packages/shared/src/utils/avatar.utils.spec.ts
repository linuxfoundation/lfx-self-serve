// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { registrantDisplayName } from './avatar.utils';

describe('registrantDisplayName', () => {
  it('joins first and last name', () => {
    expect(registrantDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('uses whichever name part is present', () => {
    expect(registrantDisplayName({ first_name: 'Ada', last_name: '' })).toBe('Ada');
    expect(registrantDisplayName({ first_name: null, last_name: 'Lovelace' })).toBe('Lovelace');
  });

  it('is never blank and never falls back to an email when both parts are empty or whitespace', () => {
    expect(registrantDisplayName({ first_name: '', last_name: '' })).toBe('Guest');
    expect(registrantDisplayName({ first_name: '  ', last_name: undefined })).toBe('Guest');
    expect(registrantDisplayName({ first_name: 'K', last_name: '' })).toBe('K');
  });
});
