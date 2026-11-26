// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  META_AUDIENCE_TARGETING_OFF_MESSAGE,
  META_TARGETING_BOXES,
  META_BEHAVIOR_TARGETING_OFF_MESSAGE,
  META_DEVICE_TARGETING_OFF_MESSAGE,
  META_INTEREST_TARGETING_OFF_MESSAGE,
  META_LOCALE_TARGETING_OFF_MESSAGE,
  META_OS_TARGETING_OFF_MESSAGE,
  META_REGION_TARGETING_OFF_MESSAGE,
  META_TARGETING_SEARCH_BUSY_MESSAGE,
  META_TARGETING_SEARCH_FAILED_MESSAGE,
  META_TARGETING_SEARCH_NO_MATCH_MESSAGE,
  META_TARGETING_SEARCH_PENDING_MESSAGE,
  META_TARGETING_SEARCH_TOO_SHORT_MESSAGE,
  META_TARGETING_SEARCH_UNAVAILABLE_MESSAGE,
} from '../constants/campaign.constants';
import type {
  CampaignServiceMetaTargetingSearch,
  MetaDetailedTargeting,
  MetaDetailedTargetingEnabled,
  MetaDetailedTargetingListView,
  MetaDetailedTargetingPicks,
  MetaTargetingBox,
  MetaTargetingFlags,
  MetaTargetingPick,
  MetaTargetingPickKey,
  MetaTargetingSearchOption,
  MetaTargetingSearchType,
} from '../interfaces/campaign.interface';
import {
  compactMetaDetailedTargeting,
  metaDeviceOsRefusal,
  parseMetaUserOs,
  copyMetaDetailedTargetingPicks,
  metaDetailedTargetingBlock,
  metaDetailedTargetingForCreate,
  metaDetailedTargetingPicksFromDraft,
  metaDetailedTargetingPicksSendable,
  emptyMetaDetailedTargetingPicks,
  metaLocaleKeys,
  metaLocationPickCountries,
  metaLocationPicksSent,
  metaTargetingBoxChoices,
  metaTargetingBoxesShown,
  metaTargetingBoxPicks,
  metaTargetingPickList,
  metaTargetingPicksAdd,
  metaTargetingPicksWith,
  metaTargetingPicksWithout,
  metaTargetingSearchEmptyMessage,
  metaTargetingSearchFailure,
  metaTargetingSearchQuery,
  isMetaTargetingSearchType,
  metaDetailedTargetingRefusal,
  metaTargetingFlagRefusal,
  metaTargetingHasAudienceFields,
  metaTargetingHasDetailedFields,
  metaTargetingQueryRefusal,
  metaTargetingSearchAllowed,
  metaTargetingSearchOptions,
} from './campaign-meta-detailed-targeting.utils';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(6003 + i));
const allOn: MetaTargetingFlags = { audience: true, interest: true, behavior: true, locale: true, region: true, device: true, os: true };

describe('which fields a block sets', () => {
  it.each([
    [{}, false, false],
    [{ ageMin: 30 }, true, false],
    [{ advantageAudience: false }, true, false],
    [{ interests: ['6003'] }, false, true],
    [{ locales: [6] }, false, true],
    [{ cities: ['2420379'] }, false, true],
    // Null and an empty list are "not set", as campaign-service reads them.
    [{ genders: null, interests: null }, false, false],
    [{ genders: [], interests: [] }, false, false],
    [{ ageMax: 44, workPositions: ['105'] }, true, true],
  ])('%j sets audience fields %s and detailed fields %s', (raw, audience, detailed) => {
    expect(metaTargetingHasAudienceFields(raw)).toBe(audience);
    expect(metaTargetingHasDetailedFields(raw)).toBe(detailed);
  });
});

