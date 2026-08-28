// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignServiceHubSpotCampaign,
  CampaignServiceHubSpotCampaigns,
  HubSpotUtmCreateResult,
  HubSpotUtmLookupResult,
} from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// campaign-service → UI conversion for the HubSpot UTM lookup
//
// Upstream returns every match in HubSpot's own relevance order and leaves the choosing to the
// caller. The UI contract predates that: it wants a single best match plus the rest. So the
// scoring lives here, ported from the legacy path so the ordering a user sees does not change
// under them mid-cutover.
//
// ONE BEHAVIOUR DOES CHANGE, deliberately — see utmTokenOf.
// ---------------------------------------------------------------------------

/**
 * Score a candidate name against the query, exactly as the legacy path did.
 *
 * Three additive signals: an exact match, a containment either way, and a shared word longer
 * than three characters. Ported verbatim rather than improved: changing the ranking during a
 * backend cutover would make a behaviour change look like a backend bug, and this ordering is
 * what users have been choosing from.
 */
function score(name: string, query: string): number {
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();
  return (
    (nameLower === queryLower ? 1 : 0) +
    (queryLower.includes(nameLower) || nameLower.includes(queryLower) ? 1 : 0) +
    (queryLower.split(' ').filter((w) => w.length > 3 && nameLower.includes(w)).length > 0 ? 1 : 0)
  );
}

/**
 * The campaign's real utm token, or null.
 *
 * THIS IS THE ONE DELIBERATE BEHAVIOUR CHANGE in the cutover. The legacy path fabricated a token
 * as `${campaignId}-${name}` whenever HubSpot had none, so a campaign with no configured token
 * still looked tokenised — and links tagged with that invented value attribute traffic to a
 * campaign HubSpot cannot report on, because HubSpot never knew that token.
 *
 * A missing token is now reported as missing. The UI already models it: `hs_utm` is
 * `string | null`, and null is what "this campaign has no token" was always supposed to mean.
 */
function utmTokenOf(c: CampaignServiceHubSpotCampaign): string | null {
  return c.utm && c.utm !== '' ? c.utm : null;
}

/**
 * Convert campaign-service's match list into the UI's lookup result.
 *
 * `found` is true when at least one candidate SCORED, not merely when the array was non-empty.
 * Upstream's search is fuzzy, so it can return rows sharing only a stray token with the query;
 * the legacy path filtered those out and reported not-found, and a caller offering "create this
 * campaign" needs that same answer.
 *
 * `all_matches` carries only campaigns that HAVE a token, because its declared element type is
 * `{ name, hs_utm }` with a non-nullable string — a tokenless campaign cannot be represented in
 * it without inventing the value this conversion exists to stop inventing. The best match still
 * reports its own null token through `hs_utm`, so a tokenless winner is visible rather than
 * silently dropped.
 */
export function toUtmLookupResult(payload: CampaignServiceHubSpotCampaigns, query: string): HubSpotUtmLookupResult {
  const scored = payload.campaigns
    .map((c) => ({ campaign: c, score: score(c.name, query) }))
    .filter((s) => s.score > 0)
    // Stable descending sort: upstream's relevance order is preserved within a score band, so
    // two equally-scored candidates stay in the order HubSpot ranked them.
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Nothing scored. Upstream's fuzzy search DID match these rows, so when it returned any, this
    // is a local scoring decision rather than an absence — reported as capped for the same reason
    // a truncated page is, since the caller acts on not-found by creating a campaign in the
    // LF-global namespace and one of those rows may be the campaign it would duplicate.
    return { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: payload.capped || payload.campaigns.length > 0 };
  }

  const best = scored[0].campaign;
  return {
    found: true,
    hs_utm: utmTokenOf(best),
    campaign_name: best.name,
    all_matches: scored
      .map((s) => ({ name: s.campaign.name, hs_utm: utmTokenOf(s.campaign) }))
      .filter((m): m is { name: string; hs_utm: string } => m.hs_utm !== null),
    // Carried through because it changes what a not-found answer MEANS downstream.
    capped: payload.capped,
  };
}

/**
 * Convert a created campaign into the UI's create result.
 *
 * `created` is true because reaching here means upstream returned a campaign — it refuses an
 * id-less response rather than reporting one as success, so there is no ambiguous middle state
 * to represent.
 */
export function toUtmCreateResult(campaign: CampaignServiceHubSpotCampaign): HubSpotUtmCreateResult {
  return {
    created: true,
    hs_utm: utmTokenOf(campaign),
    campaign_name: campaign.name,
  };
}
