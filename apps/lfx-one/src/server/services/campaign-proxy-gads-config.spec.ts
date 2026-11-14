// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

// Same collaborator mocks as campaign-proxy.service.spec.ts; this file only reads the Google Ads client setup.
const { logger } = vi.hoisted(() => ({
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('./logger.service', () => ({ logger }));
vi.mock('./linkedin-ads.service', () => ({ executeLinkedInCampaignCreation: vi.fn(), resolveGeoTargets: vi.fn() }));
vi.mock('./meta-ads.service', () => ({ executeMetaCampaignCreation: vi.fn(), updateMetaCampaignStatus: vi.fn() }));
vi.mock('./reddit-ads.service', () => ({ executeRedditCampaignCreation: vi.fn(), updateRedditCampaignStatus: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/**
 * A missing Google Ads credential must be told apart from a failed Google Ads call, so the Monitor tab
 * can say "not configured" rather than the generic failure (#4526). Loaded fresh per test because the
 * client is cached at module scope.
 */
describe('Google Ads client configuration', () => {
  it.each(['GADS_CLIENT_ID', 'GADS_CLIENT_SECRET', 'GADS_DEVELOPER_TOKEN'])(
    'throws GoogleAdsNotConfiguredError when %s is missing',
    { timeout: 30_000 },
    async (missing) => {
      for (const key of ['GADS_CLIENT_ID', 'GADS_CLIENT_SECRET', 'GADS_DEVELOPER_TOKEN', 'GADS_CUSTOMER_ID', 'GADS_REFRESH_TOKEN']) {
        vi.stubEnv(key, key === missing ? '' : 'synthetic-value');
      }
      const { getCustomer } = await import('./campaign-proxy.service');
      const { GoogleAdsNotConfiguredError } = await import('./google-ads-read-error');

      expect(() => getCustomer()).toThrow(GoogleAdsNotConfiguredError);
    }
  );

  it.each(['GADS_CUSTOMER_ID', 'GADS_REFRESH_TOKEN'])(
    'throws GoogleAdsNotConfiguredError when %s is missing, before any Google Ads call',
    { timeout: 30_000 },
    async (missing) => {
      for (const key of ['GADS_CLIENT_ID', 'GADS_CLIENT_SECRET', 'GADS_DEVELOPER_TOKEN', 'GADS_CUSTOMER_ID', 'GADS_REFRESH_TOKEN']) {
        vi.stubEnv(key, key === missing ? '' : 'synthetic-value');
      }
      const { getCustomer } = await import('./campaign-proxy.service');
      const { GoogleAdsNotConfiguredError } = await import('./google-ads-read-error');

      expect(() => getCustomer()).toThrow(GoogleAdsNotConfiguredError);
    }
  );
});
