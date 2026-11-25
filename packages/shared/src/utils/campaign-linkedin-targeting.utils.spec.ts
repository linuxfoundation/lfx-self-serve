// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInTargetingNamesSegments, linkedInTargetingRefusal } from './campaign-linkedin-targeting.utils';

const F = 'linkedInConfig.targeting';
const ids = (prefix: string, n: number, from = 1): string[] => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);
const targeting = { include: [{ skills: ['urn:li:skill:17'], titles: ['urn:li:title:1234'] }, { industries: ['urn:li:industry:4'] }] };
const withT = (t: unknown, rest: Record<string, unknown> = {}): Record<string, unknown> => ({ targetingProfile: 'cloud-native', ...rest, targeting: t });

describe('linkedInTargetingRefusal', () => {
  it.each([
    ['no linkedInConfig', null, []],
    ['a profile create', { targetingProfile: 'cloud-native' }, []],
    ['the catalogue example', withT(targeting), []],
    [
      'every facet',
      withT({
        include: [
          { groups: ['urn:li:group:5'], interfaceLocales: ['urn:li:locale:en_US'], interests: ['urn:li:interest:9'] },
          { seniorities: ['urn:li:seniority:3'], jobFunctions: ['urn:li:function:8'], staffCountRanges: ['urn:li:staffCountRange:(201,500)'] },
          { audienceMatchingSegments: ['urn:li:adSegment:11'], dynamicSegments: ['urn:li:adSegment:12'] },
        ],
        exclude: { employers: ['urn:li:company:7'], skills: ['urn:li:skill:2'] },
      }),
      [],
    ],
    ['10 clauses', withT({ include: Array(10).fill({ skills: ['urn:li:skill:1'] }) }), []],
    ['100 values and duplicates past them', withT({ include: [{ skills: [...ids('urn:li:skill:', 100), 'urn:li:skill:1'] }] }), []],
    ['200 employers, one id under both spellings', withT({ include: [{ employers: [...ids('urn:li:company:', 200), 'urn:li:organization:1'] }] }), []],
    ['a null exclude, as campaign-service decodes it', withT({ include: [{ skills: ['urn:li:skill:1'] }], exclude: null }), []],
    ['an empty exclude object', withT({ include: [{ skills: ['urn:li:skill:1'] }], exclude: {} }), []],
    [
      'configured exclusions merged under the cap',
      withT({ include: [{ skills: ['urn:li:skill:1'] }], exclude: { employers: ids('urn:li:company:', 150) } }),
      ids('urn:li:organization:', 50, 151),
    ],
    ['configured exclusions padded or blank', withT(targeting), [' urn:li:company:5 ', '']],
  ])('accepts %s', (_name, raw, exclusions) => {
    expect(linkedInTargetingRefusal(raw, true, exclusions)).toBeNull();
  });

  it.each([
    ['targeting null', withT(null), F],
    ['targeting a list', withT([]), F],
    ['an unknown key', withT({ ...targeting, excluded: {} }), F],
    ['a differently cased key', withT({ Include: targeting.include }), `${F}.include`],
    ['no include', withT({ exclude: {} }), `${F}.include`],
    ['a clause that is not facets', withT({ include: [{ skills: 'urn:li:skill:1' }] }), `${F}.include`],
    ['a non-text value', withT({ include: [{ skills: [17] }] }), `${F}.include`],
    ['exclude not an object', withT({ ...targeting, exclude: [] }), `${F}.exclude`],
    ['a profile edit beside it', withT(targeting, { targetingProfileEdit: { id: 'cloud-native', skills: [], groups: [] } }), F],
    ['no clause', withT({ include: [] }), `${F}.include`],
    ['11 clauses', withT({ include: Array(11).fill({ skills: ['urn:li:skill:1'] }) }), `${F}.include`],
    ['an empty clause', withT({ include: [{ skills: ['urn:li:skill:1'] }, {}] }), `${F}.include[1]`],
    ['an unknown facet', withT({ include: [{ locations: ['urn:li:geo:1'] }] }), `${F}.include[0]`],
    ['an inherited key as a facet', withT({ include: [{ constructor: ['x'] }] }), `${F}.include[0]`],
    ['an empty facet', withT({ include: [{ skills: [] }] }), `${F}.include[0].skills`],
    ['a blank value', withT({ include: [{ skills: [' '] }] }), `${F}.include[0].skills`],
    ['a padded value', withT({ include: [{ skills: [' urn:li:skill:1'] }] }), `${F}.include[0].skills`],
    ['a leading zero', withT({ include: [{ skills: ['urn:li:skill:01'] }] }), `${F}.include[0].skills`],
    ['a wrong namespace', withT({ include: [{ titles: ['urn:li:skill:1'] }] }), `${F}.include[0].titles`],
    ['an unknown company size', withT({ include: [{ staffCountRanges: ['urn:li:staffCountRange:(1,10)'] }] }), `${F}.include[0].staffCountRanges`],
    ['a malformed locale', withT({ include: [{ interfaceLocales: ['urn:li:locale:en_us'] }] }), `${F}.include[0].interfaceLocales`],
    ['101 values', withT({ include: [{ skills: ids('urn:li:skill:', 101) }] }), `${F}.include[0].skills`],
    ['201 employers', withT({ include: [{ employers: ids('urn:li:company:', 201) }] }), `${F}.include[0].employers`],
    ['groups excluded', withT({ ...targeting, exclude: { groups: ['urn:li:group:1'] } }), `${F}.exclude.groups`],
    ['locales excluded', withT({ ...targeting, exclude: { interfaceLocales: ['urn:li:locale:en_US'] } }), `${F}.exclude.interfaceLocales`],
    ['titles with seniorities across clauses', withT({ include: [{ titles: ['urn:li:title:1'] }, { seniorities: ['urn:li:seniority:1'] }] }), `${F}.include`],
    ['titles with job functions in one clause', withT({ include: [{ titles: ['urn:li:title:1'], jobFunctions: ['urn:li:function:1'] }] }), `${F}.include`],
    ['employers with industries', withT({ include: [{ employers: ['urn:li:company:1'] }, { industries: ['urn:li:industry:1'] }] }), `${F}.include`],
    [
      'employers with company sizes',
      withT({ include: [{ employers: ['urn:li:company:1'], staffCountRanges: ['urn:li:staffCountRange:(1,1)'] }] }),
      `${F}.include`,
    ],
    [
      'company sizes included and excluded',
      withT({ include: [{ staffCountRanges: ['urn:li:staffCountRange:(1,1)'] }], exclude: { staffCountRanges: ['urn:li:staffCountRange:(2,10)'] } }),
      `${F}.exclude.staffCountRanges`,
    ],
    ['a skill included and excluded', withT({ ...targeting, exclude: { skills: ['urn:li:skill:17'] } }), `${F}.exclude.skills`],
    [
      'a segment included under one facet and excluded under the other',
      withT({ include: [{ dynamicSegments: ['urn:li:adSegment:5'] }], exclude: { audienceMatchingSegments: ['urn:li:adSegment:5'] } }),
      `${F}.exclude.audienceMatchingSegments`,
    ],
    [
      'an employer included and excluded under its other spelling',
      withT({ include: [{ employers: ['urn:li:company:5'] }], exclude: { employers: ['urn:li:organization:5'] } }),
      `${F}.exclude.employers`,
    ],
  ])('refuses %s', (_name, raw, field) => {
    expect(linkedInTargetingRefusal(raw, true, [])?.field).toBe(field);
  });

  it('refuses any targeting while the deployment cannot send it, after the shape', () => {
    expect(linkedInTargetingRefusal(withT(targeting), false, [])?.field).toBe(F);
    expect(linkedInTargetingRefusal(withT(null), false, [])?.message).toMatch(/must be an object/);
    expect(linkedInTargetingRefusal({ targetingProfile: 'cloud-native' }, false, [])).toBeNull();
  });

  it.each([
    ['an included employer the deployment excludes', withT({ include: [{ employers: ['urn:li:organization:5'] }] }), ['urn:li:company:5'], `${F}.include`],
    [
      'more than 200 employers once merged',
      withT({ include: [{ skills: ['urn:li:skill:1'] }], exclude: { employers: ids('urn:li:company:', 150) } }),
      ids('urn:li:organization:', 51, 151),
      `${F}.exclude.employers`,
    ],
    ['a malformed configured exclusion', withT(targeting), ['urn:li:company:01'], F],
    ['a configured exclusion of another namespace', withT(targeting), ['urn:li:skill:1'], F],
  ])('refuses %s', (_name, raw, exclusions, field) => {
    expect(linkedInTargetingRefusal(raw, true, exclusions)?.field).toBe(field);
  });

  it('never echoes a caller value', () => {
    const refusal = linkedInTargetingRefusal(withT({ include: [{ 'secret-facet': ['secret-value'] }] }), true, []);
    expect(refusal?.message).not.toMatch(/secret/);
  });
});

describe('linkedInTargetingNamesSegments', () => {
  it.each([
    ['no targeting', { targetingProfile: 'cloud-native' }, false],
    ['taxonomy facets only', withT(targeting), false],
    ['an included matched audience', withT({ include: [{ skills: ['urn:li:skill:1'] }, { audienceMatchingSegments: ['urn:li:adSegment:1'] }] }), true],
    ['an excluded retargeting segment', withT({ ...targeting, exclude: { dynamicSegments: ['urn:li:adSegment:1'] } }), true],
  ])('%s → %s', (_name, raw, expected) => {
    expect(linkedInTargetingNamesSegments(raw)).toBe(expected);
  });
});
