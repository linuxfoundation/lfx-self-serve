// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { RedditDemographicsDraft } from '../interfaces/campaign.interface';

import { REDDIT_LANGUAGES, REDDIT_MAX_SCHEDULE_WINDOWS } from '../constants/campaign.constants';
import {
  redditDemographicsCapability,
  redditDemographicsDraftRefusal,
  redditDemographicsField,
  redditDemographicsFromDraft,
  redditDemographicsHeld,
  redditDemographicsRefusal,
  redditGenderChoice,
  redditLanguagesChoice,
  redditScheduleWindowAdded,
  redditScheduleWindowRemoved,
  redditScheduleWindowWith,
} from './campaign-reddit-demographics.utils';

const GENDER = 'redditConfig.gender';
const LANGUAGES = 'redditConfig.languages';
const SCHEDULE = 'redditConfig.schedule';

const monday = { startDay: 1, startHour: 9, endDay: 1, endHour: 17 };
const windows = (n: number) => Array.from({ length: n }, (_, i) => ({ startDay: i % 7, startHour: Math.floor(i / 7), endDay: i % 7, endHour: 23 }));

describe('redditDemographicsRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['not an object', null, true],
    ['nothing set, without the flag', { budgetUsd: 50 }, false],
    // campaign-service reads null and an empty list as absent, so they need no flag.
    ['null and empty lists, without the flag', { gender: null, languages: [], schedule: null }, false],
    ['each gender', { gender: 'FEMALE', languages: ['EN'] }, true],
    ['a lower-case, padded gender, as campaign-service reads it', { gender: ' male ' }, true],
    ['every language', { languages: [...REDDIT_LANGUAGES] }, true],
    // campaign-service drops duplicates rather than refusing them.
    ['lower-case, padded and repeated languages', { languages: [' en', 'EN', 'de'] }, true],
    ['the most windows', { schedule: windows(REDDIT_MAX_SCHEDULE_WINDOWS) }, true],
    // campaign-service sends windows as given; overlaps and week wraps are Reddit's call.
    ['overlapping windows', { schedule: [monday, { startDay: 1, startHour: 10, endDay: 1, endHour: 12 }] }, true],
    ['a window that wraps the week', { schedule: [{ startDay: 6, startHour: 22, endDay: 0, endHour: 2 }] }, true],
    ['a window with other keys', { schedule: [{ ...monday, note: 'x' }] }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditDemographicsRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, boolean, string, string]>([
    // Shape, whatever the flag.
    ['a case variant of a key', { Gender: 'MALE' }, false, GENDER, 'spelled exactly'],
    ['a gender that is not a string', { gender: 1 }, false, GENDER, '"FEMALE" or "MALE"'],
    ['languages that are not an array', { languages: 'EN' }, false, LANGUAGES, 'list of text'],
    ['languages with a non-text entry', { languages: ['EN', 2] }, false, LANGUAGES, 'list of text'],
    // campaign-service decodes a null entry as "" and refuses it as blank; refused here at the shape check instead.
    ['languages with a null entry', { languages: ['EN', null] }, true, LANGUAGES, 'list of text'],
    ['a schedule that is not an array', { schedule: monday }, false, SCHEDULE, 'whole-number values'],
    ['a schedule entry that is not an object', { schedule: [[1, 9, 1, 17]] }, false, SCHEDULE, 'whole-number values'],
    ['a schedule field that is text', { schedule: [{ ...monday, startDay: '1' }] }, false, SCHEDULE, 'whole-number values'],
    ['a schedule field that is fractional', { schedule: [{ ...monday, endHour: 16.5 }] }, false, SCHEDULE, 'whole-number values'],
    ['shapes in key order: gender first', { gender: 1, languages: 'EN' }, false, GENDER, '"FEMALE" or "MALE"'],
    // The flag, naming every field set.
    ['a gender without the flag', { gender: 'MALE' }, false, GENDER, 'Remove redditConfig.gender and'],
    // A blank gender counts as set.
    ['a blank gender without the flag', { gender: ' ' }, false, GENDER, 'not enabled'],
    ['languages without the flag', { languages: ['EN'] }, false, LANGUAGES, 'Remove redditConfig.languages and'],
    ['a schedule without the flag', { schedule: [monday] }, false, SCHEDULE, 'Remove redditConfig.schedule and'],
    [
      'all three without the flag',
      { gender: 'MALE', languages: ['EN'], schedule: [monday] },
      false,
      GENDER,
      'redditConfig.gender and redditConfig.languages and redditConfig.schedule',
    ],
    // The values, gender then languages then schedule.
    ['a blank gender', { gender: '  ' }, true, GENDER, 'blank'],
    ['an unknown gender', { gender: 'other' }, true, GENDER, '"FEMALE" or "MALE"'],
    ['a blank language', { languages: ['EN', ' '] }, true, LANGUAGES, 'Entry 2 is blank'],
    ['an unknown language', { languages: ['TR'] }, true, LANGUAGES, 'Entry 1 is not a Reddit language'],
    ['too many windows', { schedule: windows(REDDIT_MAX_SCHEDULE_WINDOWS + 1) }, true, SCHEDULE, `at most ${REDDIT_MAX_SCHEDULE_WINDOWS}`],
    ['a window missing a field', { schedule: [monday, { startDay: 1, startHour: 9, endDay: 1 }] }, true, SCHEDULE, 'Window 2 needs'],
    ['a window with a null field', { schedule: [{ ...monday, startHour: null }] }, true, SCHEDULE, 'Window 1 needs'],
    ['a null window', { schedule: [null] }, true, SCHEDULE, 'Window 1 needs'],
    ['a window field spelled in another case', { schedule: [{ ...monday, StartDay: 1 }] }, true, SCHEDULE, 'spelled exactly'],
    ['a day below 0', { schedule: [{ ...monday, startDay: -1 }] }, true, SCHEDULE, 'days are 0 (Sunday) to 6'],
    ['a day above 6', { schedule: [{ ...monday, endDay: 7 }] }, true, SCHEDULE, 'days are 0 (Sunday) to 6'],
    ['an hour below 0', { schedule: [{ ...monday, startHour: -1 }] }, true, SCHEDULE, 'hours are 0 to 23'],
    ['an hour above 23', { schedule: [{ ...monday, endHour: 24 }] }, true, SCHEDULE, 'hours are 0 to 23'],
    ['a window that starts where it ends', { schedule: [{ startDay: 2, startHour: 8, endDay: 2, endHour: 8 }] }, true, SCHEDULE, 'starts where it ends'],
    ['an exact repeat', { schedule: [monday, { ...monday }] }, true, SCHEDULE, 'Window 2 repeats'],
    ['a bad gender before a bad language', { gender: 'x', languages: ['x'] }, true, GENDER, '"FEMALE" or "MALE"'],
  ])('refuses %s', (_name, raw, enabled, field, message) => {
    const refusal = redditDemographicsRefusal(raw, enabled);
    expect(refusal?.field).toBe(field);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    const refusals = [{ gender: '<script>' }, { languages: ['<script>'] }].map((raw) => redditDemographicsRefusal(raw, true)?.message);
    expect(refusals.every((message) => message !== undefined && !message.includes('<script>'))).toBe(true);
  });
});

