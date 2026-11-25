// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_GEO_SEARCH_BOUNDS, LINKEDIN_GEO_URN_PATTERN } from '../constants/campaign.constants';
import type { LinkedInGeoTarget } from '../interfaces/campaign.interface';

/**
 * The LinkedIn location search rules (#5545): what query the BFF forwards to campaign-service's targeting typeahead,
 * and which of its answers the Implement tab may offer as geo targets.
 */

/** Whether `text` holds a control character (C0, DEL or C1), which campaign-service refuses in a query. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Why `raw` cannot be searched, or `null`: not text, under 2 or over 100 characters once trimmed, or a control character. */
export function linkedInGeoSearchQueryRefusal(raw: unknown): string | null {
  if (typeof raw !== 'string') return 'Enter a location to search for.';
  const query = raw.trim();
  const { minQueryLength, maxQueryLength } = LINKEDIN_GEO_SEARCH_BOUNDS;
  if (Array.from(query).length < minQueryLength) return `Enter at least ${minQueryLength} characters to search.`;
  if (Array.from(query).length > maxQueryLength) return `Search with at most ${maxQueryLength} characters.`;
  if (hasControlCharacter(query)) return 'Search with letters, numbers and punctuation only.';
  return null;
}

/**
 * The locations a typeahead answer may offer: entities whose URN is a LinkedIn geo URN a create accepts, each once, in
 * LinkedIn's order, labelled by name (or by the URN when the name is blank).
 */
export function linkedInGeoSearchLocations(entities: unknown): LinkedInGeoTarget[] {
  if (!Array.isArray(entities)) return [];
  const seen = new Set<string>();
  const locations: LinkedInGeoTarget[] = [];
  for (const entity of entities as unknown[]) {
    if (entity === null || typeof entity !== 'object') continue;
    const { urn, name } = entity as { urn?: unknown; name?: unknown };
    if (typeof urn !== 'string' || !LINKEDIN_GEO_URN_PATTERN.test(urn) || seen.has(urn)) continue;
    seen.add(urn);
    locations.push({ urn, label: typeof name === 'string' && name.trim() !== '' ? name.trim() : urn });
  }
  return locations;
}
