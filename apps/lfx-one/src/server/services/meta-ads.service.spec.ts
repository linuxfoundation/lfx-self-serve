// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config with Angular-free resolution, so the shared constants are re-exported through the
// mock from their real source module. The spec then exercises the REAL objective params, numeric
// pattern and geo normalisation rather than stand-ins that could drift from them.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/campaign.constants');
  return constants;
});
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { MetaCampaignCreateRequest } from '@lfx-one/shared/interfaces';

import { executeMetaCampaignCreation } from './meta-ads.service';

/** Every POST path the mock fetch was asked for, in call order. */
function postPaths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST').map((c) => String(c[0]));
}

function baseConfig(overrides: Partial<MetaCampaignCreateRequest> = {}): MetaCampaignCreateRequest {
  return {
    eventName: 'Open Source Summit',
    registrationUrl: 'https://events.linuxfoundation.org/oss/',
    budgetUsd: 500,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    geoTargets: ['US'],
    variants: [{ primaryText: 'Join us', headline: 'OSS 2026', description: 'Register now' }],
    ...overrides,
  } as MetaCampaignCreateRequest;
}

describe('executeMetaCampaignCreation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['META_ACCESS_TOKEN'] = 'test-token';
    let idCounter = 0;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: `id-${++idCounter}` }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('promoted-object validation ordering', () => {
    // The regression this pins is an ORDERING one, not an error-message one. A malformed pixel id
    // always threw; the defect was that it threw AFTER `POST /campaigns` had already created a
    // real, billable Meta campaign, orphaning it. Asserting only on the rejection would therefore
    // pass against the broken code — the load-bearing assertion is that NO campaign POST was ever
    // issued.
    it('issues no mutating POST when the pixel id is malformed', async () => {
      await expect(executeMetaCampaignCreation(undefined, baseConfig({ objective: 'conversions', pixelId: 'PIX9' }))).rejects.toThrow(
        /pixelId must be a numeric string/
      );

      expect(postPaths(fetchMock)).toEqual([]);
    });

    it('issues no mutating POST when a conversions campaign omits the pixel id', async () => {
      await expect(executeMetaCampaignCreation(undefined, baseConfig({ objective: 'conversions' }))).rejects.toThrow(/pixelId must be a non-empty string/);

      expect(postPaths(fetchMock)).toEqual([]);
    });

    it('creates the campaign and carries the validated pixel into the ad set when the id is well formed', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ objective: 'conversions', pixelId: ' 123456789012345 ' }));

      const paths = postPaths(fetchMock);
      expect(paths.some((p) => p.endsWith('/campaigns'))).toBe(true);

      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      expect(adSetCall).toBeDefined();
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      // Trimmed by the hoisted call and reused verbatim — proves the ad set consumes the SAME
      // value that was validated, rather than a second, independently built one.
      expect(adSetBody.promoted_object).toEqual({ pixel_id: '123456789012345', custom_event_type: 'PURCHASE' });
    });

    it('promotes the page id and still creates the campaign under a non-pixel objective', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ objective: 'traffic', pixelId: 'PIX9' }));

      // A malformed pixel is irrelevant under `traffic` — the hoist must not turn an ignored field
      // into a blocking one.
      expect(postPaths(fetchMock).some((p) => p.endsWith('/campaigns'))).toBe(true);
    });
  });

  describe('geo eligibility preflight', () => {
    // `IR` is an ASSIGNED ISO country, so the assignment check passes it — but Meta refuses to
    // target it. The legacy path filtered only SG/TW/KR, so it reached `geo_locations` and was
    // rejected at the AD SET, after the campaign POST. The Go client checks this before mutating;
    // mirroring it here means the same input cannot succeed on one path and fail on the other.
    it('issues no mutating POST when every supplied geo is ineligible', async () => {
      await expect(executeMetaCampaignCreation(undefined, baseConfig({ geoTargets: ['IR', 'KP'] }))).rejects.toThrow(/No usable geo targets/);

      expect(postPaths(fetchMock)).toEqual([]);
    });

    // REFUSES rather than falling back, matching the Go path. Falling back would spend the budget
    // on a country the operator did not ask for, after discarding every country they did.
    it('refuses an explicit list rather than silently defaulting to US', async () => {
      await expect(executeMetaCampaignCreation(undefined, baseConfig({ geoTargets: ['ZZ'] }))).rejects.toThrow(/refusing to silently fall back to US/);

      expect(postPaths(fetchMock)).toEqual([]);
    });

    // The fallback still applies to an EMPTY request — "the caller named no geo" is a different
    // question from "every geo the caller named was unusable", and only the first has a default.
    it('still defaults to US when no geo was supplied at all', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ geoTargets: [] }));

      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      expect(adSetBody.targeting.geo_locations.countries).toEqual(['US']);
    });

    // Mixed lists DROP the ineligible entries and proceed, rather than failing the whole create —
    // the guard must not over-broaden into refusing usable campaigns.
    it('drops ineligible entries from a mixed list and still creates', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ geoTargets: ['IR', 'JP'] }));

      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      expect(adSetBody.targeting.geo_locations.countries).toEqual(['JP']);
    });
  });

  describe('placement validation ordering', () => {
    // Same ORDERING defect as the promoted object above, and the same reason a rejection-only
    // assertion would not catch it: an all-off placement selection always threw, but it threw from
    // `buildPlacementTargeting` at the ad-set step — after `POST /campaigns` had created a
    // billable resource. The UI blocks an empty selection, but this service is reachable by any
    // caller of the create endpoint, so the form's guard is not the boundary.
    it('issues no mutating POST when every placement is disabled', async () => {
      const allOff = {
        facebookFeed: false,
        instagramFeed: false,
        stories: false,
        reels: false,
        audienceNetwork: false,
        messengerInbox: false,
      };

      await expect(executeMetaCampaignCreation(undefined, baseConfig({ placements: allOff }))).rejects.toThrow(/At least one placement must be enabled/);

      expect(postPaths(fetchMock)).toEqual([]);
    });

    it('creates the campaign and reuses the validated placement targeting in the ad set', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ placements: { reels: true } }));

      expect(postPaths(fetchMock).some((p) => p.endsWith('/campaigns'))).toBe(true);

      // Consumed verbatim by the ad set, proving the validation was HOISTED rather than duplicated
      // — a second, independently built value could diverge from the one that was checked.
      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      expect(adSetCall).toBeDefined();
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      expect(adSetBody.targeting.publisher_platforms).toContain('facebook');
      expect(adSetBody.targeting.facebook_positions).toContain('facebook_reels');
    });

    /**
     * Messenger Inbox was retired as a Meta placement in November 2025, so `messenger` /
     * `messenger_home` are invalid on v25.0 — they passed the non-empty check and then failed at
     * the AD SET, after the campaign POST had created a billable resource.
     *
     * The binding assertion is that NO mutating POST is issued, not merely that it rejected: the
     * broken version rejected too, just one paid resource too late. The UI cannot reach this
     * (the checkbox is disabled and the handler drops the key), which is exactly why the guard
     * belongs on the service — any other caller of the create endpoint bypasses the form.
     */
    it('issues no mutating POST when the retired messengerInbox placement is requested', async () => {
      await expect(executeMetaCampaignCreation(undefined, baseConfig({ placements: { messengerInbox: true } }))).rejects.toThrow(
        /messengerInbox placement is no longer supported/
      );

      expect(postPaths(fetchMock)).toEqual([]);
    });

    /**
     * Meta refuses `publisher_platforms: ['audience_network']` on its own. It passes the non-empty
     * check and the UI's `metaHasPlacement` guard, then fails at the ad set — the same
     * create-then-orphan shape, reached through a selection the operator CAN make today.
     */
    it('issues no mutating POST when audience network is the only placement', async () => {
      // Every default placement is turned OFF explicitly: `buildPlacementTargeting` merges over
      // `META_DEFAULT_PLACEMENTS`, which enables both feeds, so a partial `{audienceNetwork:true}`
      // is a three-platform selection and not the case under test.
      const audienceNetworkOnly = {
        facebookFeed: false,
        instagramFeed: false,
        stories: false,
        reels: false,
        audienceNetwork: true,
        messengerInbox: false,
      };

      await expect(executeMetaCampaignCreation(undefined, baseConfig({ placements: audienceNetworkOnly }))).rejects.toThrow(
        /Audience Network cannot be the only placement/
      );

      expect(postPaths(fetchMock)).toEqual([]);
    });

    /**
     * The counterpart that stops the audience-network guard over-broadening: paired with a real
     * feed placement it is a valid, spendable selection and must still go through.
     */
    it('accepts audience network alongside a feed placement', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ placements: { facebookFeed: true, audienceNetwork: true } }));

      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      expect(adSetCall).toBeDefined();
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      expect(adSetBody.targeting.publisher_platforms).toEqual(expect.arrayContaining(['facebook', 'audience_network']));
    });
  });

  /**
   * `leads` must run the same campaign the Go client runs (`internal/platform/meta/client.go`),
   * not the one its NAME implies. OUTCOME_LEADS + LEAD_GENERATION needs an instant form neither
   * path builds, so it would create the campaign and die at the ad set.
   *
   * Asserting the wire values rather than the constant: a test reading `META_OBJECTIVE_PARAMS`
   * back would agree with whatever the constant says and could never fail.
   */
  describe('leads objective mapping', () => {
    it('dispatches leads as a website-traffic campaign with no promoted object', async () => {
      await executeMetaCampaignCreation(undefined, baseConfig({ objective: 'leads' }));

      const campaignCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/campaigns'));
      expect(campaignCall).toBeDefined();
      const campaignBody = JSON.parse((campaignCall![1] as RequestInit).body as string);
      expect(campaignBody.objective).toBe('OUTCOME_TRAFFIC');

      const adSetCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/adsets'));
      expect(adSetCall).toBeDefined();
      const adSetBody = JSON.parse((adSetCall![1] as RequestInit).body as string);
      expect(adSetBody.optimization_goal).toBe('LINK_CLICKS');
      expect(adSetBody.promoted_object).toBeUndefined();
    });
  });
});
