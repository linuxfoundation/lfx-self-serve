// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleAdGroupDemographicExclusionsRefusal,
  googleDisplayDemographicsCarried,
  googleDisplayDemographicsRefusal,
  googleObservedDemographicsRefusal,
} from './campaign-google-demographics.utils';

// One test per branch of campaign-service v1.0.35's `validateAdGroupDemographicExclusions`,
// `validateObservedDemographics`, `validateDisplayDemographics` and `validateEnumExclusions`
// (`internal/platform/googleads/campaign_criteria.go`).
describe('googleAdGroupDemographicExclusionsRefusal', () => {
  it('accepts income on Search and Display, and parental status on Display, in either spelling of Unknown', () => {
    expect(googleAdGroupDemographicExclusionsRefusal(['income_range_0_50', ' UNDETERMINED '], undefined, 'search')).toBeNull();
    expect(googleAdGroupDemographicExclusionsRefusal(['INCOME_RANGE_UNDETERMINED'], ['parent', 'NOT_A_PARENT', 'UNDETERMINED'], 'display')).toBeNull();
  });

  it('asks nothing of an absent, null or empty list, or of a create with no channel', () => {
    expect(googleAdGroupDemographicExclusionsRefusal(undefined, null, 'demand-gen')).toBeNull();
    expect(googleAdGroupDemographicExclusionsRefusal([], [], 'performance-max')).toBeNull();
    expect(googleAdGroupDemographicExclusionsRefusal(['INCOME_RANGE_0_50'], undefined, undefined)).toBeNull();
  });

  it.each([
    [{}, undefined, 'excludedIncomeRanges'],
    [undefined, [1], 'excludedParentalStatuses'],
  ])('refuses a value Go cannot decode as a string list (%j, %j)', (income, parental, field) => {
    expect(googleAdGroupDemographicExclusionsRefusal(income, parental, 'display')?.field).toBe(field);
  });

  it.each([['demand-gen'], ['video'], ['performance-max']])('refuses income exclusions on %s', (channel) => {
    expect(googleAdGroupDemographicExclusionsRefusal(['INCOME_RANGE_0_50'], undefined, channel)).toEqual(
      expect.objectContaining({ field: 'excludedIncomeRanges' })
    );
  });

  it('refuses parental status on Search by name, since Google refuses it on a Search ad group', () => {
    expect(googleAdGroupDemographicExclusionsRefusal(undefined, ['PARENT'], 'search')?.message).toContain("on a Search campaign's ad groups");
  });

  it.each([['demand-gen'], ['video']])('refuses parental status on %s through the Display-only fence', (channel) => {
    expect(googleAdGroupDemographicExclusionsRefusal(undefined, ['PARENT'], channel)?.message).toContain('only on Display');
  });

  it('judges the income fence before the parental one, and income vocabulary before parental vocabulary', () => {
    expect(googleAdGroupDemographicExclusionsRefusal(['INCOME_RANGE_0_50'], ['PARENT'], 'video')?.field).toBe('excludedIncomeRanges');
    expect(googleAdGroupDemographicExclusionsRefusal(['NOPE'], ['NOPE'], 'display')?.field).toBe('excludedIncomeRanges');
  });

  it('refuses a 21st entry on the submitted count, before a repeat is collapsed', () => {
    expect(
      googleAdGroupDemographicExclusionsRefusal(
        undefined,
        Array.from({ length: 20 }, () => 'PARENT'),
        'display'
      )
    ).toBeNull();
    expect(
      googleAdGroupDemographicExclusionsRefusal(
        undefined,
        Array.from({ length: 21 }, () => 'PARENT'),
        'display'
      )?.message
    ).toContain('20');
  });

  it.each([['50-60'], ['constructor'], ['  '], ['ıncome_range_0_50']])('refuses %j on the vocabulary', (entry) => {
    expect(googleAdGroupDemographicExclusionsRefusal([entry], undefined, 'search')?.message).toContain('INCOME_RANGE_0_50');
  });

  it('refuses an unknown parental status on the vocabulary', () => {
    expect(googleAdGroupDemographicExclusionsRefusal(undefined, ['PARENTS'], 'display')?.message).toContain('PARENT, NOT_A_PARENT, UNDETERMINED');
  });
});

