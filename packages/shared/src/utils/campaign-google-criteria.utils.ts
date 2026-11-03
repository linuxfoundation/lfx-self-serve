// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_AGE_RANGE_MAP,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_GEO_TARGET_ID_PATTERN,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_MAX_BID_MODIFIER,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MIN_BID_MODIFIER,
  GOOGLE_ADS_SCHEDULE_DAYS,
  GOOGLE_ADS_SCHEDULE_MINUTES,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS,
  googleAdsEchoed,
  googleAdsTrimSpace,
  isCanonicalGoogleAdsResourceId,
} from '../constants/campaign.constants';
import type { GoogleCampaignChannel, NormalizedGoogleAdSchedule, NormalizedGoogleDeviceBidModifier } from '../interfaces/campaign.interface';

/**
 * Google campaign-level criteria — ad schedules, device bid modifiers, demographic exclusions and
 * excluded locations: the refusals campaign-service makes on them before the budget mutate
 * (`internal/platform/googleads/campaign_criteria.go` and `validateGeoPlan`).
 *
 * ONE copy for both tiers, for the reason `campaign-google-assets.utils` gives: the Implementation
 * tab's inline errors and the BFF's 400s must judge the same accept set, and two hand-written copies
 * is how one of them drifts. Each function returns the refusal as a sentence, or `null` when upstream
 * would accept the input. The BFF owns the decode-shape checks on an unvalidated body; what reaches
 * these functions is already normalized.
 */

/**
 * One hour-and-minute pair as `HH:MM`, for naming a window in a refusal.
 *
 * Hour 24 is printed as written rather than wrapped to `00`: it is the half-open window's
 * end-of-day, and wrapping it would misdescribe the two refusals that actually render it — the
 * overrun would read "ends at 00:15, past the end of the day", and an overlap would name the
 * window "MONDAY 09:00-00:00". Both would describe a different schedule than the caller wrote.
 * The empty-window refusal never renders hour 24: an end hour of 24 puts the end at 1440 or more
 * while a start hour of at most 23 puts the start at 1425 or less, so that branch cannot fire.
 *
 * Not exported, unlike the `googleAds*` helpers in `@lfx-one/shared/constants`. Those reproduce a
 * Go SEMANTIC the form and the BFF must agree on — `TrimSpace`'s NEL handling, Go's lowercasing,
 * `url.Parse`'s flaw — so they are separately specced. This one reproduces nothing upstream does; it
 * formats a refusal string. The Implementation tab's time pickers print the same `HH:MM` labels
 * from `GOOGLE_ADS_SCHEDULE_TIME_OPTIONS` in `campaign.constants.ts`, which builds them inline
 * rather than importing this: a constants file holds values and does not import from `utils/`,
 * and this file already imports from that one. The two agree because both zero-pad hour and minute
 * to two digits and both print 24:00 as written.
 */
function googleAdsClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * One list of upper-cased codes as judged and dispatched — languages, both halves of the geo plan,
 * and both demographic exclusion lists. `resolveLanguageList`, `resolveGeoList`,
 * `validateExcludedAgeRanges` and `validateExcludedGenders` normalize identically, so this is one
 * helper rather than a copy per field; the per-field reasons live on the callers.
 *
 * Strings only — the BFF's `createCampaign` refuses anything else first. Blanks are KEPT: upstream counts a
 * blank toward the cap and then refuses it by name, so dropping one here would turn `['']` into
 * an every-language campaign, or into a campaign with no exclusion at all.
 *
 * Trimmed with {@link googleAdsTrimSpace}, NOT `String.prototype.trim`. Go's `strings.TrimSpace`
 * strips U+0085 and JS does not, so a code padded with one would be refused here as an unknown
 * country or language while upstream accepts it — the over-refusal these mirrors exist to avoid.
 */
export function googleUpperCodeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string').map((c) => googleAdsTrimSpace(c).toUpperCase());
}

