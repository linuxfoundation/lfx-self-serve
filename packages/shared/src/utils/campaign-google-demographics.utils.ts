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
  GOOGLE_CHANNELS_WITH_DEMAND_GEN_DEMOGRAPHICS,
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
 * The resolved enums of a campaign-level age-range or gender exclusion list, as upstream resolved
 * them. `validateExcludedAgeRanges` and `validateExcludedGenders` only trim (Go's `TrimSpace`) and
 * upper-case, with no non-ASCII refusal, unlike `validateEnumExclusions`. So `'UNDETERMINED\u00a0'`
 * is excluded upstream and must count here.
 */
function resolvedCampaignExclusionSet(raw: unknown, allowed: Readonly<Record<string, string>>): Set<string> {
  if (!isStringList(raw)) return new Set();
  return new Set(raw.map((entry) => googleAdsTrimSpace(entry).toUpperCase()).flatMap((key) => (Object.hasOwn(allowed, key) ? [allowed[key]] : [])));
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
    AGE_RANGE: { all: ALL_AGE_RANGES, excluded: resolvedCampaignExclusionSet(exclusions.ageRanges, GOOGLE_ADS_AGE_RANGE_MAP), noun: 'age range' },
    GENDER: { all: ALL_GENDERS, excluded: resolvedCampaignExclusionSet(exclusions.genders, GENDER_MAP), noun: 'gender' },
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

/** The four lists of a demographic targeting object, Display's or a Demand Gen ad group's, in the order upstream judges them. */
const DISPLAY_TARGETING_LISTS = [
  {
    key: 'ageRanges',
    exclusion: 'ageRanges',
    noun: 'age range',
    plural: 'targeted age ranges',
    list: 'age ranges',
    allowed: GOOGLE_ADS_AGE_RANGE_MAP as Readonly<Record<string, string>>,
    choices: AGE_CHOICES,
  },
  { key: 'genders', exclusion: 'genders', noun: 'gender', plural: 'targeted genders', list: 'genders', allowed: GENDER_MAP, choices: GENDER_CHOICES },
  {
    key: 'incomeRanges',
    exclusion: 'incomeRanges',
    noun: 'income range',
    plural: 'targeted income ranges',
    list: 'income ranges',
    allowed: GOOGLE_ADS_INCOME_RANGE_MAP as Readonly<Record<string, string>>,
    choices: INCOME_CHOICES,
  },
  {
    key: 'parentalStatuses',
    exclusion: 'parentalStatuses',
    noun: 'parental status',
    plural: 'targeted parental statuses',
    list: 'parental statuses',
    allowed: PARENTAL_MAP,
    choices: PARENTAL_CHOICES,
  },
] as const;

/**
 * Whether a demographic targeting object names any value: Display's (`displayDemographics`), the test
 * upstream's flag gate and its preflight both use, or a Demand Gen ad group's, the test the tab and the
 * BFF send one on.
 */
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
    // Ages and genders are campaign-level exclusions, resolved without the non-ASCII refusal;
    // incomes and parental statuses go through `validateEnumExclusions`, which keeps it.
    const excluded =
      exclusion === 'ageRanges' || exclusion === 'genders'
        ? resolvedCampaignExclusionSet(exclusions[exclusion], allowed)
        : resolvedSet(exclusions[exclusion], allowed);
    const clash = ((obj[key] as string[] | undefined | null) ?? []).find((entry) => excluded.has(resolvedEnum(entry, allowed) ?? ''));
    if (clash !== undefined) {
      return `Google Ads cannot both target and exclude the ${noun} ${googleAdsEchoed(clash)}. Remove it from one of the two and create again.`;
    }
  }
  return null;
}

