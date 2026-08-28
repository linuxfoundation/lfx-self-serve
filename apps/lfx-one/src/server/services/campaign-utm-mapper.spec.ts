// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignServiceHubSpotCampaigns } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { toUtmCreateResult, toUtmLookupResult } from './campaign-utm-mapper';

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
   * Upstream returns matches in HubSpot's relevance order. Equal scores must preserve it —
   * re-ordering them would put a worse upstream match first for no reason this layer knows.
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
  it('carries capped through on a found result', () => {
    const res = toUtmLookupResult(cappedPayload({ id: '1', name: 'KubeCon NA 2026', utm: 'kubecon-na-2026' }), 'KubeCon NA 2026');

    expect(res.found).toBe(true);
    expect(res.capped).toBe(true);
  });

  it('reports a scored-out but non-empty result as inconclusive', () => {
    // Upstream's fuzzy search matched these rows; only the LOCAL scoring rejected them. The
    // caller acts on not-found by creating a campaign in the LF-global namespace, and one of
    // these rows may be exactly the campaign that create would duplicate.
    const res = toUtmLookupResult(payload({ id: '1', name: 'Totally Unrelated Thing' }), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.capped).toBe(true);
  });

  it('reports a genuinely empty, complete search as conclusive', () => {
    // The one case where offering the create is legitimate: nothing matched, and nothing hidden.
    const res = toUtmLookupResult(payload(), 'KubeCon NA 2026');

    expect(res.found).toBe(false);
    expect(res.capped).toBe(false);
  });
});
