// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_DEMAND_GEN_VIDEO_CALLS_TO_ACTION,
  GOOGLE_DEMAND_GEN_VIDEO_CREATIVE_FIELD_SPECS,
  GOOGLE_DEMAND_GEN_VIDEO_MAX_VIDEOS,
  googleAdsEchoed,
  googleAdsToLower,
  googleAdsTrimSpace,
} from '../constants/campaign.constants';
import type { GoogleCreativeFieldSpec } from '../interfaces/campaign.interface';
import { googleAdsTextWeight } from './campaign-google-search-ads.utils';

/**
 * The Demand Gen video responsive ad (#460/#481): the refusals campaign-service makes on it before the
 * budget mutate (`validateDemandGenVideoSpec` and `validateYouTubeVideoIDs` in
 * `internal/platform/googleads`).
 *
 * One judge, shared by the Implement tab — which holds Create on it — and the BFF, which refuses the
 * create with the same sentence. It returns `null` when upstream would accept the ad, and is meant for
 * a creative that is present: an absent one is the "no ad" shell upstream accepts, and the caller
 * decides that before asking.
 */

/** A YouTube id's alphabet: the unreserved base64url characters (`isYouTubeIDRune`). */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Why upstream would refuse these YouTube video ids, or `null`. Each id is bare: a value carrying
 * `/`, `:` or `?` is a URL, which upstream refuses rather than guess which part is the id. Repeats
 * are refused as written (upstream keys them exactly, not case-folded), and there are 1 to
 * {@link GOOGLE_DEMAND_GEN_VIDEO_MAX_VIDEOS}.
 */
export function googleDemandGenVideoIdsRefusal(ids: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = googleAdsTrimSpace(raw);
    if (id === '') continue;
    if (id.includes('/') || id.includes(':') || id.includes('?')) {
      return `YouTube video ${googleAdsEchoed(id)} is a link, not a video ID. Enter the bare ID — the part after "v=" in a watch link — and create again.`;
    }
    if (!YOUTUBE_ID_PATTERN.test(id)) {
      return `YouTube video ${googleAdsEchoed(id)} is not a YouTube video ID: an ID has only letters, digits, "-" and "_". Correct it and create again.`;
    }
    if (seen.has(id)) {
      return `YouTube video ${googleAdsEchoed(id)} is listed more than once. Remove the repeat and create again.`;
    }
    seen.add(id);
  }
  if (seen.size === 0) return 'The Demand Gen video ad needs at least one YouTube video ID.';
  if (seen.size > GOOGLE_DEMAND_GEN_VIDEO_MAX_VIDEOS) {
    return `The Demand Gen video ad takes at most ${GOOGLE_DEMAND_GEN_VIDEO_MAX_VIDEOS} YouTube videos, and ${seen.size} are listed. Remove ${seen.size - GOOGLE_DEMAND_GEN_VIDEO_MAX_VIDEOS} and create again.`;
  }
  return null;
}

/**
 * Why upstream would refuse this Demand Gen video ad, or `null` — every rule `validateDemandGenVideoSpec`
 * applies, in its order: the videos, exactly one logo, the three copy lists (counts, display widths
 * with CJK counted double, and case-insensitive repeats), the business name, and the call to action.
 *
 * `creative` is the ad as the request carries it, so it is read defensively: a field that is not the
 * expected shape counts as empty, and the count it then fails names it.
 */
export function googleDemandGenVideoCreativeRefusal(creative: unknown): string | null {
  if (creative === null || typeof creative !== 'object' || Array.isArray(creative)) {
    return 'The Demand Gen video ad must be an object of video IDs, a logo and copy.';
  }
  const ad = creative as Record<string, unknown>;

  const videos = googleDemandGenVideoIdsRefusal(stringList(ad['youtubeVideoIds']));
  if (videos !== null) return videos;

  const logos = Array.isArray(ad['logoImages']) ? ad['logoImages'].length : 0;
  if (logos !== 1) {
    return `The Demand Gen video ad needs exactly one logo image, and ${logos} ${logos === 1 ? 'is' : 'are'} set. ${logos > 1 ? 'Remove the extra ones' : 'Add a square logo'} and create again.`;
  }

  // Widened to the interface: the `as const` catalogue gives each entry only the keys it sets.
  const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_DEMAND_GEN_VIDEO_CREATIVE_FIELD_SPECS;
  for (const control of ['headlines', 'longHeadlines', 'descriptions'] as const) {
    const field = fields.find((entry) => entry.control === control);
    if (field === undefined) continue;
    const refusal = copyListRefusal(field, stringList(ad[control]));
    if (refusal !== null) return refusal;
  }

  const name = typeof ad['businessName'] === 'string' ? googleAdsTrimSpace(ad['businessName']) : '';
  const nameField = fields.find((entry) => entry.control === 'businessName');
  if (name === '') return 'The Demand Gen video ad needs a business name.';
  if (nameField?.width !== undefined && googleAdsTextWeight(name) > nameField.width) {
    return `The Demand Gen video ad's business name (${googleAdsEchoed(name)}) is longer than the ${nameField.width} characters Google Ads allows; CJK and full-width characters count double. Shorten it and create again.`;
  }

  const cta = typeof ad['callToAction'] === 'string' ? googleAdsTrimSpace(ad['callToAction']) : '';
  if (cta !== '' && !GOOGLE_DEMAND_GEN_VIDEO_CALLS_TO_ACTION.some((option) => option.value === cta)) {
    const allowed = GOOGLE_DEMAND_GEN_VIDEO_CALLS_TO_ACTION.map((option) => option.label).join(', ');
    return `The Demand Gen video ad's call to action (${googleAdsEchoed(cta)}) is not one Google Ads takes for this ad. Choose ${allowed}, or none.`;
  }
  return null;
}

/** A list field's non-blank strings, trimmed as upstream trims them; anything else is empty. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => googleAdsTrimSpace(entry))
    .filter((entry) => entry !== '');
}

/** `validateCreativeText`'s rules for one copy list: the count, each line's display width, and repeats. */
function copyListRefusal(field: GoogleCreativeFieldSpec, lines: readonly string[]): string | null {
  const label = field.label.toLowerCase();
  if (field.max !== undefined && lines.length > field.max) {
    return `The Demand Gen video ad takes at most ${field.max} ${label}, and ${lines.length} are set. Remove ${lines.length - field.max} and create again.`;
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (field.width !== undefined && googleAdsTextWeight(line) > field.width) {
      return `A ${singular(label)} on the Demand Gen video ad (${googleAdsEchoed(line)}) is longer than the ${field.width} characters Google Ads allows; CJK and full-width characters count double. Shorten it and create again.`;
    }
    const key = googleAdsToLower(line);
    if (seen.has(key)) {
      return `A ${singular(label)} on the Demand Gen video ad (${googleAdsEchoed(line)}) is listed more than once; Google Ads compares them ignoring case. Remove the repeat and create again.`;
    }
    seen.add(key);
  }
  if (field.min !== undefined && lines.length < field.min) {
    return `The Demand Gen video ad needs at least ${field.min} ${field.min === 1 ? singular(label) : label}.`;
  }
  return null;
}

/** `headlines` → `headline`: the three list labels are regular plurals. */
function singular(label: string): string {
  return label.endsWith('s') ? label.slice(0, -1) : label;
}