// The Implement tab's editor (#6108 row 9).
const NONE: RedditDemographicsDraft = { gender: '', languages: [], schedule: [] };
const SET: RedditDemographicsDraft = { gender: 'MALE', languages: ['EN', 'DE'], schedule: [monday] };

describe('redditDemographicsCapability', () => {
  it.each<[boolean | null, boolean]>([
    [true, true],
    [false, false],
    [null, false],
  ])('%s offers the editor: %s', (enabled, expected) => {
    expect(redditDemographicsCapability(enabled)).toBe(expected);
  });
});

describe('redditDemographicsHeld', () => {
  it.each<[string, RedditDemographicsDraft, boolean]>([
    ['nothing set', NONE, false],
    ['a gender', { ...NONE, gender: 'FEMALE' }, true],
    ['a language', { ...NONE, languages: ['FR'] }, true],
    ['a window', { ...NONE, schedule: [monday] }, true],
  ])('%s: %s', (_name, draft, expected) => {
    expect(redditDemographicsHeld(draft)).toBe(expected);
  });
});

describe('redditDemographicsField', () => {
  it.each<[string, RedditDemographicsDraft, boolean | null, object]>([
    ['every choice on a yes', SET, true, { gender: 'MALE', languages: ['EN', 'DE'], schedule: [monday] }],
    ['only the set choices', { ...NONE, languages: ['FR'] }, true, { languages: ['FR'] }],
    ['nothing at the defaults', NONE, true, {}],
    ['nothing while unanswered', SET, null, {}],
    ['nothing once off', SET, false, {}],
  ])('sends %s', (_name, draft, enabled, expected) => {
    expect(redditDemographicsField(draft, enabled)).toEqual(expected);
  });
});

