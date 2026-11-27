// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type {
  LinkedInCreateAccountOption,
  LinkedInCreateAccountResult,
  LinkedInCreateRefusalInput,
  LinkedInTargetingProfileConfig,
  LinkedInVariantDraft,
} from '../interfaces/campaign.interface';
import {
  linkedInAccountFields,
  linkedInCreateRefusal,
  linkedInDailyCapError,
  linkedInDailyCapField,
  linkedInEffectiveAccount,
  linkedInTargetingEdit,
  linkedInTargetingEmptyWarning,
  linkedInTargetingRemovalsHeld,
  linkedInVariantsForCreate,
} from './campaign-linkedin-form.utils';

const cap = (capUsd: number | null, over: Partial<{ lifetimeBudget: boolean; available: boolean; budgetUsd: number }> = {}) => ({
  capUsd,
  lifetimeBudget: true,
  available: true,
  budgetUsd: 1000,
  ...over,
});

describe('linkedInDailyCapError', () => {
  it.each([
    ['no cap', cap(null), null],
    ['a daily budget', cap(5, { lifetimeBudget: false }), null],
    ['a deployment without the cap', cap(5, { available: false }), null],
    ['a valid cap', cap(20), null],
    ['a cap equal to the budget', cap(1000), null],
    ['an unparsable cap', cap(Number.NaN), 'Enter the daily cap in US dollars, or leave it empty for no cap.'],
    ['a cap under the minimum', cap(9.99), "The daily cap must be at least $10, LinkedIn's daily minimum."],
    ['a cap over the budget', cap(1500), "The daily cap can't be more than the lifetime budget."],
    // campaign-service rounds the total 100.125 to 100.12 (ties to even), so 100.13 is above it.
    ['a cap over a half-cent budget once rounded', cap(100.13, { budgetUsd: 100.125 }), "The daily cap can't be more than the lifetime budget."],
  ])('%s', (_name, input, expected) => {
    expect(linkedInDailyCapError(input)).toBe(expected);
  });
});

describe('linkedInDailyCapField', () => {
  it.each([
    [cap(20), { dailyCapUsd: 20 }],
    [cap(null), {}],
    [cap(20, { lifetimeBudget: false }), {}],
    [cap(20, { available: false }), {}],
  ])('%j sends %j', (input, expected) => {
    expect(linkedInDailyCapField(input)).toEqual(expected);
  });
});

describe('linkedInTargetingEdit and its warning', () => {
  const profile: LinkedInTargetingProfileConfig = { id: 'cloud-native', label: 'Cloud Native', skills: ['s1', 's2'], groups: ['g1'] };

  it.each([
    ['nothing removed', { skills: ['s1', 's2'], groups: ['g1'] }, null, false],
    ['a skill removed', { skills: ['s2'], groups: ['g1'] }, { id: 'cloud-native', skills: ['s2'], groups: ['g1'] }, false],
    ['everything removed', { skills: [], groups: [] }, { id: 'cloud-native', skills: [], groups: [] }, true],
  ])('%s', (_name, effective, edit, warning) => {
    expect(linkedInTargetingEdit(profile, effective)).toEqual(edit);
    expect(linkedInTargetingEmptyWarning(effective, linkedInTargetingEdit(profile, effective))).toBe(warning);
  });

  it('has no edit without a loaded profile', () => {
    expect(linkedInTargetingEdit(null, { skills: [], groups: [] })).toBeNull();
  });

  it.each([
    [undefined, false],
    [{ skills: [], groups: [] }, false],
    [{ skills: ['s1'], groups: [] }, true],
  ])('removals %j are held: %s', (removals, held) => {
    expect(linkedInTargetingRemovalsHeld(removals)).toBe(held);
  });
});

describe('linkedInEffectiveAccount and linkedInAccountFields', () => {
  const def: LinkedInCreateAccountOption = { accountId: '500000001', orgId: '600000001', label: 'Default', isDefault: true };
  const grant: LinkedInCreateAccountOption = { accountId: '500000002', orgId: '600000001', label: 'Grant', isDefault: false };
  const read = (canChoose: boolean): LinkedInCreateAccountResult => ({ ...def, source: 'system', canChoose, accounts: [def, grant] });

  it.each([
    ['no answer', null, '500000002', null],
    ['a caller who cannot choose', read(false), '500000002', def],
    ['a listed pick', read(true), '500000002', grant],
    ['an unlisted pick', read(true), '999', def],
  ])('goes to the right account for %s', (_name, account, chosen, expected) => {
    expect(linkedInEffectiveAccount(account, chosen)).toEqual(expected);
  });

  const fields = { setByConnection: true, selectionAvailable: true, effectiveAccount: grant, canChoose: true, legacyAccountId: '500000009' };
  it.each([
    ['a non-default pick', fields, { selectedAdAccountId: '500000002' }],
    ['the default', { ...fields, effectiveAccount: def }, {}],
    ['no picker', { ...fields, selectionAvailable: false }, {}],
    ['a caller who cannot choose', { ...fields, canChoose: false }, {}],
    ['a failed read', { ...fields, effectiveAccount: null }, {}],
    ['the legacy creator', { ...fields, setByConnection: false }, { adAccountId: '500000009' }],
  ])('sends %s as %j', (_name, input, expected) => {
    expect(linkedInAccountFields(input)).toEqual(expected);
  });
});

