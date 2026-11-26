// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_META_OBJECTIVE,
  META_AUDIENCE_TARGETING_OFF_MESSAGE,
  META_BEHAVIOR_TARGETING_OFF_MESSAGE,
  META_CUSTOM_AUDIENCE_ID_PATTERN,
  META_DEVICE_PLATFORMS,
  META_DEVICE_TARGETING_OFF_MESSAGE,
  META_INTEREST_TARGETING_OFF_MESSAGE,
  META_LOCALE_TARGETING_OFF_MESSAGE,
  META_LOCATION_TYPES,
  META_MAX_DETAILED_TARGETING_IDS,
  META_MAX_GEO_LOCATIONS,
  META_MAX_LOCALES,
  META_MAX_USER_OS,
  META_OS_TARGETING_OFF_MESSAGE,
  META_REGION_TARGETING_OFF_MESSAGE,
  META_TARGETING_BOXES,
  META_TARGETING_PICK_KEYS,
  META_TARGETING_QUERY_MAX_LENGTH,
  META_TARGETING_QUERY_MIN_LENGTH,
  META_TARGETING_SEARCH_BUSY_MESSAGE,
  META_TARGETING_SEARCH_FAILED_MESSAGE,
  META_TARGETING_SEARCH_NO_MATCH_MESSAGE,
  META_TARGETING_SEARCH_PENDING_MESSAGE,
  META_TARGETING_SEARCH_TOO_SHORT_MESSAGE,
  META_TARGETING_SEARCH_TYPES,
  META_TARGETING_SEARCH_UNAVAILABLE_MESSAGE,
  META_USER_OS_VERSIONS,
} from '../constants/campaign.constants';
import type {
  CampaignMetaAudienceTargetingBlock,
  CampaignServiceMetaTargetingSearch,
  MetaConfigRefusal,
  MetaDetailedTargeting,
  MetaDetailedTargetingBlockInput,
  MetaDetailedTargetingChoiceView,
  MetaDetailedTargetingEnabled,
  MetaDetailedTargetingListView,
  MetaDetailedTargetingPicks,
  MetaLocationType,
  MetaTargetingFlags,
  MetaTargetingBox,
  MetaTargetingPick,
  MetaTargetingPickKey,
  MetaTargetingSearchOption,
  MetaTargetingSearchType,
  MetaUserOsValue,
} from '../interfaces/campaign.interface';
import { metaConfigRecord } from './campaign-meta-ad-options.utils';

/**
 * Meta detailed targeting in `metaConfig.targeting`: interests, behaviors, work positions and languages (#5904 row 4),
 * and devices, operating systems, regions and cities (row 6). One set of rules for the create route (which answers a refusal with a 400) and the
 * Implement tab, mirroring campaign-service's `checkMetaTargeting` and `normalizeDetailedTargeting`
 * (linuxfoundation/lfx-v2-campaign-service#612, regions and cities #671).
 */

const FIELD = 'metaConfig.targeting';
const ID_FIELDS = [
  ['interests', 'Interests'],
  ['behaviors', 'Behaviors'],
  ['workPositions', 'Job titles'],
] as const;
/** The location key lists (#5904 row 6; campaign-service#671): Meta `adgeolocation` keys, the same id rule as above. */
const GEO_FIELDS = [
  ['regions', 'Regions'],
  ['cities', 'Cities'],
] as const;
/** The audience fields of the same block (#5905); setting any of them needs the audience flag. */
const AUDIENCE_FIELDS = ['ageMin', 'ageMax', 'genders', 'customAudiences', 'excludedCustomAudiences', 'advantageAudience'] as const;

