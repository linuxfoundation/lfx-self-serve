// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_DEMAND_GEN_AUDIENCE_BESIDE_AD_GROUPS,
  GOOGLE_DEMAND_GEN_AUDIENCE_RESOURCE_PATTERN,
  googleAdsTrimSpace,
  isCanonicalGoogleAdsResourceId,
} from '../constants/campaign.constants';

/**
 * The Demand Gen audience (#5244): one Google Ads Audience per ad group, `demandGenAudience` for the
 * single ad group and `audience` on each named group. These are the refusals campaign-service makes on
 * them before the budget mutate (`validateDemandGenAudienceField` in `demandgen_targeting.go`, and the
 * opening check of `validateDemandGenAdGroups` in `demandgen_adgroups.go`).
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the
 * create with the same sentence. No refusal echoes the value.
 */

/**
 * Why campaign-service would refuse one Demand Gen audience, or `null` when it would take it. `owner`
 * names it in the sentence, as "The Demand Gen audience" or "The audience of Demand Gen ad group 2".
 * `accountId` is the customer the campaign is created in, when known; the BFF does not know it and
 * judges the shape only, and upstream judges the customer before anything is created.
 *
 * In upstream's order: absent or `''` asks for nothing; anything that is not a string is refused (Go
 * cannot decode it); a value that trims to nothing is refused as blank; then the shape, with a canonical
 * positive id; then the customer.
 */
export function googleDemandGenAudienceRefusal(owner: string, value: unknown, accountId = ''): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return `${owner} must be a Google Ads Audience resource name.`;
  const trimmed = googleAdsTrimSpace(value);
  if (trimmed === '') return `${owner} must not be blank. Remove it, or pick an Audience.`;
  const match = GOOGLE_DEMAND_GEN_AUDIENCE_RESOURCE_PATTERN.exec(trimmed);
  if (match === null || !isCanonicalGoogleAdsResourceId(match[2])) {
    return `${owner} is not a Google Ads Audience resource name (customers/<id>/audiences/<id>). Remove it and pick an Audience.`;
  }
  if (accountId !== '' && match[1] !== accountId) {
    return `${owner} belongs to another Google Ads account than the one this campaign is created in. Remove it and pick one of this account's Audiences.`;
  }
  return null;
}

/**
 * Why campaign-service would refuse the Demand Gen audiences of one create, or `null`: the single ad
 * group's beside named ad groups first, as `validateDemandGenAdGroups` opens with that, then the single
 * ad group's, then each group's in order. `groups` is `undefined` when the create is not split.
 *
 * Beside the groups, any value but `undefined`, `null` or `''` counts, whitespace included, as
 * upstream's `strings.TrimSpace(in.DemandGenAudience) != ""` would count a blank one only after
 * refusing it as blank on its own.
 */
export function googleDemandGenAudiencesRefusal(single: unknown, groups: readonly unknown[] | undefined, accountId = ''): string | null {
  const singleSet = single !== undefined && single !== null && single !== '';
  if (groups !== undefined && singleSet) return GOOGLE_DEMAND_GEN_AUDIENCE_BESIDE_AD_GROUPS;
  const singleRefusal = googleDemandGenAudienceRefusal('The Demand Gen audience', single, accountId);
  if (singleRefusal !== null) return singleRefusal;
  for (const [index, group] of (groups ?? []).entries()) {
    const audience: unknown = group !== null && typeof group === 'object' ? (group as Record<string, unknown>)['audience'] : undefined;
    const refusal = googleDemandGenAudienceRefusal(`The audience of Demand Gen ad group ${index + 1}`, audience, accountId);
    if (refusal !== null) return refusal;
  }
  return null;
}

/**
 * Whether a create body names any Demand Gen audience, on the terms campaign-service's create gate
 * counts one (`GoogleAdsDemandGenAudienceRequested`, #501): any value of `demandGenAudience`, or of any
 * `demandGenAdGroups` entry's `audience`, but `undefined`, `null` or `''`, whitespace included and
 * whatever the channel. A malformed value counts too, so it cannot slip past the access check to a
 * shape refusal an unauthorised caller could probe with.
 */
export function googleDemandGenAudienceCarried(single: unknown, groups: unknown): boolean {
  const set = (value: unknown): boolean => value !== undefined && value !== null && value !== '';
  if (set(single)) return true;
  if (!Array.isArray(groups)) return false;
  return groups.some((group: unknown) => group !== null && typeof group === 'object' && set((group as Record<string, unknown>)['audience']));
}

/**
 * Why a create body's RAW Demand Gen audiences are refused for their type, or `null`: the first of
 * `demandGenAudience`, then each `demandGenAdGroups` entry's `audience` in order, that is not a string
 * (campaign-service's JSON decode into a `string` field refuses it). Absent, `null` and an empty list ask
 * for nothing, as the cutover-only create fields treat them (`GOOGLE_CUTOVER_ONLY_CREATE_FIELDS`), and
 * every string passes, blank included: the normalizer omits a blank one, and a non-blank one is judged
 * for its shape, or refused while the cutover is dark, by the checks after this. The BFF runs it right
 * after the access check and before any check that depends on the cutover, because the normalizer drops
 * a non-string, so nothing after it would see one.
 */
export function googleDemandGenAudienceTypeRefusal(single: unknown, groups: unknown): string | null {
  const malformed = (value: unknown): boolean =>
    value !== undefined && value !== null && typeof value !== 'string' && !(Array.isArray(value) && value.length === 0);
  if (malformed(single)) return googleDemandGenAudienceRefusal('The Demand Gen audience', single);
  if (!Array.isArray(groups)) return null;
  for (const [index, group] of groups.entries()) {
    const audience: unknown = group !== null && typeof group === 'object' ? (group as Record<string, unknown>)['audience'] : undefined;
    if (malformed(audience)) return googleDemandGenAudienceRefusal(`The audience of Demand Gen ad group ${index + 1}`, audience);
  }
  return null;
}
