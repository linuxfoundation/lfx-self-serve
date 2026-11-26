// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type {
  CampaignCapabilityReadState,
  CampaignRedditCustomAudiencesBlock,
  RedditConfigRefusal,
  RedditCustomAudiencesDraft,
  RedditCustomAudiencesResult,
} from '../interfaces/campaign.interface';
import {
  redditConfigNamesCustomAudiences,
  redditCustomAudienceAddRefusal,
  redditCustomAudienceIdsFromDraft,
  redditCustomAudiencesBlock,
  redditCustomAudiencesCapability,
  redditCustomAudiencesDraftRefusal,
  redditCustomAudiencesField,
  redditCustomAudienceQuery,
  redditCustomAudiencesFromPayload,
  redditCustomAudiencesRefusal,
} from './campaign-reddit-custom-audiences.utils';

const IN = 'redditConfig.customAudienceIds';
const EX = 'redditConfig.excludedCustomAudienceIds';
const OFF = 'Reddit custom audiences are not enabled on this deployment. Reload the page, then create again without them.';
const NOT_A_LIST = 'The custom audiences must be a list of Reddit custom audience ids.';
const BAD_ID = 'Entry 2 is not a Reddit custom audience id (1 to 64 letters, digits or underscores, with no spaces).';
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `aud_${i}`);

describe('redditCustomAudiencesRefusal', () => {
  it.each<[string, unknown, boolean, RedditConfigRefusal | null]>([
    ['no config', undefined, true, null],
    ['no lists, flag off', { budgetUsd: 50 }, false, null],
    ['empty lists, flag off', { customAudienceIds: [], excludedCustomAudienceIds: [] }, false, null],
    ['null lists, flag off (null decodes as no list)', { customAudienceIds: null, excludedCustomAudienceIds: null }, false, null],
    [
      'a case variant of the key, flag off',
      { CustomAudienceIds: ['a1'] },
      false,
      { field: IN, message: 'Send the custom audiences as "customAudienceIds", spelled exactly.' },
    ],
    [
      'a long-s fold of the exclusion key',
      { excludedCuſtomAudienceIds: ['a1'] },
      true,
      { field: EX, message: 'Send the custom audiences as "excludedCustomAudienceIds", spelled exactly.' },
    ],
    ['a string, flag off (shape before flag)', { customAudienceIds: 'a1' }, false, { field: IN, message: NOT_A_LIST }],
    ['a number in the exclusion list', { excludedCustomAudienceIds: ['a1', 2] }, true, { field: EX, message: NOT_A_LIST }],
    ['a target list, flag off', { customAudienceIds: ['a1'] }, false, { field: IN, message: OFF }],
    ['only an exclusion list, flag off', { customAudienceIds: [], excludedCustomAudienceIds: ['a1'] }, false, { field: EX, message: OFF }],
    ['valid lists', { customAudienceIds: ['67547345732543', 't2_abc'], excludedCustomAudienceIds: ['A_1'] }, true, null],
    ['a 64-character id', { customAudienceIds: ['a'.repeat(64)] }, true, null],
    ['a 65-character id', { customAudienceIds: ['x', 'a'.repeat(65)] }, true, { field: IN, message: BAD_ID }],
    ['an empty id', { customAudienceIds: ['x', ''] }, true, { field: IN, message: BAD_ID }],
    ['a padded id (never trimmed)', { customAudienceIds: ['x', ' a1 '] }, true, { field: IN, message: BAD_ID }],
    ['a hyphenated id', { excludedCustomAudienceIds: ['x', 'a-1'] }, true, { field: EX, message: BAD_ID }],
    ['a non-ASCII digit', { customAudienceIds: ['x', '١'] }, true, { field: IN, message: BAD_ID }],
    ['a trailing newline', { customAudienceIds: ['x', 'a1\n'] }, true, { field: IN, message: BAD_ID }],
    ['100 ids', { customAudienceIds: ids(100) }, true, null],
    ['101 ids', { excludedCustomAudienceIds: ids(101) }, true, { field: EX, message: 'Pick at most 100 custom audiences.' }],
    ['a repeat within a list', { customAudienceIds: ['a1', 'b2', 'a1'] }, true, { field: IN, message: 'Entry 3 repeats an earlier custom audience.' }],
    ['ids differing only in case', { customAudienceIds: ['a1', 'A1'] }, true, null],
    [
      'an id in both lists',
      { customAudienceIds: ['a1', 'b2'], excludedCustomAudienceIds: ['c3', 'b2'] },
      true,
      { field: EX, message: 'Entry 2 is also a targeted custom audience. An audience cannot be both targeted and excluded.' },
    ],
    [
      'the target list is judged before the exclusion list',
      { customAudienceIds: ['a1', 'a1'], excludedCustomAudienceIds: ['bad id'] },
      true,
      { field: IN, message: 'Entry 2 repeats an earlier custom audience.' },
    ],
  ])('%s', (_name, raw, enabled, expected) => {
    expect(redditCustomAudiencesRefusal(raw, enabled)).toEqual(expected);
  });
});

