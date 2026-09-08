// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildDeepLinkKey } from './deep-link-consumption.util';

// Regression coverage for PR #2247 review (Copilot): the consumption key must be scoped by tab,
// not just eventId, so a visa-letters deep link consumed first doesn't suppress a later
// travel-funding deep link for the same event.
describe('buildDeepLinkKey', () => {
  it('produces different keys for the same event id under different tabs', () => {
    expect(buildDeepLinkKey('visa-letters', 'evt-1')).not.toBe(buildDeepLinkKey('travel-funding', 'evt-1'));
  });

  it('produces different keys for different event ids under the same tab', () => {
    expect(buildDeepLinkKey('visa-letters', 'evt-1')).not.toBe(buildDeepLinkKey('visa-letters', 'evt-2'));
  });

  it('produces the same key for the same tab and event id', () => {
    expect(buildDeepLinkKey('visa-letters', 'evt-1')).toBe(buildDeepLinkKey('visa-letters', 'evt-1'));
  });
});