/**
 * Why upstream would refuse one bid modifier, or `null` when it would not. Mirrors
 * `validateBidModifier`'s branches in order: finite, then the 0 opt-out, then the range. One
 * helper for both callers because upstream calls the one `validateBidModifier` from both
 * `validateAdSchedules` and `validateDeviceBidModifiers`.
 *
 * 0 RETURNS EARLY and is accepted. It is not a value below the minimum but the -100% opt-out —
 * "do not serve here at all" — which is how a day-parted campaign switches off the hours it does
 * not want, and how a campaign stops serving on tablets. A guard that tested the range first would
 * refuse the one modifier such a campaign is certain to carry.
 *
 * `noun` names the entry the caller wrote — an ad schedule or a device bid modifier — so the
 * message points at it rather than at the number.
 */
export function googleBidModifierRefusal(noun: string, modifier: number): string | null {
  if (!Number.isFinite(modifier)) {
    return `The Google Ads ${noun} needs a finite bid modifier. Fix it and create again.`;
  }
  if (modifier === 0) return null;
  if (modifier < GOOGLE_ADS_MIN_BID_MODIFIER || modifier > GOOGLE_ADS_MAX_BID_MODIFIER) {
    return `The Google Ads ${noun} has a bid modifier of ${modifier}. Google accepts 0 (do not serve) or ${GOOGLE_ADS_MIN_BID_MODIFIER} to ${GOOGLE_ADS_MAX_BID_MODIFIER}, so fix it and create again.`;
  }
  return null;
}

/**
 * Why upstream would refuse a normalized ad-schedule LIST, or `null` when it would not.
 *
 * A list-level guard rather than a per-entry one like the BFF's radius-target refusal, because
 * three of `validateAdSchedules`' branches are about an entry's relationship to the ones before
 * it — an exact repeat, an overlap, and the per-day count — and none of them is decidable from a
 * single entry. The cap is checked by the caller against the SUBMITTED length, as upstream does,
 * before any repeat is collapsed.
 *
 * Mirrors `validateAdSchedules`' branch order exactly, and the order is load-bearing: day, start
 * hour, end hour, start minute, end minute, the empty-or-inverted window, the 24:15 overrun, the
 * bid modifier, THEN the repeat, THEN the overlap, THEN the per-day count. A repeat is tested
 * before the overlap because an exact duplicate is one criterion written twice rather than two
 * criteria that clash, and reporting it as an overlap would name the wrong defect.
 *
 * Overlap uses the half-open comparison upstream uses — `startA < endB && startB < endA` — so
 * 09:00-12:00 and 12:00-17:00 do NOT overlap: 12:00 is not before 12:00. A naive "do they touch"
 * test would refuse the ordinary split-day schedule, which is the over-refusal these mirrors exist
 * to avoid.
 *
 * `index` is reported from 1 so it matches what an operator counts; upstream's own message numbers
 * from 0.
 */
