// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_AGE_RANGE_MAP,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_DEMAND_GEN_DEVICES,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_DEVICE_LABELS,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_GEO_TARGET_ID_PATTERN,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_MAX_BID_MODIFIER,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS,
  GOOGLE_ADS_MIN_BID_MODIFIER,
  GOOGLE_ADS_PERFORMANCE_MAX_DEVICES,
  GOOGLE_ADS_SCHEDULE_DAYS,
  GOOGLE_ADS_SCHEDULE_MINUTES,
  GOOGLE_BIDDING_DEFAULT_BY_CHANNEL,
  GOOGLE_BIDDING_SCHEDULE_ADJUSTMENT_STRATEGIES,
  GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL,
  GOOGLE_BIDDING_STRATEGY_LABELS,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_CHANNELS_WITH_AD_SCHEDULES,
  GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_CHANNELS_WITH_DEVICE_EXCLUSIONS_ONLY,
  GOOGLE_CHANNELS_WITHOUT_SCHEDULE_BID_MODIFIERS,
  GOOGLE_DEVICE_ADJUSTMENT_IGNORED_STRATEGIES,
  googleAdsEchoed,
  googleAdsTrimSpace,
  isCanonicalGoogleAdsResourceId,
} from '../constants/campaign.constants';
import type {
  GoogleAdsDevice,
  GoogleBiddingStrategy,
  GoogleCampaignChannel,
  NormalizedGoogleAdSchedule,
  NormalizedGoogleDeviceBidModifier,
} from '../interfaces/campaign.interface';
import { joinAsSentenceList } from './string.utils';

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
 * Why upstream would refuse one DEVICE bid modifier, or `null` when it would not. Mirrors
 * `validateBidModifier`'s branches in order: finite, then the 0 exclusion, then the range.
 *
 * 0 RETURNS EARLY and is accepted. On a device it is not a value below the minimum but the -100%
 * exclusion — "do not serve on this device at all" — which is how a campaign stops serving on
 * tablets. A guard that tested the range first would refuse the one modifier such a campaign is
 * certain to carry.
 *
 * Not used for ad schedules, although upstream's `validateAdSchedules` calls the same
 * `validateBidModifier`: Google reserves 0 for device exclusions and refuses it on a schedule, so
 * {@link googleAdScheduleBidModifierRefusal} judges a schedule's modifier with the range alone.
 *
 * `noun` names the entry the caller wrote, so the message points at it rather than at the number.
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
 * Why Google would refuse one AD SCHEDULE bid modifier, or `null` when it would not: a finite number
 * from {@link GOOGLE_ADS_MIN_BID_MODIFIER} to {@link GOOGLE_ADS_MAX_BID_MODIFIER} (-90% to +900%).
 *
 * Narrower than {@link googleBidModifierRefusal} by exactly one value, 0. campaign-service's
 * `validateBidModifier` accepts 0 for a schedule as it does for a device and forwards it, but
 * Google's `CampaignCriterion` contract takes 0.1 to 10.0 on an ad schedule and reserves 0 for a
 * device exclusion, so a -100% window would fail the criteria mutate after the budget exists (#5088
 * review). The way to stop serving at a time is to remove that window while keeping another — with
 * windows the campaign serves only in them, with none it serves around the clock — and the refusal
 * says so.
 */
export function googleAdScheduleBidModifierRefusal(noun: string, modifier: number): string | null {
  if (!Number.isFinite(modifier)) return googleBidModifierRefusal(noun, modifier);
  if (modifier >= GOOGLE_ADS_MIN_BID_MODIFIER && modifier <= GOOGLE_ADS_MAX_BID_MODIFIER) return null;
  const zero =
    modifier === 0
      ? ' A bid modifier of 0 excludes a device, not an ad schedule. To stop serving at that time, remove this window and keep at least one other: with windows, the campaign serves only in them; with none, it serves around the clock.'
      : '';
  return `The Google Ads ${noun} has a bid modifier of ${modifier}. Google accepts ${GOOGLE_ADS_MIN_BID_MODIFIER} to ${GOOGLE_ADS_MAX_BID_MODIFIER} on an ad schedule (${googleBidAdjustmentRangeText()}).${zero} Fix it and create again.`;
}

