// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_META_OBJECTIVE,
  META_AD_SCHEDULE_MAX_DAY,
  META_AD_SCHEDULE_MINUTES_PER_DAY,
  META_AD_SCHEDULE_OFF_MESSAGE,
  META_AD_SCHEDULE_STEP_MINUTES,
  META_FREQUENCY_CAP_MAX,
  META_FREQUENCY_CAP_MIN,
  META_FREQUENCY_CAP_OFF_MESSAGE,
} from '../constants/campaign.constants';
import type { MetaAdSchedule, MetaConfigRefusal, MetaDeliveryFlags, MetaDeliveryOptions } from '../interfaces/campaign.interface';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * Meta delivery options (#5904 row 5): `metaConfig.adSchedule` and `metaConfig.frequencyCap`. One set of rules for the
 * create route (which answers a refusal with a 400) and, later, the Implement tab, mirroring campaign-service's
 * `NormalizeAdSchedule` and `NormalizeFrequencyCap` (linuxfoundation/lfx-v2-campaign-service#612).
 */

const KEYS = ['adSchedule', 'frequencyCap'] as const;
const OFF_MESSAGES: Record<(typeof KEYS)[number], string> = {
  adSchedule: META_AD_SCHEDULE_OFF_MESSAGE,
  frequencyCap: META_FREQUENCY_CAP_OFF_MESSAGE,
};

/** Whether a field is present as campaign-service reads it: anything but absent or null. */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** A whole number, as campaign-service decodes these fields into Go ints. */
function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * The delivery field `raw` sends under another spelling of its key, or `null`. campaign-service decodes keys ignoring
 * case, so `AdSchedule` would reach it past every check here; the create route refuses it whatever the flag.
 */
export function metaDeliveryKeyVariant(raw: unknown): (typeof KEYS)[number] | null {
  const record = metaConfigRecord(raw);
  if (!record) return null;
  for (const key of Object.keys(record)) {
    const match = KEYS.find((known) => key !== known && key.toLowerCase() === known.toLowerCase());
    if (match) return match;
  }
  return null;
}

/** Why `raw` sets a delivery option this deployment does not accept, or `null`. Never a silent drop. */
export function metaDeliveryFlagRefusal(raw: unknown, flags: MetaDeliveryFlags): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  for (const key of KEYS) {
    if (isPresent(record?.[key]) && !flags[key]) return { field: `metaConfig.${key}`, message: OFF_MESSAGES[key] };
  }
  return null;
}

/**
 * Why `raw`'s ad schedule cannot be sent, or `null`: campaign-service's rules, in its order. It needs a lifetime
 * budget (Meta schedules only lifetime-budget ad sets), at least one day, each 0 (Sunday) to 6 (Saturday), and whole
 * hours with 0 <= start < end <= 1440. Absent or null is no schedule.
 */
export function metaAdScheduleRefusal(raw: unknown): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const value = record?.['adSchedule'];
  if (!isPresent(value)) return null;
  const field = 'metaConfig.adSchedule';
  const schedule = metaConfigRecord(value);
  if (!schedule) return { field, message: 'The ad schedule must be an object with days, startMinute and endMinute.' };
  if (record?.['lifetimeBudget'] !== true) {
    return { field, message: 'An ad schedule needs a lifetime budget: Meta schedules only lifetime-budget ad sets.' };
  }
  const days = schedule['days'];
  if (!Array.isArray(days) || days.length === 0) return { field, message: 'Choose at least one day for the ad schedule.' };
  if (days.some((day) => !isWholeNumber(day) || day < 0 || day > META_AD_SCHEDULE_MAX_DAY)) {
    return { field, message: 'Ad schedule days run from 0 (Sunday) to 6 (Saturday).' };
  }
  const start = schedule['startMinute'];
  const end = schedule['endMinute'];
  if (!isWholeNumber(start) || !isWholeNumber(end) || start < 0 || end > META_AD_SCHEDULE_MINUTES_PER_DAY || start >= end) {
    return { field, message: 'The ad schedule must start before it ends, within the day.' };
  }
  if (start % META_AD_SCHEDULE_STEP_MINUTES !== 0 || end % META_AD_SCHEDULE_STEP_MINUTES !== 0) {
    return { field, message: 'The ad schedule must start and end on the hour.' };
  }
  return null;
}

/**
 * Why `raw`'s frequency cap cannot be sent, or `null`: only on the awareness objective (matched ignoring case; absent
 * is the default objective), whose ad set optimizes for reach, and each field a whole number from 1 to 90. Absent or
 * null is no cap.
 */
export function metaFrequencyCapRefusal(raw: unknown): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const value = record?.['frequencyCap'];
  if (!isPresent(value)) return null;
  const field = 'metaConfig.frequencyCap';
  const cap = metaConfigRecord(value);
  if (!cap) return { field, message: 'The frequency cap must be an object with maxImpressions and intervalDays.' };
  const objective = record?.['objective'];
  const resolved = typeof objective === 'string' && objective.trim() !== '' ? objective.trim().toLowerCase() : DEFAULT_META_OBJECTIVE;
  if (resolved !== 'awareness') return { field, message: 'A frequency cap applies only to the awareness objective.' };
  for (const key of ['maxImpressions', 'intervalDays'] as const) {
    const n = cap[key];
    if (!isWholeNumber(n) || n < META_FREQUENCY_CAP_MIN || n > META_FREQUENCY_CAP_MAX) {
      return {
        field,
        message: `The frequency cap's impressions and days must each be a whole number from ${META_FREQUENCY_CAP_MIN} to ${META_FREQUENCY_CAP_MAX}.`,
      };
    }
  }
  return null;
}

/**
 * The delivery options a create sends for an ACCEPTED block (every refusal above is `null`): the schedule with its
 * days de-duplicated and sorted, as campaign-service sends them, and the cap as given. Only the known fields.
 */
export function compactMetaDeliveryOptions(raw: unknown): MetaDeliveryOptions {
  const record = metaConfigRecord(raw);
  const out: MetaDeliveryOptions = {};
  const schedule = metaConfigRecord(record?.['adSchedule']);
  if (schedule) {
    const days = [...new Set(schedule['days'] as number[])].sort((a, b) => a - b);
    out.adSchedule = { days, startMinute: schedule['startMinute'] as number, endMinute: schedule['endMinute'] as number } satisfies MetaAdSchedule;
  }
  const cap = metaConfigRecord(record?.['frequencyCap']);
  if (cap) out.frequencyCap = { maxImpressions: cap['maxImpressions'] as number, intervalDays: cap['intervalDays'] as number };
  return out;
}
