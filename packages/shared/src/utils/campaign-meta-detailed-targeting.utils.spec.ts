// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  META_AUDIENCE_TARGETING_OFF_MESSAGE,
  META_BEHAVIOR_TARGETING_OFF_MESSAGE,
  META_INTEREST_TARGETING_OFF_MESSAGE,
  META_LOCALE_TARGETING_OFF_MESSAGE,
  META_TARGETING_SEARCH_BUSY_MESSAGE,
  META_TARGETING_SEARCH_FAILED_MESSAGE,
  META_TARGETING_SEARCH_NO_MATCH_MESSAGE,
  META_TARGETING_SEARCH_PENDING_MESSAGE,
  META_TARGETING_SEARCH_TOO_SHORT_MESSAGE,
  META_TARGETING_SEARCH_UNAVAILABLE_MESSAGE,
} from '../constants/campaign.constants';
import type { MetaTargetingFlags, MetaTargetingPick, MetaTargetingSearchOption } from '../interfaces/campaign.interface';
import {
  compactMetaDetailedTargeting,
  copyMetaDetailedTargetingPicks,
  metaDetailedTargetingBlock,
  metaDetailedTargetingForCreate,
  metaDetailedTargetingPicksFromDraft,
  metaDetailedTargetingPicksSendable,
  emptyMetaDetailedTargetingPicks,
  metaTargetingKindsShown,
  metaTargetingPicksWith,
  metaTargetingPicksWithout,
  metaTargetingSearchChoices,
  metaTargetingSearchEmptyMessage,
  metaTargetingSearchFailure,
  metaTargetingSearchQuery,
  isMetaTargetingSearchType,
  metaDetailedTargetingRefusal,
  metaTargetingFlagRefusal,
  metaTargetingHasAudienceFields,
  metaTargetingHasDetailedFields,
  metaTargetingQueryRefusal,
} from './campaign-meta-detailed-targeting.utils';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(6003 + i));
const allOn: MetaTargetingFlags = { audience: true, interest: true, behavior: true, locale: true };

describe('which fields a block sets', () => {
  it.each([
    [{}, false, false],
    [{ ageMin: 30 }, true, false],
    [{ advantageAudience: false }, true, false],
    [{ interests: ['6003'] }, false, true],
    [{ locales: [6] }, false, true],
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
  ])('refuses %j naming %s', (raw, field) => {
    expect(metaDetailedTargetingRefusal(raw)?.field).toBe(field);
  });

  it('names the cap in the message', () => {
    expect(metaDetailedTargetingRefusal({ workPositions: ids(26) })?.message).toBe('Choose at most 25 job titles.');
  });
});

