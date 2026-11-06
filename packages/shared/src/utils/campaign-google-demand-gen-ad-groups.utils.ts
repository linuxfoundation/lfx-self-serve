// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES,
  GOOGLE_DEMAND_GEN_AD_GROUP_NAME_SUFFIX,
  GOOGLE_DEMAND_GEN_VIDEO_AD_NAME_SUFFIX,
  GOOGLE_DEMAND_GEN_MAX_AD_GROUPS,
  googleAdsTrimSpace,
  googleAdsWellFormed,
  isGoSpaceCode,
} from '../constants/campaign.constants';
import { googleDemandGenVideoCreativeRefusal } from './campaign-google-demand-gen-video.utils';

/**
 * Named Demand Gen ad groups (#5226): the refusals campaign-service makes on `demandGenAdGroups` before
 * the budget mutate (`validateDemandGenAdGroups` in `internal/platform/googleads/demandgen_adgroups.go`).
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the
 * create with the same sentence. A refusal names a group by its position, never by its text, as the
 * video ad's judge does: the BFF logs the refusal, and a name is free text.
 */

/** Whether a code point is one Go's `unicode.IsControl` matches: C0, DEL and C1. */
function isGoControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * An ad group name as campaign-service writes it into the composed name (`sanitizeNamePart` in
 * `campaign.go`): decoded as Go's JSON decoder decodes it, `|` and every control character made a
 * space, every run of whitespace collapsed to one space, and the ends trimmed.
 */
export function googleAdGroupNamePart(name: string): string {
  let out = '';
  let gap = false;
  for (const ch of googleAdsWellFormed(name)) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '|' || isGoControl(code) || (ch.length === 1 && isGoSpaceCode(code))) {
      gap = out !== '';
      continue;
    }
    if (gap) out += ' ';
    gap = false;
    out += ch;
  }
  return out;
}

/**
 * The key two ad group names are compared under: Go's simple case folding (`textfold.Key`, which
 * campaign-service's `adGroupNameKey` uses), approximated one code point at a time. A code point maps
 * to the lower case of its upper case when each is a single code point, so `K`, `k` and the Kelvin
 * sign, or `ς`, `σ` and `Σ`, share a key. Dotted `İ` and dotless `ı` fold with nothing in Go and are
 * kept as they are. The approximation can differ from Go only on a few code points whose upper case
 * is several code points (such as `ΐ`), where it calls two names different that Go calls the same.
 */
export function googleAdGroupNameKey(name: string): string {
  let key = '';
  for (const ch of name) {
    if (ch === '\u0130' || ch === '\u0131') {
      key += ch;
      continue;
    }
    const upper = ch.toUpperCase();
    const base = [...upper].length === 1 ? upper : ch;
    const lower = base.toLowerCase();
    key += [...lower].length === 1 ? lower : base;
  }
  return key;
}

/** A named Demand Gen ad group's full name in Google Ads: `<event name> - Display | <its name>`. */
export function googleDemandGenAdGroupName(eventName: string, name: string): string {
  return `${googleAdsTrimSpace(googleAdsWellFormed(eventName))}${GOOGLE_DEMAND_GEN_AD_GROUP_NAME_SUFFIX} | ${googleAdGroupNamePart(name)}`;
}

/** Whether a creative object holds anything at all; `null`, a non-object and `{}` hold nothing. */
function present(creative: unknown): boolean {
  return creative !== null && typeof creative === 'object' && Object.keys(creative).length > 0;
}

/**
 * Why campaign-service would refuse this `demandGenAdGroups` list, or `null`, in its order: the count,
 * then each group's name (blank, a full name over Google's 255 characters, a repeat ignoring case), then
 * its ad (both formats, neither, or one that fails its own rules), then a video ad's own name
 * (`validateDemandGenVideoAdName`: the full name plus " - Video ad", also held to 255).
 *
 * `eventName` is the event name the request carries, which campaign-service composes each full name
 * from. The video ad is judged by `googleDemandGenVideoCreativeRefusal`. The image ad is judged by
 * `imageCreativeRefusal` when the caller passes one: the Implement tab does, with the minimums it
 * already holds a single image ad to; the BFF does not, as it does not judge the single image ad.
 *
 * The campaign-level refusal (a list beside `demandGenCreative` or `demandGenVideoCreative`) is the
 * caller's: only it knows what else the request carries.
 */
export function googleDemandGenAdGroupsRefusal(
  eventName: string,
  groups: unknown,
  imageCreativeRefusal: (creative: unknown) => string | null = () => null
): string | null {
  if (!Array.isArray(groups)) return 'The Demand Gen ad groups must be a list.';
  if (groups.length > GOOGLE_DEMAND_GEN_MAX_AD_GROUPS) {
    return `A Demand Gen campaign takes at most ${GOOGLE_DEMAND_GEN_MAX_AD_GROUPS} ad groups, and ${groups.length} are set. Remove ${groups.length - GOOGLE_DEMAND_GEN_MAX_AD_GROUPS} and create again.`;
  }
  const seen = new Map<string, number>();
  for (const [index, entry] of groups.entries()) {
    const position = index + 1;
    const group: Record<string, unknown> = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const label = typeof group['name'] === 'string' ? googleAdGroupNamePart(group['name']) : '';
    if (label === '') return `Demand Gen ad group ${position} needs a name. Each ad group needs its own name.`;
    const name = googleDemandGenAdGroupName(eventName, label);
    const length = [...name].length;
    if (length > GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES) {
      return `Demand Gen ad group ${position}'s full name in Google Ads, the event name then " - Display | " and its name, is ${length} characters, over Google's limit of ${GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES}. Shorten its name or the event name.`;
    }
    const key = googleAdGroupNameKey(name);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      return `Demand Gen ad group ${position} has the same name as ad group ${earlier}; Google Ads compares ad group names ignoring case. Rename one and create again.`;
    }
    seen.set(key, position);

    const image = present(group['creative']);
    const video = present(group['videoCreative']);
    if (image && video) {
      return `Demand Gen ad group ${position} has an image ad and a video ad; an ad group takes one. Clear one of them and create again.`;
    }
    if (!image && !video) {
      return `Demand Gen ad group ${position} has no ad. Fill in its image ad or its video ad, because an ad group with no ad cannot serve.`;
    }
    const refusal = video ? googleDemandGenVideoCreativeRefusal(group['videoCreative']) : imageCreativeRefusal(group['creative']);
    if (refusal !== null) return `Demand Gen ad group ${position}: ${refusal}`;
    if (video) {
      const adLength = [...`${name}${GOOGLE_DEMAND_GEN_VIDEO_AD_NAME_SUFFIX}`].length;
      if (adLength > GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES) {
        return `Demand Gen ad group ${position}'s video ad is named after the ad group, then "${GOOGLE_DEMAND_GEN_VIDEO_AD_NAME_SUFFIX}", which makes ${adLength} characters, over Google's limit of ${GOOGLE_ADS_MAX_AD_GROUP_NAME_RUNES}. Shorten its name or the event name.`;
      }
    }
  }
  return null;
}
