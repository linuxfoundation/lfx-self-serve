// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_PIXEL_ID_PATTERN } from '../constants/campaign.constants';
import type { RedditPixelOption, RedditPixelsResult } from '../interfaces/campaign.interface';

/**
 * The Reddit pixel read (#6108 row 5): campaign-service's `GET /projects/{project_id}/reddit-ads/pixels`
 * (linuxfoundation/lfx-v2-campaign-service#549), served as `GET /api/campaigns/reddit/pixels` for a picker that fills the
 * existing `redditConfig.conversionPixelId`.
 */

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The query `GET /api/campaigns/reddit/pixels` takes: the project the create is for, as the custom-audience read takes it. */
export function redditPixelsQueryParams(projectSlug: string): { project: string } {
  return { project: projectSlug };
}

/**
 * campaign-service's pixel read, camel-cased for the picker, or `null` when it is unreadable (no `pixels` array): reading
 * that as an empty list would say the account has none. A row whose id campaign-service would not offer
 * (`REDDIT_PIXEL_ID_PATTERN`) is dropped rather than offered, and a repeated id is offered once. A name may be empty, as
 * Reddit allows; a blank or absent `business_id` is left out. `pixelCount` counts the pixels offered. Upstream order is
 * kept.
 */
export function redditPixelsFromPayload(payload: unknown): RedditPixelsResult | null {
  const body = plainRecord(payload);
  if (!body || !Array.isArray(body['pixels'])) return null;
  const seen = new Set<string>();
  const pixels: RedditPixelOption[] = [];
  for (const row of body['pixels'] as unknown[]) {
    const pixel = plainRecord(row);
    const id = pixel?.['id'];
    if (!pixel || typeof id !== 'string' || !REDDIT_PIXEL_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = typeof pixel['name'] === 'string' ? pixel['name'] : '';
    const businessId = pixel['business_id'];
    pixels.push(typeof businessId === 'string' && businessId.trim() !== '' ? { id, name, businessId } : { id, name });
  }
  return {
    accountId: typeof body['account_id'] === 'string' ? body['account_id'] : '',
    pixels,
    pixelCount: pixels.length,
    truncated: body['truncated'] === true,
  };
}