export function googleAdScheduleRefusal(schedules: NormalizedGoogleAdSchedule[]): string | null {
  // Accepted intervals per normalized day, as minutes of the day — the form both the overlap test
  // and the empty-window check compare in, so 24:00 is 1440 and sorts after every real end.
  const perDay = new Map<string, { start: number; end: number }[]>();
  // Accepted intervals by wire key, carrying the modifier a repeat must agree with.
  const seen = new Map<string, number | undefined>();

  for (const [index, schedule] of schedules.entries()) {
    const shown = `ad schedule ${index + 1}`;
    const day = googleAdsTrimSpace(schedule.dayOfWeek).toUpperCase();
    if (!(GOOGLE_ADS_SCHEDULE_DAYS as readonly string[]).includes(day)) {
      return `The Google Ads ${shown} needs a day of week of ${GOOGLE_ADS_SCHEDULE_DAYS.join(', ')}. Fix it and create again.`;
    }
    if (schedule.startHour < 0 || schedule.startHour > 23) {
      return `The Google Ads ${shown} has a start hour of ${schedule.startHour}, outside 0 to 23. Fix it and create again.`;
    }
    // 24 is midnight at the END of the day and is valid only as an end, which is what makes the
    // window half-open: a schedule running to midnight ends at hour 24.
    if (schedule.endHour < 1 || schedule.endHour > 24) {
      return `The Google Ads ${shown} has an end hour of ${schedule.endHour}, outside 1 to 24. Fix it and create again.`;
    }
    const minutes = GOOGLE_ADS_SCHEDULE_MINUTES as readonly number[];
    if (!minutes.includes(schedule.startMinute)) {
      return `The Google Ads ${shown} has a start minute of ${schedule.startMinute}. Google accepts only ${GOOGLE_ADS_SCHEDULE_MINUTES.join(', ')}, so pick one and create again.`;
    }
    if (!minutes.includes(schedule.endMinute)) {
      return `The Google Ads ${shown} has an end minute of ${schedule.endMinute}. Google accepts only ${GOOGLE_ADS_SCHEDULE_MINUTES.join(', ')}, so pick one and create again.`;
    }
    const start = schedule.startHour * 60 + schedule.startMinute;
    const end = schedule.endHour * 60 + schedule.endMinute;
    const span = `${googleAdsClockTime(schedule.startHour, schedule.startMinute)}-${googleAdsClockTime(schedule.endHour, schedule.endMinute)}`;
    // An end at or before the start is an empty or inverted window: the campaign would serve for
    // no time at all that day, which is never what a caller who wrote a schedule meant.
    if (end <= start) {
      return `The Google Ads ${shown} ends at ${googleAdsClockTime(schedule.endHour, schedule.endMinute)}, which is not after its start of ${googleAdsClockTime(schedule.startHour, schedule.startMinute)}. Fix it and create again.`;
    }
    // 24:00 is the only representation of end-of-day; 24:15 is past it.
    if (schedule.endHour === 24 && schedule.endMinute !== 0) {
      return `The Google Ads ${shown} ends at ${googleAdsClockTime(24, schedule.endMinute)}, past the end of the day. End hour 24 takes only minute 0, so fix it and create again.`;
    }
    if (schedule.bidModifier !== undefined) {
      const refusal = googleBidModifierRefusal(shown, schedule.bidModifier);
      if (refusal) return refusal;
    }

    const key = `${day}|${start}|${end}`;
    if (seen.has(key)) {
      // Collapsed when the two say the same thing, refused when they disagree about the bid —
      // Google accepts one criterion per interval, so the second value would be the one silently
      // dropped. A collapsed repeat does not reach the per-day count below, exactly as upstream.
      if (seen.get(key) !== schedule.bidModifier) {
        return `The Google Ads ${shown} repeats ${day} ${span} with a different bid modifier. Google accepts one entry per interval, so remove one and create again.`;
      }
      continue;
    }

    const accepted = perDay.get(day) ?? [];
    for (const other of accepted) {
      if (start < other.end && other.start < end) {
        const clash = `${googleAdsClockTime(Math.floor(other.start / 60), other.start % 60)}-${googleAdsClockTime(Math.floor(other.end / 60), other.end % 60)}`;
        return `The Google Ads ${shown} (${day} ${span}) overlaps ${day} ${clash}. Google rejects overlapping ad schedules on the same day, so merge them and create again.`;
      }
    }
    if (accepted.length >= GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY) {
      return `The Google Ads ${shown} is interval ${accepted.length + 1} on ${day}, and Google accepts at most ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} per day. Remove some and create again.`;
    }
    accepted.push({ start, end });
    perDay.set(day, accepted);
    seen.set(key, schedule.bidModifier);
  }
  return null;
}

/**
 * Why upstream would refuse a normalized device-bid-modifier LIST, or `null` when it would not.
 *
 * A list-level guard rather than a per-entry one, because one of `validateDeviceBidModifiers`'
 * branches — a device named twice — is about an entry's relationship to the ones before it and is
 * not decidable from a single entry. The cap is checked by the caller against the SUBMITTED
 * length, as upstream does.
 *
 * Mirrors the per-entry branches in upstream's order: the device vocabulary, then the repeat, then
 * the bid modifier. A caller who writes `TABLET` twice with two different adjustments is refused
 * on the repeat and never reaches the range check, exactly as upstream.
 *
 * Entries reaching here have a modifier — the caller refuses an absent one first, where upstream
 * does, in the dispatcher and before the channel is known.
 *
 * `index` is reported from 1 so it matches what an operator counts; upstream's message numbers
 * from 0.
 */
