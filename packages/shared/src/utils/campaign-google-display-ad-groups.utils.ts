// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES, GOOGLE_DISPLAY_AD_GROUP_NAME_SUFFIX, GOOGLE_DISPLAY_MAX_AD_GROUPS } from '../constants/campaign.constants';
import { googleAdGroupNameKey, googleAdGroupNamePart } from './campaign-google-demand-gen-ad-groups.utils';

/**
 * Named Display ad groups (campaign-service v1.0.31, #475): the refusals campaign-service makes on
 * `displayAdGroups` before the budget mutate (`validateDisplayAdGroups` in
 * `internal/platform/googleads/display_adgroups.go`).
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the
 * create with the same sentence. A refusal names a group by its position, never by its text: the BFF
 * logs the refusal, and a name is free text.
 */

/**
 * A named Display ad group's full name in Google Ads: `<event name> - Display Network | <its name>`.
 * Upstream sanitizes the event name the same way as the group's name (`displayAdGroupName` in
 * `display_creative.go`, then `sanitizeNamePart`).
 */
export function googleDisplayAdGroupName(eventName: string, name: string): string {
  return `${googleAdGroupNamePart(eventName)}${GOOGLE_DISPLAY_AD_GROUP_NAME_SUFFIX} | ${googleAdGroupNamePart(name)}`;
}

/** Whether a creative object holds anything at all; `null`, a non-object and `{}` hold nothing. */
function present(creative: unknown): boolean {
  return creative !== null && typeof creative === 'object' && Object.keys(creative).length > 0;
}

/**
 * Why campaign-service would refuse this `displayAdGroups` list, or `null`, in its order: the count,
 * then each group's name (blank, a full name over Google's 255 characters
 * (`namedAdGroupNameTooLong`), a repeat ignoring case (`adGroupNameKey`)), then its responsive display
 * ad (none, or one that fails its own rules).
 *
 * `eventName` is the event name campaign-service composes each full name from: the stored brief's
 * (`decodeBriefFields`) where the caller knows it, as the BFF does, else the request's, as the
 * Implement tab passes. The ad is judged by `creativeRefusal` when the caller passes one: the Implement
 * tab does, with the minimums it already holds the single Display ad to; the BFF does not, as it does
 * not judge the single Display ad.
 *
 * The campaign-level refusal (a list beside `displayCreative`) is the caller's: only it knows what else
 * the request carries. A group's audience lists are not judged: this application does not send them.
 */
export function googleDisplayAdGroupsRefusal(
  eventName: string,
  groups: unknown,
  creativeRefusal: (creative: unknown) => string | null = () => null
): string | null {
  if (!Array.isArray(groups)) return 'The Display ad groups must be a list.';
  if (groups.length > GOOGLE_DISPLAY_MAX_AD_GROUPS) {
    return `A Display campaign takes at most ${GOOGLE_DISPLAY_MAX_AD_GROUPS} ad groups, and ${groups.length} are set. Remove ${groups.length - GOOGLE_DISPLAY_MAX_AD_GROUPS} and create again.`;
  }
  const seen = new Map<string, number>();
  for (const [index, entry] of groups.entries()) {
    const position = index + 1;
    const group: Record<string, unknown> = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const label = typeof group['name'] === 'string' ? googleAdGroupNamePart(group['name']) : '';
    if (label === '') return `Display ad group ${position} needs a name. Each ad group needs its own name.`;
    const name = googleDisplayAdGroupName(eventName, label);
    const length = [...name].length;
    if (length > GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES) {
      return `Display ad group ${position}'s full name in Google Ads, the event name then "${GOOGLE_DISPLAY_AD_GROUP_NAME_SUFFIX} | " and its name, is ${length} characters, over Google's limit of ${GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES}. Shorten its name or the event name.`;
    }
    const key = googleAdGroupNameKey(name);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      return `Display ad group ${position} has the same name as ad group ${earlier}; Google Ads compares ad group names ignoring case. Rename one and create again.`;
    }
    seen.set(key, position);

    if (!present(group['creative'])) {
      return `Display ad group ${position} has no ad. Fill in its responsive display ad, because an ad group with no ad cannot serve.`;
    }
    const refusal = creativeRefusal(group['creative']);
    if (refusal !== null) return `Display ad group ${position}: ${refusal}`;
  }
  return null;
}
