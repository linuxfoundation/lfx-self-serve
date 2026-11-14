// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CAMPAIGN_MONITOR_ACT_PLATFORMS, isValidCampaignRefId } from './campaign-optimize.constants';

describe('CAMPAIGN_MONITOR_ACT_PLATFORMS', () => {
  it('offers row actions on LinkedIn, Reddit, Meta, Microsoft Ads and X only', () => {
    expect([...CAMPAIGN_MONITOR_ACT_PLATFORMS].sort()).toEqual(['linkedin-ads', 'meta-ads', 'microsoft-ads', 'reddit-ads', 'twitter-ads']);
  });

  it('does not offer them on Google Ads, which is not an act platform', () => {
    expect(CAMPAIGN_MONITOR_ACT_PLATFORMS.has('google-ads' as never)).toBe(false);
  });
});

describe('isValidCampaignRefId (Microsoft Ads)', () => {
  it.each(['1', '413296582', '9223372036854775807'])('accepts %s', (id) => {
    expect(isValidCampaignRefId('microsoft-ads', id)).toBe(true);
  });

  // Mirrors `resolve-microsoft-ads-campaign`: digits, no leading zero, within int64.
  it.each(['', '0', '0413296582', '9223372036854775808', '99999999999999999999', 'abc', '12a'])('refuses %s', (id) => {
    expect(isValidCampaignRefId('microsoft-ads', id)).toBe(false);
  });
});
