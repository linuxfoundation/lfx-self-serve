// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googlePerformanceMaxAudienceSignalCarried,
  googlePerformanceMaxAudienceSignalRefusal,
  googlePerformanceMaxAudienceSignalTypeRefusal,
} from './campaign-google-performance-max-signal.utils';

const AUDIENCE = 'customers/1234567890/audiences/42';

describe('googlePerformanceMaxAudienceSignalRefusal', () => {
  it('asks nothing of an absent or empty value', () => {
    for (const value of [undefined, null, '']) expect(googlePerformanceMaxAudienceSignalRefusal(value)).toBeNull();
  });

  it('takes a full Audience resource name, trimmed as Go trims', () => {
    expect(googlePerformanceMaxAudienceSignalRefusal(AUDIENCE)).toBeNull();
    expect(googlePerformanceMaxAudienceSignalRefusal(` ${AUDIENCE}\u0085`)).toBeNull();
    expect(googlePerformanceMaxAudienceSignalRefusal(AUDIENCE, '1234567890')).toBeNull();
  });

  it("takes a bare canonical audience id, which upstream resolves in the campaign's own account", () => {
    expect(googlePerformanceMaxAudienceSignalRefusal('42')).toBeNull();
    expect(googlePerformanceMaxAudienceSignalRefusal(' 42 ', '1234567890')).toBeNull();
    expect(googlePerformanceMaxAudienceSignalRefusal('9223372036854775807')).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(googlePerformanceMaxAudienceSignalRefusal(42)).toBe('The Performance Max audience signal must be a Google Ads Audience id or resource name.');
    expect(googlePerformanceMaxAudienceSignalRefusal(['x'])).toContain('must be a Google Ads Audience id or resource name');
  });

  it('refuses a blank value', () => {
    expect(googlePerformanceMaxAudienceSignalRefusal(' \u0085 ')).toBe(
      'The Performance Max audience signal must not be blank. Remove it, or pick an Audience.'
    );
  });

  it('refuses every other shape, and an id that is not canonical, without echoing it', () => {
    for (const value of [
      '0',
      '042',
      '9223372036854775808',
      '-42',
      'customers/1234567890/userLists/42',
      'customers/1234567890/audiences/',
      'customers/123-456-7890/audiences/42',
      'customers/1234567890/audiences/042',
      'customers/1234567890/audiences/0',
      'audiences/42',
    ]) {
      const refusal = googlePerformanceMaxAudienceSignalRefusal(value);
      expect(refusal).toContain('is not a Google Ads Audience (an audience id, or customers/<id>/audiences/<id>)');
      expect(refusal).not.toContain(value === '0' ? 'audiences/0' : value);
    }
  });

  it("refuses another account's Audience only when the account is known", () => {
    expect(googlePerformanceMaxAudienceSignalRefusal('customers/999/audiences/42')).toBeNull();
    expect(googlePerformanceMaxAudienceSignalRefusal('customers/999/audiences/42', '1234567890')).toContain('belongs to another Google Ads account');
  });
});

describe('googlePerformanceMaxAudienceSignalTypeRefusal', () => {
  it('refuses a value that is not a string, naming the type, without judging its shape', () => {
    for (const value of [42, ['x'], {}, true])
      expect(googlePerformanceMaxAudienceSignalTypeRefusal(value)).toContain('must be a Google Ads Audience id or resource name');
  });

  it('asks nothing of an absent, null or empty-list value, and passes every string, blank or malformed included', () => {
    for (const value of [undefined, null, [], '', ' ', 'nope', AUDIENCE]) expect(googlePerformanceMaxAudienceSignalTypeRefusal(value)).toBeNull();
  });
});

describe('googlePerformanceMaxAudienceSignalCarried', () => {
  it('counts any value but an absent, null or empty one, as the upstream gates count it', () => {
    for (const value of [AUDIENCE, ' ', 'nope', 42, ['x'], [], {}]) expect(googlePerformanceMaxAudienceSignalCarried(value)).toBe(true);
    for (const value of [undefined, null, '']) expect(googlePerformanceMaxAudienceSignalCarried(value)).toBe(false);
  });
});
