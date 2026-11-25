// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_AUDIENCES_FAILED_MESSAGE,
  LINKEDIN_AUDIENCES_LOADING_MESSAGE,
  LINKEDIN_AUDIENCES_RESTRICTED_MESSAGE,
  LINKEDIN_TARGETING_FACETS,
  LINKEDIN_TARGETING_LIMITS,
  LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE,
  LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE,
  LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE,
  LINKEDIN_TARGETING_STATIC_VALUES,
} from '../constants/campaign.constants';
import type {
  LinkedInAudienceSegment,
  LinkedInAudiencesState,
  LinkedInTargetingDraft,
  LinkedInTargetingEntity,
  LinkedInTargetingFacetPicks,
} from '../interfaces/campaign.interface';
import {
  linkedInSegmentsOwnerKey,
  emptyLinkedInTargetingDraft,
  linkedInAudienceSegmentLabel,
  linkedInAudiencesFailure,
  linkedInTargetingMergedPicks,
  linkedInTargetingCanAddClause,
  linkedInTargetingDraftFromStored,
  linkedInTargetingDraftRefusal,
  linkedInTargetingDraftWithoutSegments,
  linkedInTargetingDraftWithSegmentsAccount,
  linkedInTargetingFacetsToAdd,
  linkedInTargetingForCreate,
  linkedInTargetingPicksWith,
  linkedInTargetingPicksWithout,
  linkedInTargetingSearchChoices,
  linkedInTargetingSearchEmptyMessage,
  linkedInTargetingSearchFailure,
  linkedInTargetingSegmentChoices,
  linkedInTargetingSegmentMessage,
  linkedInTargetingSegmentsAccountRefusal,
  linkedInTargetingStaticChoices,
} from './campaign-linkedin-targeting-form.utils';

const skill = (n: number): LinkedInTargetingEntity => ({ urn: `urn:li:skill:${n}`, name: `Skill ${n}` });
const many = (prefix: string, count: number): LinkedInTargetingEntity[] =>
  Array.from({ length: count }, (_, i) => ({ urn: `${prefix}${i + 1}`, name: `${i + 1}` }));
const segment = (id: number, facet: LinkedInAudienceSegment['facet'] = 'audienceMatchingSegments', status = 'READY'): LinkedInAudienceSegment => ({
  urn: `urn:li:adSegment:${id}`,
  name: `Segment ${id}`,
  facet,
  type: 'USER',
  status,
  approximateMemberCount: null,
});
const pick = (id: number): LinkedInTargetingEntity => ({ urn: `urn:li:adSegment:${id}`, name: `Segment ${id}` });
const draft = (
  clauses: LinkedInTargetingFacetPicks[],
  exclude: LinkedInTargetingFacetPicks = {},
  segmentsAccountId: string | null = null
): LinkedInTargetingDraft => ({
  clauses,
  exclude,
  segmentsAccountId,
});

describe('linkedInTargetingPicksWith / Without', () => {
  it.each<[string, LinkedInTargetingFacetPicks, LinkedInTargetingFacetPicks]>([
    ['adds to an empty facet', {}, { skills: [skill(1)] }],
    ['adds after the picks already there', { skills: [skill(2)] }, { skills: [skill(2), skill(1)] }],
    ['keeps a URN already picked once', { skills: [skill(1)] }, { skills: [skill(1)] }],
    ['adds nothing past the cap', { skills: many('urn:li:skill:', 100) }, { skills: many('urn:li:skill:', 100) }],
  ])('%s', (_label, picks, expected) => {
    expect(linkedInTargetingPicksWith(picks, 'skills', skill(1))).toEqual(expected);
  });

  it('takes employers up to their own, larger cap', () => {
    const picks = { employers: many('urn:li:organization:', 150) };
    expect(linkedInTargetingPicksWith(picks, 'employers', { urn: 'urn:li:organization:999', name: 'x' }).employers).toHaveLength(151);
  });

  it.each<[string, LinkedInTargetingFacetPicks, LinkedInTargetingFacetPicks]>([
    ['removes one value', { skills: [skill(1), skill(2)] }, { skills: [skill(2)] }],
    ['drops a facet left empty', { skills: [skill(1)], titles: [] }, { titles: [] }],
    ['leaves an unknown URN alone', { skills: [skill(2)] }, { skills: [skill(2)] }],
  ])('without: %s', (_label, picks, expected) => {
    expect(linkedInTargetingPicksWithout(picks, 'skills', 'urn:li:skill:1')).toEqual(expected);
  });
});

