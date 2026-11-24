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
import type {
  CampaignMetaAudienceTargetingBlock,
  MetaAdSchedule,
  MetaAdScheduleHourOption,
  MetaConfigRefusal,
  MetaDeliveryBlockInput,
  MetaDeliveryDraft,
  MetaDeliveryFlags,
  MetaDeliveryOptions,
  MetaFrequencyCap,
  MetaObjective,
} from '../interfaces/campaign.interface';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * Meta delivery options (#5904 row 5): `metaConfig.adSchedule` and `metaConfig.frequencyCap`. One set of rules for the
 * create route (which answers a refusal with a 400) and the Implement tab, mirroring campaign-service's
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
 * A key as Go's `encoding/json` matches it: Unicode case folding, under which `ſ` (U+017F) is `s` and the Kelvin sign
 * is `k`. Upper-casing first catches both, where lower-casing alone does not.
 */
function foldKey(key: string): string {
  return key.toUpperCase().toLowerCase();
}

/**
 * The delivery field `raw` sends under another spelling of its key, or `null`. campaign-service decodes keys ignoring
 * case (Unicode folding), so `AdSchedule` would reach it past every check here; the create route refuses it whatever
 * the flag.
 */
export function metaDeliveryKeyVariant(raw: unknown): (typeof KEYS)[number] | null {
  const record = metaConfigRecord(raw);
  if (!record) return null;
  for (const key of Object.keys(record)) {
    const match = KEYS.find((known) => key !== known && foldKey(key) === foldKey(known));
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
    return { field, message: 'The ad schedule needs a start and an end, the start before the end, within the day.' };
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

/** No schedule and no cap: a fresh object each time. */
export function emptyMetaDeliveryDraft(): MetaDeliveryDraft {
  return { adSchedule: null, frequencyCap: null };
}

/** A copy of `draft`, so the parent's draft never holds a live view of the tab's signal. */
export function copyMetaDeliveryDraft(draft: MetaDeliveryDraft): MetaDeliveryDraft {
  return {
    adSchedule: draft.adSchedule === null ? null : { ...draft.adSchedule, days: [...draft.adSchedule.days] },
    frequencyCap: draft.frequencyCap === null ? null : { ...draft.frequencyCap },
  };
}

/** The hours the schedule's start (00:00–23:00) or end (01:00–24:00) select offers, as minutes of the day. */
export function metaAdScheduleHourOptions(kind: 'start' | 'end'): MetaAdScheduleHourOption[] {
  const first = kind === 'start' ? 0 : 1;
  return Array.from({ length: 24 }, (_, i) => {
    const hour = i + first;
    return { value: hour * META_AD_SCHEDULE_STEP_MINUTES, label: `${String(hour).padStart(2, '0')}:00` };
  });
}

/** `schedule` with `day` turned on or off, days kept sorted. */
export function metaAdScheduleWithDay(schedule: MetaAdSchedule, day: number, on: boolean): MetaAdSchedule {
  const days = new Set(schedule.days);
  if (on) days.add(day);
  else days.delete(day);
  return { ...schedule, days: [...days].sort((a, b) => a - b) };
}

/**
 * `draft` without what the current budget mode and objective cannot carry: the schedule off a daily budget, the cap
 * off any objective but awareness. Cleared rather than kept hidden, as an objective change clears ad options.
 */
export function metaDeliveryApplicable(draft: MetaDeliveryDraft, lifetimeBudget: boolean, objective: MetaObjective): MetaDeliveryDraft {
  return {
    adSchedule: lifetimeBudget ? draft.adSchedule : null,
    frequencyCap: objective === 'awareness' ? draft.frequencyCap : null,
  };
}

/** A finite number: the only shape a schedule or cap field can be restored as. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A schedule a saved draft carries, when it has the schedule's SHAPE (a list of numbers and two numbers), or `null`.
 * Its values are kept even when the rules refuse them (no day, an end before the start): an edit saved half-done must
 * come back with its error and keep holding Create, never come back as "no schedule" and let the ads run all day.
 */
function scheduleFromDraft(raw: unknown): MetaAdSchedule | null {
  const record = metaConfigRecord(raw);
  const days = record?.['days'];
  const start = record?.['startMinute'];
  const end = record?.['endMinute'];
  if (!Array.isArray(days) || !days.every(isFiniteNumber) || !isFiniteNumber(start) || !isFiniteNumber(end)) return null;
  return { days: [...new Set(days)].sort((a, b) => a - b), startMinute: start, endMinute: end };
}

/** A cap a saved draft carries, when it has the cap's shape (two numbers), or `null`; refused values are kept, as above. */
function capFromDraft(raw: unknown): MetaFrequencyCap | null {
  const record = metaConfigRecord(raw);
  const maxImpressions = record?.['maxImpressions'];
  const intervalDays = record?.['intervalDays'];
  return isFiniteNumber(maxImpressions) && isFiniteNumber(intervalDays) ? { maxImpressions, intervalDays } : null;
}

/**
 * The delivery options a saved draft restores, or `undefined` for a draft saved before row 5 (neither key present).
 * The draft is persisted JSON: a value without the right shape restores as `null` (none); one with the shape but
 * values the rules refuse restores as saved, so its error still holds Create.
 */
export function metaDeliveryFromDraft(adSchedule: unknown, frequencyCap: unknown): MetaDeliveryDraft | undefined {
  if (adSchedule === undefined && frequencyCap === undefined) return undefined;
  return { adSchedule: scheduleFromDraft(adSchedule), frequencyCap: capFromDraft(frequencyCap) };
}

/** The delivery options a Meta create sends: each only on its explicit yes. A set field without one holds Create instead. */
export function metaDeliveryForCreate(draft: MetaDeliveryDraft, adScheduleEnabled: boolean | null, frequencyCapEnabled: boolean | null): MetaDeliveryOptions {
  return {
    ...(draft.adSchedule !== null && adScheduleEnabled === true ? { adSchedule: draft.adSchedule } : {}),
    ...(draft.frequencyCap !== null && frequencyCapEnabled === true ? { frequencyCap: draft.frequencyCap } : {}),
  };
}

/** `draft` with each option this deployment answered no to cleared: the Clear past an `unsupported` block, whose control is hidden. */
export function metaDeliverySendable(draft: MetaDeliveryDraft, adScheduleEnabled: boolean | null, frequencyCapEnabled: boolean | null): MetaDeliveryDraft {
  return {
    adSchedule: adScheduleEnabled === false ? null : draft.adSchedule,
    frequencyCap: frequencyCapEnabled === false ? null : draft.frequencyCap,
  };
}

/**
 * Why Create is held for a delivery option the draft holds but the request cannot carry, or `null`: the audience
 * block's states. Held rather than dropped, since a dropped schedule runs the ads around the clock. `unsupported` (a
 * flag answered no) offers Clear; while an answer is out or failed, only waiting or Retry.
 */
export function metaDeliveryBlock(input: MetaDeliveryBlockInput): CampaignMetaAudienceTargetingBlock | null {
  const held = [input.draft.adSchedule !== null ? input.adScheduleEnabled : true, input.draft.frequencyCap !== null ? input.frequencyCapEnabled : true].filter(
    (answer) => answer !== true
  );
  if (held.length === 0) return null;
  if (held.includes(false)) {
    return {
      kind: 'unsupported',
      message:
        'The Meta ad schedule or frequency cap on this brief is not available on this deployment, so it cannot be sent. Clear it to create the campaign.',
    };
  }
  if (input.createCapabilityRead === 'pending') {
    return {
      kind: 'pending',
      message: 'Checking whether you can send the Meta ad schedule or frequency cap. Create waits for the answer so they are not dropped.',
    };
  }
  if (!input.briefId) return { kind: 'unsaved', message: "The Meta ad schedule or frequency cap can't be checked until this brief is saved. Save the brief." };
  return {
    kind: 'failed',
    message: 'Could not confirm that you can send the Meta ad schedule or frequency cap, so Create waits rather than dropping them. Retry the check.',
  };
}

/** What the Clear past an `unsupported` {@link metaDeliveryBlock} clears, as its button says it: only the options answered no. */
export function metaDeliveryClearLabel(draft: MetaDeliveryDraft, adScheduleEnabled: boolean | null, frequencyCapEnabled: boolean | null): string {
  const schedule = draft.adSchedule !== null && adScheduleEnabled === false;
  const cap = draft.frequencyCap !== null && frequencyCapEnabled === false;
  if (schedule && cap) return 'Clear the ad schedule and frequency cap';
  return schedule ? 'Clear the ad schedule' : 'Clear the frequency cap';
}
