// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_AGE_RANGE_MAP,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_INCOME_RANGE_MAP,
  GOOGLE_ADS_INCOME_RANGES,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MAX_OBSERVED_DEMOGRAPHIC_ENTRIES,
  GOOGLE_ADS_OBSERVED_DEMOGRAPHICS,
  GOOGLE_ADS_PARENTAL_STATUSES,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_TARGETING,
  GOOGLE_CHANNELS_WITH_INCOME_EXCLUSIONS,
  GOOGLE_CHANNELS_WITH_OBSERVED_DEMOGRAPHICS,
  GOOGLE_CHANNELS_WITH_PARENTAL_EXCLUSIONS,
  googleAdsEchoed,
  googleAdsTrimSpace,
} from '../constants/campaign.constants';
import type { GoogleCampaignChannel, GoogleDemographicExclusionLists, GoogleDemographicFieldRefusal } from '../interfaces/campaign.interface';

const GENDER_MAP: Readonly<Record<string, string>> = Object.fromEntries(GOOGLE_ADS_GENDERS.map((g) => [g, g]));
const PARENTAL_MAP: Readonly<Record<string, string>> = Object.fromEntries(GOOGLE_ADS_PARENTAL_STATUSES.map((s) => [s, s]));

/** Every resolved value of each dimension, in Google's enum order (`allAgeRanges`, `allGenders`, `allIncomeRanges`). */
const ALL_AGE_RANGES = [...new Set(Object.values(GOOGLE_ADS_AGE_RANGE_MAP))];
const ALL_GENDERS: readonly string[] = GOOGLE_ADS_GENDERS;
const ALL_INCOME_RANGES = [...new Set(Object.values(GOOGLE_ADS_INCOME_RANGE_MAP))];

const AGE_CHOICES = `${GOOGLE_ADS_AGE_RANGES.join(', ')} — Google's AGE_RANGE_* enum names are accepted too`;
const GENDER_CHOICES = GOOGLE_ADS_GENDERS.join(', ');
const INCOME_CHOICES = GOOGLE_ADS_INCOME_RANGES.join(', ');
const PARENTAL_CHOICES = GOOGLE_ADS_PARENTAL_STATUSES.join(', ');

function channelLabel(channel: string): string {
  return GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel as GoogleCampaignChannel] ?? channel;
}

function isStringList(raw: unknown): raw is string[] {
  return Array.isArray(raw) && raw.every((entry) => typeof entry === 'string');
}

/**
 * The enum one entry resolves to through `allowed`, or `null`. `validateEnumExclusions`' per-entry
 * branch: an entry carrying any non-ASCII rune is refused BEFORE it is upper-cased, because Unicode
 * case folding maps some non-ASCII letters onto ASCII ones (`ı` upper-cases to `I`), so
 * `ıncome_range_0_50` would otherwise resolve to a real enum. `Object.hasOwn`, so `constructor` is
 * no member.
 */
function resolvedEnum(entry: string, allowed: Readonly<Record<string, string>>): string | null {
  if ([...entry].some((ch) => ch.charCodeAt(0) > 0x7f)) return null;
  const key = googleAdsTrimSpace(entry).toUpperCase();
  return Object.hasOwn(allowed, key) ? allowed[key] : null;
}

/**
 * Why upstream would refuse one enum list, or `null`: `validateEnumExclusions` in its order — the cap
 * on the SUBMITTED length (a repeat is collapsed only after it), then the first entry outside the
 * vocabulary.
 */
function enumListRefusal(
  values: readonly string[],
  listNoun: string,
  verb: string,
  itemNoun: string,
  allowed: Readonly<Record<string, string>>,
  choices: string
): string | null {
  if (values.length > GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS) {
    return `Google Ads accepts at most ${GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS} ${listNoun} on one campaign, and this one has ${values.length}. Remove some and create again.`;
  }
  const bad = values.find((entry) => resolvedEnum(entry, allowed) === null);
  if (bad === undefined) return null;
  return `Google Ads cannot ${verb} the ${itemNoun} ${googleAdsEchoed(bad)}. Pick one of ${choices} and create again.`;
}

/** The resolved enums of one request list, as upstream resolved them; entries it would refuse are left out. */
function resolvedSet(raw: unknown, allowed: Readonly<Record<string, string>>): Set<string> {
  if (!isStringList(raw)) return new Set();
  return new Set(raw.map((entry) => resolvedEnum(entry, allowed)).filter((e): e is string => e !== null));
}

/**
 * Why upstream would refuse the ad-group income-range and parental-status exclusions
 * (linuxfoundation/lfx-v2-campaign-service#473), or `null`. `validateAdGroupDemographicExclusions`
 * branch by branch: the income channel fence, then parental status on Search (Google refuses it on
 * a Search ad group), then the parental channel fence, then each vocabulary — income first.
 * A list that is not a list of strings fails Go's decode first. An empty list asks for nothing.
 */
