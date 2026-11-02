// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignMonitorConnections, CampaignServiceAccountMonitor } from '@lfx-one/shared/interfaces';

import { MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE, MONITOR_SHARED_ACCOUNT_RESTRICTED_MESSAGE } from '@lfx-one/shared/constants';

import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The account-monitor routes (#2519): Google Ads, Meta and Reddit switch backend on LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR,
// and Microsoft, X and HubSpot exist only behind it. Kept out of campaign.controller.spec.ts, which is
// already 5000 lines, the way analytics.controller is split by area.
const {
  svcGoogle,
  svcLinkedIn,
  legacyLinkedIn,
  svcMeta,
  svcReddit,
  svcMicrosoft,
  svcTwitter,
  svcHubSpot,
  svcConnection,
  svcGoogleAccounts,
  svcTwitterAccounts,
  legacyMeta,
  legacyReddit,
  legacyGoogle,
  legacyKeywords,
  legacyAudience,
  svcKeywords,
  svcAudience,
  checkRootWriter,
  checkRootCampaignManager,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  svcGoogle: vi.fn(),
  svcLinkedIn: vi.fn(),
  legacyLinkedIn: vi.fn(),
  svcMeta: vi.fn(),
  svcReddit: vi.fn(),
  svcMicrosoft: vi.fn(),
  svcTwitter: vi.fn(),
  svcHubSpot: vi.fn(),
  svcConnection: vi.fn(),
  svcGoogleAccounts: vi.fn(),
  svcTwitterAccounts: vi.fn(),
  legacyMeta: vi.fn(),
  legacyReddit: vi.fn(),
  legacyGoogle: vi.fn(),
  legacyKeywords: vi.fn(),
  legacyAudience: vi.fn(),
  svcKeywords: vi.fn(),
  svcAudience: vi.fn(),
  checkRootWriter: vi.fn<(req: unknown) => Promise<boolean>>(),
  checkRootCampaignManager: vi.fn<(req: unknown) => Promise<boolean>>(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public getGoogleAdsAccountMonitor = svcGoogle;
      public getLinkedInAdsAccountMonitor = svcLinkedIn;
      public getMetaAdsAccountMonitor = svcMeta;
      public getRedditAdsAccountMonitor = svcReddit;
      public getMicrosoftAdsAccountMonitor = svcMicrosoft;
      public getTwitterAdsAccountMonitor = svcTwitter;
      public getHubSpotAccountMonitor = svcHubSpot;
      public getConnection = svcConnection;
      public listGoogleAdsAccounts = svcGoogleAccounts;
      public listTwitterAdsAccounts = svcTwitterAccounts;
      public getGoogleAdsKeywords = svcKeywords;
      public getGoogleAdsAudience = svcAudience;
    },
  };
});
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/campaign-proxy.service', () => ({ CampaignProxyService: class {} }));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {
    public getMonitorData = legacyGoogle;
    public getKeywords = legacyKeywords;
    public getAudience = legacyAudience;
  },
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
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkRootWriter, checkRootCampaignManager } }));
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

