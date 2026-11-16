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
// rather than dropped when the legacy creator would serve.
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