/** Whether a targeting field is set, as campaign-service reads it: a list only when non-empty, anything else when present and not null. */
function isSet(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

/** Whether `raw` sets any detailed field, so the audience flag is not needed for it alone. */
export function metaTargetingHasDetailedFields(raw: unknown): boolean {
  const record = metaConfigRecord(raw);
  return [...ID_FIELDS.map(([key]) => key), ...GEO_FIELDS.map(([key]) => key), 'locales', 'devicePlatforms', 'userOs'].some((key) => isSet(record?.[key]));
}

/** Whether `raw` sets any of the six audience fields. */
export function metaTargetingHasAudienceFields(raw: unknown): boolean {
  const record = metaConfigRecord(raw);
  return AUDIENCE_FIELDS.some((key) => isSet(record?.[key]));
}

/**
 * Why `raw` sets a targeting field this deployment does not accept, or `null`. Each detailed field needs its own
 * flag (behaviors and work positions share one); the audience flag is needed when an audience field is set, or
 * when no detailed field is, so an empty or audience-only block keeps today's rule. Never a silent drop: a block
 * here comes from a tab opened while the flag was on.
 */
export function metaTargetingFlagRefusal(raw: unknown, flags: MetaTargetingFlags): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const set = (key: string): boolean => isSet(record?.[key]);
  if ((metaTargetingHasAudienceFields(raw) || !metaTargetingHasDetailedFields(raw)) && !flags.audience) {
    return { field: FIELD, message: META_AUDIENCE_TARGETING_OFF_MESSAGE };
  }
  if (set('interests') && !flags.interest) return { field: `${FIELD}.interests`, message: META_INTEREST_TARGETING_OFF_MESSAGE };
  if (set('behaviors') && !flags.behavior) return { field: `${FIELD}.behaviors`, message: META_BEHAVIOR_TARGETING_OFF_MESSAGE };
  if (set('workPositions') && !flags.behavior) return { field: `${FIELD}.workPositions`, message: META_BEHAVIOR_TARGETING_OFF_MESSAGE };
  if (set('locales') && !flags.locale) return { field: `${FIELD}.locales`, message: META_LOCALE_TARGETING_OFF_MESSAGE };
  for (const [key] of GEO_FIELDS) {
    if (set(key) && !flags.region) return { field: `${FIELD}.${key}`, message: META_REGION_TARGETING_OFF_MESSAGE };
  }
  if (set('devicePlatforms') && !flags.device) return { field: `${FIELD}.devicePlatforms`, message: META_DEVICE_TARGETING_OFF_MESSAGE };
  if (set('userOs') && !flags.os) return { field: `${FIELD}.userOs`, message: META_OS_TARGETING_OFF_MESSAGE };
  return null;
}

/**
 * Why `raw`'s detailed fields cannot be sent, or `null`. Each id list holds Meta ids (digits, no leading zero),
 * at most {@link META_MAX_DETAILED_TARGETING_IDS} distinct; `regions` and `cities` hold Meta location keys of the same
 * shape, at most {@link META_MAX_GEO_LOCATIONS} distinct each; `locales` holds positive integers, at most
 * {@link META_MAX_LOCALES} distinct. Absent or null is "not set"; ids are trimmed first. Whether a location is
 * eligible (its country, an overlap with `geoTargets`, a city inside a listed region) needs Meta's answer, so
 * campaign-service checks it when the job runs, before anything is created.
 */
export function metaDetailedTargetingRefusal(raw: unknown): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const lists = [
    ...ID_FIELDS.map(([key, label]) => [key, label, META_MAX_DETAILED_TARGETING_IDS] as const),
    ...GEO_FIELDS.map(([key, label]) => [key, label, META_MAX_GEO_LOCATIONS] as const),
  ];
  for (const [key, label, max] of lists) {
    const value = record?.[key];
    if (value === undefined || value === null) continue;
    const field = `${FIELD}.${key}`;
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !META_CUSTOM_AUDIENCE_ID_PATTERN.test(id.trim()))) {
      return { field, message: `${label} must be Meta ids: digits, without a leading zero.` };
    }
    if (new Set(value.map((id: string) => id.trim())).size > max) {
      return { field, message: `Choose at most ${max} ${label.toLowerCase()}.` };
    }
  }
  const locales = record?.['locales'];
  if (locales !== undefined && locales !== null) {
    const field = `${FIELD}.locales`;
    if (!Array.isArray(locales) || locales.some((key) => typeof key !== 'number' || !Number.isSafeInteger(key) || key <= 0)) {
      return { field, message: 'Languages must be Meta language keys: whole numbers above zero.' };
    }
    if (new Set(locales).size > META_MAX_LOCALES) return { field, message: `Choose at most ${META_MAX_LOCALES} languages.` };
  }
  return null;
}

