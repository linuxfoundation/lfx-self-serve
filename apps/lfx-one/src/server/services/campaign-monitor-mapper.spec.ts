// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignServiceAccountMonitor,
  CampaignServiceAccountMonitorCampaign,
  CampaignServiceConnection,
  CampaignServiceHubSpotEmailMonitor,
} from '@lfx-one/shared/interfaces';
import { ERROR_CODES } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';
import {
  toAccountMonitorClientError,
  toGoogleMonitorConnectionError,
  toGoogleMonitorResponse,
  toHubSpotEmailMonitorResponse,
  toLinkedInMonitorResponse,
  toMetaMonitorResponse,
  toMonitorConnectionAccount,
  toRedditMonitorResponse,
  toReportBackedMonitorResponse,
} from './campaign-monitor-mapper';

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

/**
 * campaign-service's optional `currency` (`^[A-Z]{3}$`, campaign-service#338): passed on to every
 * account-monitor shape only as a well-formed ISO 4217 code. Anything else is absent — exactly as
 * before the field existed — so the panel stays currency-neutral rather than guessing a symbol.
 */
describe('account-monitor currency', () => {
  const mappers = [
    ['Meta', (p: CampaignServiceAccountMonitor) => toMetaMonitorResponse(p, 'LF', PULLED_AT)],
    ['Reddit', (p: CampaignServiceAccountMonitor) => toRedditMonitorResponse(p, 'LF', PULLED_AT)],
    ['LinkedIn', (p: CampaignServiceAccountMonitor) => toLinkedInMonitorResponse(p, 'LF', PULLED_AT)],
    ['report-backed', (p: CampaignServiceAccountMonitor) => toReportBackedMonitorResponse(p, PULLED_AT)],
  ] as const;

  it.each(mappers)('%s: passes a valid ISO 4217 code through', (_name, map) => {
    expect(map(payload({ currency: 'EUR' })).currency).toBe('EUR');
  });

  it.each(mappers)('%s: leaves the key out when campaign-service sent none', (_name, map) => {
    expect(map(payload())).not.toHaveProperty('currency');
  });

  it.each([['eur'], ['Eur'], ['EURO'], ['US'], [''], [' EUR'], ['E1R'], [42], [null], [{ code: 'EUR' }]])(
    'drops a malformed currency (%j) rather than repairing it',
    (bad) => {
      for (const [, map] of mappers) {
        expect(map(payload({ currency: bad as unknown as string }))).not.toHaveProperty('currency');
      }
    }
  );
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

  it("names the missing own connection, and marks it 'connection_not_found', on campaign-service's typed 404", () => {
    const mapped = toAccountMonitorClientError(upstream(404, { code: '404', message: 'x' }), 'Reddit Ads', 'reddit_monitor') as MicroserviceError;
    expect(mapped.statusCode).toBe(404);
    expect(mapped.toResponse()['error']).toBe('This project has no Reddit Ads connection of its own to read the account with.');
    expect(mapped.toResponse()['upstreamCode']).toBe('connection_not_found');
  });

  /** A gateway or routing 404 says nothing about the connection, so it is neither marked nor worded as a missing one. */
  it('keeps any other 404 retryable, without claiming the connection is absent', () => {
    const mapped = toAccountMonitorClientError(upstream(404, { message: 'route not found' }), 'HubSpot', 'hubspot_monitor') as MicroserviceError;
    expect(mapped.statusCode).toBe(404);
    expect(mapped.toResponse()['upstreamCode']).toBeUndefined();
    expect(mapped.toResponse()['error']).toBe('The HubSpot monitor could not be reached just now. Please try again shortly.');
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

  /**
   * "Metrics not enabled" and "your connection is wrong" are both 400s upstream, with opposite
   * remedies. Only the exact `ErrAccountMetricsUnsupported` text is the former; the panel shows it
   * as a "not enabled" state rather than an error.
   */
  it("marks only the metrics-disabled 400 with upstreamCode 'metrics_not_enabled'", () => {
    const disabled = toAccountMonitorClientError(
      upstream(400, { code: '400', message: 'account monitor is not supported for this platform' }),
      'Microsoft Ads',
      'microsoft_monitor'
    ) as MicroserviceError;
    const notManaged = toAccountMonitorClientError(
      upstream(400, { code: '400', message: "the requested account is not managed by this project's microsoft ads connection" }),
      'Microsoft Ads',
      'microsoft_monitor'
    ) as MicroserviceError;

    expect(disabled.statusCode).toBe(400);
    expect(disabled.toResponse()['upstreamCode']).toBe('metrics_not_enabled');
    expect(disabled.toResponse()['error']).toBe('Microsoft Ads metrics are not enabled in campaign-service for this environment yet.');
    expect(notManaged.toResponse()['upstreamCode']).toBeUndefined();
    expect(notManaged.toResponse()['error']).not.toContain('not enabled');
  });

  it('passes a transport failure and a non-MicroserviceError through unchanged', () => {
    const transport = new MicroserviceError('The request could not be completed. Please try again.', 503, 'NETWORK_ERROR', { transportFailure: true });
    const plain = new Error('boom');

    expect(toAccountMonitorClientError(transport, 'Meta Ads', 'meta_monitor')).toBe(transport);
    expect(toAccountMonitorClientError(plain, 'Meta Ads', 'meta_monitor')).toBe(plain);
  });
});

describe('toGoogleMonitorResponse', () => {
  const GOOGLE_NAME = 'Events | KubeCon NA 2026 | NA | Conversions | Intent | Search | CNCF | MoFU | 2026-09-01';

  function googleRow(overrides: Partial<CampaignServiceAccountMonitorCampaign> = {}): CampaignServiceAccountMonitorCampaign {
    return row({
      platform_campaign_id: '24183781329',
      name: GOOGLE_NAME,
      status: 'ENABLED',
      spend: 1890,
      impressions: 48_200,
      clicks: 3110,
      ctr: 6.45,
      conversions: 12.5,
      budget_day: 150,
      total_budget: 0,
      start_date: '',
      end_date: '',
      is_search_channel: true,
      pacing_pct: 41.6,
      pacing_label: 'underspending',
      campaign_url: 'https://ads.google.com/aw/campaigns?campaignId=24183781329',
      ...overrides,
    });
  }

  function googlePayload(overrides: Partial<CampaignServiceAccountMonitor> = {}): CampaignServiceAccountMonitor {
    return payload({
      account_id: '8666746580',
      days: 30,
      campaigns: [googleRow()],
      action_items: [{ campaign_id: '24183781329', campaign_name: GOOGLE_NAME, priority: 'MED', issue: 'Only spending 42%', action: 'Broaden targeting' }],
      totals: { spend: 1890, impressions: 48_200, clicks: 3110, conversions: 12.5, campaign_count: 1 },
      ...overrides,
    });
  }

  it('maps a row onto the legacy Google fields, deriving the name parts as the legacy read did', () => {
    const result = toGoogleMonitorResponse(googlePayload(), PULLED_AT);

    expect(result.pulledAt).toBe(PULLED_AT);
    expect(result.dateRange).toEqual({ mode: 'last_30_days' });
    expect(result.campaigns).toEqual([
      {
        name: GOOGLE_NAME,
        shortName: 'KubeCon NA 2026',
        eventName: 'KubeCon NA 2026',
        adFormat: 'Search',
        targeting: 'Intent',
        status: 'enabled',
        // The 30-day read window ending on the day of PULLED_AT (2026-10-13), inclusive.
        startDate: '2026-09-14',
        endDate: '2026-10-13',
        budgetDay: 150,
        totalBudget: 4500,
        spend: 1890,
        impressions: 48_200,
        clicks: 3110,
        ctr: 6.45,
        avgCpc: 1890 / 3110,
        conversions: 12.5,
        pacingPct: 42,
        pacingLabel: 'underspending',
        campaignId: '24183781329',
        googleAdsUrl: 'https://ads.google.com/aw/campaigns?campaignId=24183781329',
        pacingUnknown: false,
        fetchFailed: false,
        conversionsMeasured: true,
      },
    ]);
    expect(result.accountTotals).toEqual({ budgetDay: 150, spend: 1890, impressions: 48_200, clicks: 3110, conversions: 12.5, conversionsMeasured: true });
    // campaign-service names no currency for Google, so the amounts are the connected account's own.
    expect(result.amountsInAccountCurrency).toBe(true);
  });

  it('falls back to the whole name for a name outside the convention, and to unknown for an unrecognised status', () => {
    const [campaign] = toGoogleMonitorResponse(
      googlePayload({ campaigns: [googleRow({ name: 'Brand campaign', status: 'SOMETHING_NEW', campaign_url: undefined })] }),
      PULLED_AT
    ).campaigns;

    expect(campaign.shortName).toBe('Brand campaign');
    expect(campaign.eventName).toBe('');
    expect(campaign.status).toBe('unknown');
    // No format in the name, so campaign-service's own Search flag decides it.
    expect(campaign.adFormat).toBe('Search');
    expect(campaign.googleAdsUrl).toBe('');
  });

  it('leaves the ad format empty for a name outside the convention that is not a Search campaign', () => {
    const [campaign] = toGoogleMonitorResponse(
      googlePayload({ campaigns: [googleRow({ name: 'Brand display', is_search_channel: false })] }),
      PULLED_AT
    ).campaigns;
    expect(campaign.adFormat).toBe('');
  });

  it("keeps the name's own ad format over campaign-service's Search flag", () => {
    const [campaign] = toGoogleMonitorResponse(
      googlePayload({ campaigns: [googleRow({ name: GOOGLE_NAME.replace('| Search |', '| Display |') })] }),
      PULLED_AT
    ).campaigns;
    expect(campaign.adFormat).toBe('Display');
  });

  it('reports an average CPC of 0, not a division by zero, for a row with no clicks', () => {
    const [campaign] = toGoogleMonitorResponse(googlePayload({ campaigns: [googleRow({ clicks: 0, spend: 0 })] }), PULLED_AT).campaigns;
    expect(campaign.avgCpc).toBe(0);
  });

  it.each([
    ['could not pace', { pacing_unknown: true }, 'pacingUnknown'],
    ['could not read', { fetch_failed: true }, 'fetchFailed'],
  ] as const)('zeroes pacing for a row campaign-service %s, and keeps the flag for the panel', (_label, overrides, flagName) => {
    const [campaign] = toGoogleMonitorResponse(googlePayload({ campaigns: [googleRow({ ...overrides, pacing_label: 'overspending' })] }), PULLED_AT).campaigns;

    expect(campaign.pacingPct).toBe(0);
    expect(campaign.pacingLabel).toBe('normal');
    expect(campaign[flagName]).toBe(true);
  });

  it('marks unmeasured conversions as a placeholder on the row and on the totals', () => {
    const result = toGoogleMonitorResponse(
      googlePayload({ campaigns: [googleRow({ conversions: undefined })], totals: { spend: 1890, impressions: 48_200, clicks: 3110, campaign_count: 1 } }),
      PULLED_AT
    );

    expect(result.campaigns[0].conversions).toBe(0);
    expect(result.campaigns[0].conversionsMeasured).toBe(false);
    expect(result.accountTotals.conversions).toBe(0);
    expect(result.accountTotals.conversionsMeasured).toBe(false);
  });

  it("gives an action item its campaign's event, link and figures", () => {
    const [item] = toGoogleMonitorResponse(googlePayload(), PULLED_AT).actionItems;

    expect(item).toEqual({
      eventName: 'KubeCon NA 2026',
      campaigns: ['KubeCon NA 2026'],
      campaignUrls: { 'KubeCon NA 2026': 'https://ads.google.com/aw/campaigns?campaignId=24183781329' },
      priority: 'MED',
      issue: 'Only spending 42%',
      action: 'Broaden targeting',
      metrics: { spend: 1890, budget: 150, pacingPct: 42, impressions: 48_200, clicks: 3110, conversions: 12.5, pacingUnknown: false },
    });
  });

  /** Upstream still raises items for a campaign it could not pace (a $0 daily budget), so the item says its pacing is a placeholder. */
  it.each([
    ['could not pace', { pacing_unknown: true }],
    ['could not read', { fetch_failed: true }],
  ] as const)('marks the pacing of an item whose campaign campaign-service %s as unknown', (_label, overrides) => {
    const [item] = toGoogleMonitorResponse(googlePayload({ campaigns: [googleRow({ ...overrides, budget_day: 0 })] }), PULLED_AT).actionItems;
    expect(item.metrics.pacingPct).toBe(0);
    expect(item.metrics.pacingUnknown).toBe(true);
  });

  it('gives an account-wide action item no campaign and zero figures, and tolerates absent arrays', () => {
    const accountWide = toGoogleMonitorResponse(
      googlePayload({ action_items: [{ priority: 'LOW', issue: 'No conversions tracked', action: 'Add a conversion action' }] }),
      PULLED_AT
    );
    expect(accountWide.actionItems[0]).toEqual({
      eventName: '',
      campaigns: [],
      campaignUrls: {},
      priority: 'LOW',
      issue: 'No conversions tracked',
      action: 'Add a conversion action',
      metrics: { spend: 0, budget: 0, pacingPct: 0, impressions: 0, clicks: 0, conversions: 0, pacingUnknown: true },
    });

    const empty = toGoogleMonitorResponse(
      googlePayload({
        campaigns: null as unknown as CampaignServiceAccountMonitorCampaign[],
        action_items: null as unknown as CampaignServiceAccountMonitor['action_items'],
        totals: { spend: 0, impressions: 0, clicks: 0, conversions: 0, campaign_count: 0 },
      }),
      PULLED_AT
    );
    expect(empty.campaigns).toEqual([]);
    expect(empty.actionItems).toEqual([]);
    expect(empty.accountTotals.budgetDay).toBe(0);
  });

  it('names a campaign the item points at but the rows do not carry, by its own name', () => {
    const [item] = toGoogleMonitorResponse(
      googlePayload({
        action_items: [{ campaign_id: '999', campaign_name: GOOGLE_NAME.replace('KubeCon NA 2026', 'OSS EU 2026'), priority: 'HIGH', issue: 'x', action: 'y' }],
      }),
      PULLED_AT
    ).actionItems;

    expect(item.eventName).toBe('OSS EU 2026');
    expect(item.campaignUrls).toEqual({});
  });
});

describe('toGoogleMonitorConnectionError', () => {
  it('answers a project with no Google Ads connection as the typed 404 a missing connection gets upstream', () => {
    const error = toGoogleMonitorConnectionError('no_connection', 'campaign_monitor');
    expect(error.statusCode).toBe(404);
    expect(error.toResponse()['error']).toBe('This project has no Google Ads connection of its own to read the account with.');
    expect(error.toResponse()['upstreamCode']).toBe('connection_not_found');
  });

  it('answers a connection with no bound account as a 409 naming the remedy', () => {
    const error = toGoogleMonitorConnectionError('no_account', 'campaign_monitor');
    expect(error.statusCode).toBe(409);
    expect(error.toResponse()['error']).toContain('no ad account bound to it');
    expect(error.toResponse()['upstreamCode']).toBeUndefined();
  });

  it('answers an unreadable connection as a 503 advisory, so the panel shows its text', () => {
    const error = toGoogleMonitorConnectionError('unavailable', 'campaign_monitor');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ERROR_CODES.SERVICE_ADVISORY);
    expect(error.toResponse()['error']).toBe("This project's Google Ads connection could not be read just now. Please try again shortly.");
  });
});

describe('toReportBackedMonitorResponse', () => {
  it('carries the rows in the Reddit/Meta shape plus the report freshness', () => {
    const result = toReportBackedMonitorResponse(
      payload({
        account_id: '187654321',
        metrics_as_of: '2026-10-12T10:00:00Z',
        metrics_window_start: '2026-09-29',
        metrics_window_end: '2026-10-12',
        metrics_pending: false,
      }),
      PULLED_AT
    );

    expect(result.accountId).toBe('187654321');
    expect(result.pulledAt).toBe(PULLED_AT);
    expect(result.metricsAsOf).toBe('2026-10-12T10:00:00Z');
    expect(result.metricsWindowStart).toBe('2026-09-29');
    expect(result.metricsWindowEnd).toBe('2026-10-12');
    expect(result.metricsPending).toBe(false);
    expect(result.campaigns[0]).toMatchObject({ campaignId: '120210000000001', pacingPct: 88, pacingLabel: 'normal', conversionsMeasured: true });
    expect(result.accountTotals.campaignCount).toBe(1);
  });

  /**
   * Before the first report finishes upstream omits every freshness field and every row is
   * fetch_failed. The mapper says "no report yet" (nulls) and leaves the rows marked unread — it
   * never invents a timestamp or a figure.
   */
  it('reports no report yet as nulls, with every unread row still marked', () => {
    const result = toReportBackedMonitorResponse(
      payload({
        campaigns: [row({ fetch_failed: true, spend: 0, impressions: 0, clicks: 0, conversions: undefined })],
        metrics_pending: true,
      }),
      PULLED_AT
    );

    expect(result.metricsAsOf).toBeNull();
    expect(result.metricsWindowStart).toBeNull();
    expect(result.metricsWindowEnd).toBeNull();
    expect(result.metricsPending).toBe(true);
    expect(result.campaigns[0].fetchFailed).toBe(true);
    expect(result.campaigns[0].pacingLabel).toBeUndefined();
  });

  it('reads an absent metrics_pending as not building', () => {
    expect(toReportBackedMonitorResponse(payload(), PULLED_AT).metricsPending).toBe(false);
  });
});

describe('toHubSpotEmailMonitorResponse', () => {
  function hubspot(overrides: Partial<CampaignServiceHubSpotEmailMonitor> = {}): CampaignServiceHubSpotEmailMonitor {
    return {
      days: 30,
      emails: [
        {
          campaign_id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
          email_id: '112233445566',
          name: 'KubeCon NA 2026 — registration open',
          ab_variant: false,
          deleted: false,
          sent: 5000,
          delivered: 4850,
          opens: 1455,
          clicks: 194,
          bounces: 150,
          unsubscribes: 24,
          spam_reports: 1,
          open_rate: 0.3,
          click_rate: 0.04,
          bounce_rate: 0.03,
          unsubscribe_rate: 0.0049,
          spam_rate: 0.0002,
        },
      ],
      action_items: [
        {
          campaign_id: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
          email_id: '112233445566',
          campaign_name: 'KubeCon NA 2026 — registration open',
          priority: 'MED',
          issue: 'Bounce rate is 3.0%',
          action: 'Review the send list',
        },
      ],
      totals: {
        email_count: 1,
        sent: 5000,
        delivered: 4850,
        opens: 1455,
        clicks: 194,
        bounces: 150,
        unsubscribes: 24,
        spam_reports: 1,
        open_rate: 0.3,
        click_rate: 0.04,
        bounce_rate: 0.03,
        unsubscribe_rate: 0.0049,
        spam_rate: 0.0002,
      },
      metrics_as_of: '2026-10-08T14:30:00Z',
      metrics_window_start: '2026-09-09',
      metrics_window_end: '2026-10-08',
      emails_checked: 3,
      emails_not_sent_in_window: 2,
      emails_unattributable: 0,
      emails_truncated: false,
      ...overrides,
    };
  }

  it('maps every email, total and finding field onto camelCase, keeping rates as fractions', () => {
    const result = toHubSpotEmailMonitorResponse(hubspot(), PULLED_AT);

    expect(result.emails[0]).toEqual({
      campaignId: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      emailId: '112233445566',
      name: 'KubeCon NA 2026 — registration open',
      abVariant: false,
      deleted: false,
      sent: 5000,
      delivered: 4850,
      opens: 1455,
      clicks: 194,
      bounces: 150,
      unsubscribes: 24,
      spamReports: 1,
      openRate: 0.3,
      clickRate: 0.04,
      bounceRate: 0.03,
      unsubscribeRate: 0.0049,
      spamRate: 0.0002,
    });
    expect(result.totals).toMatchObject({ emailCount: 1, sent: 5000, spamReports: 1, openRate: 0.3 });
    expect(result.actionItems).toEqual([
      {
        priority: 'MED',
        emailId: '112233445566',
        emailName: 'KubeCon NA 2026 — registration open',
        issue: 'Bounce rate is 3.0%',
        action: 'Review the send list',
      },
    ]);
    expect(result).toMatchObject({
      pulledAt: PULLED_AT,
      days: 30,
      metricsAsOf: '2026-10-08T14:30:00Z',
      metricsWindowStart: '2026-09-09',
      metricsWindowEnd: '2026-10-08',
      emailsChecked: 3,
      emailsNotSentInWindow: 2,
      emailsUnattributable: 0,
      emailsTruncated: false,
    });
  });

  /** A rate over zero deliveries is unknown. Mapping its absence to 0 would read as "nobody opened it". */
  it('maps an absent rate to null, never 0', () => {
    const result = toHubSpotEmailMonitorResponse(
      hubspot({
        emails: [{ ...hubspot().emails[0], delivered: 0, open_rate: undefined, click_rate: undefined, unsubscribe_rate: undefined, spam_rate: undefined }],
        totals: { ...hubspot().totals, delivered: 0, open_rate: undefined, click_rate: undefined },
      }),
      PULLED_AT
    );

    expect(result.emails[0].openRate).toBeNull();
    expect(result.emails[0].clickRate).toBeNull();
    expect(result.emails[0].bounceRate).toBe(0.03);
    expect(result.totals.openRate).toBeNull();
  });

  it('reads a project with no recorded email (no metrics_as_of, null arrays) as an empty monitor', () => {
    const result = toHubSpotEmailMonitorResponse(
      hubspot({
        emails: null as unknown as [],
        action_items: null as unknown as [],
        metrics_as_of: undefined,
        metrics_window_start: undefined,
        metrics_window_end: undefined,
      }),
      PULLED_AT
    );

    expect(result.emails).toEqual([]);
    expect(result.actionItems).toEqual([]);
    expect(result.metricsAsOf).toBeNull();
    expect(result.metricsWindowStart).toBeNull();
  });

  /** `totals` is required; an absent or malformed one must fail the read, never become "0 sent". */
  it.each([
    ['absent', undefined],
    ['null', null],
    ['missing a counter', { email_count: 1, sent: 5000, delivered: 4850, opens: 1455, clicks: 194, bounces: 150, unsubscribes: 24 }],
    ['non-numeric', { ...{ email_count: 1, sent: 5000, delivered: 4850, opens: 1455, clicks: 194, bounces: 150, unsubscribes: 24 }, spam_reports: '1' }],
  ])('throws a 502 contract error when totals are %s', (_case, totals) => {
    let caught: unknown;
    try {
      toHubSpotEmailMonitorResponse(hubspot({ totals: totals as unknown as CampaignServiceHubSpotEmailMonitor['totals'] }), PULLED_AT);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(MicroserviceError);
    expect((caught as MicroserviceError).statusCode).toBe(502);
  });

  it('maps a project-wide finding (no email id) to a null emailId', () => {
    const result = toHubSpotEmailMonitorResponse(hubspot({ action_items: [{ priority: 'LOW', issue: 'i', action: 'a' }] }), PULLED_AT);
    expect(result.actionItems[0]).toEqual({ priority: 'LOW', emailId: null, emailName: '', issue: 'i', action: 'a' });
  });
});

describe('toMonitorConnectionAccount', () => {
  function connection(overrides: Partial<CampaignServiceConnection> = {}): CampaignServiceConnection {
    return { id: 'c1', project_id: 'cncf', account_id: 'act_100000000000001', has_credentials: true, status: 'active', ...overrides };
  }

  it("offers the connection's bound account under its own label", () => {
    expect(toMonitorConnectionAccount(connection({ label: ' CNCF Meta ' }), 'meta-ads')).toEqual({
      state: 'connected',
      accountId: 'act_100000000000001',
      label: 'CNCF Meta',
    });
  });

  it('falls back to the account id when the connection has no label', () => {
    expect(toMonitorConnectionAccount(connection({ label: '' }), 'meta-ads')).toEqual({
      state: 'connected',
      accountId: 'act_100000000000001',
      label: 'act_100000000000001',
    });
  });

  it.each(['', '   ', undefined])('reads account_id %j as a connection with no account bound', (accountId) => {
    expect(toMonitorConnectionAccount(connection({ account_id: accountId as unknown as string }), 'meta-ads')).toEqual({
      state: 'no_account',
      accountId: null,
      label: null,
    });
  });

  it('offers a legacy bare numeric Meta id in the act_ form the Meta monitor takes', () => {
    expect(toMonitorConnectionAccount(connection({ account_id: '100000000000001', label: '' }), 'meta-ads')).toEqual({
      state: 'connected',
      accountId: 'act_100000000000001',
      label: 'act_100000000000001',
    });
  });

  it('leaves a Meta id that is not purely numeric as stored', () => {
    expect(toMonitorConnectionAccount(connection({ account_id: 'act_x1' }), 'meta-ads')).toEqual({ state: 'connected', accountId: 'act_x1', label: 'act_x1' });
  });

  it.each(['linkedin-ads', 'reddit-ads', 'microsoft-ads', 'twitter-ads'] as const)('leaves a numeric %s id unprefixed', (provider) => {
    expect(toMonitorConnectionAccount(connection({ account_id: '187654321' }), provider)).toEqual({
      state: 'connected',
      accountId: '187654321',
      label: '187654321',
    });
  });
});
