// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignServiceAccountMonitor, CampaignServiceAccountMonitorCampaign } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';
import { toAccountMonitorClientError, toLinkedInMonitorResponse, toMetaMonitorResponse, toRedditMonitorResponse } from './campaign-monitor-mapper';

const PULLED_AT = '2026-10-13T00:00:00.000Z';

function row(overrides: Partial<CampaignServiceAccountMonitorCampaign> = {}): CampaignServiceAccountMonitorCampaign {
  return {
    platform_campaign_id: '120210000000001',
    name: 'KubeCon NA 2026 - Retargeting',
    status: 'ACTIVE',
    spend: 412.37,
    impressions: 52_000,
    clicks: 610,
    ctr: 1.17,
    conversions: 14.5,
    budget_day: 0,
    total_budget: 2500,
    start_date: '2026-09-01',
    end_date: '2026-11-30',
    pacing_unknown: false,
    is_search_channel: false,
    fetch_failed: false,
    pacing_pct: 87.6,
    pacing_label: 'normal',
    ...overrides,
  };
}

function payload(overrides: Partial<CampaignServiceAccountMonitor> = {}): CampaignServiceAccountMonitor {
  return {
    account_id: 'act_100000000000001',
    days: 14,
    campaigns: [row()],
    action_items: [
      { campaign_id: '120210000000001', campaign_name: 'KubeCon NA 2026 - Retargeting', priority: 'MED', issue: 'Low CTR', action: 'Refresh creative' },
    ],
    totals: { spend: 412.37, impressions: 52_000, clicks: 610, conversions: 14.5, campaign_count: 1 },
    ...overrides,
  };
}

describe('toMetaMonitorResponse / toRedditMonitorResponse', () => {
  it('maps every row field onto the legacy names, keeping currency and CTR units unchanged', () => {
    const result = toMetaMonitorResponse(payload(), 'LF Core', PULLED_AT);

    expect(result.accountLabel).toBe('LF Core');
    expect(result.pulledAt).toBe(PULLED_AT);
    expect(result.dateRange).toEqual({ mode: 'last_14_days' });
    expect(result.campaigns).toEqual([
      {
        campaignId: '120210000000001',
        campaignName: 'KubeCon NA 2026 - Retargeting',
        status: 'ACTIVE',
        totalBudget: 2500,
        dailyBudget: 0,
        spend: 412.37,
        impressions: 52_000,
        clicks: 610,
        ctr: 1.17,
        conversions: 14.5,
        pacingPct: 88,
        pacingLabel: 'normal',
        startDate: '2026-09-01',
        endDate: '2026-11-30',
        pacingUnknown: false,
        fetchFailed: false,
        conversionsMeasured: true,
      },
    ]);
    expect(result.accountTotals).toEqual({ spend: 412.37, impressions: 52_000, clicks: 610, conversions: 14.5, campaignCount: 1, conversionsMeasured: true });
    expect(result.actionItems).toEqual([{ priority: 'MED', campaignName: 'KubeCon NA 2026 - Retargeting', issue: 'Low CTR', action: 'Refresh creative' }]);
  });

  it('renders unmeasured conversions as a 0 placeholder and says so, rather than claiming a measured zero', () => {
    const unmeasuredRow = row();
    delete unmeasuredRow.conversions;
    const unmeasuredTotals = payload().totals;
    delete unmeasuredTotals.conversions;
    const result = toRedditMonitorResponse(payload({ campaigns: [unmeasuredRow], totals: unmeasuredTotals }), 'The Linux Foundation', PULLED_AT);

    expect(result.campaigns[0].conversions).toBe(0);
    expect(result.campaigns[0].conversionsMeasured).toBe(false);
    expect(result.accountTotals.conversions).toBe(0);
    expect(result.accountTotals.conversionsMeasured).toBe(false);
  });

  it('zeroes pacing for a row campaign-service could not pace or could not read', () => {
    const result = toRedditMonitorResponse(
      payload({ campaigns: [row({ pacing_unknown: true, pacing_pct: 412 }), row({ fetch_failed: true, pacing_pct: 63 })] }),
      'The Linux Foundation',
      PULLED_AT
    );

    expect(result.campaigns.map((c) => c.pacingPct)).toEqual([0, 0]);
    // campaign-service's placeholder label ("normal") is not passed on for either.
    expect(result.campaigns.map((c) => c.pacingLabel)).toEqual([undefined, undefined]);
    expect(JSON.parse(JSON.stringify(result.campaigns[0]))).not.toHaveProperty('pacingLabel');
    expect(result.campaigns[0].pacingUnknown).toBe(true);
    expect(result.campaigns[1].fetchFailed).toBe(true);
  });

  it('gives an account-wide action item an empty campaign name and tolerates absent arrays', () => {
    const result = toMetaMonitorResponse(
      payload({ campaigns: undefined as unknown as [], action_items: [{ priority: 'HIGH', issue: 'Account issue', action: 'Check billing' }] }),
      'LF Core',
      PULLED_AT
    );

    expect(result.campaigns).toEqual([]);
    expect(result.actionItems).toEqual([{ priority: 'HIGH', campaignName: '', issue: 'Account issue', action: 'Check billing' }]);
  });
});

