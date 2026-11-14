// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CAMPAIGN_BIDDING_CREATE_PLATFORMS, CAMPAIGN_BIDDING_PLATFORMS, CAMPAIGN_BIDDING_RULES } from '../constants/campaign.constants';
import type { CampaignBiddingDraft, CampaignBiddingPlatform } from '../interfaces/campaign.interface';
import { campaignBiddingError, campaignBiddingPayload, campaignBiddingSummary, defaultCampaignBiddingDraft } from './campaign-bidding.utils';

const manual = (bidAmount: number | null): CampaignBiddingDraft => ({ strategy: 'manual', bidAmount });

describe('campaign bidding rules', () => {
  it('never offers Google Ads, which has its own bidding plan', () => {
    expect(CAMPAIGN_BIDDING_PLATFORMS as readonly string[]).not.toContain('google-ads');
    expect(CAMPAIGN_BIDDING_CREATE_PLATFORMS as readonly string[]).not.toContain('google-ads');
    expect(Object.keys(CAMPAIGN_BIDDING_RULES)).not.toContain('google-ads');
  });

  it('bids LinkedIn in USD and every other platform in the ad account currency', () => {
    expect(CAMPAIGN_BIDDING_RULES['linkedin-ads'].currency).toBe('USD');
    for (const platform of ['meta-ads', 'microsoft-ads', 'reddit-ads', 'twitter-ads'] as const) {
      expect(CAMPAIGN_BIDDING_RULES[platform].currency).toBe('account');
    }
  });
});

describe('defaultCampaignBiddingDraft', () => {
  it('is automatic with no amount', () => {
    expect(defaultCampaignBiddingDraft()).toEqual({ strategy: 'automatic', bidAmount: null });
  });
});

describe('campaignBiddingError', () => {
  it.each(CAMPAIGN_BIDDING_PLATFORMS.map((p) => [p]))('accepts automatic on %s whatever the context', (platform) => {
    expect(campaignBiddingError(platform, defaultCampaignBiddingDraft(), { objective: 'conversions', dailyBudget: 0.01 })).toBeNull();
  });

  it.each(CAMPAIGN_BIDDING_PLATFORMS.map((p) => [p]))('refuses a manual choice with no amount on %s', (platform) => {
    expect(campaignBiddingError(platform, manual(null), { objective: 'traffic' })).toContain('Enter a max CPC bid');
    expect(campaignBiddingError(platform, manual(Number.NaN), { objective: 'traffic' })).toContain('Enter a max CPC bid');
    expect(campaignBiddingError(platform, manual(Number.POSITIVE_INFINITY), { objective: 'traffic' })).toContain('Enter a max CPC bid');
  });

  it.each(CAMPAIGN_BIDDING_PLATFORMS.map((p) => [p]))('refuses zero and negative amounts on %s', (platform) => {
    expect(campaignBiddingError(platform, manual(0), { objective: 'traffic' })).toBe('The max CPC bid must be greater than zero.');
    expect(campaignBiddingError(platform, manual(-1), { objective: 'traffic' })).toBe('The max CPC bid must be greater than zero.');
  });

  it.each(CAMPAIGN_BIDDING_PLATFORMS.map((p) => [p]))('refuses more than the 1,000,000 ceiling on %s', (platform) => {
    expect(campaignBiddingError(platform, manual(1_000_000.01), { objective: 'traffic' })).toMatch(/at most/);
  });

  describe('LinkedIn', () => {
    it('accepts whole cents', () => {
      expect(campaignBiddingError('linkedin-ads', manual(2.5))).toBeNull();
      expect(campaignBiddingError('linkedin-ads', manual(0.29))).toBeNull();
    });

    it('refuses a third decimal rather than rounding it', () => {
      expect(campaignBiddingError('linkedin-ads', manual(2.345))).toContain('two decimal places');
    });
  });

  describe('Microsoft', () => {
    it('accepts 0.01 to 1,000 at two decimals', () => {
      expect(campaignBiddingError('microsoft-ads', manual(0.01))).toBeNull();
      expect(campaignBiddingError('microsoft-ads', manual(1000))).toBeNull();
    });

    it('refuses outside 0.01 to 1,000 and a third decimal', () => {
      expect(campaignBiddingError('microsoft-ads', manual(1000.01))).toBe('The max CPC bid can be at most 1,000.');
      expect(campaignBiddingError('microsoft-ads', manual(0.005))).toBe('The max CPC bid must be at least 0.01.');
      expect(campaignBiddingError('microsoft-ads', manual(1.255))).toContain('two decimal places');
    });
  });

  describe('Meta', () => {
    it('accepts manual under traffic and leads with a daily budget of 5× the bid', () => {
      expect(campaignBiddingError('meta-ads', manual(2), { objective: 'traffic', dailyBudget: 10 })).toBeNull();
      expect(campaignBiddingError('meta-ads', manual(2), { objective: 'leads', dailyBudget: 10 })).toBeNull();
    });

    it('treats a missing objective as traffic, as campaign-service does', () => {
      expect(campaignBiddingError('meta-ads', manual(1), { dailyBudget: 5 })).toBeNull();
    });

    it.each(['awareness', 'engagement', 'conversions'])('refuses manual under the %s objective', (objective) => {
      expect(campaignBiddingError('meta-ads', manual(1), { objective, dailyBudget: 100 })).toContain('needs the Traffic or Leads objective');
    });

    it('refuses a daily budget under 5× the bid', () => {
      expect(campaignBiddingError('meta-ads', manual(2.01), { objective: 'traffic', dailyBudget: 10 })).toContain('at least 5× the bid (10.05)');
    });

    it('skips the 5× rule for a lifetime budget', () => {
      expect(campaignBiddingError('meta-ads', manual(50), { objective: 'traffic', dailyBudget: null })).toBeNull();
    });

    it('refuses a third decimal', () => {
      expect(campaignBiddingError('meta-ads', manual(0.125), { objective: 'traffic', dailyBudget: 100 })).toContain('two decimal places');
    });
  });

  describe('Reddit', () => {
    it('accepts manual under traffic, at micro-unit precision', () => {
      expect(campaignBiddingError('reddit-ads', manual(0.123456), { objective: 'traffic' })).toBeNull();
    });

    it('refuses a seventh decimal', () => {
      expect(campaignBiddingError('reddit-ads', manual(0.1234567), { objective: 'traffic' })).toContain('six decimal places');
    });

    it.each(['awareness', 'conversions', 'video_views'])('refuses manual under the %s objective', (objective) => {
      expect(campaignBiddingError('reddit-ads', manual(1), { objective })).toContain('needs the Traffic objective');
    });

    it('treats a missing objective as conversions, as campaign-service does, and refuses manual', () => {
      expect(campaignBiddingError('reddit-ads', manual(1))).toContain('needs the Traffic objective');
    });
  });

  describe('X', () => {
    it('accepts a bid up to the daily budget', () => {
      expect(campaignBiddingError('twitter-ads', manual(20), { dailyBudget: 20 })).toBeNull();
    });

    it('refuses a bid above the daily budget', () => {
      expect(campaignBiddingError('twitter-ads', manual(20.000001), { dailyBudget: 20 })).toContain('cannot exceed the daily budget');
    });
  });
});

