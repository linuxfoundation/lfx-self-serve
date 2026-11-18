// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignServiceLinkedInCreateAccount } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

// The Implement tab's LinkedIn account picker route (#5809): campaign-service's
// `get-linkedin-ads-create-account` (lfx-v2-campaign-service#581), camel-cased, and 404 while
// account selection or the campaign-service create road is off. Kept out of campaign.controller.spec.ts,
// as the conversion-action route is.
const { svcRead, isServerFeatureEnabled, logger } = vi.hoisted(() => ({
  svcRead: vi.fn(),
  isServerFeatureEnabled: vi.fn<(flag: unknown) => boolean>(() => false),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public getLinkedInCreateAccount = svcRead;
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
  RedditMetricsService: class {},
  MetaMetricsService: class {},
}));
vi.mock('../services/linkedin-ads.service', () => ({ getLinkedInConfig: () => ({ accounts: [], targetingProfiles: [] }) }));
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: {} }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

const CUTOVER_FLAGS: unknown[] = [ServerFeatureFlag.CampaignServiceCreate, ServerFeatureFlag.CampaignServiceBriefs, ServerFeatureFlag.CampaignServiceJobs];

function flags({ cutover, selection }: { cutover: boolean; selection: boolean }): void {
  isServerFeatureEnabled.mockImplementation((flag) => {
    if (flag === ServerFeatureFlag.CampaignServiceLinkedInAccountSelection) return selection;
    return CUTOVER_FLAGS.includes(flag) && cutover;
  });
}

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/api/campaigns/linkedin/create-account' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

async function read(query: Record<string, unknown> = { project: 'tlf' }): Promise<{ res: Response; next: NextFunction }> {
  const res = buildRes();
  const next = vi.fn() as unknown as NextFunction;
  await new CampaignController().getLinkedInCreateAccount(buildReq(query), res, next);
  return { res, next };
}

/** Synthetic ids: the LF system account's default, then one grant. */
const UPSTREAM: CampaignServiceLinkedInCreateAccount = {
  account_id: '500000001',
  org_id: '600000001',
  label: 'Example system account',
  source: 'system',
  status: 'active',
  account_selection_enabled: true,
  selectable_accounts: [
    { account_id: '500000001', org_id: '600000001', label: 'Example system account', default: true },
    { account_id: '500000002', org_id: '600000002', label: 'Example Foundation', default: false },
  ],
};

describe('CampaignController.getLinkedInCreateAccount (#5809)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags({ cutover: true, selection: true });
  });

  it('serves the create account camel-cased', async () => {
    svcRead.mockResolvedValue(UPSTREAM);

    const { res, next } = await read();

    expect(svcRead).toHaveBeenCalledWith(expect.anything(), 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      accountId: '500000001',
      orgId: '600000001',
      label: 'Example system account',
      source: 'system',
      status: 'active',
      accountSelectionEnabled: true,
      selectableAccounts: [
        { accountId: '500000001', orgId: '600000001', label: 'Example system account', default: true },
        { accountId: '500000002', orgId: '600000002', label: 'Example Foundation', default: false },
      ],
    });
  });

  it.each([
    { label: 'account selection is off', cutover: true, selection: false },
    { label: 'campaign-service does not own the create', cutover: false, selection: true },
  ])('answers 404 without calling upstream while $label', async ({ cutover, selection }) => {
    flags({ cutover, selection });

    const { res, next } = await read();

    expect(svcRead).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as MicroserviceError;
    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error.statusCode).toBe(404);
  });

  it('refuses a read with no project before calling upstream', async () => {
    const { next } = await read({});

    expect(svcRead).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0]?.[0]).toBeInstanceOf(ServiceValidationError);
  });

  it("passes campaign-service's 404 (no LinkedIn connection) to the error handler", async () => {
    const notFound = new MicroserviceError('Resource not found', 404, 'NOT_FOUND', { operation: 'linkedin_create_account' });
    svcRead.mockRejectedValue(notFound);

    const { res, next } = await read();

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(notFound);
  });

  it('answers 502 for an upstream body it cannot trust', async () => {
    svcRead.mockResolvedValue({ ...UPSTREAM, selectable_accounts: [{ ...UPSTREAM.selectable_accounts[0], account_id: 'urn:li:sponsoredAccount:1' }] });

    const { res, next } = await read();

    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0]?.[0] as unknown as MicroserviceError;
    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error.statusCode).toBe(502);
  });
});
