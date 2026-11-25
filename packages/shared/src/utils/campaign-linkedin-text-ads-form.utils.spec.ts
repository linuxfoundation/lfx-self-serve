// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { LinkedInTextAdDraft } from '../interfaces/campaign.interface';
import {
  linkedInTextAdViews,
  linkedInTextAdsCreateRefusal,
  linkedInTextAdsForCreate,
  newLinkedInTextAdDraft,
  nextLinkedInTextAdKey,
} from './campaign-linkedin-text-ads-form.utils';

const ad = (key: string, headline = 'KubeCon NA', description = 'Join cloud native engineers.'): LinkedInTextAdDraft => ({ key, headline, description });

describe('nextLinkedInTextAdKey', () => {
  it.each([
    [[], 'text-ad-1'],
    [[ad('text-ad-1'), ad('text-ad-4')], 'text-ad-5'],
    [[ad('restored'), ad('text-ad-x'), ad('text-ad-2')], 'text-ad-3'],
  ])('after %j is %s', (drafts, expected) => {
    expect(nextLinkedInTextAdKey(drafts)).toBe(expected);
  });

  it('starts a new ad empty, under a fresh key', () => {
    expect(newLinkedInTextAdDraft([ad('text-ad-1')])).toEqual({ key: 'text-ad-2', headline: '', description: '' });
  });
});

describe('linkedInTextAdViews', () => {
  it.each([
    ['valid copy', ad('a'), '', ''],
    ['blank copy', ad('a', '  ', ' — '), 'Enter the headline.', 'Enter the description.'],
    ['copy at the limits', ad('a', 'h'.repeat(25), 'd'.repeat(75)), '', ''],
    [
      'copy over the limits',
      ad('a', 'h'.repeat(26), 'd'.repeat(76)),
      'The headline can be at most 25 characters.',
      'The description can be at most 75 characters.',
    ],
    ['emoji counted as characters', ad('a', '🚀'.repeat(25)), '', ''],
  ])('shows %s', (_name, draft, headlineError, descriptionError) => {
    expect(linkedInTextAdViews([draft])[0]).toMatchObject({ headlineError, descriptionError });
  });

  it('counts each field after normalization', () => {
    expect(linkedInTextAdViews([ad('a', '  Summit — 2099 ', 'Go')])[0]).toMatchObject({ headlineLength: 12, descriptionLength: 2 });
  });
});

describe('linkedInTextAdsForCreate', () => {
  it('sends the copy as typed, without the key', () => {
    expect(linkedInTextAdsForCreate([ad('a', ' Summit ', 'Go')])).toEqual([{ headline: ' Summit ', description: 'Go' }]);
  });
});

describe('linkedInTextAdsCreateRefusal', () => {
  const ok = { count: 1, textInvalid: false, manualBid: true };

  it.each([
    ['ready Text Ads', ok, null],
    ['no manual bid', { ...ok, manualBid: false }, 'LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.'],
    ['no text ads', { ...ok, count: 0 }, 'LinkedIn Ads: add at least one text ad.'],
    ['101 text ads', { ...ok, count: 101 }, 'LinkedIn Ads: remove text ads until there are at most 100.'],
    ['invalid text', { ...ok, textInvalid: true }, 'LinkedIn Ads: fix the text ad text.'],
  ])('holds Create for %s', (_name, input, expected) => {
    expect(linkedInTextAdsCreateRefusal(input)).toBe(expected);
  });
});