describe('redditDemographicsDraftRefusal', () => {
  const same = { startDay: 2, startHour: 8, endDay: 2, endHour: 8 };
  it.each<[string, RedditDemographicsDraft, boolean | null, string | null]>([
    ['sendable choices', SET, true, null],
    ['nothing set', NONE, true, null],
    ['a window that starts where it ends', { ...NONE, schedule: [same] }, true, 'Window 1 starts where it ends'],
    ['a repeated window', { ...NONE, schedule: [monday, { ...monday }] }, true, 'Window 2 repeats'],
    ['too many windows', { ...NONE, schedule: windows(REDDIT_MAX_SCHEDULE_WINDOWS + 1) }, true, `at most ${REDDIT_MAX_SCHEDULE_WINDOWS}`],
    ['nothing while off, as nothing is sent', { ...NONE, schedule: [same] }, false, null],
  ])('%s', (_name, draft, enabled, expected) => {
    const refusal = redditDemographicsDraftRefusal(draft, enabled);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('redditGenderChoice and redditLanguagesChoice', () => {
  it.each<[string | null, string]>([
    ['FEMALE', 'FEMALE'],
    ['MALE', 'MALE'],
    ['', ''],
    [null, ''],
    ['female', ''],
  ])('reads gender %j as %j', (value, expected) => {
    expect(redditGenderChoice(value)).toBe(expected);
  });

  it.each<[string[], string[]]>([
    [
      ['EN', 'DE'],
      ['EN', 'DE'],
    ],
    [['EN', 'XX', 'EN'], ['EN']],
    [[], []],
  ])('reads languages %j as %j', (values, expected) => {
    expect(redditLanguagesChoice(values)).toEqual(expected);
  });
});

describe('redditScheduleWindowAdded', () => {
  it.each<[string, RedditDemographicsDraft['schedule'], RedditDemographicsDraft['schedule']]>([
    ['the default first', [], [monday]],
    ['the last window moved a day on', [monday], [monday, { ...monday, startDay: 2, endDay: 2 }]],
    [
      'Saturday wrapping to Sunday',
      [{ startDay: 6, startHour: 20, endDay: 0, endHour: 2 }],
      [
        { startDay: 6, startHour: 20, endDay: 0, endHour: 2 },
        { startDay: 0, startHour: 20, endDay: 1, endHour: 2 },
      ],
    ],
  ])('adds %s', (_name, schedule, expected) => {
    expect(redditScheduleWindowAdded(schedule)).toEqual(expected);
  });

  it('skips a window already held: the 8th from Monday moves an hour on rather than repeat window 1', () => {
    let schedule: RedditDemographicsDraft['schedule'] = [];
    for (let i = 0; i < 8; i++) schedule = redditScheduleWindowAdded(schedule);
    expect(schedule[7]).toEqual({ startDay: 1, startHour: 10, endDay: 1, endHour: 18 });
    expect(redditDemographicsDraftRefusal({ ...NONE, schedule }, true)).toBeNull();
  });

  it('adds nothing at the cap', () => {
    expect(redditScheduleWindowAdded(windows(REDDIT_MAX_SCHEDULE_WINDOWS))).toHaveLength(REDDIT_MAX_SCHEDULE_WINDOWS);
  });
});

describe('redditScheduleWindowWith and redditScheduleWindowRemoved', () => {
  const two = [monday, { ...monday, startDay: 2, endDay: 2 }];
  it.each<[string, string | null, RedditDemographicsDraft['schedule']]>([
    ['a picked hour', '20', [monday, { ...monday, startDay: 2, endDay: 2, endHour: 20 }]],
    ['nothing for a cleared select', null, two],
    ['nothing for a blank value', ' ', two],
    ['nothing for a non-integer', '1.5', two],
  ])('sets %s', (_name, value, expected) => {
    expect(redditScheduleWindowWith(two, 1, 'endHour', value)).toEqual(expected);
  });

  it('removes one window', () => {
    expect(redditScheduleWindowRemoved(two, 0)).toEqual([two[1]]);
  });
});

describe('redditDemographicsFromDraft', () => {
  it.each<[string, unknown, unknown]>([
    ['nothing stored', undefined, undefined],
    ['not an object', 'MALE', undefined],
    ['the choices as stored', SET, SET],
    [
      'only what the editor can show',
      { gender: 'other', languages: ['EN', 3, 'XX'], schedule: [monday, null, { ...monday, endHour: 24 }, { ...monday, startDay: 1.5 }] },
      { gender: '', languages: ['EN'], schedule: [monday] },
    ],
    ['lists that are not lists', { gender: 'FEMALE', languages: 'EN', schedule: {} }, { gender: 'FEMALE', languages: [], schedule: [] }],
  ])('reads %s', (_name, stored, expected) => {
    expect(redditDemographicsFromDraft(stored)).toEqual(expected);
  });
});
