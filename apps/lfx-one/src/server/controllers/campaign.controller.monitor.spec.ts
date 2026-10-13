// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignServiceAccountMonitor } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The account-monitor routes (#2519): Meta and Reddit switch backend on LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR,
// and Microsoft, X and HubSpot exist only behind it. Kept out of campaign.controller.spec.ts, which is
// already 5000 lines, the way analytics.controller is split by area.
const { svcMeta, svcReddit, svcMicrosoft, svcTwitter, svcHubSpot, legacyMeta, legacyReddit, isServerFeatureEnabled, logger } = vi.hoisted(() => ({
  svcMeta: vi.fn(),
  svcReddit: vi.fn(),
  svcMicrosoft: vi.fn(),
  svcTwitter: vi.fn(),
  svcHubSpot: vi.fn(),
  legacyMeta: vi.fn(),
  legacyReddit: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public getMetaAdsAccountMonitor = svcMeta;
      public getRedditAdsAccountMonitor = svcReddit;
      public getMicrosoftAdsAccountMonitor = svcMicrosoft;
      public getTwitterAdsAccountMonitor = svcTwitter;
      public getHubSpotAccountMonitor = svcHubSpot;
    },
  };
});
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {},
  LinkedInMetricsService: class {},
  RedditMetricsService: class {
    public getRedditMonitorData = legacyReddit;
  },
  MetaMetricsService: class {
    public getMonitorData = legacyMeta;
  },
}));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const META_ACCOUNT = 'act_193556282970417';
const REDDIT_ACCOUNT = 't2_gv9wtbfa';

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/x/monitor' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function monitorPayload(overrides: Partial<CampaignServiceAccountMonitor> = {}): CampaignServiceAccountMonitor {
  return {
    account_id: META_ACCOUNT,
    days: 30,
    campaigns: [
      {
        platform_campaign_id: '1',
        name: 'Camp',
        status: 'ACTIVE',
        spend: 10,
        impressions: 100,
        clicks: 5,
        ctr: 5,
        budget_day: 1,
        total_budget: 0,
        start_date: '2026-09-01',
        end_date: '',
        pacing_unknown: false,
        is_search_channel: false,
        fetch_failed: false,
        pacing_pct: 50,
        pacing_label: 'normal',
      },
    ],
    action_items: [],
    totals: { spend: 10, impressions: 100, clicks: 5, campaign_count: 1 },
    ...overrides,
  };
}

function flag(on: boolean): void {
  isServerFeatureEnabled.mockImplementation((f) => on && f === ServerFeatureFlag.CampaignServiceMonitor);
}

function nextError(next: NextFunction): unknown {
  return vi.mocked(next).mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  flag(false);
});

describe.each([
  { name: 'getMetaMonitor', svc: svcMeta, legacy: legacyMeta, account: META_ACCOUNT, label: 'LF Core' },
  { name: 'getRedditMonitor', svc: svcReddit, legacy: legacyReddit, account: REDDIT_ACCOUNT, label: 'The Linux Foundation' },
] as const)('CampaignController.$name', ({ name, svc, legacy, account, label }) => {
  it('serves the legacy path untouched while the flag is off', async () => {
    const legacyData = { campaigns: [] };
    legacy.mockResolvedValueOnce(legacyData);
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: account, days: '14', project: 'tlf' }), res, vi.fn());

    expect(legacy).toHaveBeenCalledWith(expect.anything(), account, 14);
    expect(svc).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(legacyData);
  });

  it('proxies to campaign-service with the project, account and clamped days, answering in the legacy shape', async () => {
    flag(true);
    svc.mockResolvedValueOnce(monitorPayload({ days: 90 }));
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: account, days: '365', project: ' tlf ' }), res, vi.fn());

    expect(legacy).not.toHaveBeenCalled();
    expect(svc).toHaveBeenCalledWith(expect.anything(), 'tlf', account, 90);
    const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body['accountLabel']).toBe(label);
    expect(body['dateRange']).toEqual({ mode: 'last_90_days' });
    expect(body['accountTotals']).toEqual({ spend: 10, impressions: 100, clicks: 5, conversions: 0, campaignCount: 1, conversionsMeasured: false });
  });

  it('still refuses an account outside the allowlist before calling campaign-service', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: 'act_999', project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svc).not.toHaveBeenCalled();
  });

  it('requires a project when the flag is on', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: account }), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('project');
    expect(svc).not.toHaveBeenCalled();
  });

  it('keeps an upstream status but not its text', async () => {
    flag(true);
    svc.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(404, 'Not Found', { message: 'no connection row for project 7f3e' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p')
    );
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: account, project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(404);
    expect(JSON.stringify(error.toResponse())).not.toContain('7f3e');
  });
});

