// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REDDIT_PIXEL_ID_PATTERN, REDDIT_PIXEL_PICKER_REASONS, REDDIT_PIXEL_PICKER_TRUNCATED } from '../constants/campaign.constants';
import type { RedditPixelOption, RedditPixelPickerState, RedditPixelPickerView, RedditPixelsResult } from '../interfaces/campaign.interface';

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

/**
 * Why the pixel list cannot be offered for a failed read with this HTTP status (0 when there was none): the 403 a caller
 * without `global_marketing_ops` gets, or a read that failed. Either way the typed-id box stays the way in.
 */
export function redditPixelPickerReason(status: number): string {
  return status === 403 ? REDDIT_PIXEL_PICKER_REASONS.restricted : REDDIT_PIXEL_PICKER_REASONS.failed;
}

/**
 * What the pixel picker shows for a read and the held pixel id: a select over the listed pixels (each `name (id)`, or the
 * id alone for an unnamed one) once there are any, keeping a held id the list does not hold as its own option; otherwise
 * the typed-id box, with why. Blank is always "use the connection's pixel".
 */
export function redditPixelPickerView(state: RedditPixelPickerState, heldId: string): RedditPixelPickerView {
  if (state.status === 'loading') return { mode: 'loading', choices: [], heldIdUnlisted: false, note: null };
  if (state.status !== 'loaded' || state.pixels.length === 0) {
    const note = state.status === 'loaded' ? REDDIT_PIXEL_PICKER_REASONS.empty : state.reason;
    return { mode: 'text', choices: [], heldIdUnlisted: false, note };
  }
  const held = heldId.trim();
  return {
    mode: 'select',
    choices: state.pixels.map((pixel) => ({ value: pixel.id, label: pixel.name.trim() === '' ? pixel.id : `${pixel.name} (${pixel.id})` })),
    heldIdUnlisted: held !== '' && !state.pixels.some((pixel) => pixel.id === held),
    note: state.truncated ? REDDIT_PIXEL_PICKER_TRUNCATED : null,
  };
}
