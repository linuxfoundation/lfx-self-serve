// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignServiceHubSpotCampaigns } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { scoreCampaignName, toUtmCreateResult, toUtmLookupResult } from './campaign-utm-mapper';

// capped defaults to false so existing cases read as complete searches; the capped-specific
// tests below pass it explicitly.
const payload = (...campaigns: { id: string; name: string; utm?: string }[]): CampaignServiceHubSpotCampaigns => ({ campaigns, capped: false });
const cappedPayload = (...campaigns: { id: string; name: string; utm?: string }[]): CampaignServiceHubSpotCampaigns => ({ campaigns, capped: true });

describe('toUtmLookupResult', () => {
  it('picks the exact-name match as best', () => {
    const res = toUtmLookupResult(
      payload({ id: '1', name: 'KubeCon EU 2026 wrap', utm: 'wrap' }, { id: '2', name: 'KubeCon NA 2026', utm: 'kubecon-na-2026' }),
      'KubeCon NA 2026'
    );

    expect(res.found).toBe(true);
    expect(res.campaign_name).toBe('KubeCon NA 2026');
    expect(res.hs_utm).toBe('kubecon-na-2026');
  });

  /**
   * `found` tracks whether anything SCORED, not whether upstream returned rows.
   *
   * The upstream search is fuzzy, so it can return campaigns sharing only a stray token with the
   * query. Reporting those as found would tell a caller a campaign exists for their event when
   * none does — and the caller acts on `found: false` by offering to create one.
   */
  it('reports not-found when upstream returned rows but none scored', () => {
    const res = toUtmLookupResult(payload({ id: '1', name: 'Totally Unrelated', utm: 'x' }), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.hs_utm).toBeNull();
    expect(res.all_matches).toEqual([]);
  });

  it('reports not-found for an empty upstream answer', () => {
    expect(toUtmLookupResult(payload(), 'KubeCon').found).toBe(false);
  });

  /**
   * THE DELIBERATE BEHAVIOUR CHANGE. The legacy path fabricated `${id}-${name}` when HubSpot had
   * no token, so a tokenless campaign looked tokenised — and a link tagged with that invented
   * value attributes traffic to a campaign HubSpot cannot report on, because HubSpot never knew
   * the token.
   *
   * A missing token is now null, which the UI contract already models.
   */
  it('reports a missing token as null rather than fabricating one', () => {
    const res = toUtmLookupResult(payload({ id: '112233', name: 'KubeCon NA 2026' }), 'KubeCon NA 2026');

    expect(res.found).toBe(true);
    expect(res.campaign_name).toBe('KubeCon NA 2026');
    expect(res.hs_utm).toBeNull();
    // Specifically NOT the legacy fabrication.
    expect(res.hs_utm).not.toBe('112233-KubeCon NA 2026');
  });

  /**
   * `all_matches` declares `hs_utm` as a non-nullable string, so a tokenless campaign cannot be
   * represented there without inventing the value. It is omitted from that list — but the BEST
   * match still reports its own null token through the top-level `hs_utm`, so a tokenless winner
   * is visible rather than silently dropped.
   */
  it('omits tokenless campaigns from all_matches while keeping the best match visible', () => {
    const res = toUtmLookupResult(
      payload({ id: '1', name: 'KubeCon NA 2026' }, { id: '2', name: 'KubeCon NA 2026 sponsors', utm: 'sponsors' }),
      'KubeCon NA 2026'
    );

    expect(res.campaign_name).toBe('KubeCon NA 2026');
    expect(res.hs_utm).toBeNull();
    expect(res.all_matches).toEqual([{ name: 'KubeCon NA 2026 sponsors', hs_utm: 'sponsors' }]);
  });

  /**
   * Upstream order is HubSpot's OBJECT-CREATION order, not relevance — the search is token-based
   * and carries no ranking. Equal scores must still preserve it: re-ordering would invent a
   * ranking neither layer has, and this layer knows no reason to prefer either row.
   */
  it('preserves upstream order within an equal score band', () => {
    const res = toUtmLookupResult(payload({ id: '1', name: 'KubeCon alpha', utm: 'a' }, { id: '2', name: 'KubeCon beta', utm: 'b' }), 'KubeCon');

    expect(res.all_matches.map((m) => m.hs_utm)).toEqual(['a', 'b']);
  });
});