describe('linkedInTargetingFacetsToAdd', () => {
  it.each<[string, 'include' | 'exclude', LinkedInTargetingFacetPicks, string[]]>([
    [
      'every editor facet in a clause',
      'include',
      {},
      [
        'skills',
        'titles',
        'seniorities',
        'jobFunctions',
        'employers',
        'industries',
        'staffCountRanges',
        'groups',
        'interests',
        'interfaceLocales',
        'audienceMatchingSegments',
        'dynamicSegments',
      ],
    ],
    [
      'no member groups or interface languages in the exclusions',
      'exclude',
      {},
      [
        'skills',
        'titles',
        'seniorities',
        'jobFunctions',
        'employers',
        'industries',
        'staffCountRanges',
        'interests',
        'audienceMatchingSegments',
        'dynamicSegments',
      ],
    ],
    [
      'no facet at its cap',
      'include',
      { skills: many('urn:li:skill:', 100) },
      [
        'titles',
        'seniorities',
        'jobFunctions',
        'employers',
        'industries',
        'staffCountRanges',
        'groups',
        'interests',
        'interfaceLocales',
        'audienceMatchingSegments',
        'dynamicSegments',
      ],
    ],
  ])('%s', (_label, placement, picks, expected) => {
    expect(linkedInTargetingFacetsToAdd(placement, picks).map((facet) => facet.key)).toEqual(expected);
  });
});

describe('choices', () => {
  it.each([
    ['seniorities', 10],
    ['jobFunctions', 26],
    ['staffCountRanges', 9],
    ['interfaceLocales', 21],
  ] as const)('lists every fixed %s value', (facet, count) => {
    expect(linkedInTargetingStaticChoices(facet, {})).toHaveLength(count);
  });

  it('offers only interface languages the create accepts, each once', () => {
    const urns = LINKEDIN_TARGETING_STATIC_VALUES.interfaceLocales.map((value) => value.urn);
    expect(urns.filter((urn) => !LINKEDIN_TARGETING_FACETS.interfaceLocales.pattern?.test(urn))).toEqual([]);
    expect(new Set(urns).size).toBe(urns.length);
  });

  it('leaves out a fixed value already picked, and offers no fixed list for a searched facet', () => {
    const owner = LINKEDIN_TARGETING_STATIC_VALUES.seniorities[9];
    expect(linkedInTargetingStaticChoices('seniorities', { seniorities: [owner] })).not.toContainEqual(owner);
    expect(linkedInTargetingStaticChoices('skills', {})).toEqual([]);
  });

  it('leaves out search answers already picked', () => {
    expect(linkedInTargetingSearchChoices([skill(1), skill(2)], [skill(1)])).toEqual([skill(2)]);
    // An employer is one identity under either spelling, as the create compares it.
    const company = { urn: 'urn:li:company:42', name: 'Acme' };
    const organization = { urn: 'urn:li:organization:42', name: 'Acme' };
    expect(linkedInTargetingSearchChoices([organization, { urn: 'urn:li:organization:43', name: 'Other' }], [company])).toEqual([
      { urn: 'urn:li:organization:43', name: 'Other' },
    ]);
  });

  it.each([
    [503, LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE],
    [500, LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE],
    [0, LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE],
  ])('says why a search answered %s', (status, message) => {
    expect(linkedInTargetingSearchFailure(status)).toBe(message);
  });
});