/**
 * Google's bid-adjustment range as an operator reads it, "-90% to +900%", derived from
 * {@link GOOGLE_ADS_MIN_BID_MODIFIER} and {@link GOOGLE_ADS_MAX_BID_MODIFIER} through
 * {@link googleBidAdjustmentPercent}, so the refusals and the Implementation tab's hints cannot drift
 * from the bounds they describe.
 */
export function googleBidAdjustmentRangeText(): string {
  return `${googleBidAdjustmentPercent(GOOGLE_ADS_MIN_BID_MODIFIER)}% to +${googleBidAdjustmentPercent(GOOGLE_ADS_MAX_BID_MODIFIER)}%`;
}

/**
 * The strategies this client offers on `channel` under which Google applies an ad-schedule bid
 * adjustment ({@link GOOGLE_BIDDING_SCHEDULE_ADJUSTMENT_STRATEGIES} that
 * {@link GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL} lists there), so a refusal or hint only suggests a
 * strategy the operator can pick: both on Search, Maximize Clicks on Display, none on Performance
 * Max or Video. None on Demand Gen either, although it offers Maximize Clicks: `validateCriteriaPlan`
 * refuses a Demand Gen schedule modifier whatever the strategy
 * ({@link GOOGLE_CHANNELS_WITHOUT_SCHEDULE_BID_MODIFIERS}).
 */
export function googleScheduleAdjustmentStrategiesOn(channel: GoogleCampaignChannel): GoogleBiddingStrategy[] {
  if (!(GOOGLE_CHANNELS_WITH_AD_SCHEDULES as readonly string[]).includes(channel)) return [];
  if (googleChannelRefusesScheduleAdjustments(channel)) return [];
  const offered = GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel] as readonly GoogleBiddingStrategy[];
  return GOOGLE_BIDDING_SCHEDULE_ADJUSTMENT_STRATEGIES.filter((strategy) => offered.includes(strategy));
}

/**
 * Whether `channel` refuses an ad-schedule bid modifier under every strategy: Demand Gen, where
 * `validateCriteriaPlan` (campaign-service v1.0.31) takes a schedule only without one.
 */
export function googleChannelRefusesScheduleAdjustments(channel: GoogleCampaignChannel): boolean {
  return (GOOGLE_CHANNELS_WITHOUT_SCHEDULE_BID_MODIFIERS as readonly string[]).includes(channel);
}

/**
 * The one sentence that says why no ad-schedule bid adjustment is sent on a channel that refuses one
 * ({@link googleChannelRefusesScheduleAdjustments}). Shared by the refusal below and the
 * Implementation tab's hint and held notice, so the three say the same.
 */
export function googleChannelScheduleAdjustmentRefusedSentence(channel: GoogleCampaignChannel): string {
  return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns take an ad schedule only without a bid adjustment, so LFX One doesn't send one.`;
}

/** Whether Google applies an ad-schedule bid adjustment under the effective `strategy`. */
export function googleStrategyTakesScheduleAdjustments(strategy: string): boolean {
  return (GOOGLE_BIDDING_SCHEDULE_ADJUSTMENT_STRATEGIES as readonly string[]).includes(strategy);
}

/**
 * The one sentence that says why an ad-schedule bid adjustment is not sent under `strategyLabel`:
 * Google Ads would store it and ignore it, so LFX One refuses it rather than lose it silently. Shared
 * by the refusal below and the Implementation tab's hint and held notice, so the three say the same,
 * as {@link googleDeviceAdjustmentNotSentSentence} is for devices.
 */
export function googleScheduleAdjustmentIgnoredSentence(strategyLabel: string): string {
  const takes = GOOGLE_BIDDING_SCHEDULE_ADJUSTMENT_STRATEGIES.map((strategy) => GOOGLE_BIDDING_STRATEGY_LABELS[strategy]).join(' or ');
  return `Google Ads applies an ad schedule bid adjustment only under ${takes}. Under ${strategyLabel} it would ignore it, so LFX One doesn't send one.`;
}

