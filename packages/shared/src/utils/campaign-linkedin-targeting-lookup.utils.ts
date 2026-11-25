// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_TARGETING_FACETS, LINKEDIN_TARGETING_SEARCH_FACETS } from '../constants/campaign.constants';
import type { LinkedInAudienceSegment, LinkedInTargetingEntity, LinkedInTargetingSearchFacet } from '../interfaces/campaign.interface';

/**
 * The LinkedIn targeting lookups (#5764 rows 8–11): which facet the BFF searches through campaign-service's targeting
 * typeahead, and which typeahead and audience answers the Implement tab may offer as `linkedInConfig.targeting` values.
 * An answer `linkedInTargetingRefusal` would refuse is dropped rather than offered.
 */

const SEGMENT_FACETS: readonly LinkedInAudienceSegment['facet'][] = ['audienceMatchingSegments', 'dynamicSegments'];

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Whether `raw` is a facet the targeting search answers. */
export function isLinkedInTargetingSearchFacet(raw: unknown): raw is LinkedInTargetingSearchFacet {
  return typeof raw === 'string' && (LINKEDIN_TARGETING_SEARCH_FACETS as readonly string[]).includes(raw);
}

/** `name` trimmed, or `urn` when it is not text or is blank. */
function label(name: unknown, urn: string): string {
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : urn;
}

/**
 * The values a typeahead answer for `facet` may offer: entities whose URN that facet accepts in `targeting`, each once,
 * in LinkedIn's order, named by name (or by the URN when the name is blank).
 */
export function linkedInTargetingSearchEntities(facet: LinkedInTargetingSearchFacet, entities: unknown): LinkedInTargetingEntity[] {
  if (!Array.isArray(entities)) return [];
  const pattern = LINKEDIN_TARGETING_FACETS[facet].pattern;
  const seen = new Set<string>();
  const out: LinkedInTargetingEntity[] = [];
  for (const entity of entities as unknown[]) {
    const record = plainRecord(entity);
    const urn = record?.['urn'];
    if (typeof urn !== 'string' || !pattern?.test(urn) || seen.has(urn)) continue;
    seen.add(urn);
    out.push({ urn, name: label(record?.['name'], urn) });
  }
  return out;
}

/**
 * The ad segments an audience read may offer: those campaign-service names a targeting facet for (it names none for a
 * type `targeting` cannot take) whose URN that facet accepts, each once, in campaign-service's order (by name).
 */
export function linkedInAudienceSegments(audiences: unknown): LinkedInAudienceSegment[] {
  if (!Array.isArray(audiences)) return [];
  const seen = new Set<string>();
  const out: LinkedInAudienceSegment[] = [];
  for (const item of audiences as unknown[]) {
    const record = plainRecord(item);
    const urn = record?.['urn'];
    const facet = SEGMENT_FACETS.find((known) => known === record?.['facet']);
    if (!record || !facet || typeof urn !== 'string' || !LINKEDIN_TARGETING_FACETS[facet].pattern?.test(urn) || seen.has(urn)) continue;
    seen.add(urn);
    const count = record['approximate_member_count'];
    out.push({
      urn,
      name: label(record['name'], urn),
      facet,
      type: typeof record['type'] === 'string' ? record['type'] : '',
      approximateMemberCount: typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null,
    });
  }
  return out;
}