/** The undetermined enum of each Demand Gen dimension, which upstream sends as `includeUndetermined` rather than as a value. */
const DEMAND_GEN_UNDETERMINED: Readonly<Record<string, string>> = {
  ageRanges: 'AGE_RANGE_UNDETERMINED',
  genders: 'UNDETERMINED',
  incomeRanges: 'INCOME_RANGE_UNDETERMINED',
  parentalStatuses: 'UNDETERMINED',
};

/** The noun each Demand Gen dimension goes by when it names everyone, as upstream's summary words it. */
const DEMAND_GEN_DIMENSION_NOUNS: Readonly<Record<string, string>> = {
  ageRanges: 'age',
  genders: 'gender',
  incomeRanges: 'income',
  parentalStatuses: 'parental status',
};

/** The keys of a Demand Gen demographics object upstream takes and this application does not send. */
const DEMAND_GEN_SEGMENT_KEYS = ['audienceSegments', 'customAudiences'] as const;

/** How many real values a dimension has: its distinct resolved enums without the undetermined one. */
function realValues(allowed: Readonly<Record<string, string>>, undetermined: string): number {
  return new Set(Object.values(allowed).filter((value) => value !== undetermined)).size;
}

/** The Demand Gen plan of one demographics object: the refusal, or the dimensions left out because they name everyone. */
interface DemandGenDemographicPlan {
  refusal: string | null;
  everyone: string[];
}

/**
 * Upstream's `buildDemographicPlan` over one demographics object already decoded, for `owner` ("the
 * Demand Gen demographics", "the demographics of Demand Gen ad group 2"). Dimension by dimension —
 * ages, genders, incomes, parental statuses — `validateEnumExclusions` (the cap on the submitted
 * length, then the vocabulary), then `demographicTargets`' refusal of a list holding only Unknown, then
 * `coversEveryone`: a list naming every value and Unknown narrows nothing, and upstream leaves it out
 * (#519). With every dimension left out, the Audience would hold nothing, which upstream refuses.
 */
