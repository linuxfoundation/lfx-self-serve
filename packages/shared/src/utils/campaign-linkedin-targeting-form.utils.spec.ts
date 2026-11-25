// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  LINKEDIN_TARGETING_LIMITS,
  LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE,
  LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE,
  LINKEDIN_TARGETING_STATIC_VALUES,
} from '../constants/campaign.constants';
import type { LinkedInTargetingDraft, LinkedInTargetingEntity, LinkedInTargetingFacetPicks } from '../interfaces/campaign.interface';
import {
  emptyLinkedInTargetingDraft,
  linkedInTargetingCanAddClause,
  linkedInTargetingDraftFromStored,
  linkedInTargetingDraftRefusal,
  linkedInTargetingFacetsToAdd,
  linkedInTargetingForCreate,
  linkedInTargetingPicksWith,
  linkedInTargetingPicksWithout,
  linkedInTargetingSearchChoices,
  linkedInTargetingSearchEmptyMessage,
  linkedInTargetingSearchFailure,
  linkedInTargetingStaticChoices,
} from './campaign-linkedin-targeting-form.utils';

const skill = (n: number): LinkedInTargetingEntity => ({ urn: `urn:li:skill:${n}`, name: `Skill ${n}` });
const many = (prefix: string, count: number): LinkedInTargetingEntity[] =>
  Array.from({ length: count }, (_, i) => ({ urn: `${prefix}${i + 1}`, name: `${i + 1}` }));
const draft = (clauses: LinkedInTargetingFacetPicks[], exclude: LinkedInTargetingFacetPicks = {}): LinkedInTargetingDraft => ({ clauses, exclude });

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
      ['skills', 'titles', 'seniorities', 'jobFunctions', 'employers', 'industries', 'staffCountRanges', 'groups', 'interests'],
    ],
    [
      'no member groups in the exclusions',
      'exclude',
      {},
      ['skills', 'titles', 'seniorities', 'jobFunctions', 'employers', 'industries', 'staffCountRanges', 'interests'],
    ],
    [
      'no facet at its cap',
      'include',
      { skills: many('urn:li:skill:', 100) },
      ['titles', 'seniorities', 'jobFunctions', 'employers', 'industries', 'staffCountRanges', 'groups', 'interests'],
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
  ] as const)('lists every fixed %s value', (facet, count) => {
    expect(linkedInTargetingStaticChoices(facet, {})).toHaveLength(count);
  });

  it('leaves out a fixed value already picked, and offers no fixed list for a searched facet', () => {
    const owner = LINKEDIN_TARGETING_STATIC_VALUES.seniorities[9];
    expect(linkedInTargetingStaticChoices('seniorities', { seniorities: [owner] })).not.toContainEqual(owner);
    expect(linkedInTargetingStaticChoices('skills', {})).toEqual([]);
  });

  it('leaves out search answers already picked', () => {
    expect(linkedInTargetingSearchChoices([skill(1), skill(2)], [skill(1)])).toEqual([skill(2)]);
  });

  it.each([
    [503, LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE],
    [500, LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE],
    [0, LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE],
  ])('says why a search answered %s', (status, message) => {
    expect(linkedInTargetingSearchFailure(status)).toBe(message);
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

describe('linkedInTargetingForCreate', () => {
  it.each<[string, LinkedInTargetingDraft, unknown]>([
    ['the empty draft', emptyLinkedInTargetingDraft(), null],
    ['only exclusions', draft([{}], { skills: [skill(1)] }), null],
    ['one clause, URNs only', draft([{ skills: [skill(1), skill(2)] }]), { include: [{ skills: ['urn:li:skill:1', 'urn:li:skill:2'] }] }],
    ['empty facets and clauses dropped', draft([{}, { skills: [skill(1)], titles: [] }, {}]), { include: [{ skills: ['urn:li:skill:1'] }] }],
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
  it.each<[string, unknown, LinkedInTargetingDraft | null]>([
    ['not an object', 'x', null],
    ['no clause list', { exclude: {} }, null],
    ['an empty clause list gets one clause', { clauses: [] }, { clauses: [{}], exclude: {} }],
    [
      'unknown facets and malformed entries dropped',
      { clauses: [{ skills: [skill(1), { urn: 7 }], locales: [skill(2)] }], exclude: { titles: 'x' } },
      { clauses: [{ skills: [skill(1)] }], exclude: {} },
    ],
  ])('%s', (_label, raw, expected) => {
    expect(linkedInTargetingDraftFromStored(raw)).toEqual(expected);
  });
});
