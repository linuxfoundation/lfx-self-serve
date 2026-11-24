// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_AD_SCHEDULE_OFF_MESSAGE, META_FREQUENCY_CAP_OFF_MESSAGE } from '../constants/campaign.constants';
import {
  compactMetaDeliveryOptions,
  metaAdScheduleRefusal,
  metaDeliveryFlagRefusal,
  metaDeliveryKeyVariant,
  metaFrequencyCapRefusal,
} from './campaign-meta-delivery.utils';

const WEEKDAYS = { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020 };

describe('metaDeliveryKeyVariant', () => {
  it.each([
    [{ adSchedule: WEEKDAYS }, null],
    [{ AdSchedule: WEEKDAYS }, 'adSchedule'],
    [{ frequencycap: {} }, 'frequencyCap'],
    // Go folds U+017F (long s) to s, which lower-casing alone misses.
    [{ ['ad\u017Fchedule']: WEEKDAYS }, 'adSchedule'],
    [{ budgetUsd: 1 }, null],
    [null, null],
  ])('finds another spelling in %j', (raw, expected) => {
    expect(metaDeliveryKeyVariant(raw)).toBe(expected);
  });
});

describe('metaDeliveryFlagRefusal', () => {
  const on = { adSchedule: true, frequencyCap: true };
  it.each([
    [{ adSchedule: WEEKDAYS }, on, null],
    [{ adSchedule: WEEKDAYS }, { ...on, adSchedule: false }, META_AD_SCHEDULE_OFF_MESSAGE],
    [{ frequencyCap: { maxImpressions: 2, intervalDays: 7 } }, { ...on, frequencyCap: false }, META_FREQUENCY_CAP_OFF_MESSAGE],
    [{ adSchedule: null, frequencyCap: null }, { adSchedule: false, frequencyCap: false }, null],
    [{}, { adSchedule: false, frequencyCap: false }, null],
  ])('answers %j with flags %j', (raw, flags, message) => {
    expect(metaDeliveryFlagRefusal(raw, flags)?.message ?? null).toBe(message);
  });
});

describe('metaAdScheduleRefusal', () => {
  const lifetime = (adSchedule: unknown) => ({ lifetimeBudget: true, adSchedule });
  it.each([
    ['weekdays 9 to 17 on a lifetime budget', lifetime(WEEKDAYS), null],
    ['the whole day', lifetime({ days: [0], startMinute: 0, endMinute: 1440 }), null],
    ['no schedule', { lifetimeBudget: false }, null],
    ['a daily budget', { lifetimeBudget: false, adSchedule: WEEKDAYS }, 'lifetime budget'],
    ['not an object', lifetime('weekdays'), 'must be an object'],
    ['no days', lifetime({ ...WEEKDAYS, days: [] }), 'at least one day'],
    ['a day past Saturday', lifetime({ ...WEEKDAYS, days: [7] }), '0 (Sunday) to 6 (Saturday)'],
    ['a fractional day', lifetime({ ...WEEKDAYS, days: [1.5] }), '0 (Sunday) to 6 (Saturday)'],
    ['an end before the start', lifetime({ ...WEEKDAYS, startMinute: 600, endMinute: 540 }), 'the start before the end'],
    ['an end past midnight', lifetime({ ...WEEKDAYS, endMinute: 1500 }), 'the start before the end'],
    ['a text minute', lifetime({ ...WEEKDAYS, startMinute: '540' }), 'the start before the end'],
    ['no end', lifetime({ days: [1], startMinute: 540 }), 'a start and an end'],
    ['a half hour', lifetime({ ...WEEKDAYS, startMinute: 570 }), 'on the hour'],
  ])('answers %s', (_case, raw, message) => {
    const refusal = metaAdScheduleRefusal(raw);
    if (message === null) expect(refusal).toBeNull();
    else expect(refusal).toMatchObject({ field: 'metaConfig.adSchedule', message: expect.stringContaining(message) });
  });
});

describe('metaFrequencyCapRefusal', () => {
  const awareness = (frequencyCap: unknown) => ({ objective: 'awareness', frequencyCap });
  it.each([
    ['2 every 7 days on awareness', awareness({ maxImpressions: 2, intervalDays: 7 }), null],
    ['the bounds', awareness({ maxImpressions: 1, intervalDays: 90 }), null],
    ['awareness in another case', { objective: ' Awareness ', frequencyCap: { maxImpressions: 2, intervalDays: 7 } }, null],
    ['no cap', { objective: 'traffic' }, null],
    ['traffic', { objective: 'traffic', frequencyCap: { maxImpressions: 2, intervalDays: 7 } }, 'only to the awareness objective'],
    ['no objective (traffic)', { frequencyCap: { maxImpressions: 2, intervalDays: 7 } }, 'only to the awareness objective'],
    ['not an object', awareness(3), 'must be an object'],
    ['zero impressions', awareness({ maxImpressions: 0, intervalDays: 7 }), 'from 1 to 90'],
    ['91 days', awareness({ maxImpressions: 2, intervalDays: 91 }), 'from 1 to 90'],
    ['a missing field', awareness({ maxImpressions: 2 }), 'from 1 to 90'],
    ['a fraction', awareness({ maxImpressions: 2.5, intervalDays: 7 }), 'from 1 to 90'],
  ])('answers %s', (_case, raw, message) => {
    const refusal = metaFrequencyCapRefusal(raw);
    if (message === null) expect(refusal).toBeNull();
    else expect(refusal).toMatchObject({ field: 'metaConfig.frequencyCap', message: expect.stringContaining(message) });
  });
});

describe('compactMetaDeliveryOptions', () => {
  it('sends the schedule with its days de-duplicated and sorted, and the cap, and nothing else', () => {
    const raw = {
      adSchedule: { days: [5, 1, 5, 3], startMinute: 540, endMinute: 1020, extra: 1 },
      frequencyCap: { maxImpressions: 2, intervalDays: 7, extra: 1 },
    };
    expect(compactMetaDeliveryOptions(raw)).toEqual({
      adSchedule: { days: [1, 3, 5], startMinute: 540, endMinute: 1020 },
      frequencyCap: { maxImpressions: 2, intervalDays: 7 },
    });
  });

  it('sends nothing when neither is set', () => {
    expect(compactMetaDeliveryOptions({ budgetUsd: 1 })).toEqual({});
  });
});