/**
 * Why upstream would refuse a normalized ad-schedule LIST under the effective bidding `strategy`,
 * or `null` when it would not.
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
 * BEFORE all of that, the channel: on Demand Gen ({@link googleChannelRefusesScheduleAdjustments})
 * any present modifier is refused, as `validateCriteriaPlan` refuses it before it calls
 * `validateAdSchedules`.
 *
 * THEN the strategy, in a second pass over the whole list, so every entry's own refusal wins first,
 * as {@link googleDeviceBidModifierRefusal} orders its strategy pass. Any PRESENT modifier is refused
 * unless {@link googleStrategyTakesScheduleAdjustments} — 1, the 0% adjustment, included, since
 * Google would store it and ignore it all the same. Upstream makes no such refusal: campaign-service
 * forwards a schedule modifier under every strategy and Google silently ignores it under Smart
 * Bidding. LFX One refuses it in this one judge, so the tab and the BFF agree, rather than let a
 * create report an adjustment that is never bid (#5088 review). A window with NO modifier is accepted
 * under every strategy. `strategy` is the EFFECTIVE one ({@link googleEffectiveBiddingStrategy});
 * `channel` decides only the wording, through {@link googleScheduleAdjustmentStrategiesOn}.
 *
 * `index` is reported from 1 so it matches what an operator counts; upstream's own message numbers
 * from 0.
 */
export function googleAdScheduleRefusal(schedules: NormalizedGoogleAdSchedule[], strategy: string, channel: GoogleCampaignChannel): string | null {
  // Accepted intervals per normalized day, as minutes of the day — the form both the overlap test
  // and the empty-window check compare in, so 24:00 is 1440 and sorts after every real end.
  const perDay = new Map<string, { start: number; end: number }[]>();
  // Accepted intervals by wire key, carrying the modifier a repeat must agree with.
  const seen = new Map<string, number | undefined>();

  if (googleChannelRefusesScheduleAdjustments(channel)) {
    for (const [index, schedule] of schedules.entries()) {
      if (schedule.bidModifier !== undefined) {
        return `The Google Ads ad schedule ${index + 1} has a bid modifier of ${schedule.bidModifier}. ${googleChannelScheduleAdjustmentRefusedSentence(channel)} Clear its bid adjustment, then create again.`;
      }
    }
  }

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
      const refusal = googleAdScheduleBidModifierRefusal(shown, schedule.bidModifier);
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
  if (googleStrategyTakesScheduleAdjustments(strategy)) return null;
  for (const [index, schedule] of schedules.entries()) {
    if (schedule.bidModifier !== undefined) {
      const named = GOOGLE_BIDDING_STRATEGY_LABELS[strategy as keyof typeof GOOGLE_BIDDING_STRATEGY_LABELS] ?? googleAdsEchoed(strategy);
      const offered = googleScheduleAdjustmentStrategiesOn(channel).map((s) => GOOGLE_BIDDING_STRATEGY_LABELS[s]);
      const fix =
        offered.length > 0
          ? `Clear its bid adjustment, or bid with ${offered.join(' or ')}, then create again.`
          : 'Clear its bid adjustment, then create again.';
      return `The Google Ads ad schedule ${index + 1} has a bid modifier of ${schedule.bidModifier}. ${googleScheduleAdjustmentIgnoredSentence(named)} ${fix}`;
    }
  }
  return null;
}

/**
 * The bidding strategy campaign-service will bid a Google create with, from the value the BFF
 * forwards as `biddingStrategy` (already JS-trimmed by `googleBidding`, so pass that value, not the
 * raw body): `validateBiddingPlan`'s `strings.ToLower(strings.TrimSpace(...))`, and the channel
 * default (`defaultBiddingStrategy`, {@link GOOGLE_BIDDING_DEFAULT_BY_CHANNEL}) when that leaves
 * nothing. Not narrowed to a known strategy: an unknown name is upstream's to refuse, and it is not
 * Manual CPC either way.
 *
 * Trimmed again with {@link googleAdsTrimSpace}, Go's whitespace set, because that is what upstream
 * applies to the forwarded value: a name padded with U+0085 survives the JS trim and Go strips it.
 */