describe('linkedInVariantsForCreate', () => {
  const variant = (over: Partial<LinkedInVariantDraft>): LinkedInVariantDraft => ({
    key: 'k',
    introText: 'Join us',
    headline: 'Summit',
    imageAssetId: '',
    imageAssetName: '',
    imageAssetBriefId: '',
    ...over,
  });

  it.each([
    ['an upload for this brief', variant({ imageAssetId: 'a1', imageAssetBriefId: 'b1', imageUrn: 'urn:li:image:1' }), true, { imageAssetId: 'a1' }],
    ['an upload for another brief', variant({ imageAssetId: 'a1', imageAssetBriefId: 'b2', imageUrn: 'urn:li:image:1' }), true, { imageUrn: 'urn:li:image:1' }],
    ['an upload while uploads are off', variant({ imageAssetId: 'a1', imageAssetBriefId: 'b1' }), false, {}],
    ['no image', variant({}), true, {}],
  ])('sends %s', (_name, draft, uploadAvailable, image) => {
    expect(linkedInVariantsForCreate([draft], uploadAvailable, 'b1')).toEqual([{ introText: 'Join us', headline: 'Summit', ...image }]);
  });

  const withFields = variant({ name: 'Ad A', description: 'Talks', callToAction: 'REGISTER' });
  it.each([
    ['nothing on a deployment that sends none', { copy: false, callToAction: false }, {}],
    ['the name and description', { copy: true, callToAction: false }, { name: 'Ad A', description: 'Talks' }],
    ['the call to action', { copy: false, callToAction: true }, { callToAction: 'REGISTER' }],
    ['all three', { copy: true, callToAction: true }, { name: 'Ad A', description: 'Talks', callToAction: 'REGISTER' }],
  ])('sends %s', (_name, fields, expected) => {
    expect(linkedInVariantsForCreate([withFields], true, 'b1', fields)).toEqual([{ introText: 'Join us', headline: 'Summit', ...expected }]);
  });

  it('sends a name of only a byte order mark, which campaign-service keeps as a name', () => {
    const bom = variant({ name: '\uFEFF' });
    expect(linkedInVariantsForCreate([bom], true, 'b1', { copy: true, callToAction: false })[0].name).toBe('\uFEFF');
  });

  it('sends no blank name, description or call to action', () => {
    const blank = variant({ name: ' ', description: '', callToAction: '' });
    expect(linkedInVariantsForCreate([blank], true, 'b1', { copy: true, callToAction: true })).toEqual([{ introText: 'Join us', headline: 'Summit' }]);
  });
});

