// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LINKEDIN_DAILY_CAP_FIELD } from '@lfx-one/shared/constants';
import type { LinkedInRuntimeConfig } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The LinkedIn daily cap (#5774): an optional `dailyCapUsd` beside a lifetime budget, forwarded to
// campaign-service (linuxfoundation/lfx-v2-campaign-service#607) only when its rules hold, and refused
// rather than dropped when the legacy creator would serve. The `linkedInConfig` key allow-list (#5764) shares
// this harness, in its own describe at the end.
const { createCampaigns, loadBrief, loadBriefById, legacyCreate, isServerFeatureEnabled, logger, linkedInConfig } = vi.hoisted(() => ({
  createCampaigns: vi.fn(),
  loadBrief: vi.fn(),
  loadBriefById: vi.fn(),
  legacyCreate: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => true),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
  linkedInConfig: { current: undefined as unknown },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public createCampaigns = createCampaigns;
      public loadBrief = loadBrief;
      public loadBriefById = loadBriefById;
    },
  };
});
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/server-feature-flag.helper')>();
  return { ...actual, isServerFeatureEnabled };
});
vi.mock('../services/campaign-proxy.service', () => ({
  CampaignProxyService: class {
    public createCampaign = legacyCreate;
  },
}));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {},
  LinkedInMetricsService: class {},
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../services/linkedin-ads.service', () => ({ getLinkedInConfig: () => linkedInConfig.current }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));
vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    checkRootWriter: vi.fn(async () => true),
    checkRootCampaignManager: vi.fn(async () => true),
    checkProjectGlobalMarketingOpsStrict: vi.fn(async () => true),
  },
}));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

/** Synthetic facet ids: two profiles, as the ConfigMap carries them. */
const CONFIG: LinkedInRuntimeConfig = {
  defaultAccountId: '500000001',
  defaultOrgId: '600000001',
  accounts: [{ accountId: '500000001', orgId: '600000001', label: 'Example account' }],
  employerExclusions: ['urn:li:company:900001'],
  targetingProfiles: [
    {
      id: 'cloud-native',
      label: 'Cloud Native',
      skills: ['urn:li:skill:101', 'urn:li:skill:102', 'urn:li:skill:103'],
      groups: ['urn:li:group:201', 'urn:li:group:202'],
    },
    { id: 'mcp', label: 'AI / MCP', skills: ['urn:li:skill:301'], groups: ['urn:li:group:401'] },
  ],
};

