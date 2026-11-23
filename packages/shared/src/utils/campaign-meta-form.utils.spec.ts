// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_DEFAULT_PLACEMENTS, META_OBJECTIVE_LABELS } from '../constants/campaign.constants';
import type { MetaPlacement } from '../interfaces/campaign.interface';
import {
  metaAcceptedGeos,
  metaBasicsRefusal,
  metaBriefSeed,
  metaCreateRefusal,
  type MetaCreateRefusalInput,
  metaDsaCountries,
  metaDsaFieldError,
  metaEffectiveGeoTargets,
  metaGeoIsIneligible,
  metaHasPlacement,
  metaInstagramDsaFields,
  metaInstagramUserIdError,
  metaObjectiveIsUnavailable,
  metaPixelField,
  metaPixelValid,
  metaPlacementIsSelectable,
  metaPlacementOverrides,
  metaRequiresPixel,
  metaUsesInstagram,
} from './campaign-meta-form.utils';

const placements = (overrides: Partial<MetaPlacement> = {}): MetaPlacement => ({ ...META_DEFAULT_PLACEMENTS, ...overrides });

const ALL_OFF: Partial<MetaPlacement> = { facebookFeed: false, instagramFeed: false, stories: false, reels: false, audienceNetwork: false };

describe('metaAcceptedGeos', () => {
  it.each([
    // Uppercased and trimmed, as campaign-service's `validateGeoTargets` does.
    [[' jp '], ['JP']],
    // De-duped in first-seen order, so `us` beside `US` cannot show a set that never reaches Meta.
    [['US', 'us'], ['US']],
    [
      ['us', 'US', 'JP'],
      ['US', 'JP'],
    ],
    [
      ['de', 'DE', ' fr '],
      ['DE', 'FR'],
    ],
    [
      ['jp', 'de', 'JP'],
      ['JP', 'DE'],
    ],
    // Shape: a malformed code cannot be a country.
    [['US', '1', '!!', 'x9', 'U', 'USA'], ['US']],
    [['us', 'USA', '1', ''], ['US']],
    [['US', '   '], ['US']],
    // Well-shaped but unassigned (ISO user-assigned range): no ad platform can target it.
    [['ZZ'], []],
    // Assigned but Meta-ineligible, refused before the ad set rather than after the campaign POST.
    [['IR', 'JP'], ['JP']],
    [['CU', 'JP'], ['JP']],
    // Eligibility stays narrow: a regulated market is assigned, so it passes here and is filtered upstream.
    [['SG'], ['SG']],
  ])('accepts %j as %j', (codes, expected) => {
    expect(metaAcceptedGeos(codes)).toEqual(expected);
  });
});

describe('metaGeoIsIneligible', () => {
  it.each([
    ['IR', true],
    [' ir ', true],
    ['CU', true],
    ['JP', false],
    ['SG', false],
  ])('%j is ineligible: %s', (code, expected) => {
    expect(metaGeoIsIneligible(code)).toBe(expected);
  });
});

describe('metaEffectiveGeoTargets', () => {
  it.each([
    // The eligible chips win over the country code.
    [['US', 'DE'], 'FR', ['US', 'DE']],
    [['IR', 'JP'], 'US', ['JP']],
    // No eligible chip: the eligible, normalised country code.
    [[], 'de', ['DE']],
    [['IR'], 'de', ['DE']],
    // Nothing usable: empty, which blocks Create rather than letting the server default to US.
    [[], '', []],
    [[], 'IR', []],
  ])('chips %j with country %j send %j', (chips, countryCode, expected) => {
    expect(metaEffectiveGeoTargets(chips, countryCode)).toEqual(expected);
  });
});

describe('metaDsaCountries', () => {
  it.each([
    [
      ['US', 'DE', 'FR'],
      ['DE', 'FR'],
    ],
    // EEA outside the EU counts too, as campaign-service's list does.
    [['NO'], ['NO']],
    [['US', 'GB', 'CH'], []],
  ])('%j require the DSA disclosures for %j', (geos, expected) => {
    expect(metaDsaCountries(geos)).toEqual(expected);
  });
});

