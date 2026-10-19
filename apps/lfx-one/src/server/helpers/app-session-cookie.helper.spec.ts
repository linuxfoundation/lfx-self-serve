// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { readAppSessionId } from './app-session-cookie.helper';

const SID = 'c'.repeat(64);
const OTHER_SID = 'd'.repeat(64);

describe('readAppSessionId', () => {
  it('returns the store-backed session id', () => {
    expect(readAppSessionId(`theme=dark; appSession=${SID}; other=1`)).toBe(SID);
  });

  it('takes the first appSession when the cookie appears twice', () => {
    expect(readAppSessionId(`appSession=${SID}; appSession=${OTHER_SID}`)).toBe(SID);
  });

  it('ignores the chunked cookie-mode appSession.0 and appSession.1', () => {
    expect(readAppSessionId(`appSession.0=${SID}; appSession.1=${OTHER_SID}`)).toBeNull();
  });

  it.each([
    ['upper-case hex', 'C'.repeat(64)],
    ['a non-hex value', 'z'.repeat(64)],
    ['a short id', 'c'.repeat(63)],
    ['a long id', 'c'.repeat(65)],
    ['an empty value', ''],
  ])('returns null for %s', (_label, value) => {
    expect(readAppSessionId(`appSession=${value}`)).toBeNull();
  });

  it('returns null with no cookie header or no appSession', () => {
    expect(readAppSessionId(undefined)).toBeNull();
    expect(readAppSessionId('theme=dark')).toBeNull();
  });
});
