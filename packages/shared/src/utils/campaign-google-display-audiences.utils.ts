// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS,
  GOOGLE_DISPLAY_AUDIENCE_KINDS,
  googleAdsTrimSpace,
  isCanonicalGoogleAdsResourceId,
} from '../constants/campaign.constants';
import type { GoogleDisplayAudienceKind, GoogleDisplayAudienceLists, GoogleDisplayCampaignAudiences } from '../interfaces/campaign.interface';

/**
 * Display audiences (campaign-service v1.0.35, #472 and #480): the refusals campaign-service makes on a
 * Display campaign's audience lists before the budget mutate (`validateDisplayTargeting` and
 * `validateDisplayAudienceList` in `internal/platform/googleads/display_targeting.go`,
 * `validateDisplayAdGroups`, `validateDisplayExcludedUserLists` and `refuseExcludedOverlap` in
 * `display_adgroups.go`).
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the create
 * with the same sentence. A refusal names an entry by its list and position, never by its text.
 */

/** A Display audience list's `googleAdsConfig` field: one of the four targeting kinds, or the campaign's exclusions. */
type DisplayAudienceListField = GoogleDisplayAudienceKind | 'excludedAudienceSegments';

/** Each collection campaign-service takes on Display, with the words for the list it belongs in (`displayAudienceCollections`). */
const COLLECTION_LABELS: ReadonlyMap<string, string> = new Map(GOOGLE_DISPLAY_AUDIENCE_KINDS.map((entry) => [entry.collection, entry.label.toLowerCase()]));

/** The collection a list's entries must name: user lists for the exclusions, else the kind's own. */
function collectionOf(field: DisplayAudienceListField): string {
  if (field === 'excludedAudienceSegments') return 'userLists';
  return GOOGLE_DISPLAY_AUDIENCE_KINDS.find((entry) => entry.kind === field)?.collection ?? '';
}

/** Whether a value is a list of strings, the only shape Go's decode into `[]string` takes. Absent and `null` decode to an empty list. */
function stringList(value: unknown): value is string[] | undefined | null {
  return value === undefined || value === null || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}

/**
 * The entries of a list as campaign-service keeps them: trimmed with Go's rules, repeats folded, blanks
 * dropped. Only for comparing two lists that have each passed {@link googleDisplayAudienceListRefusal}.
 */
function kept(names: readonly string[] | undefined | null): string[] {
  return [...new Set((names ?? []).map((name) => googleAdsTrimSpace(name)).filter((name) => name !== ''))];
}

/**
 * Why campaign-service would refuse one Display audience list, or `null` when it would take it.
 * `owner` names the list in the sentence ("The single ad group's custom audiences"); `field` picks the
 * collection its entries must name. `accountId` is the customer the campaign is created in, when known:
 * the BFF does not know it and judges the shape only, and upstream judges the customer before anything is
 * created.
 *
 * In upstream's order. For the exclusions, first any entry naming another known collection, before the
 * cap (`validateDisplayExcludedUserLists` walks the whole list first). Then the cap on the RAW list, then
 * each entry: blank; not `customers/<digits>/<collection>/<digits>`; an Audience resource, which a Display
 * ad group refuses; another Display collection, naming the list it belongs in; another customer; and an id
 * that is not the canonical spelling of a positive int64. Repeats are not refused: upstream folds them.
 */