describe('placements', () => {
  it('lets the operator toggle every placement except the retired Messenger Inbox', () => {
    expect(metaPlacementIsSelectable('messengerInbox')).toBe(false);
    for (const key of ['facebookFeed', 'instagramFeed', 'stories', 'reels', 'audienceNetwork'] as const) {
      expect(metaPlacementIsSelectable(key)).toBe(true);
    }
  });

  it.each([
    [{}, true],
    [ALL_OFF, false],
    [{ ...ALL_OFF, reels: true }, true],
    // Messenger Inbox cannot contribute a publisher platform, so it alone does not count.
    [{ ...ALL_OFF, messengerInbox: true }, false],
  ])('with %j at least one placement is on: %s', (overrides, expected) => {
    expect(metaHasPlacement(placements(overrides))).toBe(expected);
  });

  it.each([
    [{}, true],
    [{ instagramFeed: false }, false],
    [{ instagramFeed: false, stories: true }, true],
    [{ instagramFeed: false, reels: true }, true],
  ])('with %j the ad set uses Instagram: %s', (overrides, expected) => {
    expect(metaUsesInstagram(placements(overrides))).toBe(expected);
  });

  it.each([
    // Untouched defaults put no placement keys on the wire.
    [{}, {}],
    [{ reels: true }, { reels: true }],
    // A disabled default is sent as an explicit false.
    [{ facebookFeed: false }, { facebookFeed: false }],
    // Toggled off then back on re-collapses: a key equal to its default is dropped.
    [{ facebookFeed: true }, {}],
    // Every selectable placement on still never introduces the retired key.
    [
      { stories: true, reels: true, audienceNetwork: true },
      { stories: true, reels: true, audienceNetwork: true },
    ],
  ])('%j sends the overrides %j', (overrides, expected) => {
    expect(metaPlacementOverrides(placements(overrides))).toEqual(expected);
  });
});

describe('pixel', () => {
  it.each([
    ['conversions', true],
    ['traffic', false],
    ['engagement', false],
    ['awareness', false],
    ['leads', false],
  ] as const)('%s requires a pixel: %s', (objective, expected) => {
    expect(metaRequiresPixel(objective)).toBe(expected);
  });

  it.each([
    ['conversions', '', false],
    // Non-empty but not numeric: Meta pixel ids are numeric and upstream rejects it on `numericIDRE`.
    ['conversions', 'PIX9', false],
    // Upstream trims before both checks, so whitespace-only reads as empty.
    ['conversions', '   ', false],
    ['conversions', '123456789012345', true],
    ['conversions', '  123456789012345  ', true],
    // A stale value under another objective is neither validated nor sent.
    ['traffic', 'PIX9', true],
    ['engagement', '', true],
  ] as const)('%s with pixel %j is valid: %s', (objective, pixelId, expected) => {
    expect(metaPixelValid(objective, pixelId)).toBe(expected);
  });

  it.each([
    ['conversions', '  123456789012345  ', { pixelId: '123456789012345' }],
    ['traffic', 'PIX9', {}],
    ['engagement', '554433', {}],
  ] as const)('%s with pixel %j sends %j', (objective, pixelId, expected) => {
    expect(metaPixelField(objective, pixelId)).toEqual(expected);
  });
});

describe('metaInstagramUserIdError', () => {
  const REQUIRED = 'An Instagram account ID is required for the Instagram placements. Enter it, or turn off Instagram Feed, Stories and Reels.';

  it.each([
    // Off, or no Instagram placement: never required, whatever was typed.
    [false, true, '', null],
    [false, true, '@lfprojects', null],
    [true, false, '', null],
    [true, false, '@lfprojects', null],
    [true, true, '', REQUIRED],
    [true, true, '   ', REQUIRED],
    [true, true, '@lfprojects', 'The Instagram account ID must be numeric.'],
    [true, true, ' 17841400000000000 ', null],
  ])('available %s, Instagram %s, id %j: %j', (available, usesInstagram, id, expected) => {
    expect(metaInstagramUserIdError(available, usesInstagram, id)).toBe(expected);
  });
});