export function googleEffectiveBiddingStrategy(forwarded: unknown, channel: GoogleCampaignChannel): string {
  const named = typeof forwarded === 'string' ? googleAdsTrimSpace(forwarded).toLowerCase() : '';
  return named === '' ? GOOGLE_BIDDING_DEFAULT_BY_CHANNEL[channel] : named;
}

/**
 * Whether this client offers Manual CPC on the channel ({@link GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL}),
 * and so whether "bid with Manual CPC" is advice an operator can act on there. Display and Video do
 * not offer it, so their device refusals and hints leave that way out.
 */
export function googleChannelOffersManualCpc(channel: GoogleCampaignChannel): boolean {
  return (GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL[channel] as readonly string[]).includes('manual-cpc');
}

/**
 * The device vocabulary campaign-service accepts on `channel` (`deviceTypesFor` in
 * `campaign_criteria.go`): {@link GOOGLE_ADS_DEMAND_GEN_DEVICES} on Demand Gen and
 * {@link GOOGLE_ADS_PERFORMANCE_MAX_DEVICES} on Performance Max, which both add `CONNECTED_TV`, and
 * {@link GOOGLE_ADS_DEVICES} elsewhere. Its length is also upstream's cap on the list.
 */
export function googleAdsDevicesOn(channel: GoogleCampaignChannel): readonly GoogleAdsDevice[] {
  switch (channel) {
    case 'demand-gen':
      return GOOGLE_ADS_DEMAND_GEN_DEVICES;
    case 'performance-max':
      return GOOGLE_ADS_PERFORMANCE_MAX_DEVICES;
    default:
      return GOOGLE_ADS_DEVICES;
  }
}

/**
 * Whether `channel` takes a device only as an exclusion (a bid modifier of 0), under every strategy:
 * Demand Gen and Performance Max ({@link GOOGLE_CHANNELS_WITH_DEVICE_EXCLUSIONS_ONLY}).
 */
export function googleChannelTakesDeviceExclusionsOnly(channel: GoogleCampaignChannel): boolean {
  return (GOOGLE_CHANNELS_WITH_DEVICE_EXCLUSIONS_ONLY as readonly string[]).includes(channel);
}

/**
 * The one sentence that says why no device bid adjustment is sent on a channel that takes a device
 * only as an exclusion ({@link googleChannelTakesDeviceExclusionsOnly}). Shared by the refusal below
 * and the Implementation tab's hint and held notice, so the three say the same.
 */
export function googleChannelDeviceAdjustmentRefusedSentence(channel: GoogleCampaignChannel): string {
  return `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns take a device only as an exclusion, so LFX One doesn't send a device bid adjustment there.`;
}

/**
 * The one sentence that says why a device bid adjustment is not sent under the effective `strategy`.
 * Shared by the refusal below and the Implementation tab's hint and held notice, so the three say the
 * same.
 *
 * Two different reasons, and the sentence must not merge them. Under Maximize Conversions, Maximize
 * Conversion Value and Target ROAS ({@link GOOGLE_DEVICE_ADJUSTMENT_IGNORED_STRATEGIES}) Google Ads
 * itself does not apply a device bid adjustment, except a -100% exclusion. Under Maximize Clicks Google
 * DOES apply it (Google's "About bid adjustments", https://support.google.com/google-ads/answer/2732132),
 * and under Target CPA it applies it to the device's CPA target
 * (https://support.google.com/google-ads/answer/6268632); it is campaign-service's `validateBiddingPlan`,
 * which takes a device adjustment only under Manual CPC, that refuses it there, so saying Google would
 * ignore it would be false. An unknown name gets the second, policy wording.
 */
export function googleDeviceAdjustmentNotSentSentence(strategy: string): string {
  const named = GOOGLE_BIDDING_STRATEGY_LABELS[strategy as keyof typeof GOOGLE_BIDDING_STRATEGY_LABELS] ?? googleAdsEchoed(strategy);
  if ((GOOGLE_DEVICE_ADJUSTMENT_IGNORED_STRATEGIES as readonly string[]).includes(strategy)) {
    return `Google Ads doesn't apply a device bid adjustment under ${named}, except a -100% exclusion, so LFX One doesn't send one.`;
  }
  return `LFX One sends a device bid adjustment only under ${GOOGLE_BIDDING_STRATEGY_LABELS['manual-cpc']}, so it doesn't send one under ${named}.`;
}