describe('metaTargetingFlagRefusal', () => {
  it.each([
    // Everything on: nothing refused.
    [{ ageMin: 30, interests: ['6003'], behaviors: ['6004'], workPositions: ['105'], locales: [6] }, allOn, null],
    // A detailed-only block passes with the audience flag off, as campaign-service allows.
    [{ interests: ['6003'] }, { ...allOn, audience: false }, null],
    [{ locales: [6] }, { ...allOn, audience: false }, null],
    // An audience field, or an empty block, still needs the audience flag.
    [{ ageMin: 30, interests: ['6003'] }, { ...allOn, audience: false }, ['metaConfig.targeting', META_AUDIENCE_TARGETING_OFF_MESSAGE]],
    [{}, { ...allOn, audience: false }, ['metaConfig.targeting', META_AUDIENCE_TARGETING_OFF_MESSAGE]],
    // Each detailed field on its own flag; behaviors and job titles share one.
    [{ interests: ['6003'] }, { ...allOn, interest: false }, ['metaConfig.targeting.interests', META_INTEREST_TARGETING_OFF_MESSAGE]],
    [{ behaviors: ['6004'] }, { ...allOn, behavior: false }, ['metaConfig.targeting.behaviors', META_BEHAVIOR_TARGETING_OFF_MESSAGE]],
    [{ workPositions: ['105'] }, { ...allOn, behavior: false }, ['metaConfig.targeting.workPositions', META_BEHAVIOR_TARGETING_OFF_MESSAGE]],
    [{ locales: [6] }, { ...allOn, locale: false }, ['metaConfig.targeting.locales', META_LOCALE_TARGETING_OFF_MESSAGE]],
    // Regions and cities (#5904 row 6; campaign-service#671) share one flag, and are detailed-only like the rest.
    [{ regions: ['3847'] }, { ...allOn, region: false }, ['metaConfig.targeting.regions', META_REGION_TARGETING_OFF_MESSAGE]],
    [{ cities: ['2420379'] }, { ...allOn, region: false }, ['metaConfig.targeting.cities', META_REGION_TARGETING_OFF_MESSAGE]],
    [{ regions: ['3847'], cities: ['2420379'] }, { ...allOn, audience: false }, null],
    // Devices and operating systems (#5904 row 6), each on its own flag, and detailed-only like the rest.
    [{ devicePlatforms: ['mobile'] }, { ...allOn, device: false }, ['metaConfig.targeting.devicePlatforms', META_DEVICE_TARGETING_OFF_MESSAGE]],
    [{ userOs: ['iOS'] }, { ...allOn, os: false }, ['metaConfig.targeting.userOs', META_OS_TARGETING_OFF_MESSAGE]],
    [{ devicePlatforms: ['mobile'], userOs: ['iOS'] }, { ...allOn, audience: false }, null],
    // A field that is off but not set is no reason to refuse; an empty list is not set.
    [{ interests: ['6003'] }, { ...allOn, behavior: false, locale: false }, null],
    [{ interests: ['6003'], behaviors: [] }, { ...allOn, behavior: false }, null],
    [{ interests: ['6003'], genders: [] }, { ...allOn, audience: false }, null],
  ] as [Record<string, unknown>, MetaTargetingFlags, [string, string] | null][])('%j with %j: %j', (raw, flags, expected) => {
    const refusal = metaTargetingFlagRefusal(raw, flags);
    expect(refusal === null ? null : [refusal.field, refusal.message]).toEqual(expected);
  });
});

describe('metaDetailedTargetingRefusal', () => {
  it.each([
    [{}],
    [{ interests: [' 6003 ', '6003'], behaviors: [], workPositions: null }],
    [{ interests: ids(25), locales: [6, 1001] }],
    // 26 entries that de-duplicate to 25 are still 25 distinct ids.
    [{ behaviors: [...ids(25), '6003'] }],
    [{ locales: Array.from({ length: 50 }, (_, i) => i + 1) }],
    [{ regions: [' 3847 ', '3847'], cities: ids(25) }],
  ])('accepts %j', (raw) => {
    expect(metaDetailedTargetingRefusal(raw)).toBeNull();
  });

  it.each([
    [{ interests: '6003' }, 'metaConfig.targeting.interests'],
    [{ interests: ['06003'] }, 'metaConfig.targeting.interests'],
    [{ behaviors: ['0'] }, 'metaConfig.targeting.behaviors'],
    [{ workPositions: [105] }, 'metaConfig.targeting.workPositions'],
    [{ interests: ids(26) }, 'metaConfig.targeting.interests'],
    [{ locales: ['6'] }, 'metaConfig.targeting.locales'],
    [{ locales: [0] }, 'metaConfig.targeting.locales'],
    [{ locales: [1.5] }, 'metaConfig.targeting.locales'],
    [{ locales: [Number.MAX_SAFE_INTEGER + 2] }, 'metaConfig.targeting.locales'],
    [{ locales: Array.from({ length: 51 }, (_, i) => i + 1) }, 'metaConfig.targeting.locales'],
    [{ regions: '3847' }, 'metaConfig.targeting.regions'],
    [{ regions: [3847] }, 'metaConfig.targeting.regions'],
    [{ cities: ['02420379'] }, 'metaConfig.targeting.cities'],
    [{ cities: ids(26) }, 'metaConfig.targeting.cities'],
  ])('refuses %j naming %s', (raw, field) => {
    expect(metaDetailedTargetingRefusal(raw)?.field).toBe(field);
  });

  it('names the cap in the message', () => {
    expect(metaDetailedTargetingRefusal({ workPositions: ids(26) })?.message).toBe('Choose at most 25 job titles.');
    expect(metaDetailedTargetingRefusal({ regions: ids(26) })?.message).toBe('Choose at most 25 regions.');
  });
});

