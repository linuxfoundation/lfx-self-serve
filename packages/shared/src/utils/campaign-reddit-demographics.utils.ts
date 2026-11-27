// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  REDDIT_DEMOGRAPHIC_KEYS,
  REDDIT_GENDERS,
  REDDIT_LANGUAGES,
  REDDIT_MAX_SCHEDULE_WINDOWS,
  REDDIT_SCHEDULE_WINDOW_KEYS,
} from '../constants/campaign.constants';
import type { RedditConfigRefusal } from '../interfaces/campaign.interface';
import { googleAdsToUpperCode } from './campaign-google-assets.utils';
import { foldKey } from './campaign-linkedin-config.utils';
import { goTrimSpace } from './campaign-linkedin.utils';
import { normalizeRedditEnumList } from './campaign-reddit-delivery.utils';

/**
 * Reddit gender, language and dayparting targeting on create (#6108 row 9): `redditConfig.gender`, `languages` and
 * `schedule`. Held to campaign-service's `checkRedditDemographicShape`, `checkRedditDemographicTargeting` and
 * `NormalizeDemographicTargeting` (`internal/dispatch/reddit_demographic_targeting.go`,
 * `internal/platform/reddit/demographic_targeting.go`, #549), so a create campaign-service would refuse is refused here
 * first, with the field to point at. Messages never echo a caller value.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fieldOf(key: string): string {
  return `redditConfig.${key}`;
}

/** A different spelling of `key` in `record` (campaign-service decodes keys ignoring case, Unicode folds included). */
function hasCaseVariant(record: Record<string, unknown>, key: string): boolean {
  return Object.keys(record).some((other) => other !== key && foldKey(other) === foldKey(key));
}

/** Absent or `null`, which campaign-service reads as not sent. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/** A schedule window field as campaign-service's `*int` decodes it: absent and `null` are missing, else an integer. */
function isWindowFieldShaped(value: unknown): boolean {
  return isAbsent(value) || Number.isInteger(value);
}

/**
 * Whether `windows` decodes as campaign-service's `[]ScheduleWindow`: every entry an object (or `null`, which decodes
 * as a window with every field missing) whose four fields are integers when present. Other keys are ignored there too.
 */
function isScheduleShaped(windows: readonly unknown[]): boolean {
  return windows.every((entry) => {
    if (entry === null) return true;
    const window = plainRecord(entry);
    return window !== null && REDDIT_SCHEDULE_WINDOW_KEYS.every((key) => isWindowFieldShaped(window[key]));
  });
}

/** Why one decoded window cannot be sent, or `null`. `seen` holds the earlier windows, in campaign-service's order. */
function scheduleWindowRefusal(entry: unknown, position: number, seen: Set<string>): string | null {
  const window = plainRecord(entry) ?? {};
  const variant = REDDIT_SCHEDULE_WINDOW_KEYS.find((key) => hasCaseVariant(window, key));
  if (variant !== undefined) return `Window ${position}: send "${variant}", spelled exactly.`;
  const [startDay, startHour, endDay, endHour] = REDDIT_SCHEDULE_WINDOW_KEYS.map((key) => window[key]);
  if (![startDay, startHour, endDay, endHour].every((value) => Number.isInteger(value))) {
    return `Window ${position} needs startDay, startHour, endDay and endHour.`;
  }
  const [sd, sh, ed, eh] = [startDay, startHour, endDay, endHour] as number[];
  if (sd < 0 || sd > 6 || ed < 0 || ed > 6) return `Window ${position}: days are 0 (Sunday) to 6 (Saturday).`;
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23) return `Window ${position}: hours are 0 to 23.`;
  if (sd === ed && sh === eh) return `Window ${position} starts where it ends. Give it a different end.`;
  const key = `${sd}|${sh}|${ed}|${eh}`;
  if (seen.has(key)) return `Window ${position} repeats an earlier window.`;
  seen.add(key);
  return null;
}