function demandGenDemographicPlan(owner: string, obj: Record<string, unknown>): DemandGenDemographicPlan {
  const everyone: string[] = [];
  let dimensions = 0;
  for (const { key, noun, list, allowed, choices } of DISPLAY_TARGETING_LISTS) {
    const values = (obj[key] as string[] | undefined | null) ?? [];
    if (values.length === 0) continue;
    if (values.length > GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS) {
      return {
        refusal: `Google Ads accepts at most ${GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS} ${list} in ${owner}, and they have ${values.length}. Remove some and create again.`,
        everyone,
      };
    }
    const bad = values.find((entry) => resolvedEnum(entry, allowed) === null);
    if (bad !== undefined) {
      return { refusal: `Google Ads cannot target the ${noun} ${googleAdsEchoed(bad)} in ${owner}. Pick one of ${choices} and create again.`, everyone };
    }
    const undetermined = DEMAND_GEN_UNDETERMINED[key];
    const resolved = new Set(values.map((entry) => resolvedEnum(entry, allowed) as string));
    const includeUndetermined = resolved.delete(undetermined);
    if (includeUndetermined && resolved.size === 0) {
      return {
        refusal: `The ${noun} list in ${owner} holds only Unknown. Google Ads needs at least one real ${noun} beside it, since Unknown only adds the people Google could not classify, so tick one or clear the list.`,
        everyone,
      };
    }
    if (includeUndetermined && resolved.size === realValues(allowed, undetermined)) everyone.push(DEMAND_GEN_DIMENSION_NOUNS[key]);
    else dimensions++;
  }
  if (dimensions === 0) {
    return {
      refusal: `${capitalized(owner)} restrict nobody: each dimension they set (${everyone.join(', ')}) names every value and Unknown, so Google Ads would build an Audience with nothing in it. Untick a value, or clear ${owner}.`,
      everyone,
    };
  }
  return { refusal: null, everyone };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether one Demand Gen demographics value is set at all, as Go's pointer is: anything but absent or `null`, `{}` included. */
function demandGenDemographicsSet(raw: unknown): boolean {
  return raw !== undefined && raw !== null;
}

/** Whether a value asks for something on the cutover-only fields' terms: not absent, `null` or an empty list. */
function demandGenListAsked(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

/**
 * Why one raw Demand Gen demographics value is refused before upstream's preflight reads it, or `null`:
 * Go decodes it into a struct of string lists, so anything but an object of string lists fails the
 * create; and this application sends only the four demographic lists, so user lists or custom audiences
 * named inside it are refused by name rather than dropped.
 */
function demandGenDemographicsShapeRefusal(owner: string, raw: unknown): string | null {
  if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
    return `${capitalized(owner)} must be an object of age range, gender, income range and parental status lists.`;
  }
  const obj = raw as Record<string, unknown>;
  for (const { key, noun, list } of DISPLAY_TARGETING_LISTS) {
    const value = obj[key];
    if (value !== undefined && value !== null && !isStringList(value)) return `The ${list} in ${owner} must be a list of ${noun} names.`;
  }
  if (DEMAND_GEN_SEGMENT_KEYS.some((key) => demandGenListAsked(obj[key]))) {
    return `This application sends only age, gender, income and parental status in ${owner}. To target user lists or custom audiences as well, build that Audience in Google Ads and pick it as the ad group's audience instead.`;
  }
  return null;
}

/** A trimmed audience value set, on `validateDemandGenAudience`'s terms after it has refused a blank one. */
function audienceSet(value: unknown): boolean {
  return typeof value === 'string' && googleAdsTrimSpace(value) !== '';
}

/** One `demandGenAdGroups` entry as an object, or `{}`. */
function groupEntry(group: unknown): Record<string, unknown> {
  return group !== null && typeof group === 'object' && !Array.isArray(group) ? (group as Record<string, unknown>) : {};
}

/** The demographic fields a channel other than Demand Gen does take, so the fence never points at one the next check refuses (`demographicFieldsHint`). */
function demographicFieldsHint(channel: string): string {
  switch (channel) {
    case 'search':
      return ' Use the age, gender and income exclusions or the observed demographics instead.';
    case 'display':
      return ' Use the demographic exclusions or the demographic targeting instead.';
    case 'video':
      return ' Use the age and gender exclusions instead.';
    default:
      return '';
  }
}

/**
 * Why upstream would refuse a create's Demand Gen demographics (linuxfoundation/lfx-v2-campaign-service#498,
 * #518), or `null`. `single` is `demandGenDemographics`, `groups` the `demandGenAdGroups` list and
 * `audience` `demandGenAudience`, each as the request carries them.
 *
 * First every value's decode, the single ad group's then each group's (see
 * {@link demandGenDemographicsShapeRefusal}). Then `validateDemandGenDemographics` in its order: absent
 * asks for nothing; Demand Gen only; an object naming nothing; beside `demandGenAudience`; beside any
 * group's `audience`; when every group sets its own (they replace it for that group, so it would reach
 * none); then the Audience plan. Then `validateDemandGenGroupDemographics`, group by group: an object
 * naming nothing, beside that group's `audience`, then its plan. The groups are judged on Demand Gen
 * only, the one channel they are sent on.
 */
export function googleDemandGenDemographicsRefusal(
  single: unknown,
  groups: unknown,
  audience: unknown,
  channel: unknown
): GoogleDemographicFieldRefusal | null {
  const singleOwner = 'the Demand Gen demographics';
  const groupOwner = (index: number): string => `the demographics of Demand Gen ad group ${index + 1}`;
  const list = channel === 'demand-gen' && Array.isArray(groups) ? groups.map(groupEntry) : [];

  if (demandGenDemographicsSet(single)) {
    const shape = demandGenDemographicsShapeRefusal(singleOwner, single);
    if (shape) return { field: 'demandGenDemographics', message: shape };
  }
  for (const [index, group] of list.entries()) {
    if (!demandGenDemographicsSet(group['demographics'])) continue;
    const shape = demandGenDemographicsShapeRefusal(groupOwner(index), group['demographics']);
    if (shape) return { field: 'demandGenAdGroups', message: shape };
  }
  if (typeof channel !== 'string') return null;

  if (demandGenDemographicsSet(single)) {
    const refuse = (message: string): GoogleDemographicFieldRefusal => ({ field: 'demandGenDemographics', message });
    if (!(GOOGLE_CHANNELS_WITH_DEMAND_GEN_DEMOGRAPHICS as readonly string[]).includes(channel)) {
      return refuse(
        `Google Ads builds demographics into the Audience of a Demand Gen ad group only, not on ${channelLabel(channel)} campaigns. Clear the Demand Gen demographics or pick Demand Gen, then create again.${demographicFieldsHint(channel)}`
      );
    }
    if (!googleDisplayDemographicsCarried(single)) {
      return refuse(
        'The Demand Gen demographics are set but name nothing. Tick at least one age range, gender, income range or parental status, or clear them.'
      );
    }
    if (audienceSet(audience)) {
      return refuse(
        'The Demand Gen demographics and the Demand Gen audience cannot both be set: Google Ads takes one Audience per Demand Gen ad group, and this application does not edit an existing one. Remove the audience, or clear the demographics and set them inside that Audience in Google Ads.'
      );
    }
    const withAudience = list.findIndex((group) => audienceSet(group['audience']));
    if (withAudience !== -1) {
      return refuse(
        `The Demand Gen demographics cannot be combined with the audience of Demand Gen ad group ${withAudience + 1}: every ad group gets the demographic Audience, and an ad group takes only one. Remove that group's audience, or clear the Demand Gen demographics.`
      );
    }
    if (list.length > 0 && list.every((group) => demandGenDemographicsSet(group['demographics']))) {
      return refuse(
        `The Demand Gen demographics would reach no ad group: each of the ${list.length} Demand Gen ad groups sets its own, which replace them for that group. Clear the Demand Gen demographics, or leave a group without its own.`
      );
    }
    const plan = demandGenDemographicPlan(singleOwner, single as Record<string, unknown>);
    if (plan.refusal) return refuse(plan.refusal);
  }

  for (const [index, group] of list.entries()) {
    const demographics = group['demographics'];
    if (!demandGenDemographicsSet(demographics)) continue;
    const refuse = (message: string): GoogleDemographicFieldRefusal => ({ field: 'demandGenAdGroups', message });
    if (!googleDisplayDemographicsCarried(demographics)) {
      return refuse(
        `The demographics of Demand Gen ad group ${index + 1} are set but name nothing. Tick at least one age range, gender, income range or parental status, or clear them.`
      );
    }
    if (audienceSet(group['audience'])) {
      return refuse(
        `Demand Gen ad group ${index + 1} sets both an audience and demographics: Google Ads takes one Audience per ad group, and this application does not edit an existing one. Remove its audience, or clear its demographics and set them inside that Audience in Google Ads.`
      );
    }
    const plan = demandGenDemographicPlan(groupOwner(index), demographics as Record<string, unknown>);
    if (plan.refusal) return refuse(plan.refusal);
  }
  return null;
}

/**
 * The dimensions of one Demand Gen demographics object that name every value and Unknown, so narrow
 * nothing and are left out of the Audience upstream builds (#519), as nouns ("age", "gender"). Empty
 * when none does, or when the object would be refused (see {@link googleDemandGenDemographicsRefusal}).
 */
export function googleDemandGenDemographicsLeftOut(raw: unknown): string[] {
  if (demandGenDemographicsShapeRefusal('the demographics', raw) !== null) return [];
  const plan = demandGenDemographicPlan('the demographics', raw as Record<string, unknown>);
  return plan.refusal === null ? plan.everyone : [];
}