describe('compactMetaDetailedTargeting', () => {
  it('trims and de-duplicates ids in first-seen order, and drops empty lists', () => {
    expect(
      compactMetaDetailedTargeting({
        interests: [' 6003', '6004', '6003'],
        behaviors: [],
        locales: [6, 6, 1001],
        regions: ['3847 ', '3847'],
        cities: [],
        ageMin: 30,
      })
    ).toEqual({
      interests: ['6003', '6004'],
      locales: [6, 1001],
      regions: ['3847'],
    });
  });

  it.each([[null], [undefined], [{}], [{ ageMin: 30 }], [{ interests: [], workPositions: null }]])('sends nothing for %j', (raw) => {
    expect(compactMetaDetailedTargeting(raw)).toBeNull();
  });
});

describe('metaTargetingQueryRefusal', () => {
  it.each([
    ['interest', 'kubernetes'],
    ['behavior', ' it '],
    ['work_position', 'Platform engineer'],
    ['locale', 'English'],
    ['location', 'California'],
    ['interest', 'x'.repeat(100)],
    // Code points, not UTF-16 units: 100 emoji are 100 characters.
    ['interest', '🚀'.repeat(100)],
  ])('accepts %s %j', (type, query) => {
    expect(metaTargetingQueryRefusal(type, query)).toBeNull();
  });

  it.each([
    ['industry', 'kubernetes', 'The search type must be one of interest, behavior, work_position, locale, location.'],
    [undefined, 'kubernetes', 'The search type must be one of interest, behavior, work_position, locale, location.'],
    ['interest', ' k ', 'Search with 2–100 characters, on one line.'],
    ['interest', 'x'.repeat(101), 'Search with 2–100 characters, on one line.'],
    // One emoji is one character, too short, though its UTF-16 length is 2.
    ['interest', '🚀', 'Search with 2–100 characters, on one line.'],
    ['interest', 'kube\nrnetes', 'Search with 2–100 characters, on one line.'],
    ['interest', undefined, 'Search with 2–100 characters, on one line.'],
  ])('refuses %s %j', (type, query, message) => {
    expect(metaTargetingQueryRefusal(type, query)).toBe(message);
  });

  it('narrows the search type', () => {
    expect(isMetaTargetingSearchType('work_position')).toBe(true);
    expect(isMetaTargetingSearchType('industry')).toBe(false);
  });
});

describe('metaTargetingSearchOptions', () => {
  // The raw rows are upstream input, deliberately mistyped in places (a numeric id, a number in a path), so that
  // column is `unknown`; the expected column keeps its type, so a misspelled field fails the type-check.
  it.each<[string, MetaTargetingSearchType, unknown, MetaTargetingSearchOption[]]>([
    [
      'camel-cases an interest, dropping an id a create would refuse and a repeat; a nameless row reads as its id',
      'interest',
      [
        { id: '6003', name: 'Kubernetes', path: ['Interests', 'Technology', 7], audience_size_lower_bound: 1000, audience_size_upper_bound: 2000 },
        { id: '6003', name: 'Repeat' },
        { id: '6004', name: ' ', description: 'Open source' },
        { id: 'act_1', name: 'Not an id' },
        { id: 6005, name: 'Not a string' },
      ],
      [
        { id: '6003', name: 'Kubernetes', path: ['Interests', 'Technology'], audienceSizeLowerBound: 1000, audienceSizeUpperBound: 2000 },
        { id: '6004', name: '6004', path: [], description: 'Open source' },
      ],
    ],
    [
      'keeps coverage for a job title',
      'work_position',
      [{ id: '105', name: 'Platform Engineer', coverage: 0.4 }],
      [{ id: '105', name: 'Platform Engineer', path: [], coverage: 0.4 }],
    ],
    [
      'reads a language key, dropping one with a leading zero',
      'locale',
      [
        { id: '6', name: 'English (US)' },
        { id: '06', name: 'Leading zero' },
      ],
      [{ id: '6', name: 'English (US)', path: [] }],
    ],
    [
      'drops a language key past the safe-integer range, which would round as a number',
      'locale',
      [
        { id: '9007199254740993', name: 'Too big' },
        { id: '9007199254740991', name: 'Largest safe' },
      ],
      [{ id: '9007199254740991', name: 'Largest safe', path: [] }],
    ],
    [
      'keeps an interest id past the safe-integer range, as it is sent as text',
      'interest',
      [{ id: '9007199254740993', name: 'Big id' }],
      [{ id: '9007199254740993', name: 'Big id', path: [] }],
    ],
    [
      'keeps a region and a city that share a key, drops a location of another type, and keeps the location fields',
      'location',
      [
        { id: '3847', name: 'California', location_type: 'region', country_code: 'US' },
        { id: '3847', name: 'Some city', location_type: 'city', country_code: 'US', region: 'Texas' },
        { id: '3847', name: 'Repeat', location_type: 'region' },
        { id: '2420379', name: 'Country', location_type: 'country' },
        { id: '2420380', name: 'No type' },
      ],
      [
        { id: '3847', name: 'California', path: [], locationType: 'region', countryCode: 'US' },
        { id: '3847', name: 'Some city', path: [], locationType: 'city', countryCode: 'US', region: 'Texas' },
      ],
    ],
    // The location fields belong to a location row only.
    [
      'ignores location fields on another kind',
      'interest',
      [{ id: '6003', name: 'K', location_type: 'city', country_code: 'US', region: 'Texas' }],
      [{ id: '6003', name: 'K', path: [] }],
    ],
    ['answers no options for none', 'interest', undefined, []],
  ])('%s', (_case, type, raw, expected) => {
    expect(metaTargetingSearchOptions(type, raw as CampaignServiceMetaTargetingSearch['options'])).toEqual(expected);
  });
});

