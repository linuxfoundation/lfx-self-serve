// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignMonitorConnections, CampaignServiceAccountMonitor } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The account-monitor routes (#2519): Meta and Reddit switch backend on LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR,
// and Microsoft, X and HubSpot exist only behind it. Kept out of campaign.controller.spec.ts, which is
// already 5000 lines, the way analytics.controller is split by area.
const {
  svcLinkedIn,
  legacyLinkedIn,
  svcMeta,
  svcReddit,
  svcMicrosoft,
  svcTwitter,
  svcHubSpot,
  svcConnection,
  legacyMeta,
  legacyReddit,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  svcLinkedIn: vi.fn(),
  legacyLinkedIn: vi.fn(),
  svcMeta: vi.fn(),
  svcReddit: vi.fn(),
  svcMicrosoft: vi.fn(),
  svcTwitter: vi.fn(),
  svcHubSpot: vi.fn(),
  svcConnection: vi.fn(),
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
      public getLinkedInAdsAccountMonitor = svcLinkedIn;
      public getMetaAdsAccountMonitor = svcMeta;
      public getRedditAdsAccountMonitor = svcReddit;
      public getMicrosoftAdsAccountMonitor = svcMicrosoft;
      public getTwitterAdsAccountMonitor = svcTwitter;
      public getHubSpotAccountMonitor = svcHubSpot;
      public getConnection = svcConnection;
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
  LinkedInMetricsService: class {
    public getLinkedInMonitorData = legacyLinkedIn;
  },
  RedditMetricsService: class {
    public getRedditMonitorData = legacyReddit;
  },
  MetaMetricsService: class {
    public getMonitorData = legacyMeta;
  },
}));
vi.mock('../services/linkedin-ads.service', () => ({
  getLinkedInConfig: () => ({ accounts: [{ accountId: '512345678', label: 'LF LinkedIn', orgId: '1' }], targetingProfiles: [] }),
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
  { name: 'getLinkedInMonitor', svc: svcLinkedIn, legacy: legacyLinkedIn, account: '512345678', label: 'LF LinkedIn' },
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

  /**
   * With the cutover on, the picker offers the project's CONNECTION's account, which need not be in
   * the configured allowlist — campaign-service, not this BFF, decides whether it is the project's.
   * So an off-list account is read, and labelled by its id since the allowlist has no name for it.
   */
  it("reads the connection's account even when it is not in the allowlist, labelled by its id", async () => {
    flag(true);
    const offList = { getLinkedInMonitor: '700000001', getMetaMonitor: 'act_700000001', getRedditMonitor: 't2_offlist' }[name];
    svc.mockResolvedValueOnce(monitorPayload({ account_id: offList }));
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: offList, project: 'tlf' }), res, vi.fn());

    expect(svc).toHaveBeenCalledWith(expect.anything(), 'tlf', offList, 30);
    expect((vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>)['accountLabel']).toBe(offList);
  });

  it.each(['', 'act_1/../x', '12 34'])('refuses a malformed account %j by shape before calling campaign-service', async (accountKey) => {
    flag(true);
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey, project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('accountKey');
    expect(svc).not.toHaveBeenCalled();
  });

  it('still refuses an off-allowlist account on the legacy path (flag off)', async () => {
    // LinkedIn's legacy route falls back to the first configured account instead of refusing; its
    // test is below.
    if (name === 'getLinkedInMonitor') return;
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: 'act_999', project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(legacy).not.toHaveBeenCalled();
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

  it('maps the campaign-service body with its freshness, defaulting days to 30', async () => {
    flag(true);
    const payload = monitorPayload({
      account_id: good,
      metrics_as_of: '2026-10-12T10:00:00Z',
      metrics_window_start: '2026-09-13',
      metrics_window_end: '2026-10-12',
      metrics_pending: true,
    });
    svc.mockResolvedValueOnce(payload);
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: good, project: 'tlf' }), res, vi.fn());

    expect(svc).toHaveBeenCalledWith(expect.anything(), 'tlf', good, 30);
    const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      accountId: good,
      metricsAsOf: '2026-10-12T10:00:00Z',
      metricsWindowStart: '2026-09-13',
      metricsWindowEnd: '2026-10-12',
      metricsPending: true,
      dateRange: { mode: 'last_30_days' },
    });
    expect((body['campaigns'] as { campaignId: string }[])[0].campaignId).toBe('1');
  });

  it("names a metrics-disabled 400 with upstreamCode 'metrics_not_enabled', and no upstream text", async () => {
    flag(true);
    svc.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(
        400,
        'Bad Request',
        { code: '400', message: 'account monitor is not supported for this platform' },
        'LFX_V2_CAMPAIGN_SERVICE',
        '/p'
      )
    );
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey: good, project: 'tlf' }), buildRes(), next);

    const response = (nextError(next) as MicroserviceError).toResponse();
    expect((nextError(next) as MicroserviceError).statusCode).toBe(400);
    expect(response['upstreamCode']).toBe('metrics_not_enabled');
    expect(JSON.stringify(response)).not.toContain('not supported');
  });

  it.each([bad, ''])('refuses account %j by shape before calling campaign-service', async (accountKey) => {
    flag(true);
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ accountKey, project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('accountKey');
    expect(svc).not.toHaveBeenCalled();
  });
});

