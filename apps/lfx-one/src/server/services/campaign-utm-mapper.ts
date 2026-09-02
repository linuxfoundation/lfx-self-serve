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
 * Score a candidate campaign name against the query. SHARED by both lookup paths.
 *
 * Three additive signals: an exact match, a containment either way, and a shared word longer
 * than three characters. The ranking is the legacy path's, deliberately — changing it during a
 * backend cutover would make a behaviour change look like a backend bug, and this ordering is
 * what users have been choosing from. It is no longer "ported verbatim": the blank-name guard
 * below was added because the two copies had diverged without it, and the legacy path is now
 * this function rather than a second copy of it.
 */
/**
 * Whether a candidate's evidence is strong enough to apply WITHOUT a human choosing it.
 *
 * A score of 2 was the gate, on the stated belief that it meant "two independent signals agree".
 * It does not. For the query "KubeCon NA 2026" the generic name "KubeCon" scores 2 — one point
 * for containment, one for a shared word — but those are the SAME evidence counted twice: any
 * contained name necessarily shares a word with the string containing it. With no runner-up, a
 * generic parent campaign's token was therefore applied silently to a specific event's links,
 * and a misattributed token is invisible because the links still work.
 *
 * So the gate asks what the evidence IS, not how much of it there is. An exact normalised match
 * is the one signal that cannot be produced by a substring coincidence. Everything else — a
 * contained name, a shared token — is offered to the operator instead, which is what the
 * candidate list exists for.
 *
 * Deliberately NOT folded into scoreCampaignName: that score also drives the ORDER users see,
 * and the ordering is the legacy path's on purpose. This narrows what may be applied unattended
 * without changing what gets ranked first.
 */
function isConfidentMatch(name: string, query: string): boolean {
  return normaliseForMatch(name) !== '' && normaliseForMatch(name) === normaliseForMatch(query);
}

/**
 * Case, surrounding space and internal run-length collapsed, so "KubeCon  NA 2026" and
 * "kubecon na 2026" are the same name. Nothing else is stripped: punctuation and word order
 * distinguish real campaigns from each other.
 */
function normaliseForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function scoreCampaignName(name: string, query: string): number {
  // NORMALISED, not merely lowercased, so the ranking agrees with isConfidentMatch(). Collapsing
  // case alone left "KubeCon  NA 2026" (double space) scoring 1 against "KubeCon NA 2026" while
  // normalising to an EXACT match: the auto-apply gate requires the winner to outscore the
  // runner-up, so the one candidate confident enough to apply could be ranked below weaker ones
  // and then refused. Two functions deciding the same question must agree on what a name is.
  const nameLower = normaliseForMatch(name);
  const queryLower = normaliseForMatch(query);
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
    .map((c) => ({ campaign: c, score: scoreCampaignName(c.name, query) }))
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
  // Strictly-higher-than-runner-up is still required: two candidates that BOTH match exactly are
  // ambiguous no matter how strong each one's evidence is, and picking either would be the
  // creation-order tie-break this guard exists to stop.
  const runnerUp = scored[1]?.score ?? 0;
  const unambiguous = isConfidentMatch(scored[0].campaign.name, query) && scored[0].score > runnerUp;

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