describe('metaTargetingSearchAllowed', () => {
  const off = { interest: false, behavior: false, locale: false, region: false };
  it.each<[MetaTargetingSearchType, keyof typeof off]>([
    ['interest', 'interest'],
    ['behavior', 'behavior'],
    ['work_position', 'behavior'],
    ['locale', 'locale'],
    ['location', 'region'],
  ])('%s follows the %s flag only', (type, flag) => {
    expect(metaTargetingSearchAllowed(type, { ...off, [flag]: true })).toBe(true);
    expect(metaTargetingSearchAllowed(type, { interest: true, behavior: true, locale: true, region: true, [flag]: false })).toBe(false);
  });
});

describe('the detailed-targeting picker rules', () => {
  const pick = (id: string, name = `Name ${id}`): MetaTargetingPick => ({ id, name });
  const option = (id: string): MetaTargetingSearchOption => ({ id, name: `Name ${id}`, path: [] });
  const full = Array.from({ length: 25 }, (_, i) => pick(String(1000 + i)));

  it('starts every list empty, with a fresh object each time', () => {
    expect(emptyMetaDetailedTargetingPicks()).toEqual({ interests: [], behaviors: [], workPositions: [], locales: [], regions: [], cities: [] });
    expect(emptyMetaDetailedTargetingPicks()).not.toBe(emptyMetaDetailedTargetingPicks());
  });

  const flagsOff = { interest: false, behavior: false, locale: false, region: false };
  it.each<[Partial<typeof flagsOff>, MetaTargetingBox['key'][]]>([
    [{ interest: true, behavior: true, locale: true, region: true }, ['interests', 'behaviors', 'workPositions', 'locales', 'locations']],
    [{ interest: true }, ['interests']],
    [{ behavior: true }, ['behaviors', 'workPositions']],
    [{ locale: true }, ['locales']],
    [{ region: true }, ['locations']],
    [{}, []],
  ])('shows the boxes %j turns on', (flags, keys) => {
    expect(metaTargetingBoxesShown({ ...flagsOff, ...flags }).map((box) => box.key)).toEqual(keys);
  });

  it.each([
    ['  devops  ', 'devops'],
    ['k', ''],
    ['  k ', ''],
    ['a\u0007b', ''],
    ['x'.repeat(120), 'x'.repeat(100)],
    ['😀'.repeat(101), '😀'.repeat(100)],
  ])('searches %j as %j', (raw, query) => {
    expect(metaTargetingSearchQuery(raw)).toBe(query);
  });

  it('adds a pick once, trimmed, and keeps its name', () => {
    expect(metaTargetingPicksWith([], { id: ' 6003 ', name: ' Open source ' }, 'interests')).toEqual([{ id: '6003', name: 'Open source' }]);
    expect(metaTargetingPicksWith([], { id: '6003', name: ' ' }, 'interests')).toEqual([{ id: '6003', name: '6003' }]);
  });

  it.each<[string, MetaTargetingPick[], string, MetaTargetingPickKey]>([
    ['already picked', [pick('6003')], '6003', 'interests'],
    ['not a Meta id', [], '06003', 'interests'],
    ['the list is full', full, '6003', 'interests'],
    ['a region list at its cap of 25', full, '6003', 'regions'],
    ['a language past the safe-integer range', [], '9007199254740993', 'locales'],
  ])('leaves the list alone when the option is %s', (_case, picks, id, list) => {
    expect(metaTargetingPicksWith(picks, option(id), list)).toBe(picks);
  });

  it('caps languages at 50, not 25', () => {
    expect(metaTargetingPicksWith(full, option('6'), 'locales')).toHaveLength(26);
  });

  it('removes a pick by id', () => {
    expect(metaTargetingPicksWithout([pick('1'), pick('2')], '1')).toEqual([pick('2')]);
  });

  it.each([
    [503, META_TARGETING_SEARCH_BUSY_MESSAGE],
    [404, META_TARGETING_SEARCH_UNAVAILABLE_MESSAGE],
    [500, META_TARGETING_SEARCH_FAILED_MESSAGE],
    [0, META_TARGETING_SEARCH_FAILED_MESSAGE],
  ])('explains a failed search (status %i)', (status, message) => {
    expect(metaTargetingSearchFailure(status)).toBe(message);
  });

  it.each([
    ['searching', false, true, null, META_TARGETING_SEARCH_PENDING_MESSAGE],
    ['failed', false, false, 'Busy', 'Busy'],
    ['refused', true, false, null, META_TARGETING_SEARCH_TOO_SHORT_MESSAGE],
    ['answered with nothing', false, false, null, META_TARGETING_SEARCH_NO_MATCH_MESSAGE],
  ])('says what an empty popup means when the search %s', (_case, refused, pending, failure, message) => {
    expect(metaTargetingSearchEmptyMessage(refused, pending, failure)).toBe(message);
  });
});

