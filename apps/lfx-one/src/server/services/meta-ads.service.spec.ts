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
  });
});