export function googleDisplayAudienceListRefusal(owner: string, field: DisplayAudienceListField, names: unknown, accountId = ''): string | null {
  if (!stringList(names)) return `${owner} must be a list of Google Ads resource names.`;
  if (names === undefined || names === null || names.length === 0) return null;
  const collection = collectionOf(field);
  if (field === 'excludedAudienceSegments') {
    for (const [index, raw] of names.entries()) {
      const parts = googleAdsTrimSpace(raw).split('/');
      if (parts.length === 4 && parts[0] === 'customers' && parts[2] !== 'userLists') {
        return `${owner}: entry ${index + 1} is not a user list. Only user lists can be excluded on Display.`;
      }
    }
  }
  if (names.length > GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS) {
    return `${owner} hold ${names.length} entries, and Google Ads takes at most ${GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS}. Remove some and create again.`;
  }
  const digits = (value: string): boolean => /^[0-9]+$/.test(value);
  for (const [index, raw] of names.entries()) {
    const position = `${owner}: entry ${index + 1}`;
    const name = googleAdsTrimSpace(raw);
    if (name === '') return `${position} is blank. Remove it.`;
    const parts = name.split('/');
    if (parts.length !== 4 || parts[0] !== 'customers' || !digits(parts[1]) || !digits(parts[3])) {
      return `${position} is not a Google Ads resource name (customers/<id>/${collection}/<id>). Remove it and pick one from the list.`;
    }
    if (parts[2] === 'audiences') {
      return `${position} is a Google Ads Audience, which a Display ad group refuses: Display targets the segments themselves. Remove it and pick the user lists, custom audiences, custom affinity segments or interests it holds.`;
    }
    if (parts[2] !== collection) {
      const belongs = COLLECTION_LABELS.get(parts[2]);
      if (belongs !== undefined)
        return `${position} is one of this account's ${belongs}. Remove it here and pick it under ${belongs.charAt(0).toUpperCase()}${belongs.slice(1)} instead.`;
      return `${position} is not a Google Ads resource name (customers/<id>/${collection}/<id>). Remove it and pick one from the list.`;
    }
    if (accountId !== '' && parts[1] !== accountId) {
      return `${position} belongs to another Google Ads account than the one this campaign is created in. Remove it and pick one of this account's.`;
    }
    if (!isCanonicalGoogleAdsResourceId(parts[3])) {
      return `${position} has an id written with leading zeros. Remove it and pick it from the list again.`;
    }
  }
  return null;
}

/** The single ad group's, or named ad group `group`'s (1-based), list of `kind`, as a refusal names it. */
export function googleDisplayAudienceListOwner(group: number | null, kind: GoogleDisplayAudienceKind): string {
  const label = (GOOGLE_DISPLAY_AUDIENCE_KINDS.find((entry) => entry.kind === kind)?.label ?? kind).toLowerCase();
  return group === null ? `The single ad group's ${label}` : `Display ad group ${group}'s ${label}`;
}

/** The owner {@link googleDisplayAudiencesRefusal} names the campaign's exclusions by. */
const EXCLUDED_OWNER = "The campaign's excluded user lists";

/** Whether an object carries any of the four targeting lists with an entry. */
function targets(lists: GoogleDisplayAudienceLists | undefined): boolean {
  return GOOGLE_DISPLAY_AUDIENCE_KINDS.some(({ kind }) => (lists?.[kind]?.length ?? 0) > 0);
}

/**
 * Why campaign-service would refuse the Display audiences of one create, or `null`, in its order.
 * `campaign` is the request's `displayAudiences`; `groups` the named ad groups as sent, `undefined` when
 * the create is not split. `accountId` as {@link googleDisplayAudienceListRefusal} takes it.
 *
 * First `validateDisplayTargeting`: the single ad group's four lists, then the campaign's exclusions, then
 * a user list the single ad group both targets and the campaign excludes. Then `validateDisplayAdGroups`:
 * the single ad group's lists beside named groups, then each group's four lists and a user list it targets
 * that the campaign excludes. Upstream judges each group's name before its lists; the BFF judges the names
 * first through `googleDisplayAdGroupsRefusal`.
 */
export function googleDisplayAudiencesRefusal(
  campaign: GoogleDisplayCampaignAudiences | undefined,
  groups: readonly GoogleDisplayAudienceLists[] | undefined,
  accountId = ''
): string | null {
  for (const { kind } of GOOGLE_DISPLAY_AUDIENCE_KINDS) {
    const refusal = googleDisplayAudienceListRefusal(googleDisplayAudienceListOwner(null, kind), kind, campaign?.[kind], accountId);
    if (refusal !== null) return refusal;
  }
  const excludedRefusal = googleDisplayAudienceListRefusal(EXCLUDED_OWNER, 'excludedAudienceSegments', campaign?.excludedAudienceSegments, accountId);
  if (excludedRefusal !== null) return excludedRefusal;
  const excluded = new Set(kept(campaign?.excludedAudienceSegments));
  const overlap = (targeted: readonly string[] | undefined, owner: string): string | null =>
    kept(targeted).some((name) => excluded.has(name))
      ? `${owner} target a user list the campaign also excludes. Keep it in one of the two and create again.`
      : null;
  const singleOverlap = overlap(campaign?.audienceSegments, "The single ad group's user lists");
  if (singleOverlap !== null) return singleOverlap;
  if (groups === undefined) return null;
  if (targets(campaign)) {
    return "The single ad group's audiences cannot be sent with named ad groups. Pick audiences on each ad group instead; excluded user lists still cover every group.";
  }
  for (const [index, group] of groups.entries()) {
    for (const { kind } of GOOGLE_DISPLAY_AUDIENCE_KINDS) {
      const refusal = googleDisplayAudienceListRefusal(googleDisplayAudienceListOwner(index + 1, kind), kind, group[kind], accountId);
      if (refusal !== null) return refusal;
    }
    const groupOverlap = overlap(group.audienceSegments, googleDisplayAudienceListOwner(index + 1, 'audienceSegments'));
    if (groupOverlap !== null) return groupOverlap;
  }
  return null;
}

