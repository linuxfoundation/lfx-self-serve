// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { saveBrief, isServerFeatureEnabled, logger } = vi.hoisted(() => ({
  saveBrief: vi.fn(),
  isServerFeatureEnabled: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// `deriveEventSlug` is deliberately NOT stubbed. It is the function that decides whether a brief
// is persistable at all, so a fake would let the slug-refusal test below pass against a controller
// that had stopped calling it.
vi.mock('../services/campaign-service.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/campaign-service.service')>();
  return {
    ...actual,
    CampaignServiceClient: class {
      public saveBrief = saveBrief;
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
vi.mock('../services/logger.service', () => ({ logger }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: () => false }));

import { CampaignController } from './campaign.controller';

/** The narrowest brief that reaches campaign-service: a slug is the only field the controller reads. */
function briefWithSlug(slug: string): CampaignBriefOutput {
  return { eventDetails: { slug }, selectedPlatforms: ['google-ads'] } as unknown as CampaignBriefOutput;
}

function buildReq(body: unknown, query: Record<string, unknown> = { project: 'tlf' }): Request {
  return { body, query, path: '/api/campaigns/brief/persist' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as unknown as Response;
}

/**
 * The service layer's own spec covers what gets sent to campaign-service. What is only decidable
 * here is the layer boundary: whether a dark cutover is reported as a non-failure, whether an
 * unusable brief is refused before it costs a round trip, and whether a save that fails reaches
 * the error middleware instead of being answered with a 200 the user reads as "saved".
 */
describe('CampaignController.persistBrief', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    isServerFeatureEnabled.mockReturnValue(true);
    saveBrief.mockResolvedValue({ enabled: true, briefId: 'brief-1', etag: 'W/"3"', created: false, approved: true });
  });

  it('answers a dark cutover with enabled:false and never calls campaign-service', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026')), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    // 200 with a body, not a 4xx/5xx: the flag being off is the default in every environment, so
    // an error status here would fire the client's error arm on the ordinary case.
    expect(res.json).toHaveBeenCalledWith({ enabled: false, briefId: '', etag: null, created: false, approved: false });
  });

  it('returns the save result unchanged so the client can tell a create from a replace', async () => {
    saveBrief.mockResolvedValue({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });

    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026')), res, next);

    expect(saveBrief).toHaveBeenCalledTimes(1);
    expect(saveBrief.mock.calls[0][2]).toBe('kubecon-eu-2026');
    expect(saveBrief.mock.calls[0][3]).toBe('tlf');
    expect(res.json).toHaveBeenCalledWith({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: true });
    expect(next).not.toHaveBeenCalled();
  });

  // The page is reachable by an ED of any foundation, and campaign-service files briefs per
  // project. Defaulting an unresolved context to a constant would silently write one foundation's
  // work into another's table, so an absent slug is refused rather than guessed at.
  it.each([
    ['no project param at all', {}],
    ['a blank project param', { project: '   ' }],
    ['a repeated project param, which Express parses as an array', { project: ['tlf', 'cncf'] }],
  ])('refuses %s rather than defaulting the foundation', async (_label, query) => {
    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026'), query), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.toResponse()['errors']).toEqual([
      { field: 'project', message: 'no foundation is selected; reload the campaigns page from the sidebar', code: 'FIELD_VALIDATION_ERROR' },
    ]);
  });

  // Passed straight through: the client cannot tell a saved-and-approved brief from a saved-only
  // one otherwise, and Phase 3 refuses to create campaigns from anything still in `draft`.
  it('reports a saved-but-unapproved brief without turning it into an error', async () => {
    saveBrief.mockResolvedValue({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: false });

    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026')), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ enabled: true, briefId: 'brief-9', etag: 'W/"1"', created: true, approved: false });
  });

  it('refuses a brief with no event slug before spending a round trip', async () => {
    await controller.persistBrief(buildReq(briefWithSlug('   ')), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    // Asserted through toResponse() rather than `error.message`, because that is the shape the
    // browser receives: `forField` sets the top-level message to "Validation failed for <field>"
    // and carries the human-readable text in the errors array.
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    // The text must name the event page URL rather than `event_slug`, which is a field name from
    // a service the user has never heard of and did not type into.
    expect(error.toResponse()['errors']).toEqual([
      { field: 'eventDetails.slug', message: 'the brief has no event slug; check the event page URL', code: 'FIELD_VALIDATION_ERROR' },
    ]);
  });

  it('refuses a body that is not a brief', async () => {
    await controller.persistBrief(buildReq(null), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('sends a failed save to the error middleware instead of answering 200', async () => {
    const failure = new Error('campaign-service returned 500');
    saveBrief.mockRejectedValue(failure);

    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026')), res, next);

    // The whole point of the feature is that the user learns the brief is not durable. Answering
    // 200 here would leave them working on a brief they believe is saved.
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});