describe('ad segments', () => {
  it.each<[string, LinkedInTargetingFacetPicks, string[]]>([
    ["offers the facet's segments only", {}, ['urn:li:adSegment:1', 'urn:li:adSegment:2']],
    ['leaves out a segment picked here', { audienceMatchingSegments: [pick(1)] }, ['urn:li:adSegment:2']],
    // The two segment facets are one namespace, as the create compares include and exclude.
    ['leaves out a URN taken under the other segment facet', { dynamicSegments: [pick(2)] }, ['urn:li:adSegment:1']],
  ])('%s', (_label, taken, expected) => {
    const audiences = [segment(1), segment(2), segment(3, 'dynamicSegments')];
    expect(linkedInTargetingSegmentChoices('audienceMatchingSegments', audiences, taken).map((choice) => choice.urn)).toEqual(expected);
  });

  it.each<[string, LinkedInAudienceSegment, string]>([
    ['a ready segment by name', segment(1), 'Segment 1'],
    ['its size when known', { ...segment(1), approximateMemberCount: 12000 }, 'Segment 1 · ~12,000 members'],
    ['that a building one will not serve yet', segment(1, 'dynamicSegments', 'BUILDING'), "Segment 1 (building — won't serve until ready)"],
    ['that an archived one will not serve', segment(1, 'dynamicSegments', 'ARCHIVED'), "Segment 1 (archived — won't serve)"],
  ])('labels %s', (_label, value, expected) => {
    expect(linkedInAudienceSegmentLabel(value)).toBe(expected);
  });

  it.each<[number, unknown, LinkedInAudiencesState['status'], string]>([
    [403, 'LINKEDIN_AUDIENCES_RESTRICTED', 'restricted', LINKEDIN_AUDIENCES_RESTRICTED_MESSAGE],
    [503, LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE, 'unavailable', LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE],
    [503, undefined, 'unavailable', LINKEDIN_AUDIENCES_FAILED_MESSAGE],
    [0, undefined, 'unavailable', LINKEDIN_AUDIENCES_FAILED_MESSAGE],
  ])('a read failed with %s (%j) is %s', (status, code, expected, message) => {
    expect(linkedInAudiencesFailure(status, code)).toEqual({ status: expected, audiences: [], failure: message });
  });

  const loaded = (audiences: LinkedInAudienceSegment[]): LinkedInAudiencesState => ({ status: 'loaded', audiences, failure: null });
  it.each<[string, LinkedInAudiencesState, 'audienceMatchingSegments' | 'dynamicSegments', number, string | null]>([
    ['loading', { status: 'loading', audiences: [], failure: null }, 'dynamicSegments', 0, LINKEDIN_AUDIENCES_LOADING_MESSAGE],
    ['restricted', linkedInAudiencesFailure(403, undefined), 'dynamicSegments', 0, LINKEDIN_AUDIENCES_RESTRICTED_MESSAGE],
    ['unavailable', linkedInAudiencesFailure(500, undefined), 'dynamicSegments', 0, LINKEDIN_AUDIENCES_FAILED_MESSAGE],
    ['choices left', loaded([segment(1)]), 'audienceMatchingSegments', 1, null],
    ['no retargeting segments', loaded([segment(1)]), 'dynamicSegments', 0, 'No retargeting audiences on this ad account.'],
    ['no matched segments', loaded([]), 'audienceMatchingSegments', 0, 'No matched audiences on this ad account.'],
    ['every one taken', loaded([segment(1)]), 'audienceMatchingSegments', 0, 'Every one of these audiences is already used in this targeting.'],
  ])('says, when %s, %j', (_label, state, facet, count, expected) => {
    expect(linkedInTargetingSegmentMessage(state, facet, count)).toBe(expected);
  });
});

describe('linkedInTargetingMergedPicks', () => {
  const go = { urn: 'urn:li:skill:1', name: 'Go' };
  const senior = { urn: 'urn:li:seniority:4', name: 'Senior' };

  it('merges every group per facet, so the exclusions can leave out what a clause includes', () => {
    expect(linkedInTargetingMergedPicks({ skills: [go] }, { seniorities: [senior] }, {})).toEqual({ skills: [go], seniorities: [senior] });
    expect(linkedInTargetingStaticChoices('seniorities', linkedInTargetingMergedPicks({}, { seniorities: [senior] })).map((c) => c.urn)).not.toContain(
      senior.urn
    );
    expect(linkedInTargetingMergedPicks()).toEqual({});
  });
});

describe('linkedInTargetingSearchEmptyMessage', () => {
  it.each<[string | null, boolean, string | null, string]>([
    ['Too short.', true, 'Failed.', 'Too short.'],
    [null, true, 'Failed.', 'Searching…'],
    [null, false, 'Failed.', 'Failed.'],
    [null, false, null, 'Nothing matches. Try another word.'],
  ])('refusal %j, pending %s, failure %j says %j', (refusal, pending, failure, expected) => {
    expect(linkedInTargetingSearchEmptyMessage(refusal, pending, failure)).toBe(expected);
  });
});