/**
 * Why upstream would refuse a normalized device-bid-modifier LIST under the effective bidding
 * `strategy`, or `null` when it would not.
 *
 * A list-level guard rather than a per-entry one, because one of `validateDeviceBidModifiers`'
 * branches — a device named twice — is about an entry's relationship to the ones before it and is
 * not decidable from a single entry. The cap is checked by the caller against the SUBMITTED
 * length, as upstream does.
 *
 * FIRST the channel: on Demand Gen and Performance Max ({@link googleChannelTakesDeviceExclusionsOnly})
 * any modifier but `0` is refused, as `validateCriteriaPlan` refuses it before it calls
 * `validateDeviceBidModifiers`. On Performance Max it then refuses a list that excludes every device
 * in {@link GOOGLE_ADS_PERFORMANCE_MAX_DEVICES} (`allPerformanceMaxDevicesExcluded`), still before
 * the vocabulary: a campaign excluded from every device could serve nowhere. Demand Gen has no such
 * rule upstream, so it has none here.
 *
 * Then the per-entry branches in upstream's order: the channel's device vocabulary
 * ({@link googleAdsDevicesOn}), then the repeat, then the bid modifier. A caller who writes `TABLET` twice with two different adjustments is refused
 * on the repeat and never reaches the range check, exactly as upstream.
 *
 * THEN the strategy, in a second pass over the whole list, because upstream runs it later and
 * separately: `validateCriteriaPlan` judges every entry before `validateBiddingPlan` refuses any
 * NON-ZERO modifier while the strategy is anything but `manual-cpc`. Under Maximize Conversions,
 * Maximize Conversion Value and Target ROAS Google itself would accept such an adjustment and not
 * apply it; under Maximize Clicks Google applies it, and under Target CPA it applies it to the CPA
 * target, so there the refusal is campaign-service's Manual-CPC-only policy. This mirrors that policy, and
 * {@link googleDeviceAdjustmentNotSentSentence} says which of the two reasons applies. Non-zero includes `1`, the 0% adjustment the device
 * control starts at, so "Adjust bid" left at 0% is refused too. `0` is not: it is the device
 * exclusion, which Google honours under automated bidding, so refusing it would stop a create
 * upstream accepts. `strategy` is the EFFECTIVE one — the caller resolves an omitted strategy to the
 * channel default (see {@link googleEffectiveBiddingStrategy}), because Display's and Video's defaults
 * are automated and a request naming no strategy is refused there all the same. `channel` decides
 * only the wording: the refusal suggests Manual CPC only where {@link googleChannelOffersManualCpc}.
 *
 * Entries reaching here have a modifier — the caller refuses an absent one first, where upstream
 * does, in the dispatcher and before the channel is known.
 *
 * `index` is reported from 1 so it matches what an operator counts; upstream's message numbers
 * from 0.
 */
