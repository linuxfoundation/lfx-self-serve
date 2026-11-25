// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_TEXT_AD_LIMITS } from '../constants/campaign.constants';
import type { LinkedInTextAd, LinkedInTextAdDraft, LinkedInTextAdsRefusalInput, LinkedInTextAdView } from '../interfaces/campaign.interface';
import { linkedInCreativeTextLength } from './campaign-linkedin.utils';

/**
 * The Implement tab's LinkedIn Text Ads editor rules (#5764 row 19): each ad's counters and errors, what the create
 * sends, and why Create is held. The same limits as the create route (`campaign-linkedin-text-ads.utils.ts`), counted
 * the way campaign-service counts them.
 */

const KEY_PREFIX = 'text-ad-';

/** A key no ad in `drafts` has: one past the highest `text-ad-<n>`, so a restored list never collides with a new ad. */
export function nextLinkedInTextAdKey(drafts: readonly LinkedInTextAdDraft[]): string {
  const highest = drafts.reduce((max, draft) => {
    const n = draft.key.startsWith(KEY_PREFIX) ? Number(draft.key.slice(KEY_PREFIX.length)) : Number.NaN;
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  return `${KEY_PREFIX}${highest + 1}`;
}

/** An empty text ad for `drafts`, with a key none of them has. */
export function newLinkedInTextAdDraft(drafts: readonly LinkedInTextAdDraft[]): LinkedInTextAdDraft {
  return { key: nextLinkedInTextAdKey(drafts), headline: '', description: '' };
}

function fieldError(label: 'headline' | 'description', length: number): string {
  if (length === 0) return `Enter the ${label}.`;
  const limit = LINKEDIN_TEXT_AD_LIMITS[label];
  return length > limit ? `The ${label} can be at most ${limit} characters.` : '';
}

/** Each ad as the editor shows it: its lengths after normalization and the error under each field. */
export function linkedInTextAdViews(drafts: readonly LinkedInTextAdDraft[]): LinkedInTextAdView[] {
  return drafts.map((draft) => {
    const headlineLength = linkedInCreativeTextLength(draft.headline);
    const descriptionLength = linkedInCreativeTextLength(draft.description);
    return {
      ...draft,
      headlineLength,
      descriptionLength,
      headlineError: fieldError('headline', headlineLength),
      descriptionError: fieldError('description', descriptionLength),
    };
  });
}

/** The text ads as sent: the copy as typed, which campaign-service normalizes itself. `key` is never sent. */
export function linkedInTextAdsForCreate(drafts: readonly LinkedInTextAdDraft[]): LinkedInTextAd[] {
  return drafts.map(({ headline, description }) => ({ headline, description }));
}

/** Why the Text Ads hold Create, or `null`. The first failing check wins; each message names its fix. */
export function linkedInTextAdsCreateRefusal(input: LinkedInTextAdsRefusalInput): string | null {
  if (!input.manualBid) return 'LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.';
  if (input.count === 0) return 'LinkedIn Ads: add at least one text ad.';
  if (input.count > LINKEDIN_TEXT_AD_LIMITS.ads) return `LinkedIn Ads: remove text ads until there are at most ${LINKEDIN_TEXT_AD_LIMITS.ads}.`;
  if (input.textInvalid) return 'LinkedIn Ads: fix the text ad text.';
  return null;
}