describe.each([
  { name: 'getMicrosoftMonitor', svc: svcMicrosoft, good: '187654321', bad: '0187654321' },
  { name: 'getTwitterMonitor', svc: svcTwitter, good: '18ce54d4x5t', bad: '18ce-54d4' },
] as const)('CampaignController.$name', ({ name, svc, good, bad }) => {
  it('answers 404 while the flag is off, without calling campaign-service', async () => {
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: good, project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svc).not.toHaveBeenCalled();
  });

  it('returns the campaign-service body unchanged, defaulting days to 30', async () => {
    flag(true);
    const payload = monitorPayload({ account_id: good, metrics_as_of: '2026-10-12T10:00:00Z', metrics_pending: true });
    svc.mockResolvedValueOnce(payload);
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: good, project: 'tlf' }), res, vi.fn());

    expect(svc).toHaveBeenCalledWith(expect.anything(), 'tlf', good, 30);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it.each([bad, ''])('refuses account %j by shape before calling campaign-service', async (accountKey) => {
    flag(true);
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey, project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('accountKey');
    expect(svc).not.toHaveBeenCalled();
  });
});

describe('CampaignController.getTwitterMonitor conflict', () => {
  it("forwards upstream's 409 reason as upstreamCode, and no upstream text", async () => {
    flag(true);
    svcTwitter.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(
        409,
        'Conflict',
        { message: '214 campaigns active', reason: 'account_too_many_active_campaigns' },
        'LFX_V2_CAMPAIGN_SERVICE',
        '/p'
      )
    );
    const next = vi.fn();

    await new CampaignController().getTwitterMonitor(buildReq({ accountKey: '18ce54d4x5t', project: 'tlf' }), buildRes(), next);

    const response = (nextError(next) as MicroserviceError).toResponse();
    expect(response['upstreamCode']).toBe('account_too_many_active_campaigns');
    expect(JSON.stringify(response)).not.toContain('214');
  });
});

describe('CampaignController.getHubSpotMonitor', () => {
  it('answers 404 while the flag is off', async () => {
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcHubSpot).not.toHaveBeenCalled();
  });

  it('reads the project-scoped monitor with clamped days and returns it unchanged', async () => {
    flag(true);
    const payload = {
      days: 7,
      emails: [],
      action_items: [],
      totals: {},
      emails_checked: 0,
      emails_not_sent_in_window: 0,
      emails_unattributable: 0,
      emails_truncated: false,
    };
    svcHubSpot.mockResolvedValueOnce(payload);
    const res = buildRes();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf', days: '3' }), res, vi.fn());

    expect(svcHubSpot).toHaveBeenCalledWith(expect.anything(), 'tlf', 7);
    expect(res.json).toHaveBeenCalledWith(payload);
  });

  it('requires a project', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcHubSpot).not.toHaveBeenCalled();
  });

  it('maps a 503 to fixed text with the status kept', async () => {
    flag(true);
    svcHubSpot.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(503, 'Unavailable', { message: 'hubspot 429 after 3 retries' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p')
    );
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(503);
    expect(error.toResponse()['error']).toBe('HubSpot metrics are temporarily unavailable. Please try again shortly.');
  });
});