describe('CampaignController.getLinkedInMonitor account resolution', () => {
  it('keeps the legacy fallback to the first configured account when the key is unknown, flag off', async () => {
    legacyLinkedIn.mockResolvedValueOnce({ campaigns: [] });

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: 'nope', project: 'tlf', days: '7' }), buildRes(), vi.fn());

    expect(legacyLinkedIn).toHaveBeenCalledWith(expect.anything(), '512345678', 7);
  });

  /**
   * Flag on, the fallback would silently swap the connection's account for an allowlist one that
   * campaign-service then refuses as not this connection's — so an id that is not an id is refused.
   */
  it('does NOT fall back to a configured account with the flag on', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: 'nope', project: 'tlf', days: '7' }), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('accountKey');
    expect(svcLinkedIn).not.toHaveBeenCalled();
  });

  it('keeps the configured label for an allowlisted account, and maps creatives as not read', async () => {
    flag(true);
    svcLinkedIn.mockResolvedValueOnce(monitorPayload({ account_id: '512345678' }));
    const res = buildRes();

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: '512345678', project: 'tlf', days: '7' }), res, vi.fn());

    expect(svcLinkedIn).toHaveBeenCalledWith(expect.anything(), 'tlf', '512345678', 7);
    const body = vi.mocked(res.json).mock.calls[0][0] as { accountLabel: string; campaigns: { creatives: unknown[]; eventName: string }[] };
    expect(body.accountLabel).toBe('LF LinkedIn');
    expect(body.campaigns[0].creatives).toEqual([]);
    expect(body.campaigns[0].eventName).toBe('Camp');
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

  it('reads the project-scoped monitor with clamped days and maps it', async () => {
    flag(true);
    const payload = {
      days: 7,
      emails: [],
      action_items: [],
      totals: { email_count: 0, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, spam_reports: 0 },
      emails_checked: 2,
      emails_not_sent_in_window: 2,
      emails_unattributable: 0,
      emails_truncated: false,
    };
    svcHubSpot.mockResolvedValueOnce(payload);
    const res = buildRes();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf', days: '3' }), res, vi.fn());

    expect(svcHubSpot).toHaveBeenCalledWith(expect.anything(), 'tlf', 7);
    expect(vi.mocked(res.json).mock.calls[0][0]).toMatchObject({
      days: 7,
      emails: [],
      actionItems: [],
      metricsAsOf: null,
      emailsChecked: 2,
      emailsNotSentInWindow: 2,
      emailsTruncated: false,
      totals: { emailCount: 0, sent: 0, openRate: null },
    });
  });

  it('requires a project', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcHubSpot).not.toHaveBeenCalled();
  });

  /** `totals` is required upstream; reading its absence as zeros would show "0 sent". */
  it.each([
    ['absent', undefined],
    ['empty', {}],
    ['malformed', { email_count: 1, sent: '5000' }],
  ])('fails the read with a fixed 502 when totals are %s, never zeros', async (_case, totals) => {
    flag(true);
    svcHubSpot.mockResolvedValueOnce({
      days: 30,
      emails: [],
      action_items: [],
      totals,
      emails_checked: 0,
      emails_not_sent_in_window: 0,
      emails_unattributable: 0,
      emails_truncated: false,
    });
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(502);
    expect(error.toResponse()['error']).toBe('campaign-service returned an unreadable HubSpot monitor response.');
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

// Upstream declares these arrays required, but the success log must not be what turns a malformed
// body into a 500: the mapper already tolerates an absent array, so the log has to as well.
describe('CampaignController monitor success logs tolerate null upstream arrays', () => {
  it.each([
    ['getLinkedInMonitor', svcLinkedIn, { accountKey: '512345678', project: 'tlf' }],
    ['getMetaMonitor', svcMeta, { accountKey: META_ACCOUNT, project: 'tlf' }],
    ['getRedditMonitor', svcReddit, { accountKey: REDDIT_ACCOUNT, project: 'tlf' }],
    ['getMicrosoftMonitor', svcMicrosoft, { accountKey: '187654321', project: 'tlf' }],
    ['getTwitterMonitor', svcTwitter, { accountKey: '18ce54d4x5t', project: 'tlf' }],
  ] as const)('%s answers 200 when campaigns is null', async (name, svc, query) => {
    flag(true);
    svc.mockResolvedValueOnce(monitorPayload({ campaigns: null as unknown as [] }));
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController()[name](buildReq(query), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('getHubSpotMonitor answers 200 when emails and action_items are null', async () => {
    flag(true);
    svcHubSpot.mockResolvedValueOnce({
      days: 30,
      emails: null,
      action_items: null,
      totals: { email_count: 0, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, spam_reports: 0 },
      emails_checked: 0,
      emails_not_sent_in_window: 0,
      emails_unattributable: 0,
      emails_truncated: false,
    });
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
  });
});

describe('CampaignController.getMonitorConnections', () => {
  function connection(accountId: string, label?: string): Record<string, unknown> {
    return { id: 'c1', project_id: 'tlf', account_id: accountId, label, has_credentials: true, status: 'active', version: 1, etag: '"1"' };
  }

  function notFound(): MicroserviceError {
    return MicroserviceError.fromMicroserviceResponse(
      404,
      'Not Found',
      { code: '404', message: 'no linkedin ads connection configured for this project' },
      'LFX_V2_CAMPAIGN_SERVICE',
      '/p'
    );
  }

  it('answers viaCampaignService false while the flag is off, reading nothing', async () => {
    const res = buildRes();

    await new CampaignController().getMonitorConnections(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ viaCampaignService: false, platforms: {} });
    expect(svcConnection).not.toHaveBeenCalled();
  });

  it("reads each provider's own connection and reports its account, or why there is none", async () => {
    flag(true);
    svcConnection.mockImplementation(async (_req: unknown, _project: string, provider: string) => {
      switch (provider) {
        case 'linkedin-ads':
          return connection('512345678', 'CNCF LinkedIn');
        case 'meta-ads':
          return connection('');
        case 'reddit-ads':
          throw notFound();
        case 'microsoft-ads':
          return connection('187654321');
        default:
          throw MicroserviceError.fromMicroserviceResponse(503, 'Unavailable', { message: 'x' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p');
      }
    });
    const res = buildRes();

    await new CampaignController().getMonitorConnections(buildReq({ project: ' cncf ' }), res, vi.fn());

    expect(svcConnection).toHaveBeenCalledTimes(5);
    expect(svcConnection).toHaveBeenCalledWith(expect.anything(), 'cncf', 'linkedin-ads');
    const body = vi.mocked(res.json).mock.calls[0][0] as CampaignMonitorConnections;
    expect(body).toEqual({
      viaCampaignService: true,
      platforms: {
        linkedin: { state: 'connected', accountId: '512345678', label: 'CNCF LinkedIn' },
        meta: { state: 'no_account', accountId: null, label: null },
        reddit: { state: 'no_connection', accountId: null, label: null },
        microsoft: { state: 'connected', accountId: '187654321', label: '187654321' },
        twitter: { state: 'unavailable', accountId: null, label: null },
      },
    });
  });

  /**
   * Only campaign-service's own typed 404 says the connection does not exist. A bare gateway 404
   * (no `code`) is an outage or a routing miss, and calling it "no connection" would tell an
   * operator to connect something that is already connected.
   */
  it("offers a legacy Meta connection's bare numeric id in the act_ form the Meta monitor takes", async () => {
    flag(true);
    svcConnection.mockImplementation(async (_req: unknown, _project: string, provider: string) =>
      provider === 'meta-ads' ? connection('193556282970417', 'CNCF Meta') : connection('187654321')
    );
    const res = buildRes();

    await new CampaignController().getMonitorConnections(buildReq({ project: 'cncf' }), res, vi.fn());

    const body = vi.mocked(res.json).mock.calls[0][0] as CampaignMonitorConnections;
    expect(body.platforms.meta).toEqual({ state: 'connected', accountId: 'act_193556282970417', label: 'CNCF Meta' });
    // Every other provider's numeric id is offered exactly as stored.
    expect(body.platforms.linkedin?.accountId).toBe('187654321');
    expect(body.platforms.microsoft?.accountId).toBe('187654321');
  });

  it('reports a bare gateway 404 as unavailable, not as a missing connection', async () => {
    flag(true);
    svcConnection.mockRejectedValue(MicroserviceError.fromMicroserviceResponse(404, 'Not Found', 'Not Found', 'LFX_V2_CAMPAIGN_SERVICE', '/p'));
    const res = buildRes();

    await new CampaignController().getMonitorConnections(buildReq({ project: 'tlf' }), res, vi.fn());

    const body = vi.mocked(res.json).mock.calls[0][0] as CampaignMonitorConnections;
    expect(body.platforms.linkedin?.state).toBe('unavailable');
  });

  it('requires a project when the flag is on', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getMonitorConnections(buildReq({}), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('project');
    expect(svcConnection).not.toHaveBeenCalled();
  });
});

/**
 * A rolling flag change (#2519): `/monitor/connections` can land on a pod with the cutover ON and
 * the follow-up monitor read on one with it OFF. That pod must refuse a read marked
 * `accountSource=connection` with a retryable 409 — never serve LinkedIn's default account, refuse
 * Reddit's or Meta's as off the allowlist, or answer the campaign-service-only routes with a 404.
 */
describe('CampaignController monitor reads during a mixed rollout', () => {
  it.each([
    ['getLinkedInMonitor', legacyLinkedIn, svcLinkedIn, '700000001'],
    ['getRedditMonitor', legacyReddit, svcReddit, 't2_offlist'],
    ['getMetaMonitor', legacyMeta, svcMeta, 'act_700000001'],
  ] as const)('%s refuses a connection-path read on a flag-OFF pod, with no legacy fallback', async (name, legacy, svc, account) => {
    const next = vi.fn();
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: account, project: 'tlf', accountSource: 'connection' }), res, next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(409);
    expect(error.toResponse()).toMatchObject({ code: 'MONITOR_CUTOVER_MISMATCH', error: 'The monitor is switching data sources; refresh in a moment.' });
    expect(legacy).not.toHaveBeenCalled();
    expect(svc).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each([
    ['getMicrosoftMonitor', svcMicrosoft, { accountKey: '187654321' }],
    ['getTwitterMonitor', svcTwitter, { accountKey: '18ce54d4x5t' }],
    ['getHubSpotMonitor', svcHubSpot, {}],
  ] as const)('%s answers the mismatch 409, not its flag-off 404, for a marked read', async (name, svc, query) => {
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ ...query, project: 'tlf', accountSource: 'connection' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('MONITOR_CUTOVER_MISMATCH');
    expect(svc).not.toHaveBeenCalled();
  });

  it('serves a marked read normally on a flag-ON pod', async () => {
    flag(true);
    svcReddit.mockResolvedValueOnce(monitorPayload({ account_id: 't2_offlist' }));
    const res = buildRes();

    await new CampaignController().getRedditMonitor(buildReq({ accountKey: 't2_offlist', project: 'tlf', accountSource: 'connection' }), res, vi.fn());

    expect(svcReddit).toHaveBeenCalledWith(expect.anything(), 'tlf', 't2_offlist', 30);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  /**
   * The inverse direction: the tab discovered its pickers on a flag-OFF pod (legacy allowlist
   * accounts), and the read lands on a flag-ON pod. campaign-service would refuse the allowlist
   * account as not this project's connection's, so the pod answers a typed 409 of its own, which
   * the tab's Retry turns into a fresh discovery.
   */
  it.each([
    ['getLinkedInMonitor', legacyLinkedIn, svcLinkedIn, '512345678'],
    ['getRedditMonitor', legacyReddit, svcReddit, REDDIT_ACCOUNT],
    ['getMetaMonitor', legacyMeta, svcMeta, META_ACCOUNT],
  ] as const)('%s refuses a legacy-picker read on a flag-ON pod with the legacy mismatch 409', async (name, legacy, svc, account) => {
    flag(true);
    const next = vi.fn();
    const res = buildRes();

    await new CampaignController()[name](buildReq({ accountKey: account, project: 'tlf', accountSource: 'legacy' }), res, next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(409);
    expect(error.toResponse()).toMatchObject({ code: 'MONITOR_CUTOVER_LEGACY_MISMATCH', error: 'The monitor is switching data sources; refresh in a moment.' });
    expect(svc).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('serves a legacy-marked read normally on a flag-OFF pod', async () => {
    legacyMeta.mockResolvedValueOnce({ campaigns: [] });
    const res = buildRes();

    await new CampaignController().getMetaMonitor(buildReq({ accountKey: META_ACCOUNT, project: 'tlf', accountSource: 'legacy' }), res, vi.fn());

    expect(legacyMeta).toHaveBeenCalledWith(expect.anything(), META_ACCOUNT, 30);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('serves an unmarked read (the Optimize tab) on a flag-ON pod as before', async () => {
    flag(true);
    svcLinkedIn.mockResolvedValueOnce(monitorPayload({ account_id: '512345678' }));
    const res = buildRes();

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: '512345678', project: 'tlf' }), res, vi.fn());

    expect(svcLinkedIn).toHaveBeenCalledWith(expect.anything(), 'tlf', '512345678', 30);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('leaves an unmarked legacy read on a flag-OFF pod exactly as before', async () => {
    legacyLinkedIn.mockResolvedValueOnce({ campaigns: [] });

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: 'nope', project: 'tlf' }), buildRes(), vi.fn());

    expect(legacyLinkedIn).toHaveBeenCalledWith(expect.anything(), '512345678', 30);
  });
});