/** Whether a raw value asks for something: anything but absent, `null` or an empty list, a malformed value included. */
function carried(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

/** A raw value as an object to read lists from, or `null` when it is not one. */
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Whether a create body names an account-owned Display audience, on the terms campaign-service's create
 * gate counts one (`GoogleAdsMarketingOpsInputs`, #505): `audienceSegments`, `customAudiences`,
 * `customAffinities` or `excludedAudienceSegments`, in `displayAudiences` or on any `displayAdGroups`
 * entry, holding anything but absent, `null` or an empty list, whatever the channel. A malformed value
 * counts too, and so does a `displayAudiences` that is not an object, so neither can slip past the access
 * check to a shape refusal an unauthorised caller could probe with. `userInterests` are not counted.
 */
export function googleDisplayAudiencesCarried(campaign: unknown, groups: unknown): boolean {
  const gatedKeys = [...GOOGLE_DISPLAY_AUDIENCE_KINDS.filter((entry) => entry.gated).map((entry) => entry.kind), 'excludedAudienceSegments'];
  const gated = (lists: Record<string, unknown> | null): boolean => lists !== null && gatedKeys.some((key) => carried(lists[key]));
  if (carried(campaign) && record(campaign) === null) return true;
  if (gated(record(campaign))) return true;
  return Array.isArray(groups) && groups.some((group: unknown) => gated(record(group)));
}

/**
 * Why a create body's RAW Display audiences are refused for their shape, or `null`: `displayAudiences`
 * that is not an object, then any of its five lists, then each `displayAdGroups` entry's four, that is not
 * a list of strings (campaign-service's decode into `[]string` refuses it). Then a group's own
 * `excludedAudienceSegments`, which this application does not send: refused by name rather than dropped,
 * since the campaign-level exclusions cover every group. Absent, `null` and an empty list ask for nothing, as
 * the cutover-only create fields treat them (`GOOGLE_CUTOVER_ONLY_CREATE_FIELDS`). The BFF runs it
 * right after the access check, because the normalizer drops what it cannot read.
 */
export function googleDisplayAudiencesTypeRefusal(campaign: unknown, groups: unknown): string | null {
  if (carried(campaign)) {
    const lists = record(campaign);
    if (lists === null) return 'Display audiences must be an object of audience lists.';
    for (const { kind } of GOOGLE_DISPLAY_AUDIENCE_KINDS) {
      if (!stringList(lists[kind])) return `${googleDisplayAudienceListOwner(null, kind)} must be a list of Google Ads resource names.`;
    }
    if (!stringList(lists['excludedAudienceSegments'])) return `${EXCLUDED_OWNER} must be a list of Google Ads resource names.`;
  }
  if (!Array.isArray(groups)) return null;
  for (const [index, group] of groups.entries()) {
    const lists = record(group);
    if (lists === null) continue;
    for (const { kind } of GOOGLE_DISPLAY_AUDIENCE_KINDS) {
      if (!stringList(lists[kind])) return `${googleDisplayAudienceListOwner(index + 1, kind)} must be a list of Google Ads resource names.`;
    }
    if (carried(lists['excludedAudienceSegments'])) {
      return `Display ad group ${index + 1} excludes user lists of its own, which this application does not send. Exclude them for the whole campaign instead, which covers every ad group.`;
    }
  }
  return null;
}