function buildReq(linkedInConfigBody: Record<string, unknown>): Request {
  return {
    body: { platforms: ['linkedin-ads'], linkedInConfig: { budgetUsd: 100, ...linkedInConfigBody } },
    query: { project: 'tlf', brief_id: 'b-1' },
    path: '/api/campaigns/create',
  } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

function sentLinkedInConfig(): Record<string, unknown> {
  return (createCampaigns.mock.calls[0][4] as Record<string, unknown>)['linkedInConfig'] as Record<string, unknown>;
}

async function create(linkedInConfigBody: Record<string, unknown>): Promise<{ res: Response; next: NextFunction }> {
  const res = buildRes();
  const next = vi.fn() as unknown as NextFunction;
  await new CampaignController().createCampaign(buildReq(linkedInConfigBody), res, next);
  return { res, next };
}

function refusal(next: NextFunction): { field: string; message: string } {
  const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as ServiceValidationError;
  expect(error).toBeInstanceOf(ServiceValidationError);
  return error.validationErrors[0];
}

describe('CampaignController LinkedIn daily cap (#5774)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkedInConfig.current = CONFIG;
    isServerFeatureEnabled.mockImplementation(() => true);
    loadBriefById.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    createCampaigns.mockResolvedValue({ enabled: true, jobId: 'job-1', error: null });
  });

  it('forwards a valid cap beside a lifetime budget to campaign-service', async () => {
    const { next } = await create({ budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: 20, targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
    const sent = sentLinkedInConfig();
    expect(sent['dailyCapUsd']).toBe(20);
    expect(sent['budgetUsd']).toBe(1000);
    expect(sent['lifetimeBudget']).toBe(true);
  });

  it('accepts a cap equal to the lifetime budget', async () => {
    const { next } = await create({ budgetUsd: 100, lifetimeBudget: true, dailyCapUsd: 100, targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    expect(sentLinkedInConfig()['dailyCapUsd']).toBe(100);
  });

  it('sends nothing new when no cap is set', async () => {
    const { next } = await create({ budgetUsd: 1000, lifetimeBudget: true, targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    expect('dailyCapUsd' in sentLinkedInConfig()).toBe(false);
  });

  it.each([
    ['a string', { budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: '20' }, 'must be a number'],
    ['null', { budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: null }, 'must be a number'],
    ['beside a daily budget', { budgetUsd: 50, dailyCapUsd: 20 }, 'applies only to a lifetime budget'],
    ['under the daily minimum', { budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: 9.99 }, 'at least $10'],
    ['above the lifetime budget', { budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: 1500 }, "can't be more than the lifetime budget"],
    // campaign-service rounds the total 100.125 to 100.12 (ties to even), so 100.13 is above it.
    [
      'above a half-cent total once rounded as upstream rounds it',
      { budgetUsd: 100.125, lifetimeBudget: true, dailyCapUsd: 100.13 },
      "can't be more than the lifetime budget",
    ],
  ])('refuses a cap that is %s before anything is created', async (_name, config, message) => {
    const { next } = await create({ ...config, targetingProfile: 'cloud-native' });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const reason = refusal(next);
    expect(reason.field).toBe(LINKEDIN_DAILY_CAP_FIELD);
    expect(reason.message).toContain(message);
  });

  it('refuses a cap while the cutover is dark, since the legacy creator would drop it', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => !(CUTOVER_FLAGS as unknown[]).includes(flag));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const { next } = await create({ budgetUsd: 1000, lifetimeBudget: true, dailyCapUsd: 20, targetingProfile: 'cloud-native' });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const reason = refusal(next);
    expect(reason.field).toBe(LINKEDIN_DAILY_CAP_FIELD);
    expect(reason.message).toContain('not enabled on this deployment');
  });

  it('lets an uncapped create through while the cutover is dark, as before', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => !(CUTOVER_FLAGS as unknown[]).includes(flag));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const { res, next } = await create({ budgetUsd: 1000, lifetimeBudget: true, targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_1' });
  });
});

// The key allow-list (#5764): a `linkedInConfig` key the route does not check never reaches campaign-service.
describe('CampaignController LinkedIn config keys (#5764)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkedInConfig.current = CONFIG;
    isServerFeatureEnabled.mockImplementation(() => true);
    loadBriefById.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    createCampaigns.mockResolvedValue({ enabled: true, jobId: 'job-1', error: null });
  });

  it('refuses a key it does not check before anything is created', async () => {
    const { next } = await create({ lifetimeBudget: false, targetingProfile: 'cloud-native', jobFunctions: ['urn:li:function:8'] });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(refusal(next).field).toBe('linkedInConfig');
  });

  it('forwards Germany and the United Kingdom with the corrected URNs when a saved brief carries the old ones', async () => {
    const { next } = await create({
      lifetimeBudget: false,
      targetingProfile: 'cloud-native',
      geoTargets: [
        { label: 'Germany', urn: 'urn:li:geo:101165590' },
        { label: 'United Kingdom', urn: 'urn:li:geo:106693272' },
      ],
    });

    expect(next).not.toHaveBeenCalled();
    expect(sentLinkedInConfig()['geoTargets']).toEqual([
      { label: 'Germany', urn: 'urn:li:geo:101282230' },
      { label: 'United Kingdom', urn: 'urn:li:geo:101165590' },
    ]);
  });

  it('does not throw on a linkedInConfig that is not an object', async () => {
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;
    const req = {
      body: { platforms: ['linkedin-ads'], linkedInConfig: true },
      query: { project: 'tlf', brief_id: 'b-1' },
      path: '/api/campaigns/create',
    } as unknown as Request;

    await new CampaignController().createCampaign(req, res, next);
    // An error with no status is what the error handler answers as a 500 (a TypeError from `in` on a primitive).
    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown;
    if (error !== undefined) {
      expect(error).not.toBeInstanceOf(TypeError);
      expect((error as { statusCode?: number }).statusCode).toBeLessThan(500);
    }
  });

  it('hands the legacy creator the corrected Germany while the cutover is dark', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => !(CUTOVER_FLAGS as unknown[]).includes(flag));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const { next } = await create({ lifetimeBudget: false, targetingProfile: 'cloud-native', geoTargets: [{ label: 'Germany', urn: 'urn:li:geo:101165590' }] });

    expect(next).not.toHaveBeenCalled();
    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect((legacyCreate.mock.calls[0][1] as { linkedInConfig: { geoTargets: unknown } }).linkedInConfig.geoTargets).toEqual([
      { label: 'Germany', urn: 'urn:li:geo:101282230' },
    ]);
  });

  // A variant's ad name, description and call to action (#5764 rows 16–17); the rules are table rows in
  // `campaign-linkedin-variant-fields.utils.spec.ts`.
  const variant = { introText: 'Join us', headline: 'Summit' };

  it('forwards a variant ad name, description and call to action as checked and compacted', async () => {
    const { next } = await create({
      lifetimeBudget: false,
      targetingProfile: 'cloud-native',
      variants: [{ ...variant, name: '  Ad\tA ', description: 'Two days of talks', callToAction: ' register ' }],
    });

    expect(next).not.toHaveBeenCalled();
    expect(sentLinkedInConfig()['variants']).toEqual([{ ...variant, name: 'Ad A', description: 'Two days of talks', callToAction: 'REGISTER' }]);
  });

  it('refuses a call to action while its flag is off, before anything is created', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== ServerFeatureFlag.CampaignServiceLinkedInCallToAction);

    const { next } = await create({ lifetimeBudget: false, targetingProfile: 'cloud-native', variants: [{ ...variant, callToAction: 'REGISTER' }] });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(refusal(next).field).toBe('linkedInConfig.variants[0].callToAction');
  });

  // LinkedIn Text Ads (#5764 row 19); the rules are table rows in `campaign-linkedin-text-ads.utils.spec.ts`.
  const textAds = [{ headline: 'KubeCon NA', description: 'Join cloud native engineers.' }];
  const manual = { strategy: 'manual', bidAmount: 5 };

  it('forwards a Text Ads create as it came', async () => {
    const { next } = await create({ lifetimeBudget: false, targetingProfile: 'cloud-native', variants: [], format: 'text', textAds, bidding: manual });

    expect(next).not.toHaveBeenCalled();
    expect(sentLinkedInConfig()).toMatchObject({ format: 'text', textAds, variants: [] });
  });

  it('refuses a Text Ads create while its flag is off, before anything is created', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== ServerFeatureFlag.CampaignServiceLinkedInTextAds);

    const { next } = await create({ lifetimeBudget: false, targetingProfile: 'cloud-native', variants: [], format: 'text', textAds, bidding: manual });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(refusal(next).field).toBe('linkedInConfig.format');
  });

  it('refuses a text ad image while LinkedIn creative assets are off, before anything is created', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== ServerFeatureFlag.CampaignServiceLinkedInAssets);

    const { next } = await create({
      lifetimeBudget: false,
      targetingProfile: 'cloud-native',
      variants: [],
      format: 'text',
      textAds: [{ ...textAds[0], imageAssetId: 'a1' }],
      bidding: manual,
    });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(refusal(next).field).toBe('linkedInConfig.textAds[0].imageAssetId');
  });
});