describe('linkedInCreateRefusal', () => {
  const ok: LinkedInCreateRefusalInput = {
    budgetUsd: 100,
    dailyCapError: null,
    geoTargetCount: 1,
    variantCount: 1,
    variantTextInvalid: false,
    removalsHeld: false,
    targetingEditAvailable: false,
    profileLoaded: false,
    accountSetByConnection: false,
    accountInCatalog: true,
    accountSelectionAvailable: false,
    createAccountStatus: 'idle',
  };

  it.each([
    ['nothing wrong', {}, null],
    ['a budget under $1', { budgetUsd: 0.5 }, 'LinkedIn Ads: set a budget of at least $1.'],
    ['a daily cap error', { dailyCapError: 'x' }, 'LinkedIn Ads: fix the daily cap.'],
    ['no location', { geoTargetCount: 0 }, 'LinkedIn Ads: add at least one location.'],
    ['no variant', { variantCount: 0 }, 'LinkedIn Ads: add at least one ad variant.'],
    ['16 variants', { variantCount: 16 }, 'LinkedIn Ads: remove ad variants until there are at most 15.'],
    ['bad variant text', { variantTextInvalid: true }, 'LinkedIn Ads: fix the ad variant text.'],
    ['a bad ad name or description', { variantFieldsInvalid: true }, 'LinkedIn Ads: fix the ad name or description.'],
    // Text Ads (#5764 row 19) replace the variant checks: no variants is fine, and their own refusal wins.
    [
      'Text Ads no longer offered',
      { textAdsUnavailable: true },
      'LinkedIn Ads: Text Ads are not available right now. Choose single image ads as the ad format.',
    ],
    // Video ads (#5764 row 18): held rather than sent as image ads, and every ad needs its video.
    [
      'video ads no longer offered',
      { videoAdsUnavailable: true },
      'LinkedIn Ads: video ads are not available right now. Choose single image ads as the ad format.',
    ],
    ['an ad with no video', { videoMissing: true }, 'LinkedIn Ads: upload a video for every ad.'],
    // A document (campaign-service#665): held rather than sent as image ads, and it replaces the variant checks.
    [
      'a document no longer offered',
      { documentUnavailable: true },
      'LinkedIn Ads: document ads are not available right now. Choose single image ads as the ad format.',
    ],
    ['a document that can be sent, with no variants', { document: { refusal: null }, variantCount: 0 }, null],
    ['a document that cannot be sent', { document: { refusal: 'LinkedIn Ads: Choose the PDF.' } }, 'LinkedIn Ads: Choose the PDF.'],
    // A boost (campaign-service#673): held rather than sent as image ads, and its post replaces the variant checks.
    [
      'a boost no longer offered',
      { boostUnavailable: true },
      'LinkedIn Ads: boosting a post is not available right now. Choose single image ads as the ad format.',
    ],
    ['a boost that can be sent, with no variants', { boost: { refusal: null }, variantCount: 0 }, null],
    ['a boost that cannot be sent', { boost: { refusal: 'LinkedIn Ads: Choose the post.' } }, 'LinkedIn Ads: Choose the post.'],
    [
      'custom targeting no longer offered',
      { customTargetingUnavailable: true },
      'LinkedIn Ads: custom targeting is not available right now. Choose a targeting profile.',
    ],
    // Lead generation has no Text Ads: change the format, never "add a manual bid", which lead generation refuses.
    [
      'Text Ads beside lead generation',
      { textAdsWithLeadGen: true, textAds: { count: 1, textInvalid: false, manualBid: false } },
      'LinkedIn Ads: lead generation campaigns have no Text Ads. Choose single image or video ads as the ad format.',
    ],
    ['Text Ads with no variants', { variantCount: 0, textAds: { count: 1, textInvalid: false, manualBid: true } }, null],
    [
      'Text Ads without a manual bid',
      { textAds: { count: 1, textInvalid: false, manualBid: false } },
      'LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.',
    ],
    ['removals without the capability', { removalsHeld: true }, 'LinkedIn Ads: targeting changes are not available right now. Reset the targeting profile.'],
    [
      'removals without the profile',
      { removalsHeld: true, targetingEditAvailable: true },
      "LinkedIn Ads: the targeting profile's details have not loaded. Reload the page, or reset the targeting profile.",
    ],
    ['removals that can be sent', { removalsHeld: true, targetingEditAvailable: true, profileLoaded: true }, null],
    // Custom targeting (#5764 rows 8–11) replaces the profile: its own refusal holds, and removals hold nothing.
    ['custom targeting refused', { customTargeting: { refusal: 'Add a value.' } }, 'LinkedIn Ads: fix the custom targeting. Add a value.'],
    ['custom targeting with profile removals', { removalsHeld: true, customTargeting: { refusal: null } }, null],
    // The objective (#5764 rows 2 and 4) arrives as a whole message.
    ['an objective refused', { objectiveRefusal: 'LinkedIn Ads: pick a rule.' }, 'LinkedIn Ads: pick a rule.'],
    ['an objective that can be sent', { objectiveRefusal: null }, null],
    // The target cost (campaign-service#674) arrives as a whole message too.
    ['a target cost refused', { targetCostRefusal: 'LinkedIn Ads: fix it.' }, 'LinkedIn Ads: fix it.'],
    ['a target cost that can be sent', { targetCostRefusal: null }, null],
    // The delivery options (campaign-service#667) arrive as a whole message too.
    ['delivery options held', { deliveryOptionsRefusal: 'LinkedIn Ads: wait.' }, 'LinkedIn Ads: wait.'],
    ['delivery options that can be sent', { deliveryOptionsRefusal: null }, null],
    ['an account the catalog does not list', { accountInCatalog: false }, 'LinkedIn Ads: choose an ad account.'],
    ['an unlisted account the connection decides', { accountInCatalog: false, accountSetByConnection: true }, null],
    [
      'the account read in flight',
      { accountSelectionAvailable: true, createAccountStatus: 'loading' as const },
      'LinkedIn Ads: the ad account is still loading.',
    ],
    ['a failed account read', { accountSelectionAvailable: true, createAccountStatus: 'failed' as const }, null],
  ])('%s', (_name, over, expected) => {
    expect(linkedInCreateRefusal({ ...ok, ...over })).toBe(expected);
  });
});
