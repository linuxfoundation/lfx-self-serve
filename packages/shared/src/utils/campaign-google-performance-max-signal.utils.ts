// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GOOGLE_DEMAND_GEN_AUDIENCE_RESOURCE_PATTERN, googleAdsTrimSpace, isCanonicalGoogleAdsResourceId } from '../constants/campaign.constants';

/**
 * The Performance Max audience signal (#5262): ONE existing Google Ads Audience on the asset group,
 * `performanceMaxAudienceSignal`. These are the refusals campaign-service makes on the value itself
 * before the budget mutate (`resolvePerformanceMaxAudience` in `pmax_signals.go`); the channel fence and
 * the asset group it needs are judged where the channel and the creative are known.
 *
 * One judge, shared by the Implement tab, which holds Create on it, and the BFF, which refuses the
 * create with the same sentence. No refusal echoes the value.
 */

/**
 * Why campaign-service would refuse an audience signal, or `null` when it would take it. `accountId` is
 * the customer the campaign is created in, when known; the BFF does not know it and judges the shape only,
 * and upstream judges the customer before anything is created.
 *
 * In upstream's order: absent or `''` asks for nothing; anything that is not a string is refused (Go
 * cannot decode it); a value that trims to nothing is refused as blank; a canonical positive audience id
 * is taken as an Audience in the campaign's own account; otherwise the value must be a
 * `customers/<id>/audiences/<id>` resource name with a canonical id, on the campaign's own customer.
 */
export function googlePerformanceMaxAudienceSignalRefusal(value: unknown, accountId = ''): string | null {
  if (value === undefined || value === null || value === '') return null;
  const owner = 'The Performance Max audience signal';
  if (typeof value !== 'string') return `${owner} must be a Google Ads Audience id or resource name.`;
  const trimmed = googleAdsTrimSpace(value);
  if (trimmed === '') return `${owner} must not be blank. Remove it, or pick an Audience.`;
  if (isCanonicalGoogleAdsResourceId(trimmed)) return null;
  const match = GOOGLE_DEMAND_GEN_AUDIENCE_RESOURCE_PATTERN.exec(trimmed);
  if (match === null || !isCanonicalGoogleAdsResourceId(match[2])) {
    return `${owner} is not a Google Ads Audience (an audience id, or customers/<id>/audiences/<id>). Remove it and pick an Audience.`;
  }
  if (accountId !== '' && match[1] !== accountId) {
    return `${owner} belongs to another Google Ads account than the one this campaign is created in. Remove it and pick one of this account's Audiences.`;
  }
  return null;
}

/**
 * Whether a create body names an audience signal, on the terms campaign-service's create gates count
 * one (`GoogleAdsMarketingOpsInputs` and the dispatcher's deployment gate, #501): any value but
 * `undefined`, `null` or `''`, whitespace included and whatever the channel. A malformed value counts
 * too, so it cannot slip past the access check to a shape refusal an unauthorised caller could probe with.
 */
export function googlePerformanceMaxAudienceSignalCarried(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}