describe('toLinkedInMonitorResponse', () => {
  it('keeps pacing unrounded, derives eventName as the legacy engine did, and reports no creatives', () => {
    const result = toLinkedInMonitorResponse(
      payload({
        campaigns: [
          row({ name: 'Events | KubeCon NA 2026 | LinkedIn | Conversions', pacing_pct: 90.4, pacing_label: 'constrained' }),
          row({ name: 'Brand awareness', pacing_pct: 12.6 }),
          row({ name: 'Events | OSS EU | LinkedIn', pacing_unknown: true, pacing_pct: 55.5 }),
        ],
      }),
      'LF LinkedIn',
      PULLED_AT
    );

    expect(result.accountLabel).toBe('LF LinkedIn');
    expect(result.campaigns.map((c) => c.pacingPct)).toEqual([90.4, 12.6, 0]);
    expect(result.campaigns[2].pacingLabel).toBeUndefined();
    expect(result.campaigns.map((c) => c.eventName)).toEqual(['KubeCon NA 2026', 'Brand awareness', 'OSS EU']);
    expect(result.campaigns.every((c) => c.creatives.length === 0)).toBe(true);
    expect(result.campaigns.every((c) => c.creativesMeasured === false)).toBe(true);
    expect(result.campaigns[0].pacingLabel).toBe('constrained');
    expect(result.accountTotals.campaignCount).toBe(1);
  });

  it("keeps upstream's action-item order, which ranks MED between HIGH and LOW (#3018)", () => {
    const result = toLinkedInMonitorResponse(
      payload({
        action_items: [
          { campaign_name: 'A', priority: 'HIGH', issue: 'i1', action: 'a1' },
          { campaign_name: 'B', priority: 'MED', issue: 'i2', action: 'a2' },
          { campaign_name: 'C', priority: 'LOW', issue: 'i3', action: 'a3' },
        ],
      }),
      'LF LinkedIn',
      PULLED_AT
    );

    expect(result.actionItems.map((a) => a.priority)).toEqual(['HIGH', 'MED', 'LOW']);
  });
});

describe('toAccountMonitorClientError', () => {
  function upstream(status: number, body: Record<string, unknown>): MicroserviceError {
    return MicroserviceError.fromMicroserviceResponse(status, 'upstream', body, 'LFX_V2_CAMPAIGN_SERVICE', '/projects/tlf/connection-meta-ads/account-monitor');
  }

  it.each([400, 404, 409, 500, 503])('keeps status %i and replaces the upstream message', (status) => {
    const original = upstream(status, { message: 'connection row 7f3e decrypt failed: ErrCredentialDecryptionFailed' });

    const mapped = toAccountMonitorClientError(original, 'Meta Ads', 'meta_monitor') as MicroserviceError;

    expect(mapped).toBeInstanceOf(MicroserviceError);
    expect(mapped.statusCode).toBe(status);
    expect(JSON.stringify(mapped.toResponse())).not.toContain('decrypt');
    expect(mapped.toResponse()['originalMessage']).toBeUndefined();
    expect(mapped.originalError).toBe(original);
  });

  it('names the missing own connection on a 404', () => {
    const mapped = toAccountMonitorClientError(upstream(404, { message: 'x' }), 'Reddit Ads', 'reddit_monitor') as MicroserviceError;
    expect(mapped.toResponse()['error']).toBe('This project has no Reddit Ads connection of its own to read the account with.');
  });

  it("forwards a 409's reason only when it is one of upstream's enum values", () => {
    const known = toAccountMonitorClientError(
      upstream(409, { message: 'm', reason: 'account_timezone_unsupported' }),
      'X Ads',
      'twitter_monitor'
    ) as MicroserviceError;
    const unknown = toAccountMonitorClientError(upstream(409, { message: 'm', reason: 'something <script>' }), 'X Ads', 'twitter_monitor') as MicroserviceError;

    expect(known.toResponse()['upstreamCode']).toBe('account_timezone_unsupported');
    expect(unknown.toResponse()['upstreamCode']).toBeUndefined();
  });

  it('passes a transport failure and a non-MicroserviceError through unchanged', () => {
    const transport = new MicroserviceError('The request could not be completed. Please try again.', 503, 'NETWORK_ERROR', { transportFailure: true });
    const plain = new Error('boom');

    expect(toAccountMonitorClientError(transport, 'Meta Ads', 'meta_monitor')).toBe(transport);
    expect(toAccountMonitorClientError(plain, 'Meta Ads', 'meta_monitor')).toBe(plain);
  });
});
