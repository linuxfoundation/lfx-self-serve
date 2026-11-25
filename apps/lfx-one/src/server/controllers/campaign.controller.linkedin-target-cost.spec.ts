// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkedInRuntimeConfig } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// LinkedIn target cost (linuxfoundation/lfx-v2-campaign-service#674): wiring only. The rules are table rows in
// `campaign-linkedin-target-cost.utils.spec.ts`; here, that the create route forwards a passed target unchanged and
// refuses the rest before anything is created.
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

describe('CampaignController LinkedIn target cost (#674)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkedInConfig.current = CONFIG;
    isServerFeatureEnabled.mockImplementation(() => true);
    loadBriefById.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    createCampaigns.mockResolvedValue({ enabled: true, jobId: 'job-1', error: null });
  });

  it('forwards a target on automatic bidding unchanged', async () => {
    const { next } = await create({ targetingProfile: 'cloud-native', bidding: { strategy: 'automatic', targetAmount: 17.88 } });

    expect(next).not.toHaveBeenCalled();
    expect(sentLinkedInConfig()['bidding']).toEqual({ strategy: 'automatic', targetAmount: 17.88 });
  });

  it('refuses a target while its flag is off, before anything is created', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => flag !== ServerFeatureFlag.CampaignServiceLinkedInTargetCost);

    const { next } = await create({ targetingProfile: 'cloud-native', bidding: { strategy: 'automatic', targetAmount: 17.88 } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(refusal(next).field).toBe('linkedInConfig.bidding.targetAmount');
  });

  it('refuses a target beside a manual bid', async () => {
    const { next } = await create({ targetingProfile: 'cloud-native', bidding: { strategy: 'manual', bidAmount: 5, targetAmount: 17.88 } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(refusal(next)).toMatchObject({ field: 'linkedInConfig.bidding.targetAmount', message: expect.stringContaining('automatic bidding') });
  });
});