describe('metaDsaFieldError', () => {
  const ONE_LINE = 'Enter the name on one line, without tabs, line breaks or invisible formatting characters.';

  it('says nothing while the capability is off, even for an EU geo', () => {
    expect(metaDsaFieldError(false, '', '', ['DE'])).toBeNull();
    expect(metaDsaFieldError(false, 'a'.repeat(300), '', [])).toBeNull();
  });

  it.each([
    // Required for an EU/EEA geo, naming the countries.
    ['', '', ['DE', 'FR'], 'Required when targeting the EU/EEA (DE, FR).'],
    ['  ', 'LF', ['NO'], 'Required when targeting the EU/EEA (NO).'],
    // Not required outside the EU/EEA, unless the other half is present.
    ['', '', [], null],
    ['', 'CNCF', [], 'Enter both the beneficiary and the payor, or neither.'],
    ['', '   ', [], null],
    ['CNCF', '', [], null],
    // One line, no invisible formatting.
    ['CNCF\tFoundation', 'LF', [], ONE_LINE],
    ['CNCF\u2028Foundation', 'LF', [], ONE_LINE],
    ['\u202eFNCC', 'LF', [], ONE_LINE],
    // Counted in code points as Go counts runes, not UTF-16 units.
    ['a'.repeat(257), 'LF', [], 'Enter at most 256 characters.'],
    ['a'.repeat(256), 'LF', [], null],
    ['\u{20000}'.repeat(256), 'LF', [], null],
    ['Fondation Linux — Zürich', 'リナックス財団', [], null],
  ])('%j beside %j for %j: %j', (value, other, eu, expected) => {
    expect(metaDsaFieldError(true, value, other, eu)).toBe(expected);
  });
});

describe('metaInstagramDsaFields', () => {
  const typed = { instagramUserId: ' 17841400000000000 ', dsaBeneficiary: '  CNCF ', dsaPayor: ' The Linux Foundation ' };

  it('sends none of the keys while the capability is off', () => {
    expect(metaInstagramDsaFields(false, true, typed)).toEqual({});
  });

  it('sends all three trimmed for an Instagram placement and a full pair', () => {
    expect(metaInstagramDsaFields(true, true, typed)).toEqual({
      instagramUserId: '17841400000000000',
      dsaBeneficiary: 'CNCF',
      dsaPayor: 'The Linux Foundation',
    });
  });

  it('drops the Instagram id when no Instagram placement is on', () => {
    expect(metaInstagramDsaFields(true, false, typed)).toEqual({ dsaBeneficiary: 'CNCF', dsaPayor: 'The Linux Foundation' });
  });

  it('sends the disclosures only as a pair', () => {
    expect(metaInstagramDsaFields(true, true, { ...typed, dsaPayor: '  ' })).toEqual({ instagramUserId: '17841400000000000' });
    expect(metaInstagramDsaFields(true, false, { instagramUserId: '', dsaBeneficiary: 'CNCF', dsaPayor: '' })).toEqual({});
  });
});

describe('objective', () => {
  /** The label stays defined though the option is hidden: the server names campaigns from it. */
  it('keeps a label for the hidden leads objective', () => {
    expect(META_OBJECTIVE_LABELS['leads']).toBe('Leads');
  });

  it.each([
    [['awareness', 'traffic', 'engagement', 'conversions'], 'leads', true],
    [['awareness', 'traffic', 'engagement', 'conversions', 'leads'], 'leads', false],
    [['awareness', 'traffic', 'engagement', 'conversions'], 'engagement', false],
  ] as const)('with options %j, %s is unavailable: %s', (options, objective, expected) => {
    expect(metaObjectiveIsUnavailable(options, objective)).toBe(expected);
  });
});