describe('linkedInTargetingCanAddClause', () => {
  it.each([
    [1, true],
    [LINKEDIN_TARGETING_LIMITS.clauses - 1, true],
    [LINKEDIN_TARGETING_LIMITS.clauses, false],
  ])('with %s clauses: %s', (count, expected) => {
    expect(linkedInTargetingCanAddClause(draft(Array.from({ length: count }, () => ({}))))).toBe(expected);
  });
});

describe('linkedInTargetingDraftWithoutSegments', () => {
  it.each<[string, LinkedInTargetingDraft, LinkedInTargetingDraft]>([
    ['a draft without segments', draft([{ skills: [skill(1)] }], { skills: [skill(2)] }), draft([{ skills: [skill(1)] }], { skills: [skill(2)] })],
    [
      'both segment facets, in every clause and the exclusions, keeping the rest',
      draft(
        [{ skills: [skill(1)], audienceMatchingSegments: [pick(1)] }, { dynamicSegments: [pick(2)] }],
        { dynamicSegments: [pick(3)], skills: [skill(2)] },
        '100000002'
      ),
      draft([{ skills: [skill(1)] }, {}], { skills: [skill(2)] }),
    ],
  ])('drops the segments of %s', (_label, value, expected) => {
    expect(linkedInTargetingDraftWithoutSegments(value)).toEqual(expected);
  });

  it('returns a draft without segments as it is, so nothing is emitted', () => {
    const value = draft([{ skills: [skill(1)] }]);
    expect(linkedInTargetingDraftWithoutSegments(value)).toBe(value);
  });
});

describe('linkedInTargetingForCreate', () => {
  it.each<[string, LinkedInTargetingDraft, unknown]>([
    ['the empty draft', emptyLinkedInTargetingDraft(), null],
    ['only exclusions', draft([{}], { skills: [skill(1)] }), null],
    ['one clause, URNs only', draft([{ skills: [skill(1), skill(2)] }]), { include: [{ skills: ['urn:li:skill:1', 'urn:li:skill:2'] }] }],
    ['empty facets and clauses dropped', draft([{}, { skills: [skill(1)], titles: [] }, {}]), { include: [{ skills: ['urn:li:skill:1'] }] }],
    [
      'segments as picked, unchanged',
      draft([{ audienceMatchingSegments: [pick(1)] }], { dynamicSegments: [pick(2)] }),
      { include: [{ audienceMatchingSegments: ['urn:li:adSegment:1'] }], exclude: { dynamicSegments: ['urn:li:adSegment:2'] } },
    ],
    [
      'with exclusions',
      draft([{ skills: [skill(1)] }], { skills: [skill(2)], titles: [] }),
      { include: [{ skills: ['urn:li:skill:1'] }], exclude: { skills: ['urn:li:skill:2'] } },
    ],
  ])('%s', (_label, value, expected) => {
    expect(linkedInTargetingForCreate(value)).toEqual(expected);
  });
});

describe('linkedInTargetingDraftRefusal', () => {
  const title = { urn: 'urn:li:title:1', name: 'Engineer' };
  const senior = LINKEDIN_TARGETING_STATIC_VALUES.seniorities[3];
  it.each<[string, LinkedInTargetingDraft, string | null]>([
    ['no clause with a value', emptyLinkedInTargetingDraft(), 'Add at least one included targeting clause.'],
    ['a sendable draft', draft([{ skills: [skill(1)] }]), null],
    [
      'titles with seniorities',
      draft([{ titles: [title] }, { seniorities: [senior] }]),
      'LinkedIn does not take included titles together with included seniorities or job functions.',
    ],
    ['a value both included and excluded', draft([{ skills: [skill(1)] }], { skills: [skill(1)] }), 'Excluded skills holds a value that is also included.'],
    ['interface languages included', draft([{ interfaceLocales: [LINKEDIN_TARGETING_STATIC_VALUES.interfaceLocales[6]] }]), null],
    ['included and excluded segments', draft([{ audienceMatchingSegments: [pick(1)] }], { dynamicSegments: [pick(2)] }), null],
    [
      'one segment included and excluded across the two facets',
      draft([{ audienceMatchingSegments: [pick(1)] }], { dynamicSegments: [pick(1)] }),
      'Excluded dynamicSegments holds a value that is also included.',
    ],
    [
      'company sizes included and excluded',
      draft([{ staffCountRanges: [LINKEDIN_TARGETING_STATIC_VALUES.staffCountRanges[0]] }], {
        staffCountRanges: [LINKEDIN_TARGETING_STATIC_VALUES.staffCountRanges[1]],
      }),
      'Company sizes can be included or excluded, not both.',
    ],
  ])('%s', (_label, value, expected) => {
    expect(linkedInTargetingDraftRefusal(value)).toBe(expected);
  });
});