describe('compactMetaDetailedTargeting', () => {
  it('trims and de-duplicates ids in first-seen order, and drops empty lists', () => {
    expect(compactMetaDetailedTargeting({ interests: [' 6003', '6004', '6003'], behaviors: [], locales: [6, 6, 1001], ageMin: 30 })).toEqual({
      interests: ['6003', '6004'],
      locales: [6, 1001],
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
    ['interest', 'x'.repeat(100)],
    // Code points, not UTF-16 units: 100 emoji are 100 characters.
    ['interest', '🚀'.repeat(100)],
  ])('accepts %s %j', (type, query) => {
    expect(metaTargetingQueryRefusal(type, query)).toBeNull();
  });

  it.each([
    ['industry', 'kubernetes', 'The search type must be one of interest, behavior, work_position.'],
    [undefined, 'kubernetes', 'The search type must be one of interest, behavior, work_position.'],
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

describe('the detailed-targeting picker rules', () => {
  const pick = (id: string, name = `Name ${id}`): MetaTargetingPick => ({ id, name });
  const option = (id: string): MetaTargetingSearchOption => ({ id, name: `Name ${id}`, path: [] });
  const full = Array.from({ length: 25 }, (_, i) => pick(String(1000 + i)));

  it('starts every list empty, with a fresh object each time', () => {
    expect(emptyMetaDetailedTargetingPicks()).toEqual({ interests: [], behaviors: [], workPositions: [] });
    expect(emptyMetaDetailedTargetingPicks()).not.toBe(emptyMetaDetailedTargetingPicks());
  });

  it.each([
    [{ interest: true, behavior: true }, ['interests', 'behaviors', 'workPositions']],
    [{ interest: true, behavior: false }, ['interests']],
    [{ interest: false, behavior: true }, ['behaviors', 'workPositions']],
    [{ interest: false, behavior: false }, []],
  ])('shows the lists %j turns on', (flags, keys) => {
    expect(metaTargetingKindsShown(flags).map((kind) => kind.key)).toEqual(keys);
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
    expect(metaTargetingPicksWith([], { id: ' 6003 ', name: ' Open source ' })).toEqual([{ id: '6003', name: 'Open source' }]);
    expect(metaTargetingPicksWith([], { id: '6003', name: ' ' })).toEqual([{ id: '6003', name: '6003' }]);
  });

  it.each([
    ['already picked', [pick('6003')], '6003'],
    ['not a Meta id', [], '06003'],
    ['the list is full', full, '6003'],
  ])('leaves the list alone when the option is %s', (_case, picks, id) => {
    expect(metaTargetingPicksWith(picks, option(id))).toBe(picks);
  });

  it('removes a pick by id', () => {
    expect(metaTargetingPicksWithout([pick('1'), pick('2')], '1')).toEqual([pick('2')]);
  });

  it('disables a picked row, and every row once the list is full', () => {
    expect(metaTargetingSearchChoices([option('1'), option('2')], [pick('1')]).map((c) => c.disabled)).toEqual([true, false]);
    expect(metaTargetingSearchChoices([option('9')], full).map((c) => c.disabled)).toEqual([true]);
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
  const picks = {
    interests: [{ id: '6003', name: 'Open source' }],
    behaviors: [{ id: '6004', name: 'Early adopters' }],
    workPositions: [{ id: '105', name: 'Engineer' }],
  };
  const none = emptyMetaDetailedTargetingPicks();

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
      { interests: [{ id: '6003', name: 'Open source' }], behaviors: [], workPositions: [{ id: '105', name: 'Engineer' }] },
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
  });

  it.each([
    [true, true, { interests: ['6003'], behaviors: ['6004'], workPositions: ['105'] }],
    [true, false, { interests: ['6003'] }],
    [null, true, { behaviors: ['6004'], workPositions: ['105'] }],
    [false, null, null],
  ])('sends the lists whose flag is a yes (interest %s, behavior %s)', (interest, behavior, expected) => {
    expect(metaDetailedTargetingForCreate(picks, interest, behavior)).toEqual(expected);
  });

  it('sends nothing for empty lists', () => {
    expect(metaDetailedTargetingForCreate(none, true, true)).toBeNull();
  });

  it('clears only the lists this deployment answered no to', () => {
    expect(metaDetailedTargetingPicksSendable(picks, true, false)).toEqual({ ...none, interests: picks.interests });
    expect(metaDetailedTargetingPicksSendable(picks, null, false)).toEqual({ ...none, interests: picks.interests });
  });

  const block = (over: Partial<Parameters<typeof metaDetailedTargetingBlock>[0]>) =>
    metaDetailedTargetingBlock({ picks, interestEnabled: true, behaviorEnabled: true, createCapabilityRead: 'ready', briefId: 'b-1', ...over })?.kind ?? null;

  it.each([
    ['every held list is sendable', {}, null],
    ['nothing is picked in an unsendable list', { picks: { ...none, interests: picks.interests }, behaviorEnabled: false }, null],
    ['a held list answered no', { behaviorEnabled: false }, 'unsupported'],
    ['a no wins over an unanswered list', { interestEnabled: null, behaviorEnabled: false, createCapabilityRead: 'pending' }, 'unsupported'],
    ['the answer is still out', { interestEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    ['the brief is unsaved', { interestEnabled: null, briefId: null }, 'unsaved'],
    ['the answer failed', { interestEnabled: null, createCapabilityRead: 'failed' }, 'failed'],
  ] as const)('holds Create when %s', (_case, over, kind) => {
    expect(block(over)).toBe(kind);
  });
});