/**
 * Why `raw`'s gender, languages or schedule cannot be sent, or `null` (#6108 row 9). Typed runtime checks, since the
 * create route forwards `redditConfig` as it comes. In campaign-service's order: shape, then the flag, then the values
 * (gender, languages, schedule). Refused:
 *
 * - a case variant of any of the three keys, whatever the flag, since it would reach campaign-service past the checks
 *   here;
 * - a `gender` that is not a string, a `languages` that is not an array of strings, or a `schedule` that is not an
 *   array of objects whose `startDay` / `startHour` / `endDay` / `endHour` are integers (`null` is absent);
 * - a present `gender` (a blank one included), a non-empty `languages` or a non-empty `schedule` while this deployment
 *   cannot send them (`enabled`): refused, never dropped, since the legacy creator ignores them and campaign-service
 *   refuses them while `REDDIT_GENDER_LANGUAGE_DAYPARTING_ENABLED` is off. The message names every one that is set;
 * - a blank `gender`, or one that is not `FEMALE` / `MALE` once trimmed and upper-cased;
 * - a blank language, or one that is not in `REDDIT_LANGUAGES` once trimmed and upper-cased;
 * - more than `REDDIT_MAX_SCHEDULE_WINDOWS` windows; a window with a field missing, a day outside 0-6 or an hour outside
 *   0-23; a window that starts where it ends; an exact repeat of an earlier window.
 *
 * An empty list is the default, as an absent one is. Duplicate languages are not refused (campaign-service drops them),
 * nor are overlapping windows or windows that wrap the week.
 */
export function redditDemographicsRefusal(raw: unknown, enabled: boolean): RedditConfigRefusal | null {
  const config = plainRecord(raw);
  if (!config) return null;
  for (const key of REDDIT_DEMOGRAPHIC_KEYS) {
    if (hasCaseVariant(config, key)) return { field: fieldOf(key), message: `Send it as "${key}", spelled exactly.` };
  }
  const gender = config['gender'];
  if (!isAbsent(gender) && typeof gender !== 'string') {
    return { field: fieldOf('gender'), message: 'Send the gender as "FEMALE" or "MALE", or omit it for every gender.' };
  }
  const languagesRaw = config['languages'];
  const languages = isAbsent(languagesRaw) ? [] : languagesRaw;
  if (!Array.isArray(languages) || !languages.every((entry) => typeof entry === 'string')) {
    return { field: fieldOf('languages'), message: 'Send it as a list of text entries.' };
  }
  const scheduleRaw = config['schedule'];
  const schedule = isAbsent(scheduleRaw) ? [] : scheduleRaw;
  if (!Array.isArray(schedule) || !isScheduleShaped(schedule)) {
    return { field: fieldOf('schedule'), message: 'Send it as a list of {startDay, startHour, endDay, endHour} windows with whole-number values.' };
  }
  const set: string[] = [];
  if (typeof gender === 'string') set.push('gender');
  if (languages.length > 0) set.push('languages');
  if (schedule.length > 0) set.push('schedule');
  if (set.length === 0) return null;
  if (!enabled) {
    const named = set.map(fieldOf).join(' and ');
    return {
      field: fieldOf(set[0]),
      message: `Reddit gender, language and dayparting targeting is not enabled on this deployment. Remove ${named} and create again.`,
    };
  }
  if (typeof gender === 'string') {
    const canonical = googleAdsToUpperCode(goTrimSpace(gender));
    if (canonical === '') return { field: fieldOf('gender'), message: 'The gender is blank. Omit it to target every gender.' };
    if (!REDDIT_GENDERS.some((value) => value === canonical)) {
      return { field: fieldOf('gender'), message: 'Send the gender as "FEMALE" or "MALE", or omit it for every gender.' };
    }
  }
  const languageList = normalizeRedditEnumList(languages, REDDIT_LANGUAGES, 'language');
  if ('refusal' in languageList) return { field: fieldOf('languages'), message: languageList.refusal };
  if (schedule.length > REDDIT_MAX_SCHEDULE_WINDOWS) {
    return { field: fieldOf('schedule'), message: `Send at most ${REDDIT_MAX_SCHEDULE_WINDOWS} schedule windows.` };
  }
  const seen = new Set<string>();
  for (const [i, entry] of schedule.entries()) {
    const refusal = scheduleWindowRefusal(entry, i + 1, seen);
    if (refusal !== null) return { field: fieldOf('schedule'), message: refusal };
  }
  return null;
}