describe('googleObservedDemographicsRefusal', () => {
  it('accepts every dimension on Search, a repeat collapsed', () => {
    expect(googleObservedDemographicsRefusal(['age_range', 'GENDER', 'INCOME_RANGE', 'GENDER'], 'search', {})).toBeNull();
  });

  it('asks nothing of an absent or empty list, or of a create with no channel', () => {
    expect(googleObservedDemographicsRefusal(undefined, 'display', {})).toBeNull();
    expect(googleObservedDemographicsRefusal([], 'display', {})).toBeNull();
    expect(googleObservedDemographicsRefusal(['GENDER'], undefined, {})).toBeNull();
  });

  it('refuses a value Go cannot decode as a string list', () => {
    expect(googleObservedDemographicsRefusal('GENDER', 'search', {})).toContain('list');
  });

  it.each([['display'], ['demand-gen'], ['performance-max']])('refuses observation on %s', (channel) => {
    expect(googleObservedDemographicsRefusal(['GENDER'], channel, {})).toContain('Search campaigns only');
  });

  it('refuses a 7th entry on the submitted count', () => {
    expect(
      googleObservedDemographicsRefusal(
        Array.from({ length: 6 }, () => 'GENDER'),
        'search',
        {}
      )
    ).toBeNull();
    expect(
      googleObservedDemographicsRefusal(
        Array.from({ length: 7 }, () => 'GENDER'),
        'search',
        {}
      )
    ).toContain('6');
  });

  it.each([
    ['AGE_RANGE', { ageRanges: ['18-24', '25-34', '35-44', '45-54', '55-64', 'AGE_RANGE_65_UP', 'UNDETERMINED'] }, 'age range'],
    ['GENDER', { genders: ['MALE', 'FEMALE', 'UNDETERMINED'] }, 'gender'],
    [
      'INCOME_RANGE',
      {
        incomeRanges: [
          'INCOME_RANGE_0_50',
          'INCOME_RANGE_50_60',
          'INCOME_RANGE_60_70',
          'INCOME_RANGE_70_80',
          'INCOME_RANGE_80_90',
          'INCOME_RANGE_90_UP',
          'UNDETERMINED',
        ],
      },
      'income range',
    ],
  ])('refuses observing %s when every value is excluded', (dim, exclusions, noun) => {
    expect(googleObservedDemographicsRefusal([dim], 'search', exclusions)).toContain(`Every ${noun} is excluded`);
  });

  it('accepts observing a dimension with one value still open', () => {
    expect(googleObservedDemographicsRefusal(['GENDER'], 'search', { genders: ['MALE', 'FEMALE'] })).toBeNull();
  });

  it('refuses PARENTAL_STATUS by name', () => {
    expect(googleObservedDemographicsRefusal(['PARENTAL_STATUS'], 'search', {})).toContain('parental status');
  });

  it.each([['DEVICE'], ['ɡender'], ['']])('refuses %j on the vocabulary', (entry) => {
    expect(googleObservedDemographicsRefusal([entry], 'search', {})).toContain('AGE_RANGE, GENDER, INCOME_RANGE');
  });
});

describe('googleDisplayDemographicsRefusal', () => {
  it('accepts targeting on all four dimensions, and an exclusion of a different value of a targeted dimension', () => {
    expect(
      googleDisplayDemographicsRefusal(
        { ageRanges: ['25-34'], genders: ['female'], incomeRanges: ['INCOME_RANGE_90_UP'], parentalStatuses: ['PARENT'] },
        'display',
        {
          ageRanges: ['18-24'],
        }
      )
    ).toBeNull();
  });

  it('asks nothing of an absent object, an object of empty or null lists, or a create with no channel', () => {
    expect(googleDisplayDemographicsRefusal(undefined, 'search', {})).toBeNull();
    expect(googleDisplayDemographicsRefusal({ ageRanges: [], genders: null }, 'search', {})).toBeNull();
    expect(googleDisplayDemographicsRefusal({ ageRanges: ['18-24'] }, undefined, {})).toBeNull();
  });

  it.each([[['18-24']], ['18-24'], [{ ageRanges: '18-24' }], [{ parentalStatuses: [2] }]])('refuses %j, which Go cannot decode', (raw) => {
    expect(googleDisplayDemographicsRefusal(raw, 'display', {})).toContain('must be');
  });

  it.each([['search'], ['demand-gen'], ['video']])('refuses targeting on %s', (channel) => {
    expect(googleDisplayDemographicsRefusal({ genders: ['MALE'] }, channel, {})).toContain('Display campaigns only');
  });

  it.each([
    [{ ageRanges: ['18-25'] }, '18-24'],
    [{ genders: ['OTHER'] }, 'MALE, FEMALE, UNDETERMINED'],
    [{ incomeRanges: ['ıncome_range_0_50'] }, 'INCOME_RANGE_0_50'],
    [{ parentalStatuses: ['NOT_PARENT'] }, 'NOT_A_PARENT'],
  ])('refuses %j on its vocabulary', (raw, expected) => {
    expect(googleDisplayDemographicsRefusal(raw, 'display', {})).toContain(expected);
  });

  it('refuses a 21st targeted value', () => {
    expect(googleDisplayDemographicsRefusal({ genders: Array.from({ length: 21 }, () => 'MALE') }, 'display', {})).toContain('20');
  });

  it('judges every vocabulary before any clash', () => {
    expect(googleDisplayDemographicsRefusal({ ageRanges: ['18-24'], parentalStatuses: ['NOPE'] }, 'display', { ageRanges: ['18-24'] })).toContain('NOPE');
  });

  it.each([
    [{ ageRanges: ['AGE_RANGE_18_24'] }, { ageRanges: ['18-24'] }],
    [{ genders: ['MALE'] }, { genders: ['male'] }],
    [{ incomeRanges: ['UNDETERMINED'] }, { incomeRanges: ['INCOME_RANGE_UNDETERMINED'] }],
    [{ parentalStatuses: ['PARENT'] }, { parentalStatuses: ['PARENT'] }],
  ])('refuses %j targeted while %j excludes it, compared by resolved enum', (raw, exclusions) => {
    expect(googleDisplayDemographicsRefusal(raw, 'display', exclusions)).toContain('both target and exclude');
  });
});

describe('googleDisplayDemographicsCarried', () => {
  it('is true only when a list names a value', () => {
    expect(googleDisplayDemographicsCarried({ genders: ['MALE'] })).toBe(true);
    expect(googleDisplayDemographicsCarried({ genders: [] })).toBe(false);
    expect(googleDisplayDemographicsCarried(null)).toBe(false);
    expect(googleDisplayDemographicsCarried(['MALE'])).toBe(false);
  });
});
