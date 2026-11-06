// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS,
  GOOGLE_ADS_MAX_CAMPAIGN_AUDIENCE_SEGMENT_ENTRIES,
  GOOGLE_USER_LIST_TYPE_LABELS,
} from '../constants/campaign.constants';
import type { GoogleAdsUserListOption, GoogleCampaignAudienceSegmentFault, GoogleCampaignAudienceSegmentsRefusal } from '../interfaces/campaign.interface';

/**
 * The Implement tab's audience segment picker (#5244) over the `googleAudienceSegments` list, which
 * stays the one thing the request is built from: one `customers/{id}/userLists/{id}` resource name
 * per entry, sent as the Search campaign's `campaignAudienceSegments`. Picking a list adds its
 * resource name exactly as typing it would, so a create sends the same request either way.
 */

/**
 * What the picker shows for one list: its name, its type in words, and a warning when Google reports
 * it cannot serve on Search (the only channel that takes audience segments here).
 */
export function googleUserListLabel(list: GoogleAdsUserListOption): string {
  const type = GOOGLE_USER_LIST_TYPE_LABELS[list.type] ?? sentenceCase(list.type);
  const words = type === '' ? '' : ` · ${type}`;
  return `${list.name}${words}${list.eligibleForSearch === false ? ' · not eligible for Search' : ''}`;
}

function sentenceCase(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words === '' ? '' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The listed user lists not already among `picked`, in list order: the rows the picker still offers. */
export function googleUnpickedUserLists<T extends GoogleAdsUserListOption>(lists: readonly T[], picked: readonly string[]): T[] {
  const taken = new Set(picked);
  return lists.filter((list) => !taken.has(list.resourceName));
}

/** The largest positive int64, the bound Go's `strconv.ParseInt(s, 10, 64)` parses up to. */
const MAX_INT64_DIGITS = '9223372036854775807';

/**
 * Why upstream would refuse one `campaignAudienceSegments` entry, already trimmed with Go's rules, or
 * `null` when it would not: `validateCampaignAudienceSegments`' per-entry branches in its order
 * (`internal/platform/googleads/search_campaign_audiences.go:88-104` at v1.0.33). The account match
 * (`:99`) is not judged: this client does not know the campaign's account.
 */
export function googleCampaignAudienceSegmentFault(trimmed: string): GoogleCampaignAudienceSegmentFault | null {
  if (trimmed === '') return 'blank';
  const parts = trimmed.split('/');
  const digits = (value: string): boolean => /^[0-9]+$/.test(value);
  if (parts.length !== 4 || parts[0] !== 'customers' || !digits(parts[1]) || !digits(parts[3])) return 'shape';
  if (parts[2] !== 'userLists') return 'notUserList';
  return googleAdsCanonicalPositiveId(parts[3]) ? null : 'id';
}

/**
 * Whether an all-digit id is the canonical base-10 spelling of a positive int64: no leading zero, not
 * zero, and within int64, the round trip upstream's `canonicalCampaignID` requires
 * (`internal/platform/googleads/campaign_lookup.go:143`).
 */
export function googleAdsCanonicalPositiveId(id: string): boolean {
  if (!/^[1-9][0-9]*$/.test(id)) return false;
  return id.length < MAX_INT64_DIGITS.length || (id.length === MAX_INT64_DIGITS.length && id <= MAX_INT64_DIGITS);
}

/**
 * Why upstream would refuse a `campaignAudienceSegments` list, each entry already trimmed with Go's
 * rules, once its channel and level checks pass, or `null`: the raw bound before any entry, the first
 * bad entry, then the cap on the DISTINCT lists after the dedupe
 * (`search_campaign_audiences.go:82-112`). An empty list asks for nothing.
 */
export function googleCampaignAudienceSegmentsRefusal(segments: readonly string[]): GoogleCampaignAudienceSegmentsRefusal | null {
  if (segments.length > GOOGLE_ADS_MAX_CAMPAIGN_AUDIENCE_SEGMENT_ENTRIES) return { rule: 'entries', count: segments.length };
  for (const [index, segment] of segments.entries()) {
    const fault = googleCampaignAudienceSegmentFault(segment);
    if (fault !== null) return { rule: 'entry', position: index + 1, fault };
  }
  const distinct = new Set(segments).size;
  return distinct > GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS ? { rule: 'lists', count: distinct } : null;
}
