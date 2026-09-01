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
// Upstream returns every match in the order HubSpot returned them — OBJECT-CREATION order, not
// relevance: campaign-service documents the search as token-based with no relevance sort, so
// position carries no ranking information. It leaves the choosing to the caller. The UI contract
// predates that: it wants a single best match plus the rest. So the scoring lives here, ported
// from the legacy path so the ordering a user sees does not change under them mid-cutover.
//
// TWO BEHAVIOURS DO CHANGE, deliberately:
//   - a missing token is reported as missing rather than fabricated — see utmTokenOf.
//   - a token is auto-applied only for an UNAMBIGUOUS winner. A tie, or a match too weak to
//     stand alone, returns the candidates for a human to pick instead of letting creation order
//     decide which campaign's UTM lands in an event's links.
// ---------------------------------------------------------------------------

/**
 * Score a candidate name against the query, exactly as the legacy path did.
 *
 * Three additive signals: an exact match, a containment either way, and a shared word longer
 * than three characters. Ported verbatim rather than improved: changing the ranking during a
 * backend cutover would make a behaviour change look like a backend bug, and this ordering is
 * what users have been choosing from.
 */
/**
 * The lowest score that may be applied without a human choosing it.
 *
 * score() adds three independent signals: exact name, containment either way, and a shared word
 * longer than three characters. A score of 1 is a SINGLE weak signal — "KubeCon Europe 2026"
 * earns it against "KubeCon NA 2026" purely by sharing one word — so requiring 2 means at least
 * two signals agree before a token is applied to an event without anyone looking at it.
 */
const MIN_CONFIDENT_SCORE = 2;

function score(name: string, query: string): number {
  const nameLower = name.toLowerCase();
  const queryLower = query.toLowerCase();
  // A blank name cannot match anything, and must be refused BEFORE the containment test:
  // every string contains '', so `queryLower.includes('')` is true and an unnamed campaign
  // scores 1 — beating a genuinely unrelated named campaign, which scores 0. The winner's UTM
  // is then applied to this event, attributing its traffic to a campaign nobody named. The
  // name is legitimately empty on a campaign-service hit, so this is reachable, not defensive.
  if (nameLower.trim() === '') {
    return 0;
  }
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
    // Stable descending sort. Within a score band this preserves the order upstream returned,
    // which is HubSpot's OBJECT-CREATION order — not a ranking. campaign-service documents that
    // the search is token-based and not relevance-sorted, so position inside a band carries no
    // information about which candidate is the better match.
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // Nothing scored. When upstream returned rows, its own fuzzy search DID match them and only
    // the LOCAL scorer rejected them — so absence is not established, and one of those rows may
    // be the campaign a create would duplicate. That makes the result INCONCLUSIVE, but it is
    // NOT truncation: reporting it as `capped` would have the UI tell the operator HubSpot
    // matched more than it returned, which is false, and would point them at narrowing a term
    // when the real remedy is to check the name.
    return {
      found: false,
      hs_utm: null,
      campaign_name: '',
      all_matches: [],
      capped: payload.capped,
      inconclusive: payload.capped || payload.campaigns.length > 0,
    };
  }

  // Auto-apply only an UNAMBIGUOUS winner. Applying scored[0] unconditionally silently put the
  // wrong campaign's token into generated links: for "KubeCon NA 2026", both "KubeCon Europe
  // 2026" and "KubeCon China 2026" score 1 and TIE, and the tie is broken by HubSpot's creation
  // order, which says nothing about relevance. A misattributed token is invisible — the links
  // work, and the traffic lands on another campaign's report.
  //
  // Unambiguous means the top score is strictly higher than the next one AND strong enough to be
  // more than a shared token: a lone weak match is still a guess, so it is offered rather than
  // applied. The candidates are returned either way, so the operator picks instead of the sort.
  const runnerUp = scored[1]?.score ?? 0;
  const unambiguous = scored[0].score >= MIN_CONFIDENT_SCORE && scored[0].score > runnerUp;

  const candidates = scored
    .map((s) => ({ name: s.campaign.name, hs_utm: utmTokenOf(s.campaign) }))
    .filter((m): m is { name: string; hs_utm: string } => m.hs_utm !== null);

  if (!unambiguous) {
    return {
      found: false,
      hs_utm: null,
      campaign_name: '',
      all_matches: candidates,
      capped: payload.capped,
      // Inconclusive: real candidates exist and one of them may be the campaign a create would
      // duplicate, so the create offer must not be presented as a clean "nothing matched".
      inconclusive: true,
    };
  }

  // A CAPPED search cannot auto-apply, even with an unambiguous local winner. The result set is
  // incomplete by definition, so an equal-or-better campaign may sit outside it — and the
  // planning tab applies a `found` token immediately, consulting `inconclusive` only on the
  // not-found path. This is the same rule the legacy proxy path follows; leaving it out here
  // meant the two producers disagreed about the same situation.
  if (payload.capped) {
    return {
      found: false,
      hs_utm: null,
      campaign_name: '',
      all_matches: candidates,
      capped: true,
      inconclusive: true,
    };
  }

  const best = scored[0].campaign;
  return {
    found: true,
    hs_utm: utmTokenOf(best),
    campaign_name: best.name,
    all_matches: candidates,
    // Carried through because it changes what a not-found answer MEANS downstream.
    capped: payload.capped,
    inconclusive: payload.capped,
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