describe('the detailed-targeting create rules', () => {
  const picks: MetaDetailedTargetingPicks = {
    interests: [{ id: '6003', name: 'Open source' }],
    behaviors: [{ id: '6004', name: 'Early adopters' }],
    workPositions: [{ id: '105', name: 'Engineer' }],
    locales: [{ id: '6', name: 'English (US)' }],
    regions: [{ id: '3847', name: 'California, US' }],
    cities: [{ id: '2420379', name: 'Austin, Texas, US' }],
  };
  const none = emptyMetaDetailedTargetingPicks();
  const on: MetaDetailedTargetingEnabled = { interest: true, behavior: true, locale: true, region: true };

  it.each([
    ['not a record', 'x', undefined],
    ['null', null, undefined],
    ['an empty record', {}, none],
    [
      'well-formed picks, dropping a bad id, a missing name, a repeat and a non-list',
      {
        interests: [{ id: '6003', name: 'Open source' }, { id: '06003', name: 'Bad' }, { id: '7' }, { id: '6003', name: 'Again' }],
        behaviors: 'x',
        workPositions: [{ id: ' 105 ', name: 'Engineer' }],
      },
      { ...none, interests: [{ id: '6003', name: 'Open source' }], workPositions: [{ id: '105', name: 'Engineer' }] },
    ],
    [
      'languages, regions and cities, dropping a language past the safe-integer range',
      {
        locales: [
          { id: '6', name: 'English (US)' },
          { id: '9007199254740993', name: 'Too big' },
        ],
        regions: [{ id: '3847', name: 'California, US' }],
        cities: [{ id: '2420379', name: 'Austin, Texas, US' }],
      },
      { ...none, locales: picks.locales, regions: picks.regions, cities: picks.cities },
    ],
  ])('reads a saved draft holding %s', (_case, raw, expected) => {
    expect(metaDetailedTargetingPicksFromDraft(raw)).toEqual(expected);
  });

  it('caps a saved list at 25', () => {
    const raw = { interests: Array.from({ length: 30 }, (_, i) => ({ id: String(100 + i), name: `N${i}` })) };
    expect(metaDetailedTargetingPicksFromDraft(raw)?.interests).toHaveLength(25);
  });

  it('copies every list', () => {
    const copy = copyMetaDetailedTargetingPicks(picks);
    expect(copy).toEqual(picks);
    expect(copy.interests).not.toBe(picks.interests);
    expect(copy.cities).not.toBe(picks.cities);
  });

  it.each<[string, Partial<MetaDetailedTargetingEnabled>, MetaDetailedTargeting | null]>([
    ['every flag is a yes', {}, { interests: ['6003'], behaviors: ['6004'], workPositions: ['105'], locales: [6], regions: ['3847'], cities: ['2420379'] }],
    ['only interests', { behavior: false, locale: null, region: false }, { interests: ['6003'] }],
    ['only behaviors and job titles', { interest: null, locale: false, region: null }, { behaviors: ['6004'], workPositions: ['105'] }],
    ['only languages, as numbers', { interest: false, behavior: false, region: false }, { locales: [6] }],
    ['only regions and cities, each in its own list', { interest: false, behavior: false, locale: false }, { regions: ['3847'], cities: ['2420379'] }],
    ['no flag is a yes', { interest: false, behavior: null, locale: null, region: false }, null],
  ])('sends the lists whose flag is a yes: %s', (_case, enabled, expected) => {
    expect(metaDetailedTargetingForCreate(picks, { ...on, ...enabled })).toEqual(expected);
  });

  it('sends nothing for empty lists', () => {
    expect(metaDetailedTargetingForCreate(none, on)).toBeNull();
  });

  it.each<[string[], number[]]>([
    [
      ['6', ' 1001 '],
      [6, 1001],
    ],
    [['06', '9007199254740993', 'x'], []],
  ])('turns language ids %j into the keys %j', (ids, keys) => {
    expect(metaLocaleKeys(ids)).toEqual(keys);
  });

  it.each<[string, Partial<MetaDetailedTargetingEnabled>, MetaDetailedTargetingPicks]>([
    ['behaviors answered no', { behavior: false }, { ...picks, behaviors: [], workPositions: [] }],
    ['languages answered no, regions unanswered', { locale: false, region: null }, { ...picks, locales: [] }],
    ['regions answered no', { region: false }, { ...picks, regions: [], cities: [] }],
  ])('clears only the lists this deployment answered no to: %s', (_case, enabled, expected) => {
    expect(metaDetailedTargetingPicksSendable(picks, { ...on, ...enabled })).toEqual(expected);
  });

  const block = (over: Partial<Omit<Parameters<typeof metaDetailedTargetingBlock>[0], 'enabled'>>, enabled: Partial<MetaDetailedTargetingEnabled> = {}) =>
    metaDetailedTargetingBlock({ picks, enabled: { ...on, ...enabled }, createCapabilityRead: 'ready', briefId: 'b-1', ...over })?.kind ?? null;

  it.each<[string, Partial<Omit<Parameters<typeof metaDetailedTargetingBlock>[0], 'enabled'>>, Partial<MetaDetailedTargetingEnabled>, string | null]>([
    ['every held list is sendable', {}, {}, null],
    ['nothing is picked in an unsendable list', { picks: { ...none, interests: picks.interests } }, { behavior: false, locale: false, region: false }, null],
    ['a held list answered no', {}, { behavior: false }, 'unsupported'],
    ['held languages answered no', {}, { locale: false }, 'unsupported'],
    ['held cities answered no', { picks: { ...none, cities: picks.cities } }, { region: false }, 'unsupported'],
    ['a no wins over an unanswered list', { createCapabilityRead: 'pending' }, { interest: null, behavior: false }, 'unsupported'],
    ['the answer is still out', { createCapabilityRead: 'pending' }, { interest: null }, 'pending'],
    ['the region answer is still out', { createCapabilityRead: 'pending' }, { region: null }, 'pending'],
    ['the brief is unsaved', { briefId: null }, { interest: null }, 'unsaved'],
    ['the answer failed', { createCapabilityRead: 'failed' }, { locale: null }, 'failed'],
  ])('holds Create when %s', (_case, over, enabled, kind) => {
    expect(block(over, enabled)).toBe(kind);
  });
});