describe('redditConfigNamesCustomAudiences', () => {
  it.each<[string, unknown, boolean]>([
    ['no config', undefined, false],
    ['empty lists', { customAudienceIds: [], excludedCustomAudienceIds: [] }, false],
    ['a target list', { customAudienceIds: ['a1'] }, true],
    ['an exclusion list', { excludedCustomAudienceIds: ['a1'] }, true],
  ])('%s', (_name, raw, expected) => {
    expect(redditConfigNamesCustomAudiences(raw)).toBe(expected);
  });
});

describe('redditCustomAudienceQuery', () => {
  it.each<[string, unknown, { valid: boolean; q?: string }]>([
    ['absent', undefined, { valid: true }],
    ['text, trimmed', '  KubeCon ', { valid: true, q: 'KubeCon' }],
    ['blank', '  ', { valid: false }],
    ['101 characters', 'q'.repeat(101), { valid: false }],
    ['repeated', ['a', 'b'], { valid: false }],
  ])('%s', (_name, raw, expected) => {
    expect(redditCustomAudienceQuery(raw)).toEqual(expected);
  });
});

describe('redditCustomAudiencesFromPayload', () => {
  const visitors = { id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', size_lower: 1000, size_upper: 5000 };

  it.each<[string, unknown, string | undefined, RedditCustomAudiencesResult | null]>([
    ['no body', undefined, undefined, null],
    ['no audiences array', { account_id: 't2_acct', audiences: null }, undefined, null],
    [
      'rows camel-cased, sizes absent read as null',
      { account_id: 't2_acct', audiences: [visitors, { id: 'b_2', name: 'Registrants', type: 'CUSTOMER_LIST', status: 'PENDING' }], truncated: true },
      undefined,
      {
        accountId: 't2_acct',
        audiences: [
          { id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', sizeLower: 1000, sizeUpper: 5000 },
          { id: 'b_2', name: 'Registrants', type: 'CUSTOMER_LIST', status: 'PENDING', sizeLower: null, sizeUpper: null },
        ],
        truncated: true,
      },
    ],
    [
      'an unsendable id dropped, a repeat offered once, a blank name read as the id',
      { account_id: 't2_acct', audiences: [{ id: 'bad id', name: 'x' }, visitors, visitors, { id: 'c3', name: ' ', size_lower: -1 }] },
      undefined,
      {
        accountId: 't2_acct',
        audiences: [
          { id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', sizeLower: 1000, sizeUpper: 5000 },
          { id: 'c3', name: 'c3', type: '', status: '', sizeLower: null, sizeUpper: null },
        ],
        truncated: false,
      },
    ],
    [
      'a search keeps names containing it, ignoring case',
      { account_id: 't2_acct', audiences: [visitors, { id: 'b_2', name: 'Registrants', type: 'CUSTOMER_LIST', status: 'VALID' }] },
      'kubecon',
      {
        accountId: 't2_acct',
        audiences: [{ id: '67547345732543', name: 'KubeCon site visitors', type: 'PIXEL_RETARGETING', status: 'VALID', sizeLower: 1000, sizeUpper: 5000 }],
        truncated: false,
      },
    ],
  ])('%s', (_name, payload, q, expected) => {
    expect(redditCustomAudiencesFromPayload(payload, q)).toEqual(expected);
  });
});

const picks = (customAudienceIds: string[], excludedCustomAudienceIds: string[] = []): RedditCustomAudiencesDraft => ({
  customAudienceIds,
  excludedCustomAudienceIds,
});

describe('redditCustomAudiencesCapability', () => {
  it.each<[boolean | null, boolean]>([
    [true, true],
    [false, false],
    [null, false],
  ])('%j reads as %j', (enabled, expected) => {
    expect(redditCustomAudiencesCapability(enabled)).toBe(expected);
  });
});

describe('redditCustomAudiencesField', () => {
  it.each<[string, RedditCustomAudiencesDraft, boolean | null, Record<string, string[]>]>([
    ['both lists, enabled', picks(['a1'], ['b1']), true, { customAudienceIds: ['a1'], excludedCustomAudienceIds: ['b1'] }],
    ['an empty list is left out', picks([], ['b1']), true, { excludedCustomAudienceIds: ['b1'] }],
    ['nothing picked', picks([]), true, {}],
    ['not confirmed (held by the block instead)', picks(['a1']), null, {}],
    ['answered no', picks(['a1']), false, {}],
  ])('%s', (_name, audiences, enabled, expected) => {
    expect(redditCustomAudiencesField(audiences, enabled)).toEqual(expected);
  });
});

describe('redditCustomAudiencesDraftRefusal', () => {
  it.each<[string, RedditCustomAudiencesDraft, string | null]>([
    ['valid lists', picks(['a1'], ['b1']), null],
    ['nothing picked', picks([]), null],
    ['an id in both lists', picks(['a1'], ['a1']), 'Entry 1 is also a targeted custom audience. An audience cannot be both targeted and excluded.'],
    ['a malformed restored id', picks(['a1', 'bad id']), BAD_ID],
    ['too many ids', picks(ids(101)), 'Pick at most 100 custom audiences.'],
  ])('%s', (_name, audiences, expected) => {
    expect(redditCustomAudiencesDraftRefusal(audiences)).toBe(expected);
  });
});

describe('redditCustomAudienceAddRefusal', () => {
  it.each<[string, RedditCustomAudiencesDraft, 'customAudienceIds' | 'excludedCustomAudienceIds', string, string | null]>([
    ['a new id', picks([]), 'customAudienceIds', 'a1', null],
    ['an id already in the same list', picks(['a1']), 'customAudienceIds', 'a1', null],
    ['an id with a space', picks([]), 'customAudienceIds', 'a 1', 'Enter a Reddit custom audience id: 1 to 64 letters, digits or underscores.'],
    [
      'an id in the other list',
      picks(['a1']),
      'excludedCustomAudienceIds',
      'a1',
      'Audience a1 is already in the other list. An audience cannot be both targeted and excluded.',
    ],
    ['a full list', picks(ids(100)), 'customAudienceIds', 'new_one', 'At most 100 audiences per list.'],
  ])('%s', (_name, audiences, key, id, expected) => {
    expect(redditCustomAudienceAddRefusal(audiences, key, id)).toBe(expected);
  });
});

describe('redditCustomAudiencesBlock', () => {
  it.each<[string, RedditCustomAudiencesDraft, boolean | null, CampaignCapabilityReadState, string | null, CampaignRedditCustomAudiencesBlock['kind'] | null]>([
    ['nothing picked, unanswered', picks([]), null, 'pending', 'b1', null],
    ['picks, confirmed', picks(['a1']), true, 'ready', 'b1', null],
    ['picks, answered no', picks(['a1']), false, 'ready', 'b1', 'restricted'],
    ['exclusions only, answered no', picks([], ['b1']), false, 'ready', 'b1', 'restricted'],
    ['picks, read in flight', picks(['a1']), null, 'pending', 'b1', 'pending'],
    ['picks, unanswered, brief unsaved', picks(['a1']), null, 'unknown', null, 'unsaved'],
    ['picks, unanswered, brief saved', picks(['a1']), null, 'failed', 'b1', 'failed'],
  ])('%s', (_name, audiences, enabled, createCapabilityRead, briefId, expected) => {
    expect(redditCustomAudiencesBlock({ audiences, enabled, createCapabilityRead, briefId })?.kind ?? null).toBe(expected);
  });
});

describe('redditCustomAudienceIdsFromDraft', () => {
  it.each<[unknown, string[] | undefined]>([
    [
      ['a1', 2, 'b1'],
      ['a1', 'b1'],
    ],
    [[], []],
    ['a1', undefined],
    [undefined, undefined],
  ])('%j restores as %j', (stored, expected) => {
    expect(redditCustomAudienceIdsFromDraft(stored)).toEqual(expected);
  });
});