/** A caller authorised for the one project it names, but neither a ROOT writer nor a ROOT `global_marketing_ops` holder. */
function nonRoot(): void {
  checkRootWriter.mockResolvedValue(false);
  checkRootCampaignManager.mockResolvedValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  flag(false);
  // Root by default, so the account-monitor specs below exercise the arms the gate lets through.
  checkRootWriter.mockResolvedValue(true);
  checkRootCampaignManager.mockResolvedValue(true);
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

describe('CampaignController.getMonitorData (Google Ads, #4526)', () => {
  const GOOGLE_ACCOUNT = '8666746580';

  function connected(): void {
    svcConnection.mockResolvedValueOnce({ account_id: GOOGLE_ACCOUNT, label: 'LF Google Ads' });
  }

  it('serves the legacy account-wide read while the flag is off, reading no connection', async () => {
    const legacyData = { campaigns: [] };
    legacyGoogle.mockResolvedValueOnce(legacyData);
    const res = buildRes();

    await new CampaignController().getMonitorData(buildReq({ days: '14', project: 'tlf' }), res, vi.fn());

    expect(legacyGoogle).toHaveBeenCalledWith(expect.anything(), 14);
    expect(svcConnection).not.toHaveBeenCalled();
    expect(svcGoogle).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(legacyData);
  });

  it("reads the project's own connection's account with clamped days, answering in the legacy Google shape", async () => {
    flag(true);
    connected();
    svcGoogle.mockResolvedValueOnce(monitorPayload({ account_id: GOOGLE_ACCOUNT, days: 90 }));
    const res = buildRes();

    await new CampaignController().getMonitorData(buildReq({ days: '365', project: ' tlf ' }), res, vi.fn());

    expect(svcConnection).toHaveBeenCalledWith(expect.anything(), 'tlf', 'google-ads');
    expect(svcGoogle).toHaveBeenCalledWith(expect.anything(), 'tlf', GOOGLE_ACCOUNT, 90);
    expect(legacyGoogle).not.toHaveBeenCalled();
    const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body['dateRange']).toEqual({ mode: 'last_90_days' });
    expect(body['accountTotals']).toEqual({ budgetDay: 1, spend: 10, impressions: 100, clicks: 5, conversions: 0, conversionsMeasured: false });
    expect((body['campaigns'] as Record<string, unknown>[])[0]).toMatchObject({ campaignId: '1', name: 'Camp', avgCpc: 2 });
  });

  it('answers a project with no Google Ads connection of its own as the typed 404, never the legacy read', async () => {
    flag(true);
    svcConnection.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(404, 'Not Found', { code: '404', message: 'not found' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p')
    );
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(404);
    expect(error.toResponse()['upstreamCode']).toBe('connection_not_found');
    expect(svcGoogle).not.toHaveBeenCalled();
    expect(legacyGoogle).not.toHaveBeenCalled();
  });

  it('answers a connection with no account bound as a 409, reading no monitor', async () => {
    flag(true);
    svcConnection.mockResolvedValueOnce({ account_id: '', label: 'LF Google Ads' });
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(409);
    expect(svcGoogle).not.toHaveBeenCalled();
  });

  /**
   * The route admits a ROOT writer before any project check, but campaign-service authorizes the read
   * with the project's `campaign_manager` relation, which a ROOT writer need not hold (#4837). Its 403
   * is a standing refusal: answered as a 403 naming the missing role, never the retryable 503.
   */
  it("answers campaign-service's refusal of a ROOT writer without the project role as a 403, not a retryable 503", async () => {
    flag(true);
    checkRootWriter.mockResolvedValue(true);
    svcConnection.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { message: 'openfga check failed for project:7f3e' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p')
    );
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(403);
    expect(error.toResponse()['error']).toBe(
      "campaign-service refused to read this project's Google Ads connection. Your account needs the campaign manager role on this project."
    );
    expect(error.toResponse()['code']).not.toBe(MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE);
    expect(JSON.stringify(error.toResponse())).not.toContain('7f3e');
    expect(svcGoogle).not.toHaveBeenCalled();
  });

  it("words campaign-service's refusal of the monitor read itself the same way", async () => {
    flag(true);
    svcConnection.mockResolvedValueOnce({ account_id: '8666746580', label: 'LF Google Ads' });
    svcGoogle.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { message: 'x' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p'));
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(403);
    expect(error.toResponse()['error']).toBe(
      'campaign-service refused to read this Google Ads account for this project. Your account needs the campaign manager role on this project.'
    );
  });

  it('answers an unreadable connection as a 503 advisory, reading no monitor', async () => {
    flag(true);
    svcConnection.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(500, 'boom', { message: 'x' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p'));
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(503);
    expect(svcGoogle).not.toHaveBeenCalled();
  });

  it("keeps the monitor read's upstream status but not its text", async () => {
    flag(true);
    connected();
    svcGoogle.mockRejectedValueOnce(
      MicroserviceError.fromMicroserviceResponse(409, 'Conflict', { message: 'campaign 7f3e recorded under customer 123' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p')
    );
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as MicroserviceError;
    expect(error.statusCode).toBe(409);
    expect(JSON.stringify(error.toResponse())).not.toContain('7f3e');
  });

  it('requires a project, reading nothing, with the flag on', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({}), buildRes(), next);

    expect((nextError(next) as ServiceValidationError).validationErrors[0].field).toBe('project');
    expect(svcConnection).not.toHaveBeenCalled();
    expect(svcGoogle).not.toHaveBeenCalled();
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

describe('CampaignController.getGoogleAdsAccounts', () => {
  it('answers 404 while the flag is off, reading nothing', async () => {
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcGoogleAccounts).not.toHaveBeenCalled();
  });

  it("maps campaign-service's accounts onto the Meta/Reddit option shape, labelling an unlabelled one by its id", async () => {
    flag(true);
    svcGoogleAccounts.mockResolvedValueOnce({
      accounts: [{ id: '1000000001', label: 'CNCF Search' }, { id: '1000000002', label: '' }, { id: '1000000003' }],
    });
    const res = buildRes();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(svcGoogleAccounts).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(res.json).toHaveBeenCalledWith([
      { key: '1000000001', label: 'CNCF Search' },
      { key: '1000000002', label: '1000000002' },
      { key: '1000000003', label: '1000000003' },
    ]);
  });

  it('answers an empty list as an empty list', async () => {
    flag(true);
    svcGoogleAccounts.mockResolvedValueOnce({ accounts: [] });
    const res = buildRes();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('requires a project', async () => {
    flag(true);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAccounts(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcGoogleAccounts).not.toHaveBeenCalled();
  });

  it('refuses a non-root caller before any upstream call, whatever the flag says', async () => {
    flag(true);
    nonRoot();
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as AuthorizationError;
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.toResponse()['code']).toBe(MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE);
    expect(svcGoogleAccounts).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', {}],
    ['not an array', { accounts: null }],
  ])('fails the read with a 502 when accounts is %s, never an empty list', async (_case, payload) => {
    flag(true);
    svcGoogleAccounts.mockResolvedValueOnce(payload);
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: 'tlf' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it("passes campaign-service's own failure through with its status", async () => {
    flag(true);
    const upstream = MicroserviceError.fromMicroserviceResponse(
      404,
      'Not Found',
      { name: 'NotFound', message: 'no Google Ads connection configured for this project' },
      'LFX_V2_CAMPAIGN_SERVICE',
      '/p'
    );
    svcGoogleAccounts.mockRejectedValueOnce(upstream);
    const next = vi.fn();

    await new CampaignController().getGoogleAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    expect(nextError(next)).toBe(upstream);
  });
});

/**
 * Which X ad account an X create uses (LFXV2-3319): the account list beside the project's own X
 * connection. Gated on X creation (cutover + TWITTER_CREATE), and root-only because a project with
 * no X connection of its own is answered from the LF system credential.
 */
describe('CampaignController.getTwitterCreateCapability', () => {
  it.each([
    ['off', () => false, false],
    ['on with the create cutover', () => true, true],
    ['on without the create cutover', (f: unknown) => f === ServerFeatureFlag.CampaignServiceTwitterCreate, false],
  ])('answers X creation %s as the deployment-wide capability', (_label, flags, enabled) => {
    isServerFeatureEnabled.mockImplementation(flags);
    const res = buildRes();

    new CampaignController().getTwitterCreateCapability(buildReq({}), res);

    expect(res.json).toHaveBeenCalledWith({ enabled });
  });
});

describe('CampaignController.getTwitterAdsAccounts', () => {
  const twitterOn = (): void => {
    isServerFeatureEnabled.mockImplementation((f) => f !== ServerFeatureFlag.CampaignServiceMonitor);
  };

  it('answers 404 while X creation is off, reading nothing', async () => {
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(404);
    expect(svcTwitterAccounts).not.toHaveBeenCalled();
    expect(svcConnection).not.toHaveBeenCalled();
  });

  it('answers the accounts and the bound account of the project connection', async () => {
    twitterOn();
    svcTwitterAccounts.mockResolvedValueOnce({ accounts: [{ id: '18ce54d4x5t', label: 'Linux Foundation' }, { id: '8r7gb' }] });
    svcConnection.mockResolvedValueOnce({ id: 'c-1', project_id: 'tlf', account_id: '18ce54d4x5t', label: 'LF X', has_credentials: true, status: 'active' });
    const res = buildRes();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: ' tlf ' }), res, vi.fn());

    expect(svcTwitterAccounts).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(svcConnection).toHaveBeenCalledWith(expect.anything(), 'tlf', 'twitter-ads');
    expect(res.json).toHaveBeenCalledWith({
      accounts: [
        { key: '18ce54d4x5t', label: 'Linux Foundation' },
        { key: '8r7gb', label: '8r7gb' },
      ],
      connection: { state: 'connected', accountId: '18ce54d4x5t', label: 'LF X' },
    });
  });

  /** Both reads share campaign-service's `campaign_manager` rule (#4837): the answer is the role refusal, not the shared-account 403. */
  it('answers a ROOT writer refused on both reads with a forbidden connection, not an HTTP 403', async () => {
    twitterOn();
    const refused = (): MicroserviceError =>
      MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { message: 'openfga check failed' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p');
    svcTwitterAccounts.mockRejectedValueOnce(refused());
    svcConnection.mockRejectedValueOnce(refused());
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ accounts: [], connection: { state: 'forbidden', accountId: null, label: null } });
  });

  /** The API client answers `null` for an empty success; that is a malformed list, not a refusal. */
  it('fails an empty account-list answer as unreadable, not as forbidden', async () => {
    twitterOn();
    svcTwitterAccounts.mockResolvedValueOnce(null);
    svcConnection.mockResolvedValueOnce({ id: 'c-1', project_id: 'tlf', account_id: '18ce54d4x5t', label: 'LF X', has_credentials: true, status: 'active' });
    const next = vi.fn();
    const res = buildRes();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), res, next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('still fails the read on any other refusal of the account list', async () => {
    twitterOn();
    svcTwitterAccounts.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(500, 'boom', { message: 'x' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p'));
    svcConnection.mockResolvedValueOnce({ id: 'c-1', project_id: 'tlf', account_id: '18ce54d4x5t', label: 'LF X', has_credentials: true, status: 'active' });
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    expect((nextError(next) as MicroserviceError).statusCode).toBe(500);
  });

  it('reports a connection with no account bound, which the create would be refused for', async () => {
    twitterOn();
    svcTwitterAccounts.mockResolvedValueOnce({ accounts: [{ id: '18ce54d4x5t', label: 'Linux Foundation' }] });
    svcConnection.mockResolvedValueOnce({ id: 'c-1', project_id: 'tlf', account_id: '', has_credentials: true, status: 'active' });
    const res = buildRes();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), res, vi.fn());

    expect(vi.mocked(res.json).mock.calls[0][0]).toMatchObject({ connection: { state: 'no_account', accountId: null } });
  });

  it('refuses a non-root caller before any upstream call', async () => {
    twitterOn();
    nonRoot();
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), buildRes(), next);

    const error = nextError(next) as AuthorizationError;
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.toResponse()['code']).toBe(MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE);
    expect(svcTwitterAccounts).not.toHaveBeenCalled();
  });

  it('fails the read with a 502 when accounts is not an array, never an empty list', async () => {
    twitterOn();
    svcTwitterAccounts.mockResolvedValueOnce({ accounts: null });
    svcConnection.mockResolvedValueOnce({ id: 'c-1', project_id: 'tlf', account_id: 'a', has_credentials: true, status: 'active' });
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({ project: 'tlf' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect((nextError(next) as MicroserviceError).statusCode).toBe(502);
  });

  it('requires a project', async () => {
    twitterOn();
    const next = vi.fn();

    await new CampaignController().getTwitterAdsAccounts(buildReq({}), buildRes(), next);

    expect(nextError(next)).toBeInstanceOf(ServiceValidationError);
    expect(svcTwitterAccounts).not.toHaveBeenCalled();
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

  /** The pickers' read gets the same standing refusal as the Google monitor (#4837), never the retryable `unavailable`. */
  it("reports campaign-service's 403 as forbidden on the connections read", async () => {
    flag(true);
    svcConnection.mockRejectedValue(MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { message: 'x' }, 'LFX_V2_CAMPAIGN_SERVICE', '/p'));
    const res = buildRes();

    await new CampaignController().getMonitorConnections(buildReq({ project: 'tlf' }), res, vi.fn());

    const body = vi.mocked(res.json).mock.calls[0][0] as CampaignMonitorConnections;
    expect(body.platforms.linkedin?.state).toBe('forbidden');
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

/**
 * lfx-self-serve-ops#54: the Google Ads, Meta, Reddit and X accounts are shared by every foundation,
 * as is LinkedIn's legacy allowlist account, so their account monitors would hand one foundation's
 * campaign manager every foundation's campaigns. They are root-only on every arm, refused before
 * any upstream call and before the cutover's own 409/404 answers.
 */
describe('shared-account monitor access (lfx-self-serve-ops#54)', () => {
  function expectRestricted(next: NextFunction): void {
    const error = nextError(next) as AuthorizationError;
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.statusCode).toBe(403);
    expect(error.toResponse()).toMatchObject({ code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE, error: MONITOR_SHARED_ACCOUNT_RESTRICTED_MESSAGE });
  }

  it.each([
    { name: 'getMonitorData', legacy: legacyGoogle, svc: svcGoogle, account: '' },
    { name: 'getRedditMonitor', legacy: legacyReddit, svc: svcReddit, account: REDDIT_ACCOUNT },
    { name: 'getMetaMonitor', legacy: legacyMeta, svc: svcMeta, account: META_ACCOUNT },
  ] as const)('$name refuses a non-root caller with the flag on and off, reading nothing', async ({ name, legacy, svc, account }) => {
    nonRoot();
    for (const on of [false, true]) {
      flag(on);
      const next = vi.fn();
      const res = buildRes();

      await new CampaignController()[name](buildReq({ accountKey: account, project: 'tlf' }), res, next);

      expectRestricted(next);
      expect(res.json).not.toHaveBeenCalled();
    }
    expect(legacy).not.toHaveBeenCalled();
    expect(svc).not.toHaveBeenCalled();
    expect(svcConnection).not.toHaveBeenCalled();
  });

  it.each([false, true])('getTwitterMonitor refuses a non-root caller with the flag %s, not with the flag-off 404', async (on) => {
    nonRoot();
    flag(on);
    const next = vi.fn();

    await new CampaignController().getTwitterMonitor(buildReq({ accountKey: '18ce54d4x5t', project: 'tlf' }), buildRes(), next);

    expectRestricted(next);
    expect(svcTwitter).not.toHaveBeenCalled();
  });

  it("refuses LinkedIn's legacy allowlist arm to a non-root caller", async () => {
    nonRoot();
    const next = vi.fn();

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: '512345678', project: 'tlf' }), buildRes(), next);

    expectRestricted(next);
    expect(legacyLinkedIn).not.toHaveBeenCalled();
  });

  it("serves LinkedIn's campaign-service arm, the project's own account, to a non-root caller", async () => {
    nonRoot();
    flag(true);
    svcLinkedIn.mockResolvedValueOnce(monitorPayload({ account_id: '512345678' }));
    const res = buildRes();

    await new CampaignController().getLinkedInMonitor(buildReq({ accountKey: '512345678', project: 'tlf' }), res, vi.fn());

    expect(svcLinkedIn).toHaveBeenCalledWith(expect.anything(), 'tlf', '512345678', 30);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it.each([
    { who: 'a ROOT writer', rootWriter: true, rootCampaignManager: false },
    { who: 'a ROOT global_marketing_ops holder', rootWriter: false, rootCampaignManager: true },
  ])('serves the Google monitor to $who', async ({ rootWriter, rootCampaignManager }) => {
    checkRootWriter.mockResolvedValue(rootWriter);
    checkRootCampaignManager.mockResolvedValue(rootCampaignManager);
    const data = { campaigns: [] };
    legacyGoogle.mockResolvedValueOnce(data);
    const res = buildRes();

    await new CampaignController().getMonitorData(buildReq({ project: 'tlf', days: '7' }), res, vi.fn());

    expect(legacyGoogle).toHaveBeenCalledWith(expect.anything(), 7);
    expect(res.json).toHaveBeenCalledWith(data);
    expect(checkRootCampaignManager).toHaveBeenCalledTimes(rootWriter ? 0 : 1);
  });

  it.each([true, false])('getMonitorData answers a missing project with a 400 before the gate (root: %s)', async (root) => {
    checkRootWriter.mockResolvedValue(root);
    checkRootCampaignManager.mockResolvedValue(root);
    const next = vi.fn();

    await new CampaignController().getMonitorData(buildReq({ project: '  ' }), buildRes(), next);

    const error = nextError(next) as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.validationErrors[0].field).toBe('project');
    expect(checkRootWriter).not.toHaveBeenCalled();
    expect(legacyGoogle).not.toHaveBeenCalled();
  });

  it('refuses a non-root connection-marked Reddit read on a flag-OFF pod with the 403, not the retryable 409', async () => {
    nonRoot();
    const next = vi.fn();

    await new CampaignController().getRedditMonitor(buildReq({ accountKey: REDDIT_ACCOUNT, project: 'tlf', accountSource: 'connection' }), buildRes(), next);

    expectRestricted(next);
    expect(legacyReddit).not.toHaveBeenCalled();
  });

  it('leaves the Microsoft and HubSpot monitors open to a non-root caller', async () => {
    nonRoot();
    flag(true);
    svcMicrosoft.mockResolvedValueOnce(monitorPayload({ account_id: '187654321' }));
    svcHubSpot.mockResolvedValueOnce({
      days: 30,
      emails: [],
      action_items: [],
      totals: { email_count: 0, sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubscribes: 0, spam_reports: 0 },
    });
    const msRes = buildRes();
    const hsRes = buildRes();

    await new CampaignController().getMicrosoftMonitor(buildReq({ accountKey: '187654321', project: 'tlf' }), msRes, vi.fn());
    await new CampaignController().getHubSpotMonitor(buildReq({ project: 'tlf' }), hsRes, vi.fn());

    expect(svcMicrosoft).toHaveBeenCalledWith(expect.anything(), 'tlf', '187654321', 30);
    expect(svcHubSpot).toHaveBeenCalledWith(expect.anything(), 'tlf', 30);
    expect(msRes.json).toHaveBeenCalledTimes(1);
    expect(hsRes.json).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  { name: 'getKeywords', legacy: legacyKeywords, svc: svcKeywords, payload: { window: 'last_30_days', row_count: 0, truncated: false, rows: [] } },
  { name: 'getAudience', legacy: legacyAudience, svc: svcAudience, payload: { window: 'last_30_days', bucket_count: 0, buckets: [] } },
] as const)('shared-account legacy insights: $name', ({ name, legacy, svc, payload }) => {
  it.each([false, true])('refuses non-root legacy reads before any upstream call, monitor cutover: %s', async (monitorOn) => {
    flag(monitorOn);
    nonRoot();
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ project: 'acme-foundation', days: '30' }), res, next);

    expect(nextError(next)).toBeInstanceOf(AuthorizationError);
    expect((nextError(next) as AuthorizationError).toResponse()).toMatchObject({ code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE });
    expect(legacy).not.toHaveBeenCalled();
    expect(svc).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it.each([true, false])('serves legacy insights to a ROOT caller, writer: %s', async (writer) => {
    checkRootWriter.mockResolvedValue(writer);
    checkRootCampaignManager.mockResolvedValue(!writer);
    const data = { legacy: true };
    legacy.mockResolvedValueOnce(data);
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ project: 'acme-foundation', days: '7' }), res, next);

    expect(legacy).toHaveBeenCalledWith(expect.anything(), 7);
    expect(res.json).toHaveBeenCalledWith(data);
    expect(next).not.toHaveBeenCalled();
    expect(checkRootCampaignManager).toHaveBeenCalledTimes(writer ? 0 : 1);
  });

  it('keeps campaign-service project-scoped insights available to a non-root caller', async () => {
    nonRoot();
    isServerFeatureEnabled.mockImplementation((f) => f === ServerFeatureFlag.CampaignServiceInsights);
    svc.mockResolvedValueOnce(payload);
    const res = buildRes();
    const next = vi.fn();

    await new CampaignController()[name](buildReq({ project: 'acme-foundation', days: '30' }), res, next);

    expect(svc).toHaveBeenCalledWith(expect.anything(), 'acme-foundation', 'last_30_days');
    expect(legacy).not.toHaveBeenCalled();
    expect(checkRootWriter).not.toHaveBeenCalled();
    expect(checkRootCampaignManager).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });
});