describe('the language and location picker rules', () => {
  const box = (key: MetaTargetingBox['key']): MetaTargetingBox => META_TARGETING_BOXES.find((b) => b.key === key) ?? META_TARGETING_BOXES[0];
  const none = emptyMetaDetailedTargetingPicks();
  const region: MetaTargetingSearchOption = { id: '3847', name: 'California', path: [], locationType: 'region', countryCode: 'US' };
  const city: MetaTargetingSearchOption = { id: '2420379', name: 'Austin', path: [], locationType: 'city', countryCode: 'US', region: 'Texas' };
  const language: MetaTargetingSearchOption = { id: '6', name: 'English (US)', path: [] };

  it.each<[string, MetaTargetingBox['key'], MetaTargetingSearchOption, MetaTargetingPickKey | null]>([
    ['an interest fills interests', 'interests', { id: '6003', name: 'K', path: [] }, 'interests'],
    ['a language fills locales', 'locales', language, 'locales'],
    ['a region fills regions', 'locations', region, 'regions'],
    ['a city fills cities', 'locations', city, 'cities'],
    ['a location of neither type fills nothing', 'locations', { id: '1', name: 'X', path: [] }, null],
  ])('%s', (_case, key, option, list) => {
    expect(metaTargetingPickList(box(key), option)).toBe(list);
  });

  it.each<[string, MetaTargetingBox['key'], MetaTargetingSearchOption, Partial<MetaDetailedTargetingPicks>]>([
    ['a language keeps its key as text', 'locales', language, { locales: [{ id: '6', name: 'English (US)' }] }],
    ['a region keeps its country in its name and code', 'locations', region, { regions: [{ id: '3847', name: 'California, US', countryCode: 'US' }] }],
    [
      'a city keeps its region and country in its name, and its country code',
      'locations',
      city,
      { cities: [{ id: '2420379', name: 'Austin, Texas, US', countryCode: 'US' }] },
    ],
    [
      'a city with no place reads as its name',
      'locations',
      { id: '2420380', name: 'Nowhere', path: [], locationType: 'city' },
      { cities: [{ id: '2420380', name: 'Nowhere' }] },
    ],
  ])('adds a pick: %s', (_case, key, option, expected) => {
    expect(metaTargetingPicksAdd(none, box(key), option)).toEqual({ ...none, ...expected });
  });

  it.each<[string, MetaTargetingBox['key'], MetaTargetingSearchOption]>([
    ['a location of neither type', 'locations', { id: '1', name: 'X', path: [] }],
    ['a language past the safe-integer range', 'locales', { id: '9007199254740993', name: 'Too big', path: [] }],
  ])('returns the same picks for %s', (_case, key, option) => {
    expect(metaTargetingPicksAdd(none, box(key), option)).toBe(none);
  });

  it.each<[string, MetaDetailedTargetingPicks, boolean[], string[]]>([
    ['nothing picked', none, [false, false, true], ['Region · US', 'City · Texas, US', '']],
    ['the region picked', { ...none, regions: [{ id: '3847', name: 'California, US' }] }, [true, false, true], ['Region · US', 'City · Texas, US', '']],
    [
      'the city list at its cap',
      { ...none, cities: Array.from({ length: 25 }, (_, i) => ({ id: String(9000 + i), name: `C${i}` })) },
      [false, true, true],
      ['Region · US', 'City · Texas, US', ''],
    ],
  ])('lists location rows with %s', (_case, picks, disabled, details) => {
    const choices = metaTargetingBoxChoices(box('locations'), [region, city, { id: '1', name: 'X', path: [] }], picks);
    expect(choices.map((c) => c.disabled)).toEqual(disabled);
    expect(choices.map((c) => c.pathLabel)).toEqual(details);
  });

  it.each<[string, MetaTargetingPickKey, string | undefined, string | undefined]>([
    ['a location list upper-cases a two-letter code', 'cities', ' de ', 'DE'],
    ['a location list drops a code that is not two letters', 'regions', 'USA', undefined],
    ['a non-location list never keeps a code', 'interests', 'US', undefined],
  ])('metaTargetingPicksWith: %s', (_case, list, countryCode, expected) => {
    expect(metaTargetingPicksWith([], { id: '6003', name: 'X', countryCode }, list)[0]?.countryCode).toBe(expected);
  });

  it('restores a location pick country code from a draft only when it is a country code', () => {
    const restored = metaDetailedTargetingPicksFromDraft({
      cities: [
        { id: '2420379', name: 'Berlin, DE', countryCode: 'DE' },
        { id: '2420380', name: 'Odd', countryCode: 49 },
      ],
      interests: [{ id: '6003', name: 'K', countryCode: 'US' }],
    });
    expect(restored?.cities).toEqual([
      { id: '2420379', name: 'Berlin, DE', countryCode: 'DE' },
      { id: '2420380', name: 'Odd' },
    ]);
    expect(restored?.interests).toEqual([{ id: '6003', name: 'K' }]);
    expect(copyMetaDetailedTargetingPicks(restored ?? none).cities[0]?.countryCode).toBe('DE');
  });

  it.each<[string, boolean | null, string[]]>([
    ['sends regions then cities while the region flag is yes', true, ['3847', '2420379', '2420381']],
    ['sends none while the region flag is unanswered', null, []],
    ['sends none while the region flag is no', false, []],
  ])('metaLocationPicksSent %s', (_case, region, expected) => {
    const picks: MetaDetailedTargetingPicks = {
      ...none,
      interests: [{ id: '6003', name: 'K' }],
      regions: [{ id: '3847', name: 'California, US', countryCode: 'US' }],
      cities: [
        { id: '2420379', name: 'Austin, Texas, US', countryCode: 'US' },
        { id: '2420381', name: 'Paris, FR', countryCode: 'FR' },
      ],
    };
    const sent = metaLocationPicksSent(picks, { interest: true, behavior: true, locale: true, region });
    expect(sent.map((pick) => pick.id)).toEqual(expected);
  });

  it('lists the countries of location picks once each, skipping picks without a code', () => {
    expect(
      metaLocationPickCountries([
        { id: '1', name: 'A', countryCode: 'US' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C', countryCode: 'FR' },
        { id: '4', name: 'D', countryCode: 'US' },
      ])
    ).toEqual(['US', 'FR']);
  });

  it('lists an interest row with its taxonomy path, disabled once picked', () => {
    const rows = metaTargetingBoxChoices(box('interests'), [{ id: '6003', name: 'K', path: ['Interests', 'Technology'] }], {
      ...none,
      interests: [{ id: '6003', name: 'K' }],
    });
    expect(rows.map((r) => [r.disabled, r.pathLabel])).toEqual([[true, 'Interests › Technology']]);
  });

  it.each<[string, MetaTargetingBox['key'], MetaDetailedTargetingPicks, Pick<MetaDetailedTargetingListView, 'chips' | 'full' | 'countLabel'>]>([
    ['empty languages', 'locales', none, { chips: [], full: false, countLabel: 'Languages (0 of 50)' }],
    [
      'a region and a city, each chip saying which',
      'locations',
      { ...none, regions: [{ id: '3847', name: 'California, US' }], cities: [{ id: '3847', name: 'Austin, Texas, US' }] },
      {
        chips: [
          { list: 'regions', id: '3847', label: 'California, US (region)' },
          { list: 'cities', id: '3847', label: 'Austin, Texas, US (city)' },
        ],
        full: false,
        countLabel: 'Regions and cities (1 of 25 regions, 1 of 25 cities)',
      },
    ],
    [
      'regions at their cap but not cities',
      'locations',
      { ...none, regions: Array.from({ length: 25 }, (_, i) => ({ id: String(100 + i), name: 'R' })) },
      {
        chips: Array.from({ length: 25 }, (_, i) => ({ list: 'regions', id: String(100 + i), label: 'R (region)' })),
        full: false,
        countLabel: 'Regions and cities (25 of 25 regions, 0 of 25 cities)',
      },
    ],
  ])('shows the picks of %s', (_case, key, picks, expected) => {
    expect(metaTargetingBoxPicks(box(key), picks)).toEqual(expected);
  });
});

describe('parseMetaUserOs', () => {
  it.each([
    ['iOS', 'iOS', false],
    [' android ', 'Android', false],
    ['IOS_ver_8.0_and_above', 'iOS_ver_8.0_and_above', true],
    ['Android_ver_4.0_to_7.0', 'Android_ver_4.0_to_7.0', true],
  ])('reads %j as %s', (raw, canonical, versioned) => {
    expect(parseMetaUserOs(raw)).toMatchObject({ canonical, versioned });
  });

  it.each([['Windows'], ['iOS_ver_8.1_and_above'], ['Android_ver_7.0_to_4.0'], ['Android_ver_4.0_to_4.0'], ['iOS_ver_8.0'], [7]])('refuses %j', (raw) => {
    expect(parseMetaUserOs(raw)).toBeNull();
  });
});

describe('metaDeviceOsRefusal', () => {
  it.each([
    ['mobile only', { devicePlatforms: ['Mobile'] }, 'traffic', {}, null],
    ['both devices with iOS and Android', { devicePlatforms: ['mobile', 'desktop'], userOs: ['iOS', 'Android'] }, 'traffic', {}, null],
    ['desktop only without Audience Network', { devicePlatforms: ['desktop'] }, 'traffic', { audienceNetwork: false }, null],
    ['a device that is not one', { devicePlatforms: ['tablet'] }, 'traffic', {}, 'devicePlatforms'],
    ['desktop only with Audience Network', { devicePlatforms: ['desktop'] }, 'traffic', { audienceNetwork: true }, 'devicePlatforms'],
    ['an OS Meta does not list', { userOs: ['Windows'] }, 'traffic', {}, 'userOs'],
    ['a version beside the other family', { userOs: ['iOS_ver_8.0_and_above', 'Android'] }, 'traffic', {}, 'userOs'],
    ['an OS with desktop only', { devicePlatforms: ['desktop'], userOs: ['iOS'] }, 'traffic', {}, 'userOs'],
    ['an OS version on awareness', { userOs: ['iOS_ver_8.0_and_above'] }, 'awareness', {}, 'userOs'],
    ['an OS family on awareness', { userOs: ['iOS'] }, 'awareness', {}, null],
    [
      'eleven OS values',
      { userOs: ['iOS', ...['2.0', '3.0', '4.0', '4.3', '5.0', '6.0', '7.0', '8.0', '9.0'].map((v) => `iOS_ver_${v}_and_above`), 'iOS_ver_2.0_to_3.0'] },
      'traffic',
      {},
      'userOs',
    ],
  ])('answers %s', (_case, raw, objective, placements, field) => {
    const refusal = metaDeviceOsRefusal(raw, objective, placements);
    expect(refusal === null ? null : refusal.field.replace('metaConfig.targeting.', '')).toBe(field);
  });
});

describe('compactMetaDetailedTargeting with devices and operating systems', () => {
  it('sends devices lower-cased and de-duplicated, and OS values in Meta spelling', () => {
    expect(compactMetaDetailedTargeting({ devicePlatforms: ['Mobile', 'mobile'], userOs: ['ios', 'IOS', 'android_ver_4.0_and_above'] })).toEqual({
      devicePlatforms: ['mobile'],
      userOs: ['iOS', 'Android_ver_4.0_and_above'],
    });
  });
});

// The picker's cap per list (the box's `max`) must be exactly what a create accepts for the field it fills, so a
// row the picker offers is never refused on create and the create's cap is never out of reach in the picker.
describe('the picker cap matches the create cap', () => {
  const rows = META_TARGETING_BOXES.flatMap((b) => b.lists.map((list) => [list, b.max] as [MetaTargetingPickKey, number]));
  it.each<[MetaTargetingPickKey, number]>(rows)('%s takes %i picks, as a create does', (list, max) => {
    let picks: MetaTargetingPick[] = [];
    for (const id of ids(max + 1)) picks = metaTargetingPicksWith(picks, { id, name: id }, list);
    expect(picks).toHaveLength(max);
    const sent = (n: number): unknown[] => (list === 'locales' ? ids(n).map(Number) : ids(n));
    expect(metaDetailedTargetingRefusal({ [list]: sent(max) })).toBeNull();
    expect(metaDetailedTargetingRefusal({ [list]: sent(max + 1) })?.field).toBe(`metaConfig.targeting.${list}`);
  });
});