describe('metaBriefSeed', () => {
  const structured = (metaAds: Record<string, unknown>) => ({ structuredCopy: { meta_ads: metaAds }, metaCopy: undefined });

  it.each([
    [
      ['us', ' jp '],
      ['US', 'JP'],
    ],
    [
      ['us', 'US', 'JP'],
      ['US', 'JP'],
    ],
    [['us', 'USA', '1', ''], ['US']],
    [['IR', 'JP'], ['JP']],
  ])('seeds the structured brief geos %j as %j', (geos, expected) => {
    expect(metaBriefSeed(structured({ variants: [], recommended_geos: geos }))?.geoTargets).toEqual(expected);
  });

  it('seeds the typed brief geos through the same rule', () => {
    const seed = metaBriefSeed({ structuredCopy: null, metaCopy: { variants: [], recommendedGeos: ['de', 'DE', ' fr ', 'IR'] } as never });
    expect(seed?.geoTargets).toEqual(['DE', 'FR']);
  });

  it('maps the structured snake_case variants, defaulting missing text to empty', () => {
    const seed = metaBriefSeed(structured({ variants: [{ primary_text: 'Join us', headline: 'KubeCon', description: 'Paris' }, {}] }));
    expect(seed).toEqual({
      variants: [
        { primaryText: 'Join us', headline: 'KubeCon', description: 'Paris' },
        { primaryText: '', headline: '', description: undefined },
      ],
      geoTargets: [],
    });
  });

  it('treats non-array variants or geos as none', () => {
    expect(metaBriefSeed(structured({ variants: 'x', recommended_geos: 'US' }))).toEqual({ variants: [], geoTargets: [] });
  });

  it('prefers the structured copy over the typed copy', () => {
    const seed = metaBriefSeed({
      structuredCopy: { meta_ads: { recommended_geos: ['JP'] } },
      metaCopy: { variants: [], recommendedGeos: ['DE'] } as never,
    });
    expect(seed?.geoTargets).toEqual(['JP']);
  });

  it('seeds nothing for a brief without Meta copy', () => {
    expect(metaBriefSeed({ structuredCopy: null, metaCopy: undefined })).toBeNull();
    expect(metaBriefSeed({ structuredCopy: { google_ads: {} }, metaCopy: undefined })).toBeNull();
  });
});

describe('metaBasicsRefusal', () => {
  it.each([
    [0, ['US'], 'Meta Ads: set a budget of at least $1.'],
    [0.5, [], 'Meta Ads: set a budget of at least $1.'],
    [1, [], 'Meta Ads: add a location, or a country code.'],
    [1, ['US'], null],
  ])('budget %s with geos %j: %j', (budget, geos, expected) => {
    expect(metaBasicsRefusal(budget, geos)).toBe(expected);
  });
});

describe('metaCreateRefusal', () => {
  const clear: MetaCreateRefusalInput = {
    variants: [{ primaryText: 'Join us', headline: 'KubeCon' }],
    hasPlacement: true,
    pixelValid: true,
    instagramDsaInvalid: false,
    audienceTargetingBlock: null,
    audienceTargetingError: null,
    adOptionsBlock: null,
    adOptionsError: null,
    leadFormError: null,
  };

  it('lets a complete form through', () => {
    expect(metaCreateRefusal(clear)).toBeNull();
  });

  it.each([
    [{ variants: [] }, 'Meta Ads: give at least one ad both primary text and a headline.'],
    [
      {
        variants: [
          { primaryText: 'Join us', headline: '  ' },
          { primaryText: ' ', headline: 'KubeCon' },
        ],
      },
      'Meta Ads: give at least one ad both primary text and a headline.',
    ],
    [{ hasPlacement: false }, 'Meta Ads: choose at least one placement.'],
    [{ pixelValid: false }, 'Meta Ads: fix the pixel.'],
    [{ instagramDsaInvalid: true }, 'Meta Ads: fix the Instagram account or the EU disclosure fields.'],
    [{ audienceTargetingBlock: 'targeting is loading.' }, 'Meta Ads: targeting is loading.'],
    [{ audienceTargetingError: 'fix the ages.' }, 'Meta Ads: fix the ages.'],
    [{ adOptionsBlock: 'ad options are loading.' }, 'Meta Ads: ad options are loading.'],
    [{ adOptionsError: 'fix the CTA.' }, 'Meta Ads: fix the CTA.'],
    [{ leadFormError: 'choose a lead form.' }, 'Meta Ads: choose a lead form.'],
  ] as [Partial<MetaCreateRefusalInput>, string][])('refuses %j with %j', (overrides, expected) => {
    expect(metaCreateRefusal({ ...clear, ...overrides })).toBe(expected);
  });

  it('reports the first failing check, in order', () => {
    expect(metaCreateRefusal({ ...clear, pixelValid: false, hasPlacement: false })).toBe('Meta Ads: choose at least one placement.');
    expect(metaCreateRefusal({ ...clear, leadFormError: 'b', audienceTargetingBlock: 'a' })).toBe('Meta Ads: a');
    expect(metaCreateRefusal({ ...clear, adOptionsError: 'b', audienceTargetingError: 'a' })).toBe('Meta Ads: a');
  });
});
