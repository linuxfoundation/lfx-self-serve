// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_AD_SCHEDULE_OFF_MESSAGE, META_FREQUENCY_CAP_OFF_MESSAGE } from '../constants/campaign.constants';
import {
  compactMetaDeliveryOptions,
  copyMetaDeliveryDraft,
  emptyMetaDeliveryDraft,
  metaAdScheduleHourOptions,
  metaAdScheduleWithDay,
  metaDeliveryApplicable,
  metaDeliveryBlock,
  metaDeliveryClearLabel,
  metaDeliveryForCreate,
  metaDeliveryFromDraft,
  metaDeliverySendable,
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

describe('the Implement tab delivery rules', () => {
  const CAP = { maxImpressions: 2, intervalDays: 7 };
  const both = { adSchedule: WEEKDAYS, frequencyCap: CAP };

  it('starts empty, with a fresh object each time, and copies deeply', () => {
    expect(emptyMetaDeliveryDraft()).toEqual({ adSchedule: null, frequencyCap: null });
    expect(emptyMetaDeliveryDraft()).not.toBe(emptyMetaDeliveryDraft());
    const copy = copyMetaDeliveryDraft(both);
    expect(copy).toEqual(both);
    expect(copy.adSchedule?.days).not.toBe(WEEKDAYS.days);
  });

  it('offers start hours 00:00–23:00 and end hours 01:00–24:00', () => {
    const start = metaAdScheduleHourOptions('start');
    const end = metaAdScheduleHourOptions('end');
    expect([start[0], start.at(-1)]).toEqual([
      { value: 0, label: '00:00' },
      { value: 1380, label: '23:00' },
    ]);
    expect([end[0], end.at(-1)]).toEqual([
      { value: 60, label: '01:00' },
      { value: 1440, label: '24:00' },
    ]);
  });

  it.each([
    [6, true, [1, 2, 3, 4, 5, 6]],
    [0, true, [0, 1, 2, 3, 4, 5]],
    [3, false, [1, 2, 4, 5]],
    [3, true, [1, 2, 3, 4, 5]],
  ])('turns day %i %s', (day, on, days) => {
    expect(metaAdScheduleWithDay(WEEKDAYS, day, on).days).toEqual(days);
  });

  it.each([
    [true, 'awareness', both],
    [false, 'awareness', { adSchedule: null, frequencyCap: CAP }],
    [true, 'traffic', { adSchedule: WEEKDAYS, frequencyCap: null }],
    [false, 'leads', { adSchedule: null, frequencyCap: null }],
  ] as const)('keeps what a lifetime budget %s and %s can carry', (lifetime, objective, expected) => {
    expect(metaDeliveryApplicable(both, lifetime, objective)).toEqual(expected);
  });

  it.each([
    ['a draft from before row 5', undefined, undefined, undefined],
    ['a well-formed pair', WEEKDAYS, CAP, both],
    ['unset values', null, null, { adSchedule: null, frequencyCap: null }],
    [
      // Refused but well typed: kept as saved, so the restored edit still shows its error and holds Create.
      'a half-hour schedule and a zero cap',
      { ...WEEKDAYS, startMinute: 570 },
      { maxImpressions: 0, intervalDays: 7 },
      { adSchedule: { ...WEEKDAYS, startMinute: 570 }, frequencyCap: { maxImpressions: 0, intervalDays: 7 } },
    ],
    [
      'no days and an end before the start',
      { days: [], startMinute: 600, endMinute: 540 },
      undefined,
      { adSchedule: { days: [], startMinute: 600, endMinute: 540 }, frequencyCap: null },
    ],
    [
      'the wrong shape',
      { days: 'weekdays', startMinute: 540, endMinute: 1020 },
      { maxImpressions: '2', intervalDays: 7 },
      { adSchedule: null, frequencyCap: null },
    ],
    ['repeated days', { ...WEEKDAYS, days: [3, 1, 3] }, undefined, { adSchedule: { ...WEEKDAYS, days: [1, 3] }, frequencyCap: null }],
  ])('restores %s', (_case, schedule, cap, expected) => {
    expect(metaDeliveryFromDraft(schedule, cap)).toEqual(expected);
  });

  it.each([
    [true, true, both],
    [true, null, { adSchedule: WEEKDAYS }],
    [false, true, { frequencyCap: CAP }],
  ])('sends each option only on its yes (schedule %s, cap %s)', (schedule, cap, expected) => {
    expect(metaDeliveryForCreate(both, schedule, cap)).toEqual(expected);
  });

  it.each([
    [false, true, 'Clear the ad schedule'],
    [true, false, 'Clear the frequency cap'],
    [false, false, 'Clear the ad schedule and frequency cap'],
  ])('names what Clear clears (schedule %s, cap %s)', (schedule, cap, label) => {
    expect(metaDeliveryClearLabel(both, schedule, cap)).toBe(label);
  });

  it('clears only the options answered no', () => {
    expect(metaDeliverySendable(both, false, null)).toEqual({ adSchedule: null, frequencyCap: CAP });
  });

  const block = (over: Partial<Parameters<typeof metaDeliveryBlock>[0]>) =>
    metaDeliveryBlock({ draft: both, adScheduleEnabled: true, frequencyCapEnabled: true, createCapabilityRead: 'ready', briefId: 'b-1', ...over })?.kind ??
    null;

  it.each([
    ['both are sendable', {}, null],
    ['an unset option is off', { draft: { adSchedule: WEEKDAYS, frequencyCap: null }, frequencyCapEnabled: false }, null],
    ['a set option answered no', { adScheduleEnabled: false }, 'unsupported'],
    ['a no wins over an unanswered option', { adScheduleEnabled: null, frequencyCapEnabled: false, createCapabilityRead: 'pending' }, 'unsupported'],
    ['the answer is still out', { adScheduleEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    ['the brief is unsaved', { frequencyCapEnabled: null, briefId: null }, 'unsaved'],
    ['the answer failed', { frequencyCapEnabled: null, createCapabilityRead: 'failed' }, 'failed'],
  ] as const)('holds Create when %s', (_case, over, kind) => {
    expect(block(over)).toBe(kind);
  });
});
