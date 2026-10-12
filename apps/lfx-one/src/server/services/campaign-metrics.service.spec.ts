// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

// Same shape as campaign-proxy.service.spec.ts: runtime collaborators are mocked so the service
// can be exercised without a Google Ads client, and `gaqlSearch` is the seam the query is read at.
const { logger, gaqlSearch } = vi.hoisted(() => ({
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
  // Typed with its real signature: `vi.fn(async () => …)` infers a zero-argument mock, and reading
  // the captured query off `calls[0][0]` is then a compile error rather than the assertion seam.
  gaqlSearch: vi.fn<(query: string) => Promise<unknown[]>>(async () => []),
}));

vi.mock('./logger.service', () => ({ logger }));
vi.mock('./campaign-proxy.service', () => ({ gaqlSearch }));
vi.mock('./linkedin-ads.service', () => ({ getLinkedInAnalytics: vi.fn() }));
vi.mock('./meta-ads.service', () => ({ getMetaAnalytics: vi.fn() }));
vi.mock('./reddit-ads.service', () => ({ getRedditAnalytics: vi.fn() }));

import { GOOGLE_ADS_CHANNEL_TYPE_ENUMS } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { CampaignMetricsService } from './campaign-metrics.service';

const req = {} as Request;

/**
 * The monitoring query's channel filter is the read side of the create side.
 *
 * It named SEARCH and DEMAND_GEN alone, which was every channel that could be created at the time.
 * Now that Performance Max and Display can be created here, a filter left behind would not fail —
 * it would silently hide campaigns this application had just created successfully, which is a
 * defect visible only on the screen that is supposed to report them.
 */
describe('CampaignMetricsService monitoring query', () => {
  afterEach(() => {
    gaqlSearch.mockClear();
  });

  async function monitorQuery(): Promise<string> {
    await new CampaignMetricsService().getMonitorData(req, 30);
    return gaqlSearch.mock.calls[0][0];
  }

  it.each(Object.entries(GOOGLE_ADS_CHANNEL_TYPE_ENUMS))('accepts the %s channel as %s', async (_channel, enumValue) => {
    expect(await monitorQuery()).toContain(`'${enumValue}'`);
  });

  /**
   * Asserted as the whole clause rather than per-value, because every value also appears nowhere
   * else in the query: a filter that merely MENTIONED the new enums while still restricting the
   * `IN` list to the old pair would satisfy the containment checks above.
   */
  it('filters on every channel the app knows, in one IN list', async () => {
    const expected = Object.values(GOOGLE_ADS_CHANNEL_TYPE_ENUMS)
      .map((type) => `'${type}'`)
      .join(', ');

    expect(await monitorQuery()).toContain(`campaign.advertising_channel_type IN (${expected})`);
  });

  /** The literal the widening replaced — pinned so a revert cannot pass unnoticed. */
  it('no longer restricts the read to search and demand gen', async () => {
    expect(await monitorQuery()).not.toContain(`IN ('SEARCH', 'DEMAND_GEN')`);
  });
});