export function googleAdGroupDemographicExclusionsRefusal(rawIncome: unknown, rawParental: unknown, channel: unknown): GoogleDemographicFieldRefusal | null {
  for (const [field, raw, listNoun, itemNoun] of [
    ['excludedIncomeRanges', rawIncome, 'excluded income ranges', 'income range names'],
    ['excludedParentalStatuses', rawParental, 'excluded parental statuses', 'parental status names'],
  ] as const) {
    if (raw !== undefined && raw !== null && !isStringList(raw)) return { field, message: `Google Ads ${listNoun} must be a list of ${itemNoun}.` };
  }
  const incomes = isStringList(rawIncome) ? rawIncome : [];
  const parents = isStringList(rawParental) ? rawParental : [];
  if (typeof channel !== 'string' || incomes.length + parents.length === 0) return null;
  const label = channelLabel(channel);

  if (incomes.length > 0 && !(GOOGLE_CHANNELS_WITH_INCOME_EXCLUSIONS as readonly string[]).includes(channel)) {
    return {
      field: 'excludedIncomeRanges',
      message: `Google Ads does not accept income-range exclusions on ${label} campaigns, only on Search and Display. Remove the excluded income ranges or pick a different channel, then create again.`,
    };
  }
  if (parents.length > 0 && channel === 'search') {
    return {
      field: 'excludedParentalStatuses',
      message: `Google Ads refuses parental-status exclusions on a Search campaign's ad groups. Remove the excluded parental statuses, or create a Display campaign to exclude them.`,
    };
  }
  if (parents.length > 0 && !(GOOGLE_CHANNELS_WITH_PARENTAL_EXCLUSIONS as readonly string[]).includes(channel)) {
    return {
      field: 'excludedParentalStatuses',
      message: `Google Ads does not accept parental-status exclusions on ${label} campaigns, only on Display. Remove the excluded parental statuses or pick a different channel, then create again.`,
    };
  }
  const incomeRefusal = enumListRefusal(incomes, 'excluded income ranges', 'exclude', 'income range', GOOGLE_ADS_INCOME_RANGE_MAP, INCOME_CHOICES);
  if (incomeRefusal) return { field: 'excludedIncomeRanges', message: incomeRefusal };
  const parentalRefusal = enumListRefusal(parents, 'excluded parental statuses', 'exclude', 'parental status', PARENTAL_MAP, PARENTAL_CHOICES);
  if (parentalRefusal) return { field: 'excludedParentalStatuses', message: parentalRefusal };
  return null;
}

/**
 * Why upstream would refuse the observed demographic dimensions (linuxfoundation/lfx-v2-campaign-service#497),
 * or `null`. `validateObservedDemographics` branch by branch: Search only, the cap on the submitted
 * length, then each entry in order (upstream skips a repeat, which judges the same either way) — AGE_RANGE / GENDER / INCOME_RANGE refused when
 * the exclusions already exclude every value of the dimension, PARENTAL_STATUS refused by name (Google
 * refuses it on a Search ad group), anything else refused on the vocabulary. Judged after the
 * exclusions, which upstream has already accepted when it gets here.
 */
export function googleObservedDemographicsRefusal(raw: unknown, channel: unknown, exclusions: GoogleDemographicExclusionLists): string | null {
  if (raw === undefined || raw === null) return null;
  if (!isStringList(raw)) return 'Google Ads observed demographics must be a list of dimension names.';
  if (raw.length === 0 || typeof channel !== 'string') return null;
  if (!(GOOGLE_CHANNELS_WITH_OBSERVED_DEMOGRAPHICS as readonly string[]).includes(channel)) {
    return `Google Ads observes demographics on Search campaigns only, not on ${channelLabel(channel)}. Clear the observed demographics or pick Search, then create again.`;
  }
  if (raw.length > GOOGLE_ADS_MAX_OBSERVED_DEMOGRAPHIC_ENTRIES) {
    return `Google Ads accepts at most ${GOOGLE_ADS_MAX_OBSERVED_DEMOGRAPHIC_ENTRIES} observed demographic entries, and this campaign has ${raw.length}. Only ${GOOGLE_ADS_OBSERVED_DEMOGRAPHICS.join(', ')} are distinct; remove the repeats and create again.`;
  }
  const remaining: Record<string, { all: readonly string[]; excluded: Set<string>; noun: string }> = {
    AGE_RANGE: { all: ALL_AGE_RANGES, excluded: resolvedSet(exclusions.ageRanges, GOOGLE_ADS_AGE_RANGE_MAP), noun: 'age range' },
    GENDER: { all: ALL_GENDERS, excluded: resolvedSet(exclusions.genders, GENDER_MAP), noun: 'gender' },
    INCOME_RANGE: { all: ALL_INCOME_RANGES, excluded: resolvedSet(exclusions.incomeRanges, GOOGLE_ADS_INCOME_RANGE_MAP), noun: 'income range' },
  };
  for (const entry of raw) {
    const dim = [...entry].some((ch) => ch.charCodeAt(0) > 0x7f) ? '' : googleAdsTrimSpace(entry).toUpperCase();
    const plan = Object.hasOwn(remaining, dim) ? remaining[dim] : undefined;
    if (plan) {
      if (plan.all.every((value) => plan.excluded.has(value))) {
        return `Every ${plan.noun} is excluded, so there is nothing left to observe. Stop observing it or exclude fewer, then create again.`;
      }
    } else if (dim === 'PARENTAL_STATUS') {
      return 'Google Ads refuses parental status on a Search campaign, so it cannot be observed. Remove it from the observed demographics and create again.';
    } else {
      return `Google Ads cannot observe ${googleAdsEchoed(entry)}. Pick one of ${GOOGLE_ADS_OBSERVED_DEMOGRAPHICS.join(', ')} and create again.`;
    }
  }
  return null;
}