export function googleDeviceBidModifierRefusal(devices: NormalizedGoogleDeviceBidModifier[]): string | null {
  const seen = new Set<string>();
  for (const [index, entry] of devices.entries()) {
    const shown = `device bid modifier ${index + 1}`;
    const device = googleAdsTrimSpace(entry.device).toUpperCase();
    if (!(GOOGLE_ADS_DEVICES as readonly string[]).includes(device)) {
      return `The Google Ads ${shown} names ${googleAdsEchoed(entry.device)}, which is not one of ${GOOGLE_ADS_DEVICES.join(', ')}. Fix it and create again.`;
    }
    if (seen.has(device)) {
      return `The Google Ads device bid modifiers name ${device} more than once. Google accepts one criterion per device, so the second adjustment would be the one silently dropped — remove one and create again.`;
    }
    seen.add(device);
    if (entry.bidModifier !== undefined) {
      const refusal = googleBidModifierRefusal(shown, entry.bidModifier);
      if (refusal) return refusal;
    }
  }
  return null;
}

/**
 * Why upstream would refuse one campaign-level demographic exclusion list, or `null` when it
 * would not. `null` is also the answer for a field that was never sent, and for a create carrying
 * no Google channel — nothing is refused for a campaign that was never going to send the field.
 *
 * ONE helper for `validateExcludedAgeRanges` and `validateExcludedGenders`, because the two are
 * the same upstream branch written twice: both decode a Go `[]string`, both fence the same
 * channels, both check `maxDemographicExclusions` against the SUBMITTED count before any repeat
 * is collapsed, and both refuse on the FIRST bad entry. Only the vocabulary differs, and that is
 * what `entryRefusal` carries. The two call sites stay separate so that if one of the upstream
 * validators moves, only its own call has to move with it.
 *
 * `listNoun` and `itemNoun` are the only text that differs between the two messages, so a new
 * demographic list upstream adds a call, not a third copy of these four strings.
 */
export function googleDemographicExclusionRefusal(
  raw: unknown,
  listNoun: string,
  itemNoun: string,
  channel: unknown,
  entryRefusal: (entry: string) => string | null
): string | null {
  if (raw === undefined || raw === null) return null;

  // Upstream decodes the field into a Go `[]string`, so a non-array or a non-string entry is
  // refused before any validator runs.
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    return `Google Ads ${listNoun} must be a list of ${itemNoun}.`;
  }

  const entries = googleUpperCodeList(raw as string[]);
  if (entries.length === 0 || typeof channel !== 'string') return null;

  if (!(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS as readonly string[]).includes(channel)) {
    return `Google Ads does not accept campaign-level demographic exclusions on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel as GoogleCampaignChannel] ?? channel} campaigns. Remove the ${listNoun} or pick a different channel, then create again.`;
  }

  if (entries.length > GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS) {
    return `Google Ads accepts at most ${GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS} ${listNoun} on one campaign, and this one has ${entries.length}. Remove some and create again.`;
  }

  for (const entry of entries) {
    const refusal = entryRefusal(entry);
    if (refusal) return refusal;
  }
  return null;
}

/**
 * Why upstream would refuse one normalized excluded age range, or `null` when it would not.
 *
 * Mirrors `validateExcludedAgeRanges`' single per-entry branch: membership in
 * {@link GOOGLE_ADS_AGE_RANGE_MAP}, which carries BOTH the friendly spelling and Google's own
 * `AGE_RANGE_*` enum name for every value. A blank entry has no branch of its own, upstream or
 * here — it is simply not in the map, and the vocabulary message names what to write instead.
 *
 * A repeat is NOT refused: upstream collapses it. The echo is cut short, as every echo of an
 * unvalidated body is.
 */
export function googleExcludedAgeRangeRefusal(ageRange: string): string | null {
  if (Object.hasOwn(GOOGLE_ADS_AGE_RANGE_MAP, ageRange)) return null;
  return `Google Ads cannot exclude the age range ${googleAdsEchoed(ageRange)}. Pick one of ${GOOGLE_ADS_AGE_RANGES.join(', ')} — Google's AGE_RANGE_* enum names are accepted too — and create again.`;
}

/**
 * Why upstream would refuse one normalized excluded gender, or `null` when it would not.
 *
 * Mirrors `validateExcludedGenders`' single per-entry branch. UNDETERMINED is an ordinary member
 * of the vocabulary, not a non-value: it is the bucket Google puts users it could not classify
 * into, and excluding it is a real choice a campaign makes. A repeat is NOT refused — upstream
 * collapses it.
 */
export function googleExcludedGenderRefusal(gender: string): string | null {
  if ((GOOGLE_ADS_GENDERS as readonly string[]).includes(gender)) return null;
  return `Google Ads cannot exclude the gender ${googleAdsEchoed(gender)}. Pick one of ${GOOGLE_ADS_GENDERS.join(', ')} and create again.`;
}

