// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { REDDIT_LANGUAGES, REDDIT_MAX_SCHEDULE_WINDOWS } from '../constants/campaign.constants';
import { redditDemographicsRefusal } from './campaign-reddit-demographics.utils';

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
