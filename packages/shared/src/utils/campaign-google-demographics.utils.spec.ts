// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleAdGroupDemographicExclusionsRefusal,
  googleDisplayDemographicsCarried,
  googleDemandGenDemographicsLeftOut,
  googleDemandGenDemographicsMalformed,
  googleDemandGenDemographicsRefusal,
  googleDemographicValuesAsOffered,
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

describe('campaign-level age and gender exclusions with non-ASCII padding (upstream trims, no non-ASCII refusal)', () => {
  it('refuses observing GENDER when every gender is excluded, one of them padded with a no-break space', () => {
    expect(googleObservedDemographicsRefusal(['GENDER'], 'search', { genders: ['MALE', 'FEMALE', 'UNDETERMINED\u00a0'] })).toContain(
      'Every gender is excluded'
    );
  });

  it('refuses targeting a gender the campaign excludes with a no-break space after it', () => {
    expect(googleDisplayDemographicsRefusal({ genders: ['FEMALE'] }, 'display', { genders: ['FEMALE\u00a0'] })).toContain('both target and exclude');
  });

  it('keeps the non-ASCII refusal for income exclusions, which upstream resolves through validateEnumExclusions', () => {
    expect(googleDisplayDemographicsRefusal({ incomeRanges: ['UNDETERMINED'] }, 'display', { incomeRanges: ['UNDETERMINED\u00a0'] })).toBeNull();
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

// One test per branch of campaign-service v1.0.35's `validateDemandGenDemographics`,
// `validateDemandGenGroupDemographics`, `buildDemographicPlan`, `demographicTargets` and `coversEveryone`
// (`internal/platform/googleads/demandgen_demographics.go`).
describe('googleDemandGenDemographicsRefusal', () => {
  const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const INCOMES = ['INCOME_RANGE_0_50', 'INCOME_RANGE_50_60', 'INCOME_RANGE_60_70', 'INCOME_RANGE_70_80', 'INCOME_RANGE_80_90', 'INCOME_RANGE_90_UP'];

  it("accepts the live KubeCon NA campaign's shape: ages 25 to 54 with Unknown, income and parental status left open", () => {
    expect(googleDemandGenDemographicsRefusal({ ageRanges: ['25-34', '35-44', '45-54', 'UNDETERMINED'] }, undefined, undefined, 'demand-gen')).toBeNull();
  });

  it('accepts every dimension together, in either spelling and any case', () => {
    expect(
      googleDemandGenDemographicsRefusal(
        { ageRanges: ['AGE_RANGE_65_UP'], genders: ['female'], incomeRanges: ['income_range_90_up', 'UNDETERMINED'], parentalStatuses: ['NOT_A_PARENT'] },
        undefined,
        '',
        'demand-gen'
      )
    ).toBeNull();
  });

  it('asks nothing of an absent or null value, or of a create with no channel', () => {
    expect(googleDemandGenDemographicsRefusal(undefined, undefined, undefined, 'search')).toBeNull();
    expect(googleDemandGenDemographicsRefusal(null, [{ demographics: null }], undefined, 'demand-gen')).toBeNull();
    expect(googleDemandGenDemographicsRefusal({ genders: ['MALE'] }, undefined, undefined, undefined)).toBeNull();
  });

  it.each([[['25-34']], ['25-34'], [{ ageRanges: '25-34' }], [{ genders: [1] }]])('refuses %j, which Go cannot decode', (raw) => {
    expect(googleDemandGenDemographicsRefusal(raw, undefined, undefined, 'demand-gen')).toEqual({
      field: 'demandGenDemographics',
      message: expect.stringContaining('must be'),
    });
  });

  it("refuses a group's demographics Go cannot decode, after the single ad group's and before any other check", () => {
    expect(googleDemandGenDemographicsRefusal(undefined, [{}, { demographics: ['MALE'] }], undefined, 'demand-gen')).toEqual({
      field: 'demandGenAdGroups',
      message: expect.stringContaining('Demand Gen ad group 2 must be an object'),
    });
    expect(googleDemandGenDemographicsRefusal({ genders: 'MALE' }, [{ demographics: [] }], undefined, 'demand-gen')?.field).toBe('demandGenDemographics');
  });

  it.each([['audienceSegments'], ['customAudiences']])('refuses %s by name, which this application does not send', (key) => {
    expect(
      googleDemandGenDemographicsRefusal({ genders: ['MALE'], [key]: ['customers/1/userLists/2'] }, undefined, undefined, 'demand-gen')?.message
    ).toContain('sends only age, gender, income and parental status');
    expect(googleDemandGenDemographicsRefusal({ genders: ['MALE'], [key]: [] }, undefined, undefined, 'demand-gen')).toBeNull();
  });

  it.each([
    ['search', 'observed demographics'],
    ['display', 'demographic targeting'],
    ['video', 'age and gender exclusions'],
  ])('refuses them on %s, naming what that channel takes instead', (channel, hint) => {
    const message = googleDemandGenDemographicsRefusal({ genders: ['MALE'] }, undefined, undefined, channel)?.message;
    expect(message).toContain('Demand Gen ad group only');
    expect(message).toContain(hint);
  });

  it('refuses them on Performance Max with no channel to point at', () => {
    expect(googleDemandGenDemographicsRefusal({ genders: ['MALE'] }, undefined, undefined, 'performance-max')?.message).toMatch(/then create again\.$/);
  });

  it.each([[{}], [{ ageRanges: [], genders: null }]])('refuses %j, an object naming nothing', (raw) => {
    expect(googleDemandGenDemographicsRefusal(raw, undefined, undefined, 'demand-gen')?.message).toContain('set but name nothing');
  });

  it('refuses them beside the Demand Gen audience', () => {
    expect(googleDemandGenDemographicsRefusal({ genders: ['MALE'] }, undefined, 'customers/1/audiences/2', 'demand-gen')?.message).toContain(
      'cannot both be set'
    );
  });

  it("refuses them beside a group's audience", () => {
    expect(
      googleDemandGenDemographicsRefusal({ genders: ['MALE'] }, [{ name: 'A' }, { name: 'B', audience: 'customers/1/audiences/2' }], undefined, 'demand-gen')
        ?.message
    ).toContain('audience of Demand Gen ad group 2');
  });

  it('refuses them when every group sets its own, and accepts them while one group does not', () => {
    const own = { demographics: { genders: ['MALE'] } };
    expect(googleDemandGenDemographicsRefusal({ genders: ['FEMALE'] }, [own, own], undefined, 'demand-gen')?.message).toContain('would reach no ad group');
    expect(googleDemandGenDemographicsRefusal({ genders: ['FEMALE'] }, [own, {}], undefined, 'demand-gen')).toBeNull();
  });

  it('refuses a 21st entry on the submitted count, before a repeat is collapsed', () => {
    expect(googleDemandGenDemographicsRefusal({ genders: Array.from({ length: 20 }, () => 'MALE') }, undefined, undefined, 'demand-gen')).toBeNull();
    expect(googleDemandGenDemographicsRefusal({ genders: Array.from({ length: 21 }, () => 'MALE') }, undefined, undefined, 'demand-gen')?.message).toContain(
      'at most 20 genders'
    );
  });

  it.each([
    [{ ageRanges: ['25-35'] }, '18-24'],
    [{ genders: ['constructor'] }, 'MALE, FEMALE, UNDETERMINED'],
    [{ incomeRanges: ['ıncome_range_0_50'] }, 'INCOME_RANGE_0_50'],
    [{ parentalStatuses: ['  '] }, 'NOT_A_PARENT'],
  ])('refuses %j on its vocabulary', (raw, expected) => {
    expect(googleDemandGenDemographicsRefusal(raw, undefined, undefined, 'demand-gen')?.message).toContain(expected);
  });

  it('judges the dimensions in order: ages before genders', () => {
    expect(googleDemandGenDemographicsRefusal({ ageRanges: ['NOPE'], genders: ['NOPE'] }, undefined, undefined, 'demand-gen')?.message).toContain('age range');
  });

  it.each([
    [{ ageRanges: ['AGE_RANGE_UNDETERMINED'] }, 'age range'],
    [{ genders: ['UNDETERMINED', 'undetermined'] }, 'gender'],
    [{ incomeRanges: ['INCOME_RANGE_UNDETERMINED'] }, 'income range'],
    [{ parentalStatuses: ['UNDETERMINED'] }, 'parental status'],
  ])('refuses %j, Unknown alone in a dimension', (raw, noun) => {
    expect(googleDemandGenDemographicsRefusal(raw, undefined, undefined, 'demand-gen')?.message).toContain(
      `The ${noun} list in the Demand Gen demographics holds only Unknown`
    );
  });

  it('accepts a dimension naming every value and Unknown beside one that narrows, and names it as left out', () => {
    const raw = { ageRanges: [...AGES, 'UNDETERMINED'], genders: ['FEMALE'] };
    expect(googleDemandGenDemographicsRefusal(raw, undefined, undefined, 'demand-gen')).toBeNull();
    expect(googleDemandGenDemographicsLeftOut(raw)).toEqual(['age']);
  });

  it('keeps a dimension naming every value without Unknown, which still narrows', () => {
    expect(googleDemandGenDemographicsLeftOut({ incomeRanges: INCOMES })).toEqual([]);
  });

  it('refuses demographics where every dimension names everyone', () => {
    expect(
      googleDemandGenDemographicsRefusal(
        { genders: ['MALE', 'FEMALE', 'UNDETERMINED'], parentalStatuses: ['PARENT', 'NOT_A_PARENT', 'UNDETERMINED'] },
        undefined,
        undefined,
        'demand-gen'
      )?.message
    ).toContain('restrict nobody: each dimension they set (gender, parental status)');
  });

  it('names no dimension left out of demographics that would be refused', () => {
    expect(googleDemandGenDemographicsLeftOut({ genders: ['MALE', 'FEMALE', 'UNDETERMINED'] })).toEqual([]);
    expect(googleDemandGenDemographicsLeftOut(['MALE'])).toEqual([]);
  });

  it("refuses a group's demographics naming nothing", () => {
    expect(googleDemandGenDemographicsRefusal(undefined, [{ demographics: {} }], undefined, 'demand-gen')).toEqual({
      field: 'demandGenAdGroups',
      message: expect.stringContaining('Demand Gen ad group 1 are set but name nothing'),
    });
  });

  it("refuses a group's demographics beside its own audience", () => {
    expect(
      googleDemandGenDemographicsRefusal(undefined, [{ audience: 'customers/1/audiences/2', demographics: { genders: ['MALE'] } }], undefined, 'demand-gen')
        ?.message
    ).toContain('Demand Gen ad group 1 sets both an audience and demographics');
  });

  it("refuses a group's demographics on the same plan, naming the group", () => {
    expect(googleDemandGenDemographicsRefusal(undefined, [{}, { demographics: { genders: ['UNDETERMINED'] } }], undefined, 'demand-gen')).toEqual({
      field: 'demandGenAdGroups',
      message: expect.stringContaining('the demographics of Demand Gen ad group 2 holds only Unknown'),
    });
  });

  it("judges the single ad group's demographics before any group's", () => {
    expect(googleDemandGenDemographicsRefusal({ genders: ['NOPE'] }, [{ demographics: { genders: ['NOPE'] } }, {}], undefined, 'demand-gen')?.field).toBe(
      'demandGenDemographics'
    );
  });

  it('accepts a different Audience on each group, and judges no group off Demand Gen', () => {
    expect(
      googleDemandGenDemographicsRefusal(
        undefined,
        [{ demographics: { ageRanges: ['25-34'] } }, { audience: 'customers/1/audiences/2' }],
        undefined,
        'demand-gen'
      )
    ).toBeNull();
    expect(googleDemandGenDemographicsRefusal(undefined, [{ demographics: {} }], undefined, 'search')).toBeNull();
  });
});

describe('googleDemographicValuesAsOffered', () => {
  it.each([
    ['ageRanges', ['AGE_RANGE_25_34', ' age_range_65_up ', 'AGE_RANGE_UNDETERMINED'], ['25-34', '65+', 'UNDETERMINED']],
    ['genders', ['female', 'UNDETERMINED'], ['FEMALE', 'UNDETERMINED']],
    ['incomeRanges', ['INCOME_RANGE_UNDETERMINED', 'income_range_90_up'], ['UNDETERMINED', 'INCOME_RANGE_90_UP']],
    ['parentalStatuses', ['not_a_parent'], ['NOT_A_PARENT']],
  ] as const)('rewrites each accepted %s spelling to the one its checkbox offers', (key, values, offered) => {
    expect(googleDemographicValuesAsOffered(key, values)).toEqual(offered);
  });

  it('keeps a value upstream refuses as it is, a non-ASCII spelling included, and drops a repeat the rewrite makes', () => {
    expect(googleDemographicValuesAsOffered('genders', ['NOPE', 'MALE', 'male', 'ımale'])).toEqual(['NOPE', 'MALE', 'ımale']);
    expect(googleDemographicValuesAsOffered('ageRanges', ['25-34', 'AGE_RANGE_25_34'])).toEqual(['25-34']);
  });

  it('keeps a non-string a hand-built draft holds, for the shape refusal, rather than throwing on it', () => {
    expect(googleDemographicValuesAsOffered('genders', [7, 'female'] as unknown as string[])).toEqual([7, 'FEMALE']);
  });
});

describe('googleDemandGenDemographicsMalformed', () => {
  it.each([
    ['a string', 'FEMALE'],
    ['a list', ['FEMALE']],
    ['an object whose list is not a list', { genders: 'FEMALE' }],
    ['a non-string entry', { genders: [7] }],
    ['audience segments', { audienceSegments: ['customers/1/userLists/5'] }],
    ['custom audiences beside a value', { genders: ['FEMALE'], customAudiences: ['customers/1/customAudiences/7'] }],
  ])('is true for %s', (_label, raw) => {
    expect(googleDemandGenDemographicsMalformed(raw)).toBe(true);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an empty object', {}],
    ['well-formed lists', { genders: ['FEMALE'], ageRanges: [] }],
    ['empty segment lists', { audienceSegments: [], customAudiences: null }],
  ])('is false for %s', (_label, raw) => {
    expect(googleDemandGenDemographicsMalformed(raw)).toBe(false);
  });
});