/**
 * Why upstream would refuse one entry of a normalized EXCLUDED geo list, or `null` when it would
 * not.
 *
 * Mirrors `resolveGeoEntry`'s branches in order. A blank entry is refused. A NUMERIC entry is a
 * raw geo target constant id — how a caller addresses a city, region, metro or postal code — so
 * it must be canonical (`canonicalCampaignID` upstream, {@link isCanonicalGoogleAdsResourceId}
 * here) but is deliberately NOT tested against {@link GOOGLE_ADS_GEO_TARGET_MAP}, which holds
 * countries only; testing it there would refuse every city upstream accepts. Anything else must
 * be a country code present in that map.
 *
 * Classified by {@link GOOGLE_ADS_GEO_TARGET_ID_PATTERN} (digits only, matching Go's `numericID`)
 * rather than by a bounded resource-id pattern, so a 21-digit run is refused as a non-canonical
 * id — upstream's own answer — instead of being misreported as an unsupported country code.
 */
export function googleExcludedGeoRefusal(entry: string): string | null {
  if (entry === '') return 'Google Ads excluded locations cannot include a blank entry. Remove it and create again.';
  const shown = googleAdsEchoed(entry);
  if (GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(entry)) {
    return isCanonicalGoogleAdsResourceId(entry)
      ? null
      : `Google Ads excluded location ${shown} is not the canonical spelling of a positive geo target constant id. Use the id with no leading zeros, or pick a country from the list, and create again.`;
  }
  return Object.hasOwn(GOOGLE_ADS_GEO_TARGET_MAP, entry)
    ? null
    : `Google Ads cannot exclude ${shown} on this path. Use a supported country code or a numeric geo target constant id from Google's geo-targets table, then create again.`;
}

/**
 * The geo target constant id one normalized entry resolves to, or `null` when it resolves to
 * nothing (a blank, a bad code, a non-canonical id) and {@link googleExcludedGeoRefusal} has already
 * refused it.
 *
 * The resolved id is what the targeted-and-excluded clash compares, for the reason upstream
 * compares it: `US` and `2840` are one criterion, so a pair spelled two different ways still
 * clashes.
 */
export function googleResolvedGeoId(entry: string): string | null {
  if (GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(entry)) return isCanonicalGoogleAdsResourceId(entry) ? entry : null;
  return GOOGLE_ADS_GEO_TARGET_MAP[entry] ?? null;
}

/**
 * Why upstream would refuse a location that is both TARGETED and EXCLUDED, or `null` when the two
 * lists share none. Both lists arrive normalized by {@link googleUpperCodeList}.
 *
 * Refused rather than resolved: Google lets the exclusion win, so the campaign would silently not
 * serve where the operator plainly asked it to. Compared by RESOLVED id, as upstream compares it, so
 * `US` and `2840` clash however each half is spelled. The first targeted entry that clashes is named.
 */
export function googleExcludedGeoClashRefusal(targeted: readonly string[], excluded: readonly string[]): string | null {
  const excludedIds = new Set(excluded.map((entry) => googleResolvedGeoId(entry)).filter((id): id is string => id !== null));
  const clash = targeted.find((entry) => {
    const id = googleResolvedGeoId(entry);
    return id !== null && excludedIds.has(id);
  });
  if (clash === undefined) return null;
  return `Google Ads cannot both target and exclude ${googleAdsEchoed(clash)} — the exclusion would win and the campaign would not serve there at all. Remove it from one of the two lists and create again.`;
}

/**
 * A bid adjustment written as a percentage, as Google's own UI shows it, turned into the bid
 * modifier the request carries: -20% is 0.8, +50% is 1.5 and -100% is 0, the do-not-serve opt-out.
 * Rounded to a whole percentage, so the modifier never carries float noise such as 0.7999999.
 */
export function googleBidModifierFromPercent(percent: number): number {
  return Math.round(100 + percent) / 100;
}

/** The inverse of {@link googleBidModifierFromPercent}: the whole percentage a bid modifier adjusts by. */
export function googleBidAdjustmentPercent(modifier: number): number {
  return Math.round(modifier * 100) - 100;
}