/** The four lists of a Display demographic targeting object, in the order upstream judges them. */
const DISPLAY_TARGETING_LISTS = [
  {
    key: 'ageRanges',
    exclusion: 'ageRanges',
    noun: 'age range',
    plural: 'targeted age ranges',
    allowed: GOOGLE_ADS_AGE_RANGE_MAP as Readonly<Record<string, string>>,
    choices: AGE_CHOICES,
  },
  { key: 'genders', exclusion: 'genders', noun: 'gender', plural: 'targeted genders', allowed: GENDER_MAP, choices: GENDER_CHOICES },
  {
    key: 'incomeRanges',
    exclusion: 'incomeRanges',
    noun: 'income range',
    plural: 'targeted income ranges',
    allowed: GOOGLE_ADS_INCOME_RANGE_MAP as Readonly<Record<string, string>>,
    choices: INCOME_CHOICES,
  },
  {
    key: 'parentalStatuses',
    exclusion: 'parentalStatuses',
    noun: 'parental status',
    plural: 'targeted parental statuses',
    allowed: PARENTAL_MAP,
    choices: PARENTAL_CHOICES,
  },
] as const;

/** Whether a Display demographic targeting object names any value — the test upstream's flag gate and its preflight both use. */
export function googleDisplayDemographicsCarried(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return DISPLAY_TARGETING_LISTS.some(({ key }) => Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0);
}

/**
 * Why upstream would refuse Display's positive demographic targeting (linuxfoundation/lfx-v2-campaign-service#499),
 * or `null`. Go decodes `displayDemographics` into a struct of four string lists, so anything else
 * fails the create first. Then `validateDisplayDemographics` in its order: nothing named asks for
 * nothing; Display only; each list's cap and vocabulary (ages, genders, incomes, parental statuses);
 * then, list by list, a value both targeted and excluded — compared by resolved enum, so `18-24`
 * and `AGE_RANGE_18_24` clash. Excluding a different value of a targeted dimension is accepted.
 */
export function googleDisplayDemographicsRefusal(raw: unknown, channel: unknown, exclusions: GoogleDemographicExclusionLists): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    return 'Google Ads demographic targeting must be an object of age range, gender, income range and parental status lists.';
  const obj = raw as Record<string, unknown>;
  for (const { key, noun, plural } of DISPLAY_TARGETING_LISTS) {
    const list = obj[key];
    if (list !== undefined && list !== null && !isStringList(list)) return `Google Ads ${plural} must be a list of ${noun} names.`;
  }
  if (!googleDisplayDemographicsCarried(raw) || typeof channel !== 'string') return null;
  if (!(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_TARGETING as readonly string[]).includes(channel)) {
    return `Google Ads takes demographic targeting on Display campaigns only, not on ${channelLabel(channel)}. Clear the demographic targeting or pick Display, then create again.`;
  }
  for (const { key, noun, plural, allowed, choices } of DISPLAY_TARGETING_LISTS) {
    const refusal = enumListRefusal((obj[key] as string[] | undefined | null) ?? [], plural, 'target', noun, allowed, choices);
    if (refusal) return refusal;
  }
  for (const { key, exclusion, noun, allowed } of DISPLAY_TARGETING_LISTS) {
    const excluded = resolvedSet(exclusions[exclusion], allowed);
    const clash = ((obj[key] as string[] | undefined | null) ?? []).find((entry) => excluded.has(resolvedEnum(entry, allowed) ?? ''));
    if (clash !== undefined) {
      return `Google Ads cannot both target and exclude the ${noun} ${googleAdsEchoed(clash)}. Remove it from one of the two and create again.`;
    }
  }
  return null;
}