describe('toUtmCreateResult', () => {
  it('reports the assigned token', () => {
    expect(toUtmCreateResult({ id: '99', name: 'KubeCon NA 2027', utm: 'assigned' })).toEqual({
      created: true,
      hs_utm: 'assigned',
      campaign_name: 'KubeCon NA 2027',
    });
  });

  // HubSpot assigns the token, but not necessarily synchronously. A created campaign with no
  // token yet is still created — reporting created:false would tell the caller to retry a write
  // that already happened, into an LF-global namespace.
  it('reports created even when no token came back', () => {
    const res = toUtmCreateResult({ id: '99', name: 'Tokenless' });

    expect(res.created).toBe(true);
    expect(res.hs_utm).toBeNull();
  });
});

describe('toUtmLookupResult capped', () => {
  it('refuses to auto-apply from a capped search, even on an exact match', () => {
    // A capped set is incomplete by definition, so an equal-or-better campaign may sit outside
    // it. The planning tab applies a `found` token immediately and only consults `inconclusive`
    // on the not-found path, so returning found:true here would silently pick a possibly-worse
    // match. The candidates still travel; the operator picks. Same rule as the legacy path.
    const res = toUtmLookupResult(cappedPayload({ id: '1', name: 'KubeCon NA 2026', utm: 'kubecon-na-2026' }), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.hs_utm).toBeNull();
    expect(res.capped).toBe(true);
    expect(res.inconclusive).toBe(true);
    // The match is still offered for a human to choose.
    expect(res.all_matches.map((m) => m.hs_utm)).toContain('kubecon-na-2026');
  });

  it('reports a scored-out but non-empty result as inconclusive WITHOUT claiming truncation', () => {
    // Upstream's fuzzy search matched these rows; only the LOCAL scoring rejected them. The
    // caller acts on not-found by creating a campaign in a shared namespace, and one of these
    // rows may be exactly the campaign that create would duplicate -- so the result is
    // inconclusive. But HubSpot returned everything it matched, so `capped` must stay false:
    // the UI would otherwise state that HubSpot truncated a result it did not truncate, and
    // send the operator to narrow a term when the remedy is to check the name.
    const res = toUtmLookupResult(payload({ id: '1', name: 'Totally Unrelated Thing' }), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(res.capped).toBe(false);
  });

  it('reports a genuinely empty, complete search as conclusive', () => {
    // The one case where offering the create is legitimate: nothing matched, and nothing hidden.
    const res = toUtmLookupResult(payload(), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.capped).toBe(false);
    expect(res.inconclusive).toBe(false);
  });

  it('scores a blank name at zero, however it is spelled', () => {
    // Asserted on the SCORER directly, now that it is shared. Going through toUtmLookupResult
    // no longer isolates this: the unambiguous-winner check refuses a blank match too, so the
    // outer assertion passes with the guard removed and proves nothing. Both call sites depend
    // on this — every string contains '', so an unguarded containment test scores a blank name
    // 1 and beats a genuinely unrelated campaign at 0.
    expect(scoreCampaignName('', 'KubeCon NA 2026')).toBe(0);
    expect(scoreCampaignName('   ', 'KubeCon NA 2026')).toBe(0);
    // A real name still scores normally.
    expect(scoreCampaignName('KubeCon NA 2026', 'KubeCon NA 2026')).toBeGreaterThan(0);
  });

  it('never lets a blank-named campaign win the match', () => {
    // Every string contains '', so an unguarded `queryLower.includes(nameLower)` scores a
    // blank name 1 -- ahead of a genuinely unrelated named campaign, which scores 0. The
    // winner's UTM is applied to this event, so an unnamed row would attribute this event's
    // paid traffic to a campaign nobody named. The name is legitimately empty on a
    // campaign-service hit, so this is reachable rather than defensive.
    const res = toUtmLookupResult(
      payload({ id: 'blank', name: '', utm: 'wrong-token' }, { id: 'real', name: 'Cloud Native Rejekts', utm: 'rejekts-token' }),
      'KubeCon NA 2026'
    );

    // The blank row must not supply the token. Nothing else matches either, so this is
    // correctly a no-match: found stays false rather than naming the unnamed campaign.
    expect(res.hs_utm).not.toBe('wrong-token');
    expect(res.found).toBe(false);
  });

  it('refuses to auto-apply when two candidates tie', () => {
    // "KubeCon Europe 2026" and "KubeCon China 2026" both score 1 against "KubeCon NA 2026" —
    // one shared word each. scored[0] would be decided by HubSpot's OBJECT-CREATION order, which
    // carries no relevance information, so applying it silently puts another campaign's token
    // into this event's links. The links work, so the misattribution is invisible.
    const res = toUtmLookupResult(
      payload({ id: 'eu', name: 'KubeCon Europe 2026', utm: 'eu-token' }, { id: 'cn', name: 'KubeCon China 2026', utm: 'cn-token' }),
      'KubeCon NA 2026'
    );

    expect(res.found).toBe(false);
    expect(res.hs_utm).toBeNull();
    // The candidates survive: the operator picks, rather than the sort picking for them.
    expect(res.all_matches.map((m) => m.hs_utm).sort()).toEqual(['cn-token', 'eu-token']);
    // Real candidates exist, so a create offer must not read as a clean "nothing matched".
    expect(res.inconclusive).toBe(true);
  });

  it('refuses to auto-apply a lone weak match', () => {
    // One shared word and nothing else is still a guess, even unopposed.
    const res = toUtmLookupResult(payload({ id: 'eu', name: 'KubeCon Europe 2026', utm: 'eu-token' }), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.all_matches).toHaveLength(1);
  });

  it('refuses to auto-apply a generic CONTAINED name, whose two points are one piece of evidence', () => {
    // "KubeCon" scores 2 against "KubeCon NA 2026" -- one point for containment, one for a shared
    // word -- and with no runner-up that cleared the old score>=2 gate. But those are the SAME
    // evidence counted twice: any contained name necessarily shares a word with the string
    // containing it. So a generic PARENT campaign's token was applied silently to a specific
    // event's links, and a misattributed token is invisible because the links still work.
    const res = toUtmLookupResult(payload({ id: 'generic', name: 'KubeCon', utm: 'generic-token' }), 'KubeCon NA 2026');

    expect(res.found, 'a generic contained name was auto-applied').toBe(false);
    expect(res.hs_utm).toBeNull();
    // Still OFFERED -- the operator picks it if it really is the right campaign.
    expect(res.all_matches).toEqual([{ name: 'KubeCon', hs_utm: 'generic-token' }]);
  });

  it('ranks a whitespace variant as high as the exact spelling it normalises to', () => {
    // The GATE normalised whitespace but the SCORE did not, so "KubeCon  NA 2026" (double space)
    // scored 1 while normalising to an exact match -- and because auto-apply requires the winner
    // to outscore the runner-up, the one candidate confident enough to apply could rank BELOW
    // weaker ones and be refused. Two functions deciding the same question must agree.
    expect(scoreCampaignName('KubeCon  NA 2026', 'KubeCon NA 2026')).toBe(scoreCampaignName('KubeCon NA 2026', 'KubeCon NA 2026'));
  });

  it('auto-applies an exact match despite case and whitespace differences', () => {
    // Normalised, not literal: an operator pasting a differently-spaced name should not lose the
    // one-click path, since neither case nor run-length distinguishes two real campaigns.
    const res = toUtmLookupResult(payload({ id: 'na', name: 'kubecon  na 2026', utm: 'na-token' }), 'KubeCon NA 2026');

    expect(res.found).toBe(true);
    expect(res.hs_utm).toBe('na-token');
  });

  it('still auto-applies an unambiguous winner', () => {
    // The common case must stay one click: an exact name beats a same-token rival outright.
    const res = toUtmLookupResult(
      payload({ id: 'eu', name: 'KubeCon Europe 2026', utm: 'eu-token' }, { id: 'na', name: 'KubeCon NA 2026', utm: 'na-token' }),
      'KubeCon NA 2026'
    );

    expect(res.found).toBe(true);
    expect(res.hs_utm).toBe('na-token');
  });
});
