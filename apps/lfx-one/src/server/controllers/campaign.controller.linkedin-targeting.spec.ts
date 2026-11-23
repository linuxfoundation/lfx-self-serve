// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LINKEDIN_TARGETING_PROFILE_EDIT_FIELD } from '@lfx-one/shared/constants';
import type { LinkedInRuntimeConfig } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The LinkedIn targeting edit (#5546): the Implement tab may send the selected profile with entries
// REMOVED, and the controller forwards it to campaign-service only when it is exactly that.
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

describe('CampaignController LinkedIn targeting edit (#5546)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkedInConfig.current = CONFIG;
    isServerFeatureEnabled.mockImplementation(() => true);
    loadBriefById.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    createCampaigns.mockResolvedValue({ enabled: true, jobId: 'job-1', error: null });
  });

  it('serves the configured profiles for the Implement tab', () => {
    const res = buildRes();
    const next = vi.fn();
    const req = {} as Request;

    new CampaignController().getLinkedInTargetingProfiles(req, res, next);

    expect(res.json).toHaveBeenCalledWith(CONFIG.targetingProfiles);
    expect(next).not.toHaveBeenCalled();
    expect(logger.startOperation).toHaveBeenCalledWith(req, 'get_linkedin_targeting_profiles', {});
    expect(logger.success).toHaveBeenCalledWith(req, 'get_linkedin_targeting_profiles', 0, { count: CONFIG.targetingProfiles.length });
  });

  it('hands a failed profile read to the error handler instead of throwing', () => {
    linkedInConfig.current = undefined as never;
    const res = buildRes();
    const next = vi.fn();

    new CampaignController().getLinkedInTargetingProfiles({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('forwards the configured catalogue unchanged when the request carries no edit', async () => {
    const { next } = await create({ targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    const sent = sentLinkedInConfig();
    expect(sent['targetingProfiles']).toBe(CONFIG.targetingProfiles);
    expect(sent).not.toHaveProperty('targetingProfileEdit');
    expect(sent['targetingProfile']).toBe('cloud-native');
  });

  it('narrows the selected profile to the kept entries, in the configured order and with the configured label', async () => {
    const { next } = await create({
      targetingProfile: 'cloud-native',
      targetingProfileEdit: { id: 'cloud-native', skills: ['urn:li:skill:103', 'urn:li:skill:101'], groups: [] },
    });

    expect(next).not.toHaveBeenCalled();
    const sent = sentLinkedInConfig();
    expect(sent['targetingProfiles']).toEqual([
      { id: 'cloud-native', label: 'Cloud Native', skills: ['urn:li:skill:101', 'urn:li:skill:103'], groups: [] },
      CONFIG.targetingProfiles[1],
    ]);
    // Not an upstream field: it shapes the catalogue and goes no further.
    expect(sent).not.toHaveProperty('targetingProfileEdit');
    expect(sent['targetingProfile']).toBe('cloud-native');
  });

  it('accepts an edit of cloud-native for a custom selection, which campaign-service reads as cloud-native', async () => {
    const { next } = await create({
      targetingProfile: 'custom',
      targetingProfileEdit: { id: 'cloud-native', skills: ['urn:li:skill:102'], groups: ['urn:li:group:202'] },
    });

    expect(next).not.toHaveBeenCalled();
    expect((sentLinkedInConfig()['targetingProfiles'] as { id: string; skills: string[] }[])[0]).toEqual({
      id: 'cloud-native',
      label: 'Cloud Native',
      skills: ['urn:li:skill:102'],
      groups: ['urn:li:group:202'],
    });
  });

  it.each([
    ['a skill the profile does not carry', { skills: ['urn:li:skill:101', 'urn:li:skill:999'], groups: [] }, 'adding targeting is not supported'],
    ['a group from another profile', { skills: [], groups: ['urn:li:group:401'] }, 'adding targeting is not supported'],
    ['a skill filed under groups', { skills: [], groups: ['urn:li:skill:101'] }, 'adding targeting is not supported'],
    [
      'more entries than the profile has',
      { skills: ['urn:li:skill:101', 'urn:li:skill:101', 'urn:li:skill:102', 'urn:li:skill:103'], groups: [] },
      'adding targeting is not supported',
    ],
    ['an entry listed twice', { skills: ['urn:li:skill:101', 'urn:li:skill:101'], groups: [] }, 'more than once'],
    ['a non-string entry', { skills: [101], groups: [] }, 'adding targeting is not supported'],
    ['skills that are not a list', { skills: 'urn:li:skill:101', groups: [] }, 'must be a list'],
    ['groups missing', { skills: [] }, 'must be a list'],
  ])('refuses %s, before anything is dispatched', async (_label, facets, message) => {
    const { next } = await create({ targetingProfile: 'cloud-native', targetingProfileEdit: { id: 'cloud-native', ...facets } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const reason = refusal(next);
    expect(reason.field).toBe(LINKEDIN_TARGETING_PROFILE_EDIT_FIELD);
    expect(reason.message).toContain(message);
  });

  it.each([
    ['an id that is not a profile', 'cloud-native', 'kubernetes', 'for the selected targeting profile'],
    ['an edit of a profile other than the selected one', 'cloud-native', 'mcp', 'for the selected targeting profile'],
    ['an edit of custom itself, which campaign-service never reads', 'custom', 'custom', 'for the selected targeting profile'],
  ])('refuses %s', async (_label, targetingProfile, id, message) => {
    const { next } = await create({ targetingProfile, targetingProfileEdit: { id, skills: [], groups: [] } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(refusal(next).message).toContain(message);
  });

  it('refuses an edit of a selected profile the ConfigMap does not carry', async () => {
    linkedInConfig.current = { ...CONFIG, targetingProfiles: [CONFIG.targetingProfiles[0]] };

    const { next } = await create({ targetingProfile: 'mcp', targetingProfileEdit: { id: 'mcp', skills: [], groups: [] } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(refusal(next).message).toContain('not configured on this deployment');
  });

  it.each([null, ['cloud-native'], 'cloud-native'])('refuses a malformed edit (%o)', async (targetingProfileEdit) => {
    const { next } = await create({ targetingProfile: 'cloud-native', targetingProfileEdit });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(refusal(next).message).toContain('must be an object');
  });

  it('refuses an edit while the cutover is dark, since the legacy creator would drop it', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => !(CUTOVER_FLAGS as unknown[]).includes(flag));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const { next } = await create({ targetingProfile: 'cloud-native', targetingProfileEdit: { id: 'cloud-native', skills: [], groups: [] } });

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const reason = refusal(next);
    expect(reason.field).toBe(LINKEDIN_TARGETING_PROFILE_EDIT_FIELD);
    expect(reason.message).toContain('not enabled on this deployment');
  });

  it('lets an unedited create through while the cutover is dark, as before', async () => {
    isServerFeatureEnabled.mockImplementation((flag) => !(CUTOVER_FLAGS as unknown[]).includes(flag));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const { res, next } = await create({ targetingProfile: 'cloud-native' });

    expect(next).not.toHaveBeenCalled();
    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_1' });
  });
});