/**
 * The detailed fields a create sends for an ACCEPTED block ({@link metaDetailedTargetingRefusal} and
 * {@link metaDeviceOsRefusal} are `null`), or `null` when it sets none: ids trimmed, devices lower-cased, OS values in
 * Meta's spelling, each list de-duplicated in first-seen order, empty lists dropped.
 */
export function compactMetaDetailedTargeting(raw: unknown): MetaDetailedTargeting | null {
  const record = metaConfigRecord(raw);
  const out: MetaDetailedTargeting = {};
  for (const [key] of [...ID_FIELDS, ...GEO_FIELDS]) {
    const value = record?.[key];
    if (!Array.isArray(value)) continue;
    const ids = [...new Set(value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()))].filter((id) => id !== '');
    if (ids.length > 0) out[key] = ids;
  }
  const locales = record?.['locales'];
  if (Array.isArray(locales)) {
    const keys = [...new Set(locales.filter((key): key is number => typeof key === 'number'))];
    if (keys.length > 0) out.locales = keys;
  }
  const devices = record?.['devicePlatforms'];
  if (Array.isArray(devices)) {
    const keys = [...new Set(devices.filter((d): d is string => typeof d === 'string').map((d) => d.trim().toLowerCase()))];
    if (keys.length > 0) out.devicePlatforms = keys;
  }
  const userOs = record?.['userOs'];
  if (Array.isArray(userOs)) {
    const values = [
      ...new Set(
        userOs
          .map(parseMetaUserOs)
          .filter((v): v is MetaUserOsValue => v !== null)
          .map((v) => v.canonical)
      ),
    ];
    if (values.length > 0) out.userOs = values;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Why a targeting search cannot be sent, or `null`: a known kind, and 2–100 characters after trimming with no control characters. */
export function metaTargetingQueryRefusal(type: unknown, query: unknown): string | null {
  if (typeof type !== 'string' || !(META_TARGETING_SEARCH_TYPES as readonly string[]).includes(type)) {
    return `The search type must be one of ${META_TARGETING_SEARCH_TYPES.join(', ')}.`;
  }
  const trimmed = typeof query === 'string' ? query.trim() : '';
  // Counted in code points, as campaign-service counts runes: an emoji is one character, not two.
  const length = [...trimmed].length;
  // eslint-disable-next-line no-control-regex -- matching control characters is the point.
  if (length < META_TARGETING_QUERY_MIN_LENGTH || length > META_TARGETING_QUERY_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) {
    return `Search with ${META_TARGETING_QUERY_MIN_LENGTH}–${META_TARGETING_QUERY_MAX_LENGTH} characters, on one line.`;
  }
  return null;
}

/** Narrows a checked search type ({@link metaTargetingQueryRefusal} is `null`). */
export function isMetaTargetingSearchType(value: unknown): value is MetaTargetingSearchType {
  return typeof value === 'string' && (META_TARGETING_SEARCH_TYPES as readonly string[]).includes(value);
}

/** Narrows a Meta location type the targeting search answers. */
function isMetaLocationType(value: unknown): value is MetaLocationType {
  return typeof value === 'string' && (META_LOCATION_TYPES as readonly string[]).includes(value);
}

/**
 * campaign-service's targeting search options, camel-cased for the picker. An option whose id is not one a create
 * accepts (digits, no leading zero; for a `locale`, also a safe integer, as it is sent as a number) cannot be sent, so
 * it is dropped rather than offered, and so is a `location`
 * row that is neither a region nor a city. A repeat is offered once: by id, or for `location` by type and id, since a
 * region and a city may share a key (campaign-service#671). A nameless option reads as its id.
 */
export function metaTargetingSearchOptions(type: MetaTargetingSearchType, raw: CampaignServiceMetaTargetingSearch['options']): MetaTargetingSearchOption[] {
  const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
  const seen = new Set<string>();
  const out: MetaTargetingSearchOption[] = [];
  for (const o of raw ?? []) {
    const id = o?.id;
    if (typeof id !== 'string' || !META_CUSTOM_AUDIENCE_ID_PATTERN.test(id)) continue;
    // A language is sent as a number, so an id past Number.MAX_SAFE_INTEGER (it would round) cannot be sent.
    if (type === 'locale' && !Number.isSafeInteger(Number(id))) continue;
    const locationType = type === 'location' ? o.location_type : undefined;
    if (type === 'location' && !isMetaLocationType(locationType)) continue;
    const key = `${locationType ?? ''}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lower = num(o.audience_size_lower_bound);
    const upper = num(o.audience_size_upper_bound);
    const coverage = num(o.coverage);
    const description = text(o.description);
    // Location fields only on a location row, as campaign-service sends them.
    const countryCode = type === 'location' ? text(o.country_code) : undefined;
    const region = type === 'location' ? text(o.region) : undefined;
    out.push({
      id,
      name: text(o.name) ?? id,
      path: Array.isArray(o.path) ? o.path.filter((part): part is string => typeof part === 'string') : [],
      ...(description !== undefined ? { description } : {}),
      ...(lower !== undefined ? { audienceSizeLowerBound: lower } : {}),
      ...(upper !== undefined ? { audienceSizeUpperBound: upper } : {}),
      ...(coverage !== undefined ? { coverage } : {}),
      ...(isMetaLocationType(locationType) ? { locationType } : {}),
      ...(countryCode !== undefined ? { countryCode } : {}),
      ...(region !== undefined ? { region } : {}),
    });
  }
  return out;
}

/** No picks in any list: a fresh object each time, so one caller's edit never reaches another's. */
export function emptyMetaDetailedTargetingPicks(): MetaDetailedTargetingPicks {
  return { interests: [], behaviors: [], workPositions: [], locales: [], regions: [], cities: [] };
}

/**
 * Whether a targeting search of `type` may be sent: the flag of the list its options fill, so the search never
 * offers an option a create would refuse. Every kind is listed; a new kind fails the type-check until it is mapped.
 */
export function metaTargetingSearchAllowed(
  type: MetaTargetingSearchType,
  flags: Pick<MetaTargetingFlags, 'interest' | 'behavior' | 'locale' | 'region'>
): boolean {
  switch (type) {
    case 'interest':
      return flags.interest;
    case 'behavior':
    case 'work_position':
      return flags.behavior;
    case 'locale':
      return flags.locale;
    case 'location':
      return flags.region;
    default: {
      const unmapped: never = type;
      return unmapped;
    }
  }
}

/**
 * The search boxes the picker shows for this deployment: each on the flag of the lists it fills (the same map as
 * {@link metaTargetingSearchAllowed}), so languages show on the locale flag and the location box on the region flag.
 */
export function metaTargetingBoxesShown(flags: Pick<MetaTargetingFlags, 'interest' | 'behavior' | 'locale' | 'region'>): MetaTargetingBox[] {
  return META_TARGETING_BOXES.filter((box) => metaTargetingSearchAllowed(box.type, flags));
}

/**
 * What the picker sends for a typed query: trimmed and cut to the upstream maximum (in code points), or `''`,
 * meaning "do not search", while it is shorter than the minimum or holds a control character.
 */
export function metaTargetingSearchQuery(raw: string): string {
  const query = [...raw.trim()].slice(0, META_TARGETING_QUERY_MAX_LENGTH).join('').trim();
  return metaTargetingQueryRefusal(META_TARGETING_SEARCH_TYPES[0], query) === null ? query : '';
}

/**
 * At most this many distinct picks in `list`, as campaign-service caps the field it fills: the `max` of the
 * `META_TARGETING_BOXES` box that fills it, the one source the picker's counts and disabled rows read too.
 */
function pickListMax(list: MetaTargetingPickKey): number {
  const box = META_TARGETING_BOXES.find((b) => (b.lists as readonly MetaTargetingPickKey[]).includes(list));
  return box ? box.max : 0;
}

/** Whether `id` can be sent in `list`: a Meta id (digits, no leading zero), and for a language one that stays exact as a number. */
function pickIdAccepted(list: MetaTargetingPickKey, id: string): boolean {
  return META_CUSTOM_AUDIENCE_ID_PATTERN.test(id) && (list !== 'locales' || Number.isSafeInteger(Number(id)));
}

/**
 * `picks` (the list `list`) with `option` added at the end; the same array when it is already there, the list is at
 * its cap, or its id cannot be sent in that list.
 */
export function metaTargetingPicksWith(
  picks: MetaTargetingPick[],
  option: Pick<MetaTargetingSearchOption, 'id' | 'name' | 'countryCode'>,
  list: MetaTargetingPickKey
): MetaTargetingPick[] {
  const id = option.id.trim();
  if (!pickIdAccepted(list, id) || picks.length >= pickListMax(list) || picks.some((pick) => pick.id === id)) return picks;
  const pick: MetaTargetingPick = { id, name: option.name.trim() || id };
  const countryCode = isLocationList(list) ? pickCountryCode(option.countryCode) : undefined;
  if (countryCode !== undefined) pick.countryCode = countryCode;
  return [...picks, pick];
}

/** Whether `list` holds locations (regions or cities), the only picks that keep a country code. */
function isLocationList(list: MetaTargetingPickKey): boolean {
  return list === 'regions' || list === 'cities';
}

/** `raw` as an ISO country code (two letters, upper-cased), or `undefined` when it is not one. */
function pickCountryCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/** `picks` without the one whose id is `id`. */
export function metaTargetingPicksWithout(picks: MetaTargetingPick[], id: string): MetaTargetingPick[] {
  return picks.filter((pick) => pick.id !== id);
}

/** The list a search row of `box` fills: the box's own, or for the location box `regions` or `cities` by the row's type; `null` for neither. */
export function metaTargetingPickList(box: MetaTargetingBox, option: Pick<MetaTargetingSearchOption, 'locationType'>): MetaTargetingPickKey | null {
  if (box.type !== 'location') return box.lists[0] ?? null;
  if (option.locationType === 'region') return 'regions';
  if (option.locationType === 'city') return 'cities';
  return null;
}

/** Where a location row is: the region a city is in, then the country code, e.g. "Texas, US"; `''` when Meta gives neither. */
function locationPlace(option: Pick<MetaTargetingSearchOption, 'locationType' | 'region' | 'countryCode'>): string {
  return [option.locationType === 'city' ? option.region : undefined, option.countryCode].filter((part) => part !== undefined && part !== '').join(', ');
}

/** A search row's secondary line: a location's type and place ("City · Texas, US"), else the taxonomy path ("Interests › Technology"). */
export function metaTargetingChoiceDetail(option: MetaTargetingSearchOption): string {
  if (option.locationType === undefined) return option.path.join(' › ');
  const type = option.locationType === 'region' ? 'Region' : 'City';
  const place = locationPlace(option);
  return place === '' ? type : `${type} · ${place}`;
}

/**
 * `picks` with a search row of `box` added to the list it fills ({@link metaTargetingPickList}); the same object when
 * nothing changes. A location's name keeps its place ("Austin, Texas, US"), so its chip still says which one after a restore.
 */
export function metaTargetingPicksAdd(picks: MetaDetailedTargetingPicks, box: MetaTargetingBox, option: MetaTargetingSearchOption): MetaDetailedTargetingPicks {
  const list = metaTargetingPickList(box, option);
  if (list === null) return picks;
  const place = option.locationType === undefined ? '' : locationPlace(option);
  const name = place === '' ? option.name : `${option.name.trim()}, ${place}`;
  const next = metaTargetingPicksWith(picks[list], { id: option.id, name, countryCode: option.countryCode }, list);
  return next === picks[list] ? picks : { ...picks, [list]: next };
}

/**
 * The search rows as `box` lists them, each with its secondary line: a row is shown but disabled when it is already
 * picked, when the list it fills is at its cap, or when it fills no list.
 */
export function metaTargetingBoxChoices(
  box: MetaTargetingBox,
  options: MetaTargetingSearchOption[],
  picks: MetaDetailedTargetingPicks
): MetaDetailedTargetingChoiceView[] {
  return options.map((option) => {
    const list = metaTargetingPickList(box, option);
    const listed = list === null ? [] : picks[list];
    const disabled = list === null || listed.length >= box.max || listed.some((pick) => pick.id === option.id);
    return { ...option, disabled, pathLabel: metaTargetingChoiceDetail(option) };
  });
}

/**
 * What `box` shows of the picks: one chip per pick of each list it fills (a region or city chip says which), whether
 * every one of those lists is at its cap, and its heading with the count, e.g. "Languages (2 of 50)" or
 * "Regions and cities (1 of 25 regions, 0 of 25 cities)".
 */
export function metaTargetingBoxPicks(
  box: MetaTargetingBox,
  picks: MetaDetailedTargetingPicks
): Pick<MetaDetailedTargetingListView, 'chips' | 'full' | 'countLabel'> {
  const chips = box.lists.flatMap((list) =>
    picks[list].map((pick) => {
      const label = list === 'regions' || list === 'cities' ? `${pick.name} (${list === 'regions' ? 'region' : 'city'})` : pick.name;
      return { list, id: pick.id, label };
    })
  );
  const full = box.lists.every((list) => picks[list].length >= box.max);
  const counts = box.lists.map((list) => (box.lists.length === 1 ? `${picks[list].length} of ${box.max}` : `${picks[list].length} of ${box.max} ${list}`));
  return { chips, full, countLabel: `${box.label} (${counts.join(', ')})` };
}

/** What a failed targeting search tells the user, from its HTTP status (`0` when there is none). */
export function metaTargetingSearchFailure(status: number): string {
  if (status === 503) return META_TARGETING_SEARCH_BUSY_MESSAGE;
  if (status === 404) return META_TARGETING_SEARCH_UNAVAILABLE_MESSAGE;
  return META_TARGETING_SEARCH_FAILED_MESSAGE;
}

/**
 * What a list's search popup says while it has no rows: that it is searching, why the search failed, that the
 * typed text cannot be searched (`refused`: too short after trimming, or holding a control character), or that
 * nothing matched.
 */
export function metaTargetingSearchEmptyMessage(refused: boolean, pending: boolean, failure: string | null): string {
  if (pending) return META_TARGETING_SEARCH_PENDING_MESSAGE;
  if (failure !== null) return failure;
  if (refused) return META_TARGETING_SEARCH_TOO_SHORT_MESSAGE;
  return META_TARGETING_SEARCH_NO_MATCH_MESSAGE;
}

/** Which capability answer each list needs: interests the interest flag, behaviors and job titles the behavior flag, languages the locale flag, regions and cities the region flag. */
function pickListFlag(list: MetaTargetingPickKey, enabled: MetaDetailedTargetingEnabled): boolean | null {
  switch (list) {
    case 'interests':
      return enabled.interest;
    case 'behaviors':
    case 'workPositions':
      return enabled.behavior;
    case 'locales':
      return enabled.locale;
    case 'regions':
    case 'cities':
      return enabled.region;
    default: {
      const unmapped: never = list;
      return unmapped;
    }
  }
}

/**
 * The picks a saved draft carries, or `undefined` when it carries none or not as a record (a draft saved before row
 * 4). The draft is persisted JSON, so each list keeps only well-formed picks: an id that list can send and a string
 * name, de-duplicated in first-seen order and capped as the list is. A list a draft predates (languages, regions,
 * cities) reads as empty.
 */
export function metaDetailedTargetingPicksFromDraft(raw: unknown): MetaDetailedTargetingPicks | undefined {
  const record = metaConfigRecord(raw);
  if (record === null || record === undefined) return undefined;
  const picks = emptyMetaDetailedTargetingPicks();
  for (const key of META_TARGETING_PICK_KEYS) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const entry = metaConfigRecord(item);
      const id = entry?.['id'];
      const name = entry?.['name'];
      if (typeof id !== 'string' || typeof name !== 'string') continue;
      const countryCode = entry?.['countryCode'];
      picks[key] = metaTargetingPicksWith(picks[key], { id, name, countryCode: typeof countryCode === 'string' ? countryCode : undefined }, key);
    }
  }
  return picks;
}

/** A copy of `picks`, so the parent's draft never holds a live view of the tab's signal. */
export function copyMetaDetailedTargetingPicks(picks: MetaDetailedTargetingPicks): MetaDetailedTargetingPicks {
  const out = emptyMetaDetailedTargetingPicks();
  for (const key of META_TARGETING_PICK_KEYS) out[key] = [...picks[key]];
  return out;
}

/** Language picks' ids as the locale keys a create sends: numbers, only for ids that are exact whole numbers above zero. */
export function metaLocaleKeys(ids: readonly string[]): number[] {
  return ids.filter((id) => pickIdAccepted('locales', id.trim())).map((id) => Number(id.trim()));
}

/**
 * The detailed fields a Meta create sends, or `null` when none: the ids of each list whose flag is an explicit yes,
 * languages as numbers ({@link metaLocaleKeys}), regions and cities as their own lists. A list whose flag is not a
 * yes is never sent; {@link metaDetailedTargetingBlock} holds Create while it has picks.
 */
export function metaDetailedTargetingForCreate(picks: MetaDetailedTargetingPicks, enabled: MetaDetailedTargetingEnabled): MetaDetailedTargeting | null {
  const out: MetaDetailedTargeting = {};
  for (const key of META_TARGETING_PICK_KEYS) {
    if (pickListFlag(key, enabled) !== true) continue;
    const ids = picks[key].map((pick) => pick.id);
    if (key === 'locales') out.locales = metaLocaleKeys(ids);
    else out[key] = ids;
  }
  return compactMetaDetailedTargeting(out);
}

/**
 * The region and city picks a Meta create sends: those lists' picks while the region flag is an explicit yes, else
 * none ({@link metaDetailedTargetingForCreate} sends them on the same rule).
 */
export function metaLocationPicksSent(picks: MetaDetailedTargetingPicks, enabled: MetaDetailedTargetingEnabled): MetaTargetingPick[] {
  return enabled.region === true ? [...picks.regions, ...picks.cities] : [];
}

/** The countries `locations` lie in, de-duplicated in first-seen order; a pick without a country code adds none. */
export function metaLocationPickCountries(locations: readonly MetaTargetingPick[]): string[] {
  const out: string[] = [];
  for (const pick of locations) {
    if (pick.countryCode !== undefined && !out.includes(pick.countryCode)) out.push(pick.countryCode);
  }
  return out;
}

/** `picks` with every list this deployment answered no to emptied: the Clear past an `unsupported` block, whose lists are hidden. An unanswered list is kept, since it may yet be sendable. */
export function metaDetailedTargetingPicksSendable(picks: MetaDetailedTargetingPicks, enabled: MetaDetailedTargetingEnabled): MetaDetailedTargetingPicks {
  const out = copyMetaDetailedTargetingPicks(picks);
  for (const key of META_TARGETING_PICK_KEYS) {
    if (pickListFlag(key, enabled) === false) out[key] = [];
  }
  return out;
}

/**
 * Why Create is held for detailed targeting the draft holds but the request cannot carry, or `null`: the audience
 * block's states (`metaAudienceTargetingBlock`). Held rather than dropped, since targeting changes who the campaign
 * reaches. `unsupported` (a list's flag answered no) offers Clear, since that list is hidden; while an answer is
 * out or failed, only waiting or Retry, since the picks may well be sendable once it answers.
 */
export function metaDetailedTargetingBlock(input: MetaDetailedTargetingBlockInput): CampaignMetaAudienceTargetingBlock | null {
  const held = META_TARGETING_PICK_KEYS.filter((key) => input.picks[key].length > 0 && pickListFlag(key, input.enabled) !== true);
  if (held.length === 0) return null;
  if (held.some((key) => pickListFlag(key, input.enabled) === false)) {
    return {
      kind: 'unsupported',
      message: 'Some Meta detailed targeting on this brief is not available on this deployment, so it cannot be sent. Clear it to create the campaign.',
    };
  }
  if (input.createCapabilityRead === 'pending') {
    return {
      kind: 'pending',
      message: 'Checking whether you can send Meta detailed targeting. Create waits for the answer so the targeting on this brief is not dropped.',
    };
  }
  if (!input.briefId) return { kind: 'unsaved', message: "Meta detailed targeting can't be checked until this brief is saved. Save the brief." };
  return {
    kind: 'failed',
    message: 'Could not confirm that you can send Meta detailed targeting, so Create waits rather than dropping the targeting on this brief. Retry the check.',
  };
}

/** A Meta `user_os` value, case-insensitively: the family, then an optional minimum version or version range. */
const USER_OS_PATTERN = /^(ios|android)(?:_ver_([0-9]+\.[0-9]+)_(?:(and_above)|to_([0-9]+\.[0-9]+)))?$/i;

/**
 * A Meta `user_os` value parsed into its canonical spelling, or `null` when it is not one of the reference's formats
 * with a listed version (a range must run from a lower to a higher listed version). campaign-service's `parseUserOS`.
 */
export function parseMetaUserOs(raw: unknown): MetaUserOsValue | null {
  if (typeof raw !== 'string') return null;
  const match = USER_OS_PATTERN.exec(raw.trim());
  if (!match) return null;
  const family = match[1].toLowerCase() === 'ios' ? 'iOS' : 'Android';
  const [, , from, andAbove, to] = match;
  if (from === undefined) return { canonical: family, family, versioned: false };
  const versions = META_USER_OS_VERSIONS[family];
  if (!versions.includes(from)) return null;
  if (andAbove !== undefined) return { canonical: `${family}_ver_${from}_and_above`, family, versioned: true };
  if (!versions.includes(to) || versions.indexOf(to) <= versions.indexOf(from)) return null;
  return { canonical: `${family}_ver_${from}_to_${to}`, family, versioned: true };
}

/**
 * Why `raw`'s device and operating-system targeting cannot be sent (#5904 row 6), or `null`: campaign-service's
 * rules. Devices are `mobile` or `desktop` (matched ignoring case). Desktop alone cannot serve the Audience Network
 * placement, which is mobile only. OS values must be Meta's formats, at most 10 distinct, with no version of one
 * family beside the other family. An OS list cannot be combined with desktop alone, and the awareness objective takes
 * no OS version. `objective` and `placements` are the rest of `metaConfig`.
 */
export function metaDeviceOsRefusal(raw: unknown, objective: unknown, placements: unknown): MetaConfigRefusal | null {
  const record = metaConfigRecord(raw);
  const devices = record?.['devicePlatforms'];
  const deviceField = `${FIELD}.devicePlatforms`;
  let devicesSent: string[] = [];
  if (devices !== undefined && devices !== null) {
    const known = META_DEVICE_PLATFORMS as readonly string[];
    if (!Array.isArray(devices) || devices.some((d) => typeof d !== 'string' || !known.includes(d.trim().toLowerCase()))) {
      return { field: deviceField, message: 'Devices must be mobile, desktop, or both.' };
    }
    devicesSent = [...new Set(devices.map((d: string) => d.trim().toLowerCase()))];
  }
  const desktopOnly = devicesSent.length === 1 && devicesSent[0] === 'desktop';
  if (desktopOnly && metaConfigRecord(placements)?.['audienceNetwork'] === true) {
    return {
      field: deviceField,
      message: 'Desktop only cannot use the Audience Network placement, which serves in mobile apps. Add mobile or turn Audience Network off.',
    };
  }
  const userOs = record?.['userOs'];
  if (userOs === undefined || userOs === null) return null;
  const osField = `${FIELD}.userOs`;
  if (!Array.isArray(userOs)) return { field: osField, message: 'Operating systems must be a list of Meta user_os values.' };
  const parsed = userOs.map(parseMetaUserOs);
  if (parsed.some((v) => v === null)) {
    return { field: osField, message: 'Operating systems must be iOS or Android, optionally with a minimum version or a version range Meta lists.' };
  }
  const values = parsed as MetaUserOsValue[];
  if (new Set(values.map((v) => v.canonical)).size > META_MAX_USER_OS) {
    return { field: osField, message: `Choose at most ${META_MAX_USER_OS} operating systems.` };
  }
  const versioned = values.find((v) => v.versioned);
  if (versioned && values.some((v) => v.family !== versioned.family)) {
    return { field: osField, message: `A version of ${versioned.family} cannot be combined with the other platform. Drop the version or the other platform.` };
  }
  if (values.length > 0 && desktopOnly) {
    return { field: osField, message: 'Operating systems target mobile devices, so they cannot be combined with desktop only. Add mobile or remove them.' };
  }
  const resolved = typeof objective === 'string' && objective.trim() !== '' ? objective.trim().toLowerCase() : DEFAULT_META_OBJECTIVE;
  if (resolved === 'awareness' && versioned) {
    return { field: osField, message: 'The awareness objective can target iOS or Android but not an OS version.' };
  }
  return null;
}
