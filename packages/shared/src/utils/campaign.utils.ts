// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MAX_SPONSORS, MAX_SPONSOR_NAME_LENGTH } from '../constants/campaign.constants';
import type { CampaignEventSponsor } from '../interfaces/campaign.interface';
import { sanitizeDisplayText } from './html-utils';
import { canonicalHttpUrl } from './url.utils';

/**
 * The sponsor list exactly as it will be staged: sanitized, bounded, and capped.
 *
 * ONE implementation because the preview and the wire must agree. The component rendered this
 * list and the controller rebuilt it, and the two drifted repeatedly -- blank names kept in one
 * and dropped in the other, the name cap applied in one only, the sanitizer added to one first.
 * Each drift showed the operator a sponsor the sent draft omits, or vice versa.
 *
 * @param sponsors - Raw entries from a scraped brief or a direct request; any shape
 * @param preSliceFactor - Entries to keep BEFORE the per-entry URL parse, as a multiple of
 *   MAX_SPONSORS. The server bounds untrusted input this way so a direct request cannot make it
 *   parse an unbounded list; the client's input is already bounded, so it passes 1.
 * @returns At most MAX_SPONSORS entries, each with a non-empty name and a usable http(s) logo
 */
export function normalizeSponsors(sponsors: unknown, preSliceFactor = 1): CampaignEventSponsor[] {
  if (!Array.isArray(sponsors)) return [];
  return sponsors
    .filter((sponsor): sponsor is { name: string; logoUrl?: unknown } => !!sponsor && typeof sponsor.name === 'string')
    .slice(0, MAX_SPONSORS * preSliceFactor)
    .map((sponsor) => ({
      name: sanitizeDisplayText([...sponsor.name.trim()].slice(0, MAX_SPONSOR_NAME_LENGTH).join('')),
      logoUrl: canonicalHttpUrl(sponsor.logoUrl),
    }))
    .filter((sponsor) => sponsor.name !== '' && sponsor.logoUrl !== '')
    .slice(0, MAX_SPONSORS);
}