export function googleDeviceBidModifierRefusal(devices: NormalizedGoogleDeviceBidModifier[], strategy: string, channel: GoogleCampaignChannel): string | null {
  if (googleChannelTakesDeviceExclusionsOnly(channel)) {
    for (const [index, entry] of devices.entries()) {
      if (entry.bidModifier !== undefined && entry.bidModifier !== 0) {
        // Echoed bounded: this runs before the vocabulary check, so the device is still the caller's text.
        return `The Google Ads device bid modifier ${index + 1} gives ${googleAdsEchoed(googleAdsTrimSpace(entry.device).toUpperCase())} a bid modifier of ${entry.bidModifier}. ${googleChannelDeviceAdjustmentRefusedSentence(channel)} Set it to 0 to exclude the device or remove it, then create again.`;
      }
    }
  }
  if (channel === 'performance-max') {
    // Every entry is an exclusion by now. Keyed on the trimmed, upper-cased name, as upstream's set is.
    const excluded = new Set(devices.map((entry) => googleAdsTrimSpace(entry.device).toUpperCase()));
    if (GOOGLE_ADS_PERFORMANCE_MAX_DEVICES.every((device) => excluded.has(device))) {
      return `The Google Ads device bid modifiers exclude every device (${joinAsSentenceList(GOOGLE_ADS_PERFORMANCE_MAX_DEVICES.map((device) => GOOGLE_ADS_DEVICE_LABELS[device]))}) on a ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaign, so it could not serve anywhere. Keep at least one device, then create again.`;
    }
  }
  const vocabulary = googleAdsDevicesOn(channel);
  const seen = new Set<string>();
  for (const [index, entry] of devices.entries()) {
    const shown = `device bid modifier ${index + 1}`;
    const device = googleAdsTrimSpace(entry.device).toUpperCase();
    if (!(vocabulary as readonly string[]).includes(device)) {
      return `The Google Ads ${shown} names ${googleAdsEchoed(entry.device)}, which is not one of ${vocabulary.join(', ')} on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel]} campaigns. Fix it and create again.`;
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
  if (strategy === 'manual-cpc') return null;
  for (const [index, entry] of devices.entries()) {
    if (entry.bidModifier !== undefined && entry.bidModifier !== 0) {
      const manual = GOOGLE_BIDDING_STRATEGY_LABELS['manual-cpc'];
      const fix = googleChannelOffersManualCpc(channel)
        ? `Set it to 0 to exclude the device, remove it, or bid with ${manual}, then create again.`
        : 'Set it to 0 to exclude the device or remove it, then create again.';
      return `The Google Ads device bid modifier ${index + 1} gives ${googleAdsTrimSpace(entry.device).toUpperCase()} a bid modifier of ${entry.bidModifier}. ${googleDeviceAdjustmentNotSentSentence(strategy)} ${fix}`;
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
 * Why upstream would refuse the excluded age range list, or `null`: {@link googleDemographicExclusionRefusal}
 * with the age-range nouns and vocabulary. One call for the BFF and the Implementation tab, so the
 * message text is written once.
 */
export function googleExcludedAgeRangesRefusal(raw: unknown, channel: unknown): string | null {
  return googleDemographicExclusionRefusal(raw, 'excluded age ranges', 'age range names', channel, googleExcludedAgeRangeRefusal);
}

/** Why upstream would refuse the excluded gender list, or `null`: the gender half of {@link googleExcludedAgeRangesRefusal}. */
export function googleExcludedGendersRefusal(raw: unknown, channel: unknown): string | null {
  return googleDemographicExclusionRefusal(raw, 'excluded genders', 'gender names', channel, googleExcludedGenderRefusal);
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
 * Why upstream would refuse a normalized EXCLUDED geo list sent beside a normalized TARGETED one, or
 * `null`. `validateGeoPlan`'s exclusion steps in its order: the cap on the submitted length (per list,
 * and before any repeat is collapsed — see {@link GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS}), then each
 * entry with the first bad one winning ({@link googleExcludedGeoRefusal}), then the clash
 * ({@link googleExcludedGeoClashRefusal}). No channel fence: upstream applies none to exclusions.
 */
export function googleExcludedGeoListRefusal(excluded: readonly string[], targeted: readonly string[]): string | null {
  if (excluded.length > GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS) {
    return `Google Ads accepts at most ${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS} excluded locations on one campaign, and this one has ${excluded.length}. Remove some and create again.`;
  }
  for (const entry of excluded) {
    const refusal = googleExcludedGeoRefusal(entry);
    if (refusal) return refusal;
  }
  return googleExcludedGeoClashRefusal(targeted, excluded);
}

/**
 * A bid adjustment written as a percentage, as Google's own UI shows it, turned into the bid
 * modifier the request carries: -20% is 0.8, +50% is 1.5 and -100% is 0 — a device exclusion, and a
 * value `googleAdScheduleRefusal` refuses on an ad schedule, whose lowest adjustment is -90% (0.1).
 * Rounded to a whole percentage, so the modifier never carries float noise such as 0.7999999.
 */
export function googleBidModifierFromPercent(percent: number): number {
  return Math.round(100 + percent) / 100;
}

/** The inverse of {@link googleBidModifierFromPercent}: the whole percentage a bid modifier adjusts by. */
export function googleBidAdjustmentPercent(modifier: number): number {
  return Math.round(modifier * 100) - 100;
}