describe('linkedInTargetingDraftFromStored', () => {
  const english = LINKEDIN_TARGETING_STATIC_VALUES.interfaceLocales[6];
  it.each<[string, unknown, LinkedInTargetingDraft | null]>([
    ['not an object', 'x', null],
    ['no clause list', { exclude: {} }, null],
    ['an empty clause list gets one clause', { clauses: [] }, emptyLinkedInTargetingDraft()],
    [
      'unknown facets and malformed entries dropped',
      { clauses: [{ skills: [skill(1), { urn: 7 }], locales: [skill(2)] }], exclude: { titles: 'x' } },
      draft([{ skills: [skill(1)] }]),
    ],
    [
      'segment picks kept, with the account they were picked for',
      { clauses: [{ audienceMatchingSegments: [pick(1)] }], exclude: { dynamicSegments: [pick(2)] }, segmentsAccountId: '100000002' },
      draft([{ audienceMatchingSegments: [pick(1)] }], { dynamicSegments: [pick(2)] }, '100000002'),
    ],
    ['an account that is not text read as the default', { clauses: [{}], segmentsAccountId: 7 }, emptyLinkedInTargetingDraft()],
    ['interface language picks kept', { clauses: [{ interfaceLocales: [english] }] }, draft([{ interfaceLocales: [english] }])],
  ])('%s', (_label, raw, expected) => {
    expect(linkedInTargetingDraftFromStored(raw)).toEqual(expected);
  });
});

describe('segment account', () => {
  const withSegment = (account: string | null): LinkedInTargetingDraft => draft([{ audienceMatchingSegments: [pick(1)] }], {}, account);
  const withTwo = draft([{ audienceMatchingSegments: [pick(1)] }], { dynamicSegments: [pick(2)] });

  it.each<[string, LinkedInTargetingDraft, LinkedInTargetingDraft, string | null]>([
    ['the first segment takes the editor account', draft([{ skills: [skill(1)] }]), withSegment(null), '100000002'],
    ['a further segment keeps the account the first was picked for', withSegment('100000001'), withTwo, '100000001'],
    ['no segment left clears it', withSegment('100000002'), draft([{ skills: [skill(1)] }]), null],
  ])('%s', (_label, previous, next, expected) => {
    expect(linkedInTargetingDraftWithSegmentsAccount(previous, next, '100000002').segmentsAccountId).toBe(expected);
  });

  it.each<[string, LinkedInTargetingDraft, string | null, string | null]>([
    ['no segment', draft([{ skills: [skill(1)] }], {}, '100000001'), '100000002', null],
    ['segments for the same account', withSegment('100000002'), '100000002', null],
    ['segments for the default, sent to the default', withSegment(null), null, null],
    ['segments for another account', withSegment('100000001'), '100000002', LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE],
    ['segments for the default, sent to a chosen account', withSegment(null), '100000002', LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE],
    ['excluded segments for another account', draft([{}], { dynamicSegments: [pick(2)] }, '100000001'), null, LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE],
  ])('refuses %s: %j', (_label, value, account, expected) => {
    expect(linkedInTargetingSegmentsAccountRefusal(value, account)).toBe(expected);
  });
});

describe('linkedInSegmentsOwnerKey', () => {
  it.each([
    ['a picked account', 'tlf', '100000002', 'tlf|100000002'],
    ["the foundation's default account", 'tlf', null, 'tlf|'],
    ["another foundation's default account", 'cncf', null, 'cncf|'],
  ])('keys %s by foundation and account', (_name, projectSlug, accountId, expected) => {
    expect(linkedInSegmentsOwnerKey(projectSlug, accountId)).toBe(expected);
  });
});