describe('campaignBiddingPayload', () => {
  it('sends automatic as the bare strategy, with no amount key', () => {
    const payload = campaignBiddingPayload('linkedin-ads', { strategy: 'automatic', bidAmount: 3 });
    expect(payload).toEqual({ strategy: 'automatic' });
    expect(Object.keys(payload ?? {})).toEqual(['strategy']);
  });

  it('sends manual with the amount exactly as entered', () => {
    expect(campaignBiddingPayload('meta-ads', manual(1.25), { objective: 'traffic', dailyBudget: 100 })).toEqual({ strategy: 'manual', bidAmount: 1.25 });
  });

  it.each([
    ['linkedin-ads', manual(null), {}],
    ['microsoft-ads', manual(0), {}],
    ['meta-ads', manual(1), { objective: 'awareness', dailyBudget: 100 }],
    ['reddit-ads', manual(1), { objective: 'conversions' }],
    ['twitter-ads', manual(30), { dailyBudget: 20 }],
  ] as [CampaignBiddingPlatform, CampaignBiddingDraft, object][])('returns null rather than a refused shape on %s', (platform, draft, context) => {
    expect(campaignBiddingPayload(platform, draft, context)).toBeNull();
  });

  it('never produces null, an empty string or unknown keys', () => {
    const payloads = CAMPAIGN_BIDDING_PLATFORMS.flatMap((p) => [
      campaignBiddingPayload(p, defaultCampaignBiddingDraft()),
      campaignBiddingPayload(p, manual(1), { objective: 'traffic', dailyBudget: 100 }),
    ]);
    for (const payload of payloads) {
      expect(payload).not.toBeNull();
      for (const [key, value] of Object.entries(payload ?? {})) {
        expect(['strategy', 'bidAmount']).toContain(key);
        expect(value).not.toBeNull();
        expect(value).not.toBe('');
      }
    }
  });
});

describe('campaignBiddingSummary', () => {
  it('is empty when nothing is recorded', () => {
    expect(campaignBiddingSummary('meta-ads', undefined, undefined)).toBe('');
  });

  it('names a manual bid in USD on LinkedIn and the account currency elsewhere', () => {
    expect(campaignBiddingSummary('linkedin-ads', 'manual', 2.5)).toBe('Bidding: manual · max CPC bid 2.5 USD');
    expect(campaignBiddingSummary('reddit-ads', 'manual', 0.75)).toBe('Bidding: manual · max CPC bid 0.75 in the ad account currency');
  });

  it('reports automatic without inventing a bid', () => {
    expect(campaignBiddingSummary('meta-ads', 'automatic', undefined)).toBe('Bidding: automatic');
  });

  it('ignores a strategy outside the contract rather than echoing it', () => {
    expect(campaignBiddingSummary('meta-ads', '<script>', undefined)).toBe('');
    expect(campaignBiddingSummary('meta-ads', 'MANUAL', 'abc')).toBe('');
  });
});
