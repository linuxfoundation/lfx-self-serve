// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  saveBrief,
  loadBrief,
  createCampaigns,
  legacyCreate,
  svcGetJobStatus,
  legacyGetJobStatus,
  searchHubSpotEmails,
  toggleCampaignStatus,
  listBriefCampaigns,
  getBriefMetrics,
  svcGetKeywords,
  svcResolveCampaign,
  svcApplyKeywordActions,
  legacyKeywordActions,
  svcGetAudience,
  legacyGetKeywords,
  legacyGetAudience,
  legacyUpdateStatus,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  saveBrief: vi.fn(),
  loadBrief: vi.fn(),
  createCampaigns: vi.fn(),
  legacyCreate: vi.fn(),
  svcGetJobStatus: vi.fn(),
  legacyGetJobStatus: vi.fn(),
  searchHubSpotEmails: vi.fn(),
  toggleCampaignStatus: vi.fn(),
  listBriefCampaigns: vi.fn(),
  getBriefMetrics: vi.fn(),
  svcGetKeywords: vi.fn(),
  svcResolveCampaign: vi.fn(),
  svcApplyKeywordActions: vi.fn(),
  legacyKeywordActions: vi.fn(),
  svcGetAudience: vi.fn(),
  legacyGetKeywords: vi.fn(),
  legacyGetAudience: vi.fn(),
  legacyUpdateStatus: vi.fn(),
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
      public loadBrief = loadBrief;
      public createCampaigns = createCampaigns;
      public getJobStatus = svcGetJobStatus;
      public searchHubSpotEmails = searchHubSpotEmails;
      public toggleCampaignStatus = toggleCampaignStatus;
      public listBriefCampaigns = listBriefCampaigns;
      public getBriefMetrics = getBriefMetrics;
      public getGoogleAdsKeywords = svcGetKeywords;
      public resolveGoogleAdsCampaign = svcResolveCampaign;
      public applyKeywordActions = svcApplyKeywordActions;
      public getGoogleAdsAudience = svcGetAudience;
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
    public getJobStatus = legacyGetJobStatus;
    public updateCampaignStatus = legacyUpdateStatus;
    public executeKeywordActions = legacyKeywordActions;
  },
}));
vi.mock('../services/campaign-metrics.service', () => ({
  CampaignMetricsService: class {
    public getKeywords = legacyGetKeywords;
    public getAudience = legacyGetAudience;
  },
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

  it('rejects a non-string event slug instead of throwing a TypeError', async () => {
    // `req.body as CampaignBriefOutput` is a compile-time claim about untrusted JSON.
    // `deriveEventSlug` calls `.trim()` on the slug, so a number reached it and threw — turning
    // malformed input into a 500 rather than the controlled 400 sitting right beside it.
    await controller.persistBrief(buildReq({ eventDetails: { slug: 42 } } as never), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Error;
    expect(error.message).toContain('eventDetails.slug');
  });

  it('rejects a non-array platform list instead of forwarding it upstream', async () => {
    // `selectedPlatforms` is passed to campaign-service as `platforms`. A non-array does not
    // throw locally, so without this it becomes an upstream contract violation reported against
    // a field the user never typed.
    await controller.persistBrief(buildReq({ eventDetails: { slug: 'kubecon-eu-2026' }, selectedPlatforms: 'google-ads' } as never), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const error = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Error;
    expect(error.message).toContain('selectedPlatforms');
  });

  it('answers a dark cutover with enabled:false and never calls campaign-service', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await controller.persistBrief(buildReq(briefWithSlug('kubecon-eu-2026')), res, next);

    expect(saveBrief).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    // 200 with a body, not a 4xx/5xx: the flag being off is an ordinary deployment state rather
    // than a fault, so an error status here would fire the client's error arm on that case.
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

/**
 * The read half of brief persistence. The same flag gates both read and write; they flip
 * together because a read without a write (or vice versa) is a broken cutover that either hides
 * a persisted brief or makes one disappear. Tests here assert the boundary: that the flag's state
 * is consulted, that query params are not defaulted but refused, and that every status the
 * service can return is passed through unchanged.
 */
describe('CampaignController.loadBrief', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function buildLoadReq(query: Record<string, unknown> = { event_slug: 'kubecon-eu-2026', project: 'tlf' }): Request {
    return { query, path: '/api/campaigns/brief' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    isServerFeatureEnabled.mockReturnValue(true);
  });

  it('answers a dark cutover without calling campaign-service, signaling the ordinary steady state', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await controller.loadBrief(buildLoadReq(), res, next);

    // The flag being off is an ordinary deployment state and warrants no error. A 4xx/5xx
    // would fire the client's error arm on the ordinary case and train whoever sees it to ignore
    // a UI that should never fire.
    expect(loadBrief).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'off', briefId: null, brief: null, etag: null, approved: false });
  });

  it('refuses to look up a brief without an event_slug query param', async () => {
    // Rejected rather than passed through: campaign-service's `find-brief` declares MinLength(1)
    // on `event_slug`, so an empty one is a 400 naming a field the user never typed — the same
    // reason `persistBrief` checks upstream. Better to refuse here, saying what is actually
    // wrong (the derived slug is empty), than to relay campaign-service's complaint about a
    // field name the user never saw.
    await controller.loadBrief(buildLoadReq({ event_slug: '', project: 'tlf' }), res, next);

    expect(loadBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.toResponse()['errors']).toEqual([{ field: 'event_slug', message: 'event_slug is required', code: 'FIELD_VALIDATION_ERROR' }]);
  });

  it.each([
    ['no event_slug param at all', { project: 'tlf' }],
    ['a blank event_slug param', { event_slug: '   ', project: 'tlf' }],
  ])('refuses %s rather than passing it through', async (_label, query) => {
    await controller.loadBrief(buildLoadReq(query), res, next);

    expect(loadBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('refuses to look up a brief without a project query param, even though the page itself is scoped by one', async () => {
    // The page is reachable by an ED of any foundation, and campaign-service files briefs per
    // project. Defaulting an unresolved context to a constant would silently read one foundation's
    // brief table on behalf of another, offering to restore the wrong foundation's brief or finding
    // nothing — and if the user saves after, the update would overwrite whatever brief the
    // foundation that owns it had. Refusing is the only safe course.
    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: '' }), res, next);

    expect(loadBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.toResponse()['errors']).toEqual([
      { field: 'project', message: 'no foundation is selected; reload the campaigns page from the sidebar', code: 'FIELD_VALIDATION_ERROR' },
    ]);
  });

  it.each([
    ['no project param at all', { event_slug: 'kubecon-eu-2026' }],
    ['a blank project param', { event_slug: 'kubecon-eu-2026', project: '   ' }],
  ])('refuses %s rather than defaulting the foundation', async (_label, query) => {
    await controller.loadBrief(buildLoadReq(query), res, next);

    expect(loadBrief).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('returns a "none" status when campaign-service has no brief for this slug', async () => {
    // The ordinary first-time case: the user has not generated a brief yet, so campaign-service
    // returns nothing. This is not an error, just an empty result that tells the UI "generate one".
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
  });

  it('returns a "loaded" status with the brief when campaign-service reconstructs it successfully', async () => {
    // A saved brief that this build can deserialize. The brief object is returned unchanged so
    // the Implementation tab can use it immediately without a second round trip.
    const mockBrief = {
      eventDetails: { slug: 'kubecon-eu-2026', name: 'KubeCon EU 2026' },
      structuredCopy: null,
      keywords: [],
    } as unknown as CampaignBriefOutput;
    loadBrief.mockResolvedValue({ status: 'loaded', briefId: 'brief-abc123', brief: mockBrief, etag: 'W/"7"', approved: true });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'loaded', briefId: 'brief-abc123', brief: mockBrief, etag: 'W/"7"', approved: true });
  });

  it('returns an "unreadable" status with the brief ID when a row exists but cannot be reconstructed', async () => {
    // A stored brief that has become undeserializable (e.g. a schema change, or a corrupted row).
    // Returning the ID lets whoever investigates look it up, and the distinct status prevents the
    // UI from treating this as "no brief" and silently overwriting the orphaned row with a new save.
    // The client learns "a saved brief exists but could not be opened" and can prompt the user
    // rather than pretending the slate is clean.
    loadBrief.mockResolvedValue({ status: 'unreadable', briefId: 'brief-def456', brief: null, etag: 'W/"9"', approved: false });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'unreadable', briefId: 'brief-def456', brief: null, etag: 'W/"9"', approved: false });
  });

  it('sends a failed load to the error middleware instead of returning a degraded result', async () => {
    // campaign-service returned an error (not a 404 — that is the "none" case). A 500 is not a
    // "brief not found" outcome and should not be answered as one. Letting it through to the error
    // middleware preserves the failure signal; swallowing it would train the UI to move on when it
    // should wait for the service to recover.
    const failure = new Error('campaign-service returned 500');
    loadBrief.mockRejectedValue(failure);

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});

/**
 * The layer boundary that matters for the creation cutover: whether the legacy path — which has
 * REAL side effects on the ad platforms — runs, and under exactly which conditions. Everything
 * about what campaign-service is sent is the service spec's business.
 */
describe('CampaignController.createCampaign cutover', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  const body = { platforms: ['linkedin-ads'], linkedInConfig: { budgetUsd: 100 }, hsToken: 'hs-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicit rather than relying on an unstubbed mock returning undefined. The controller now
    // reads this flag directly (for the `?project=` validation), so leaving it unset would make
    // every test in this block depend on a falsy default rather than a stated condition.
    isServerFeatureEnabled.mockReturnValue(true);
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
  });

  it('falls through to the legacy path when the cutover is dark', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_123_abc' });

    await controller.createCampaign(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_123_abc' });
  });

  it('does NOT run the legacy path once campaign-service accepts the job', async () => {
    // The property worth pinning: both paths create real campaigns on real ad platforms, so a
    // fall-through after an accepted 202 would double-create and spend twice.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-000000000001', error: null });

    await controller.createCampaign(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '9f1c2d3e-0000-4000-8000-000000000001' });
  });

  it('does NOT fall back when campaign-service refuses the create', async () => {
    // Enabled-but-refused is the dangerous case. Falling through would create the campaigns
    // anyway while the user is told creation failed — a worse outcome than any error message,
    // because the spend is real and nobody is looking for it.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: null, error: 'Campaign creation could not be started. Please try again.' });

    await controller.createCampaign(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: 'Campaign creation could not be started. Please try again.' });
  });

  it('allows a create when the same platform IS configured', async () => {
    // The contrast: identical platform, but Search selected, so `buildGoogleAdsConfig` builds a
    // config. Without this, the test above would pass on a controller that refused everything.
    const withSearch = { platforms: ['google-ads'], campaignTypes: ['search'], budgetUsd: 5000, headlines: ['a'], descriptions: ['b'] };
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-000000000002', error: null });

    await controller.createCampaign(buildReq(withSearch, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: '9f1c2d3e-0000-4000-8000-000000000002' });
  });

  /**
   * A missing `?project=` is a client 400, matching `getJobStatus` and every other validation in
   * this controller.
   *
   * Left to fall through it produced "this campaign could not be created because its brief has not
   * been saved yet" — wrong (the brief may well be saved) and TERMINAL, so it also blocked the
   * legacy fall-through.
   */
  it('rejects a create with no project slug once the cutover is on', async () => {
    isServerFeatureEnabled.mockReturnValue(true);

    await controller.createCampaign(buildReq(body, { brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('does not require a project slug when CREATE is on but a prerequisite is off', async () => {
    // The guard must match `createCampaigns`, which gates on all three flags. Checking CREATE
    // alone 400'd a request the legacy path serves fine: with JOBS off the cutover is dark,
    // `createCampaigns` reports disabled, and the create falls through — needing no slug.
    isServerFeatureEnabled.mockImplementation((flag: string) => !String(flag).includes('JOBS'));
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_partial_1' });

    await controller.createCampaign(buildReq(body, { brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(legacyCreate).toHaveBeenCalledTimes(1);
  });

  it('does not require a project slug while the cutover is dark', async () => {
    // The legacy path neither reads nor needs the param, so requiring it there would be the same
    // category error as putting the unconfigured-platform guard in the controller was.
    isServerFeatureEnabled.mockReturnValue(false);
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_legacy_1' });

    await controller.createCampaign(buildReq(body, { brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(legacyCreate).toHaveBeenCalledTimes(1);
  });

  it('passes the project slug and brief id from the query, not the body', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(body, { project: 'cncf', brief_id: 'b-9' }), res, next);

    // Slug, NOT a UUID: campaign-service stamps it into the campaign name and keys the dispatch
    // connection lookup on it, so a UUID here fails twice over.
    expect(createCampaigns).toHaveBeenCalledWith(
      expect.anything(),
      'b-9',
      'cncf',
      ['linkedin-ads'],
      // `linkedInConfig` is adapted, not forwarded: the account override is stripped and the
      // runtime targeting catalogue is added. Asserted loosely here because the exact catalogue
      // comes from config on disk; the adapter has its own dedicated test above.
      { hsToken: 'hs-1', linkedInConfig: expect.objectContaining({ budgetUsd: 100 }) },
      // The options object carries `campaignTypes` for the Demand Gen refusal. Asserted rather
      // than loosened to `expect.anything()`, so dropping the argument fails here too.
      { campaignTypes: undefined }
    );
  });

  it('omits absent per-platform configs rather than sending them as null', async () => {
    // The dispatcher reads an absent config as "not selected" and a null one as a malformed
    // selection, so the difference is not cosmetic.
    //
    // The selection is now reddit + linkedin rather than reddit alone. A platform with NO config
    // no longer reaches this call at all — it is refused before dispatch, because campaign-service
    // reads an absent config key as a zero value and would have dispatched it with empty fields.
    // So the property this test exists for is checked on the platform that IS configured: the
    // envelope carries `linkedInConfig` and does not invent a null `redditConfig` beside it.
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const body = { platforms: ['linkedin-ads'], linkedInConfig: { budgetUsd: 100 } };
    await controller.createCampaign(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).toHaveBeenCalledWith(
      expect.anything(),
      'b-1',
      'tlf',
      ['linkedin-ads'],
      // `objectContaining`: `linkedInConfig` is ADAPTED, not forwarded — the runtime targeting
      // catalogue is added from config on disk. The adapter has its own test above; what this one
      // pins is the absence of an invented `redditConfig`.
      { linkedInConfig: expect.objectContaining({ budgetUsd: 100 }) },
      { campaignTypes: undefined }
    );
    // The property this test exists for: no INVENTED null config for a platform not selected.
    // `linkedInConfig` is present and adapted (see the LinkedIn adapter test above).
    expect(envelopeFor(createCampaigns)).not.toHaveProperty('redditConfig');
  });

  const googleBody = (overrides: Record<string, unknown> = {}) => ({
    platforms: ['google-ads'],
    campaignTypes: ['search'],
    budgetUsd: 1000,
    searchBudgetPct: 60,
    headlines: ['H1'],
    descriptions: ['D1'],
    keywords: [{ term: 'kubernetes', matchType: 'Exact', intentLevel: 'high', notes: 'n' }],
    ...overrides,
  });

  const envelopeFor = (mock: typeof createCampaigns): Record<string, unknown> => mock.mock.calls[0][4] as Record<string, unknown>;

  it('sends googleAdsConfig so the campaign has a budget and servable keywords', async () => {
    // Without this the dispatcher creates a campaign with a zero budget and an ad group with no
    // criteria, which per the service's own contract "can never serve".
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody(), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(envelopeFor(createCampaigns)['googleAdsConfig']).toEqual({
      budget: 1000,
      // Named explicitly since LFXV2-3257 — see buildGoogleAdsConfig.
      channel: 'search',
      headlines: ['H1'],
      descriptions: ['D1'],
      // `text`, not `term`, and an upper-case enum: the service's keyword shape.
      keywords: [{ text: 'kubernetes', matchType: 'EXACT' }],
    });
  });

  it('funds Google with the SEARCH share when demand-gen is also selected', async () => {
    // The dispatcher composes a "Search Campaign" and creates exactly one Search campaign, so the
    // combined budget would spend the demand-gen half on Search.
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['search', 'demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect((envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>)['budget']).toBe(600);
  });

  /**
   * The legacy LinkedIn object cannot be forwarded unchanged, and both halves fail the dispatch:
   *
   *   - `adAccountId` is REJECTED on mismatch (`linkedin.go:143`, "cross-account campaigns are not
   *     allowed"), and the legacy request carries this app's account, not the project connection's.
   *   - the dispatcher builds its runtime config from `targetingProfiles` (plural catalogue) and
   *     `employerExclusions` (`linkedin.go:135`); the legacy request carries neither, so an
   *     ordinary profile selection fails with "not found in runtime config".
   */
  it('strips the legacy ad account and adds the runtime targeting catalogue for LinkedIn', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const linkedInBody = {
      platforms: ['linkedin-ads'],
      linkedInConfig: { budgetUsd: 100, adAccountId: '507654321', targetingProfile: { id: 'cloud-native' } },
    };
    await controller.createCampaign(buildReq(linkedInBody, { project: 'tlf', brief_id: 'b-1' }), res, next);

    const sent = envelopeFor(createCampaigns)['linkedInConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('adAccountId');
    expect(sent).toHaveProperty('targetingProfiles');
    expect(sent).toHaveProperty('employerExclusions');
    // The user's SELECTION survives — it is what the catalogue is resolved against, not a
    // duplicate of it.
    expect(sent['targetingProfile']).toEqual({ id: 'cloud-native' });
    expect(sent['budgetUsd']).toBe(100);
  });

  /**
   * SUPERSEDED by LFXV2-3257, which is why this now asserts the opposite of what it once did.
   *
   * The old contract omitted `googleAdsConfig` entirely for a demand-gen-only create, because
   * "the dispatcher would otherwise run a demand-gen request as Search" — true when the config
   * had no way to name a channel. campaign-service now takes `channel`, so the config is sent
   * and names it. Omitting it today would mark the platform UNCONFIGURED and refuse a create the
   * service can serve.
   */
  it('sends a demand-gen googleAdsConfig rather than omitting it', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(envelopeFor(createCampaigns)['googleAdsConfig']).toEqual({
      budget: 1000,
      channel: 'demand-gen',
    });
  });

  /**
   * The regression guard for a bug I shipped and had to back out.
   *
   * The unconfigured-platform refusal was briefly in the controller, ABOVE the `createCampaigns`
   * call, where it ran unconditionally. That broke demand-gen-only Google creation with every flag
   * OFF — a case the legacy path has always supported, because its `includeGoogle` gates on
   * platform membership alone and Google's inputs live on the request root, not in a config
   * object. The guard tests for a campaign-service envelope key, so applying it to the legacy path
   * was a category error.
   */
  it('still runs the legacy path for a demand-gen-only Google create when the cutover is dark', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_dg_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_dg_1' });
  });

  /**
   * Demand-gen-only is the one mixed-type case the cutover can serve today (LFXV2-3257).
   * Before this, `buildGoogleAdsConfig` returned null whenever Search was unselected, so the
   * platform read as UNCONFIGURED and the whole create was refused — Demand Gen was
   * unreachable through campaign-service even after the Go client existed.
   */
  it('sends the demand-gen channel when only demand gen is selected', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['channel']).toBe('demand-gen');
  });

  /**
   * The WHOLE budget, not the search share. `searchBudgetPct` splits a budget between two
   * campaigns; with no Search campaign to fund there is nothing to split, and sending 70% would
   * silently underfund the only campaign being created.
   */
  it('gives a demand-gen-only create the whole budget', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: ['demand-gen'], budgetUsd: 500, searchBudgetPct: 70 }), { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    // Pinned WHOLE, like the search branch above. Asserting only `budget` would pass a builder
    // that leaked a stray field into the demand-gen envelope — headlines or keywords copied
    // across from the search branch, say — which campaign-service would then receive on a
    // channel that has no use for them.
    expect(envelopeFor(createCampaigns)['googleAdsConfig']).toEqual({
      budget: 500,
      channel: 'demand-gen',
    });
  });

  /**
   * Search keeps its channel explicitly, and keeps the SPLIT budget. The contrast matters: without
   * it the two tests above would pass on a builder that sent demand-gen for everything.
   */
  it('keeps sending the search channel and the split budget for a mixed selection', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: ['search', 'demand-gen'], budgetUsd: 500, searchBudgetPct: 70 }), { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['channel']).toBe('search');
    expect(sent['budget']).toBe(350);
  });

  it('renames Meta budgetUsd to the budget key the dispatcher reads', async () => {
    // Passing metaConfig through unchanged leaves `budget` at zero, and the Meta client rejects
    // every such dispatch with "invalid budget: must be a positive number".
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const metaConfig = { budgetUsd: 250, lifetimeBudget: false, geoTargets: ['US'], variants: [{ primaryText: 'p', headline: 'h' }] };
    await controller.createCampaign(buildReq({ platforms: ['meta-ads'], metaConfig }, { project: 'tlf', brief_id: 'b-1' }), res, next);

    const sent = envelopeFor(createCampaigns)['metaConfig'] as Record<string, unknown>;
    expect(sent['budget']).toBe(250);
    expect(sent).not.toHaveProperty('budgetUsd');
    expect(sent['geoTargets']).toEqual(['US']);
  });

  /**
   * LFXV2-3312. These assert the WIRE PAYLOAD — `envelopeFor` reads the fifth argument actually
   * handed to `createCampaigns` — rather than the request object, because a shape-only assertion
   * on the request would pass against a broken mapping. `unmarshalPlatformConfig` upstream reads a
   * missing key as a ZERO VALUE rather than an error, so a wrong key name is silent.
   */
  const microsoftConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    eventName: 'KubeCon',
    eventSlug: 'kubecon',
    registrationUrl: 'https://example.com',
    budgetUsd: 300,
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    geoTargets: ['US'],
    keywords: [{ text: 'kubernetes', matchType: 'Exact' }],
    ...overrides,
  });

  const createWithMicrosoft = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });
    await controller.createCampaign(
      buildReq({ platforms: ['microsoft-ads'], microsoftConfig: microsoftConfig(overrides) }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );
  };

  it('renames Microsoft budgetUsd to the budget key the dispatcher reads', async () => {
    await createWithMicrosoft();

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent['budget']).toBe(300);
    expect(sent).not.toHaveProperty('budgetUsd');
    expect(sent['keywords']).toEqual([{ text: 'kubernetes', matchType: 'Exact' }]);
    expect(sent['geoTargets']).toEqual(['US']);
  });

  it('omits cpcBid and timeZone when unset, leaving Microsoft its serve-capable defaults', async () => {
    // An explicit 0 would claim a bid the account does not have; omitted means Microsoft applies
    // the account-currency minimum. A blank timeZone is the same non-answer as an absent one.
    await createWithMicrosoft({ cpcBid: 0, timeZone: '   ' });

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('cpcBid');
    expect(sent).not.toHaveProperty('timeZone');
  });

  /**
   * The client refuses a supplied bid outside [0.01, 1000] (`targeting.go:263-268`), and because
   * creation is async that refusal is a FAILED JOB, not an error on this request. Dropped rather
   * than refused whole: unset is a valid serve-capable state, so the campaign still works.
   */
  it.each([
    ['below the minimum', 0.001],
    ['above the maximum', 1001],
  ])('drops a cpcBid %s rather than dispatching one Microsoft rejects', async (_label, cpcBid) => {
    await createWithMicrosoft({ cpcBid });

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('cpcBid');
    // The rest of the config still dispatches — an out-of-range bid must not sink the campaign.
    expect(sent['budget']).toBe(300);
  });

  it.each([
    ['the minimum', 0.01],
    ['the maximum', 1000],
  ])('forwards a cpcBid at %s, which is in range', async (_label, cpcBid) => {
    await createWithMicrosoft({ cpcBid });

    expect((envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>)['cpcBid']).toBe(cpcBid);
  });

  /**
   * The client refuses these BEFORE its first create call (`targeting.go:183`, `:195`,
   * `geo.go:243`), so an over-cap list is an async dead job rather than a refusal of the request.
   * Refused whole rather than TRUNCATED: silently dropping the 61st keyword would dispatch a
   * campaign targeting less than the operator asked for, with nothing saying so.
   */
  it.each([
    ['more than 60 keywords', { keywords: Array.from({ length: 61 }, (_, i) => ({ text: `kw-${i}`, matchType: 'Exact' })) }],
    ['a keyword longer than 100 characters', { keywords: [{ text: 'k'.repeat(101), matchType: 'Exact' }] }],
    [
      'more than 30 geo targets',
      { geoTargets: Array.from({ length: 31 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))) },
    ],
  ])('refuses a Microsoft create with %s', async (_label, overrides) => {
    await createWithMicrosoft(overrides);

    expect(envelopeFor(createCampaigns)).not.toHaveProperty('microsoftConfig');
  });

  /**
   * This route has NO body validator — `req.body` is asserted, not parsed — so a malformed body
   * reaches the builder intact. Before these checks `keywords: {}` hit `.filter` and
   * `geoTargets: [123]` hit `.trim`, answering with a 500 instead of the controlled refusal. Same
   * reasoning as `buildHubSpotConfig`, which type-checks for exactly this.
   */
  it.each([
    ['a non-array keywords value', { keywords: {} }],
    ['a non-string keyword text', { keywords: [{ text: 123, matchType: 'Exact' }] }],
    ['an unsupported match type', { keywords: [{ text: 'kubernetes', matchType: 'BROAD_MATCH' }] }],
    ['a non-array geoTargets value', { geoTargets: {} }],
    ['non-string geo entries', { geoTargets: [123] }],
    ['a non-ISO geo code', { geoTargets: ['USA'] }],
  ])('refuses a malformed Microsoft %s without throwing', async (_label, overrides) => {
    await expect(createWithMicrosoft(overrides)).resolves.not.toThrow();

    expect(envelopeFor(createCampaigns)).not.toHaveProperty('microsoftConfig');
    // Not a 500: the refusal is the controlled "unconfigured" path, so nothing reaches `next`
    // as an unexpected TypeError.
    const forwarded = vi.mocked(next).mock.calls.flat() as unknown[];
    expect(forwarded.some((e) => (e as { constructor?: { name?: string } })?.constructor?.name === 'TypeError')).toBe(false);
  });

  /**
   * REJECT-ALL, not filter-and-continue. Upstream errors on the FIRST bad entry
   * (`validateKeywords`, `validateGeoTargets`), and `resolveGeoTargets` states why: "returning the
   * partial set would create a campaign targeted at some-but-not-all of the requested countries
   * while reporting success, and a caller cannot tell that from a full result."
   *
   * Each case pairs a VALID entry with an invalid one, so a filtering implementation would build a
   * config from the survivor and pass a mere "was it refused" assertion.
   */
  it.each([
    [
      'an unsupported match type beside a valid keyword',
      {
        keywords: [
          { text: 'kubernetes', matchType: 'Exact' },
          { text: 'mesh', matchType: 'Fuzzy' },
        ],
      },
    ],
    [
      'a C0 control character beside a valid keyword',
      {
        keywords: [
          { text: 'kubernetes', matchType: 'Exact' },
          { text: 'me\tsh', matchType: 'Exact' },
        ],
      },
    ],
    // C1 (U+0080-U+009F) is rejected by Go's `unicode.IsControl` too. An earlier version of this
    // guard stopped at DEL, so U+0085 passed the preflight, was queued, and was refused upstream
    // only AFTER the campaign hierarchy may have been created — the partial create this prevents.
    ['a C1 control character (U+0085 NEL)', { keywords: [{ text: 'kuber\u0085netes', matchType: 'Exact' }] }],
    ['a C1 control character (U+009F APC)', { keywords: [{ text: 'kuber\u009Fnetes', matchType: 'Exact' }] }],
    ['a DEL character (U+007F)', { keywords: [{ text: 'kuber\u007Fnetes', matchType: 'Exact' }] }],
    [
      'an over-length keyword beside a valid one',
      {
        keywords: [
          { text: 'kubernetes', matchType: 'Exact' },
          { text: 'k'.repeat(101), matchType: 'Exact' },
        ],
      },
    ],
    [
      'a blank keyword beside a valid one',
      {
        keywords: [
          { text: 'kubernetes', matchType: 'Exact' },
          { text: '   ', matchType: 'Exact' },
        ],
      },
    ],
    ['a non-ISO code beside a valid geo', { geoTargets: ['US', 'USA'] }],
    ['a blank code beside a valid geo', { geoTargets: ['US', '  '] }],
  ])('refuses the WHOLE Microsoft config for %s rather than dropping the bad entry', async (_label, overrides) => {
    await createWithMicrosoft(overrides);

    // Not "a config with one keyword" — no config at all. A filtering implementation would have
    // dispatched the valid survivor and reported success.
    expect(envelopeFor(createCampaigns)).not.toHaveProperty('microsoftConfig');
  });

  /**
   * Upstream `canonicalMatchType` does `strings.ToLower(strings.TrimSpace(in))`, so `EXACT` and
   * ` exact ` are both valid. An exact-case `Set.has` was STRICTER than the service and refused a
   * request it would have accepted, reporting the platform as unconfigured instead.
   */
  it.each([['EXACT'], ['exact'], ['  Exact  '], ['bRoAd']])('accepts the match type %s, which upstream canonicalises', async (matchType) => {
    await createWithMicrosoft({ keywords: [{ text: 'kubernetes', matchType }] });

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    // Forwarded UNCHANGED — upstream canonicalises, so rewriting it here would be a second
    // normalisation that could only drift.
    expect((sent['keywords'] as { matchType: string }[])[0].matchType).toBe(matchType);
  });

  /**
   * `microsoftConfig` declares no scheduling fields, so dates on the wire are silently discarded.
   * Sending them implied a flight the operator never gets.
   */
  it('sends no flight dates, which microsoftConfig does not carry', async () => {
    await createWithMicrosoft();

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('startDate');
    expect(sent).not.toHaveProperty('endDate');
  });

  /**
   * U+00A0 (NBSP) sits immediately above the C1 range, and Go reports `IsControl(U+00A0) == false`
   * — verified by running it — so it must still dispatch. Without this case the obvious "widen to
   * U+00FF" fix would look correct while silently refusing a keyword Microsoft accepts.
   */
  it('accepts a non-breaking space, which is not a control character', async () => {
    await createWithMicrosoft({ keywords: [{ text: 'kuber\u00A0netes', matchType: 'Exact' }] });

    expect(envelopeFor(createCampaigns)).toHaveProperty('microsoftConfig');
  });

  /**
   * Optional chaining guards a NULLISH receiver, not a wrong-TYPED one — `(123)?.trim()` still
   * throws. A direct caller sending `timeZone: 123` therefore answered with a 500 rather than the
   * controlled path. The rest of the config is valid, so this asserts the create still SUCCEEDS
   * with the key simply omitted: a bad optional field must not sink an otherwise good campaign.
   */
  it('omits a wrong-typed timeZone instead of throwing', async () => {
    await createWithMicrosoft({ timeZone: 123 });

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('timeZone');
    expect(sent['budget']).toBe(300);
  });

  it('uppercases geo codes so a lowercase entry still dispatches', async () => {
    await createWithMicrosoft({ geoTargets: ['us', ' jp '] });

    expect((envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>)['geoTargets']).toEqual(['US', 'JP']);
  });

  it.each([
    ['exactly 60 keywords', { keywords: Array.from({ length: 60 }, (_, i) => ({ text: `kw-${i}`, matchType: 'Exact' })) }],
    ['a keyword of exactly 100 characters', { keywords: [{ text: 'k'.repeat(100), matchType: 'Exact' }] }],
    [
      'exactly 30 geo targets',
      { geoTargets: Array.from({ length: 30 }, (_, i) => String.fromCharCode(65 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26))) },
    ],
  ])('accepts a Microsoft create with %s, which is at the limit', async (_label, overrides) => {
    await createWithMicrosoft(overrides);

    expect(envelopeFor(createCampaigns)).toHaveProperty('microsoftConfig');
  });

  /**
   * Rune-counted, matching the client's `utf8.RuneCountInString`. `.length` counts UTF-16 units,
   * so 60 astral-plane characters would measure 120 and be refused here while the client accepts
   * them — rejecting a keyword that is actually valid.
   */
  it('measures keyword length in runes, not UTF-16 units', async () => {
    await createWithMicrosoft({ keywords: [{ text: '\u{1F600}'.repeat(60), matchType: 'Exact' }] });

    expect(envelopeFor(createCampaigns)).toHaveProperty('microsoftConfig');
  });

  it('forwards cpcBid and timeZone when they carry meaning', async () => {
    await createWithMicrosoft({ cpcBid: 2.5, timeZone: 'PacificTimeUSCanadaTijuana' });

    const sent = envelopeFor(createCampaigns)['microsoftConfig'] as Record<string, unknown>;
    expect(sent['cpcBid']).toBe(2.5);
    expect(sent['timeZone']).toBe('PacificTimeUSCanadaTijuana');
  });

  /**
   * Each arm below refuses the CREATE rather than building a config, and the reason differs per
   * field — which is why they are asserted separately rather than as one "invalid input" case.
   * `hasPlatformConfig` turns the null into a named refusal; without it the campaign is created
   * and the failure surfaces at launch (keywords) or as uncontrolled spend (geo).
   */
  it.each([
    ['zero keywords, which would create a campaign that can never serve', { keywords: [] }],
    ['whitespace-only keywords, which are not terms Microsoft can match', { keywords: [{ text: '   ', matchType: 'Exact' }] }],
    ['zero geo targets, which would serve everywhere once enabled', { geoTargets: [] }],
    ['whitespace-only geo targets', { geoTargets: ['  '] }],
    ['a non-positive budget the client rejects mid-dispatch', { budgetUsd: 0 }],
    ['a NaN budget', { budgetUsd: Number.NaN }],
    ['an infinite budget', { budgetUsd: Number.POSITIVE_INFINITY }],
    // The client caps the DAILY budget and rejects anything larger during dispatch.
    ['a budget over the maximum', { budgetUsd: 1_000_000_001 }],
  ])('refuses a Microsoft create with %s', async (_case, overrides) => {
    await createWithMicrosoft(overrides);

    // The envelope carries NO microsoftConfig, which is what makes the platform "unconfigured".
    // `hasPlatformConfig` then refuses the whole create in campaign-service.service (see its
    // `unconfigured` guard) rather than dispatching a zero-value config. That refusal is asserted
    // where it lives — the legacy fall-through is deliberately NOT asserted here, because these
    // cases run with the cutover dark, where reaching the legacy path is correct behaviour.
    expect(envelopeFor(createCampaigns)).not.toHaveProperty('microsoftConfig');
  });

  /**
   * LFXV2-3256. The envelope key and field names are a CONTRACT with
   * `internal/dispatch/hubspot.go:47-56` — the dispatcher reads `hubspotConfig.sourceEmailId`, and
   * `unmarshalPlatformConfig` treats a missing key as a zero value rather than an error. A typo on
   * either side therefore produces a silent zero-value dispatch, not a type error, which is why
   * these assert the exact strings.
   */
  it('builds the hubspot envelope key the email dispatcher reads', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'email-123' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent).toEqual({ sourceEmailId: 'email-123' });
  });

  it('forwards utmCampaign only when it is set', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', utmCampaign: 'kubecon-eu' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    expect(envelopeFor(createCampaigns)['hubspotConfig']).toEqual({ sourceEmailId: 'e-1', utmCampaign: 'kubecon-eu' });
  });

  /**
   * Canonicalization, not a correctness guard: `utm.Resolve` trims and falls through to the
   * name-derived slug on empty, so `''` and absent resolve the same upstream. Pinned anyway
   * because the envelope should carry only fields that mean something — an empty string reads as
   * a deliberate override to anyone inspecting the wire.
   *
   * Asserts the key is MISSING rather than falsy: `toBeFalsy()` would pass on `''`, which is the
   * exact value this omits.
   */
  it('omits a blank utmCampaign rather than sending an empty override', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', utmCampaign: '   ' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('utmCampaign');
    expect(sent['sourceEmailId']).toBe('e-1');
  });

  /**
   * A blank id must read as UNCONFIGURED, so `hasPlatformConfig` refuses locally and names the
   * problem. Upstream trims before its own emptiness check, so a whitespace-only id would pass a
   * truthiness test here and be refused there — the split this guard exists to prevent.
   *
   * Asserts the key is ABSENT, not that it holds `''`: only absence reaches the refusal.
   */
  it.each([
    ['whitespace only', '   '],
    ['empty string', ''],
  ])('treats a %s sourceEmailId as unconfigured rather than sending it', async (_label, sourceEmailId) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId } }, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(envelopeFor(createCampaigns)).not.toHaveProperty('hubspotConfig');
  });

  /**
   * `CampaignCreateRequest` is a compile-time assertion over `req.body`, and this route has no
   * runtime validator — so a caller CAN send a number. Before the typeof checks, `.trim()` threw a
   * TypeError and the request 500'd instead of taking the controlled refusal.
   *
   * `next` is asserted unused: an unhandled throw here surfaces through the catch as a 500, so a
   * test that only checked the envelope would pass while the request errored.
   */
  it.each([
    ['a numeric sourceEmailId', { sourceEmailId: 123 }],
    ['a null sourceEmailId', { sourceEmailId: null }],
    ['an object sourceEmailId', { sourceEmailId: {} }],
  ])('refuses %s without throwing', async (_label, hubspotConfig) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig } as unknown as Record<string, unknown>, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(envelopeFor(createCampaigns)).not.toHaveProperty('hubspotConfig');
  });

  it('drops a non-string utmCampaign rather than throwing on it', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', utmCampaign: 42 } } as unknown as Record<string, unknown>, {
        project: 'tlf',
        brief_id: 'b-1',
      }),
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(envelopeFor(createCampaigns)['hubspotConfig']).toEqual({ sourceEmailId: 'e-1' });
  });

  it('omits hubspotConfig entirely when the request carries none', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({}), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(envelopeFor(createCampaigns)).not.toHaveProperty('hubspotConfig');
  });

  /**
   * The path this ticket actually ships — the envelope tests above all run with the cutover DARK
   * (they assert on the ARGUMENT handed to a mocked `createCampaigns` that reports `enabled:
   * false`), so without this one nothing proves an email create succeeds when the cutover is on.
   */
  it('returns the campaign-service job id for an email create when the cutover is on', async () => {
    createCampaigns.mockResolvedValue({ enabled: true, jobId: 'a3f1c2d4-0000-4000-8000-00000000000e', error: null });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'email-123' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: 'a3f1c2d4-0000-4000-8000-00000000000e' });
  });

  /**
   * The dark-cutover refusal, and the reason `hasPlatformConfig` cannot cover it: that guard lives
   * inside `createCampaigns` and is gated by the same flags, so with the cutover off it never
   * runs. Widening `platforms` to `CampaignAnyPlatform` is what made this reachable at all —
   * `platforms: ['hubspot']` used to be a type error at every caller.
   *
   * The legacy path would NOT have failed loudly: it has no `includeHubspot` arm, so it records
   * "Unsupported platform(s)" in an errors array and completes with an empty promise list — a job
   * that finishes, after the inline 45s wait, having created nothing.
   *
   * Asserts `legacyCreate` was never called, not merely that an error came back: reaching that
   * path at all is the defect.
   */
  it('refuses an email create instead of falling through to the legacy path', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'email-123' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: expect.stringContaining('cutover') });
  });

  it('still runs the legacy path for a paid create when the cutover is dark', async () => {
    // The contrast. Without it the refusal above would pass on a controller that refused every
    // dark-cutover create, not just the email ones.
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_legacy_1' });

    await controller.createCampaign(buildReq(googleBody({}), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_legacy_1' });
  });
});

/**
 * The poll's routing decision, which the service spec cannot see.
 *
 * Safety-critical: a UUID job polled without its project slug answers `not_found` from `GetJob`'s
 * exact-match join, and `not_found` is TERMINAL for the poller — so a campaign that is running and
 * spending gets reported as lost. The controller refuses rather than guessing a slug, and that
 * refusal had no controller-level test until now (raised by @dealako).
 */
describe('CampaignController.getJobStatus routing', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  const UUID_JOB = '9f1c2d3e-0000-4000-8000-000000000001';
  const LEGACY_JOB = 'job_1699999999_ab12cd';

  function jobReq(jobId: string, query: Record<string, unknown>): Request {
    return { params: { jobId }, query, path: `/api/campaigns/jobs/${jobId}` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    isServerFeatureEnabled.mockReturnValue(true);
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
  });

  it('refuses a UUID job poll with no project slug rather than guessing one', async () => {
    await controller.getJobStatus(jobReq(UUID_JOB, {}), res, next);

    expect(svcGetJobStatus).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('forwards the trimmed slug to campaign-service for a UUID job', async () => {
    svcGetJobStatus.mockResolvedValue({ status: 'running' });

    await controller.getJobStatus(jobReq(UUID_JOB, { project: '  cncf  ' }), res, next);

    expect(svcGetJobStatus).toHaveBeenCalledWith(expect.anything(), UUID_JOB, 'cncf');
    expect(legacyGetJobStatus).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'running' });
  });

  it('routes a legacy job_ id to the in-process map and needs no slug', async () => {
    // The id shape, not the flag, is what keeps both eras of job id resolvable during rollout.
    legacyGetJobStatus.mockResolvedValue({ status: 'done' });

    await controller.getJobStatus(jobReq(LEGACY_JOB, {}), res, next);

    expect(legacyGetJobStatus).toHaveBeenCalledTimes(1);
    expect(svcGetJobStatus).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'done' });
  });

  it('routes a UUID job to the in-process map when the JOBS flag is off', async () => {
    // Pins the flag half of the predicate. Without it the tests above would pass on a controller
    // that routed on id shape alone, which would break rollback.
    isServerFeatureEnabled.mockReturnValue(false);
    legacyGetJobStatus.mockResolvedValue({ status: 'done' });

    await controller.getJobStatus(jobReq(UUID_JOB, {}), res, next);

    expect(legacyGetJobStatus).toHaveBeenCalledTimes(1);
    expect(svcGetJobStatus).not.toHaveBeenCalled();
  });
});

/**
 * The controller boundary for the template search: whether the service is called at all, and
 * whether a 400 is raised instead. The service spec covers what campaign-service is sent; only
 * the refusal and the trim are decidable here (raised by @dealako).
 */
describe('CampaignController.searchHubSpotEmails', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function emailReq(query: Record<string, unknown>): Request {
    return { query, path: '/api/campaigns/hubspot/emails' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    searchHubSpotEmails.mockResolvedValue({ enabled: true, emails: [], error: null, possiblyTruncated: false });
  });

  // The page is reachable by an ED of any foundation and templates are per-project, so an absent
  // slug is refused rather than guessed — the same rule `loadBrief` follows.
  it.each([
    ['no project param', {}],
    ['a blank project param', { project: '   ' }],
    ['a repeated project param, which Express parses as an array', { project: ['tlf', 'cncf'] }],
  ])('refuses %s with a 400 and never calls the service', async (_label, query) => {
    await controller.searchHubSpotEmails(emailReq(query), res, next);

    expect(searchHubSpotEmails).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('trims the query and forwards the result unchanged', async () => {
    const result = { enabled: true, emails: [{ id: '1', name: 'Welcome' }], error: null, possiblyTruncated: false };
    searchHubSpotEmails.mockResolvedValue(result);

    await controller.searchHubSpotEmails(emailReq({ project: 'tlf', q: '  kubecon  ' }), res, next);

    expect(searchHubSpotEmails).toHaveBeenCalledWith(expect.anything(), 'tlf', 'kubecon');
    expect(res.json).toHaveBeenCalledWith(result);
    expect(next).not.toHaveBeenCalled();
  });

  it('treats a missing q as the unfiltered listing rather than refusing', async () => {
    // An empty query is the "show me everything" case the cap and `possiblyTruncated` exist for,
    // not a validation failure.
    await controller.searchHubSpotEmails(emailReq({ project: 'tlf' }), res, next);

    expect(searchHubSpotEmails).toHaveBeenCalledWith(expect.anything(), 'tlf', '');
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a service failure to the error middleware instead of answering 200', async () => {
    const failure = new Error('upstream exploded');
    searchHubSpotEmails.mockRejectedValue(failure);

    await controller.searchHubSpotEmails(emailReq({ project: 'tlf' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});

/**
 * The email refusal has to happen HERE, not only in the service.
 *
 * An email brief has no generated copy and no keywords, so the paid-only field checks in
 * `refineBrief` fire first and answer "currentCopy is required" — true, but it names a field the
 * caller cannot supply and hides the real reason. The service refuses email refines too, and that
 * guard stays (it is not the only caller), but only this path is reached over HTTP.
 */
describe('CampaignController.refineBrief email refusal', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
  });

  it('says refining email is unsupported rather than "currentCopy is required"', async () => {
    // The shape an email brief really produces: no structured copy, no keywords.
    const body = { deliveryType: 'email', feedback: 'shorter subject', currentCopy: null, currentKeywords: [] };

    await controller.refineBrief(buildReq(body), res, next);

    // Through the error middleware as a ServiceValidationError, like every sibling check in this
    // method — not a manual `res.status().json()`, which would skip the standard error shape and
    // the centralized log line (backend-checklist §8).
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.toResponse()['errors']).toEqual([
      { field: 'deliveryType', message: 'refining email copy is not supported yet', code: 'FIELD_VALIDATION_ERROR' },
    ]);
  });

  it('rejects a MISSPELLED deliveryType instead of blaming currentCopy', async () => {
    // The gap an exact `=== 'email'` match leaves: `'emial'` falls past it into the paid-only
    // checks and produces "currentCopy is required" — the same misleading message the email guard
    // exists to prevent, for a caller whose only mistake was a typo.
    const body = { deliveryType: 'emial', feedback: 'shorter', currentCopy: null, currentKeywords: [] };

    await controller.refineBrief(buildReq(body), res, next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.toResponse()['errors']).toEqual([
      { field: 'deliveryType', message: 'deliveryType must be one of: paid-marketing, email', code: 'FIELD_VALIDATION_ERROR' },
    ]);
  });

  it('still validates currentCopy for a PAID refine', async () => {
    // The contrast: without it the guard above could swallow every refine, email or not.
    const body = { feedback: 'punchier', currentCopy: null, currentKeywords: [] };

    await controller.refineBrief(buildReq(body), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
  });
});

/**
 * Which backend serves a status toggle is decided by the campaign id's SHAPE, not by the flag
 * alone. That is the whole safety argument for flipping this flag during a rolling deploy: the
 * two id spaces are disjoint, so a request cannot be claimed by both paths and a mixed-flag
 * fleet cannot misroute one. These tests pin that, plus the refusals that keep a money-affecting
 * dispatch from going out on incomplete or stale information.
 */
describe('CampaignController.updateCampaignStatus', () => {
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function statusReq(campaignId: string, body: Record<string, unknown>, query: Record<string, unknown> = { project: 'tlf' }): Request {
    return { params: { campaignId }, body, query, path: `/api/campaigns/${campaignId}/status` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    isServerFeatureEnabled.mockReturnValue(true);
    toggleCampaignStatus.mockResolvedValue({ id: UUID, status: 'paused', version: 2, etag: '2' });
    legacyUpdateStatus.mockResolvedValue({ platform: 'meta-ads', campaignId: '123', previousStatus: 'ACTIVE', newStatus: 'PAUSED', success: true });
  });

  it('sends a UUID id to campaign-service, not the legacy per-platform path', async () => {
    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(toggleCampaignStatus).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: 'b-1',
      campaignId: UUID,
      status: 'PAUSED',
      etag: '1',
    });
  });

  // The reach this whole change exists to buy: the legacy switch throws on anything but
  // meta/reddit, so before this a Google Ads campaign could not be paused from the product at all.
  it('accepts google-ads, which the legacy path cannot serve', async () => {
    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ platform: 'google-ads', newStatus: 'PAUSED', success: true }));
  });

  it('keeps a numeric id on the legacy path even while the flag is on', async () => {
    await controller.updateCampaignStatus(statusReq('123456', { platform: 'meta-ads', status: 'PAUSED' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(legacyUpdateStatus).toHaveBeenCalledTimes(1);
  });

  // A numeric id cannot address a campaign-service row, so the legacy allowlist must NOT widen —
  // waving google-ads through here would reach the legacy switch's default arm and throw an error
  // naming the wrong cause.
  it('still refuses google-ads on the legacy path', async () => {
    await controller.updateCampaignStatus(statusReq('123456', { platform: 'google-ads', status: 'PAUSED' }), res, next);

    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  // Fail CLOSED rather than handing a UUID to a backend that cannot address it.
  it('refuses a UUID when the cutover flag is off', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // Upstream answers a missing If-Match with 428, and a guessed brief id addresses a different
  // route entirely — so both are refused here, where the message can name the missing field.
  it.each([
    ['briefId', { platform: 'google-ads', status: 'PAUSED', etag: '1' }],
    ['etag', { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1' }],
  ])('refuses a campaign-service toggle with no %s', async (_field, body) => {
    await controller.updateCampaignStatus(statusReq(UUID, body), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a campaign-service toggle with no project', async () => {
    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }, {}), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // The assertion whose absence let a real defect through: the client was called without
  // assignment, so the etag it fetched died one frame later. The service spec asserts the CLIENT's
  // return value and this spec mocks the whole client, so nothing observed the seam between them —
  // reverting the client fix broke a test while leaving production behaviour identical.
  it("propagates the row's fresh etag so a follow-up toggle has a valid If-Match", async () => {
    toggleCampaignStatus.mockResolvedValue({ id: UUID, status: 'paused', version: 7, etag: '7' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '6' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ etag: '7' }));
  });

  // A guess and an observation must not share a field name. The legacy path GETs the campaign
  // before writing and reports previousStatus as a FACT; campaign-service returns only the
  // post-toggle row, so there is nothing to observe and the field is omitted. Inferring "the
  // opposite of what was requested" would be wrong for a created_degraded campaign, whose true
  // prior status is created_degraded rather than ACTIVE.
  it('omits previousStatus rather than inferring one it never observed', async () => {
    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    const body = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('previousStatus');
  });

  // Pausing a created_degraded campaign pauses it UPSTREAM while deliberately leaving the row's
  // status unchanged (campaign-service `pauseDegraded`). Echoing the request would render "Paused"
  // for a transition the service declined to record.
  it('reports the service status, not the requested one, for a degraded campaign', async () => {
    toggleCampaignStatus.mockResolvedValue({ id: UUID, status: 'created_degraded', version: 4, etag: '4' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '4' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'PAUSED', serviceStatus: 'created_degraded' }));
  });

  // Found by mutation: deleting `.filter((p) => !p.disabled)` from
  // CAMPAIGN_SERVICE_STATUS_PLATFORMS left all 77 tests green, silently admitting microsoft-ads
  // and twitter-ads. The filter is the entire subject of that constant's doc block, so nothing
  // pinned the one thing it claims to do — this is the test that makes the claim binding.
  //
  // Narrowed to twitter-ads by LFXV2-3312, which ENABLED Microsoft: the set is derived from
  // `!p.disabled`, so dropping that flag in the shared constant admits microsoft-ads here by
  // design. X stays disabled for a capability reason rather than a plumbing one, so it remains
  // the subject — and the mutation this test was born from still fails, because admitting X is
  // still wrong. The companion case below asserts the other half: that Microsoft is now ALLOWED,
  // so a future re-disabling cannot pass silently either.
  it.each([['twitter-ads']])('refuses %s, which this app does not offer', async (platform) => {
    await controller.updateCampaignStatus(statusReq(UUID, { platform, status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('allows a Microsoft status toggle now that the channel is enabled', async () => {
    // The other half of the narrowed allowlist spec above: CAMPAIGN_SERVICE_STATUS_PLATFORMS is
    // DERIVED from `!p.disabled`, so re-adding `disabled: true` to the shared constant would make
    // pause unreachable for a channel the UI offers. This fails if that happens.
    toggleCampaignStatus.mockResolvedValue({ id: UUID, status: 'paused', version: 2, etag: '2' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'microsoft-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(toggleCampaignStatus).toHaveBeenCalledTimes(1);
  });

  // Also found by mutation: dropping `.trim()` left these green. A whitespace-only etag then
  // reaches upstream as `If-Match: " "` and comes back 412 — the very refusal the guard exists to
  // pre-empt with a named field, arriving instead as an opaque upstream error.
  it.each([
    ['briefId', { platform: 'google-ads', status: 'PAUSED', briefId: '   ', etag: '1' }],
    ['etag', { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '   ' }],
  ])('refuses a whitespace-only %s rather than sending it upstream', async (_field, body) => {
    await controller.updateCampaignStatus(statusReq(UUID, body), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // campaign-service resolves the platform from the stored row and never receives the caller's.
  // Echoing the request would confirm a platform the caller invented.
  it("reports the row's platform, not the caller's claim", async () => {
    toggleCampaignStatus.mockResolvedValue({ id: UUID, platform: 'reddit-ads', status: 'paused', version: 2, etag: '2' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ platform: 'reddit-ads' }));
  });

  // The pre-check tests the CALLER'S label, which is never sent upstream — campaign-service loads
  // the dispatcher from the row — so a mislabelled request passes it. The row is only knowable
  // after the toggle returns, and by then the ad platform has already moved, so this is observed
  // and logged rather than refused. The response still reports the row's platform, so the caller
  // is not told their label was accepted.
  //
  // The example row platform is `twitter-ads` rather than `microsoft-ads` as of LFXV2-3312:
  // Microsoft is now an OFFERED platform, so using it here would assert the warning on a row this
  // app does offer and the test would be checking the opposite of its own name. X is still
  // disabled, so it remains a true example of the case this guard describes.
  it('logs when the toggled row is a platform this app does not offer', async () => {
    toggleCampaignStatus.mockResolvedValue({ id: UUID, platform: 'twitter-ads', status: 'paused', version: 2, etag: '2' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(logger.warning).toHaveBeenCalledWith(
      expect.anything(),
      'campaign_status_update',
      expect.stringContaining('does not offer'),
      expect.objectContaining({ requestedPlatform: 'google-ads', rowPlatform: 'twitter-ads' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ platform: 'twitter-ads' }));
  });

  it('does not log the platform warning for an offered platform', async () => {
    toggleCampaignStatus.mockResolvedValue({ id: UUID, platform: 'google-ads', status: 'paused', version: 2, etag: '2' });

    await controller.updateCampaignStatus(statusReq(UUID, { platform: 'google-ads', status: 'PAUSED', briefId: 'b-1', etag: '1' }), res, next);

    expect(logger.warning).not.toHaveBeenCalled();
  });

  it('rejects an id that is neither numeric nor a UUID', async () => {
    await controller.updateCampaignStatus(statusReq('not-an-id', { platform: 'meta-ads', status: 'PAUSED' }), res, next);

    expect(toggleCampaignStatus).not.toHaveBeenCalled();
    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * The controller's job here is the scope refusal. Both `project` and `brief_id` are required and
 * neither is defaulted — `project` is the authorization boundary the platform checks FGA against,
 * and a guessed `brief_id` would widen the read past the brief the caller asked about.
 */
describe('CampaignController.listBriefCampaigns', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function listReq(query: Record<string, unknown>): Request {
    return { query, path: '/api/campaigns/list' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    // Carries `statusToggleEnabled` because the real `listBriefCampaigns` always returns it and
    // `CampaignListResult` declares it required. A fixture omitting it stands in for a payload the
    // service cannot produce, and this suite is the only place the /list HTTP contract is exercised.
    listBriefCampaigns.mockResolvedValue({ campaigns: [], possiblyStale: true, statusToggleEnabled: false, demandGenEnabled: false });
  });

  it('passes both scopes through, trimmed', async () => {
    await controller.listBriefCampaigns(listReq({ project: '  tlf  ', brief_id: '  b-1  ' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(listBriefCampaigns).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1');
  });

  it.each([
    ['project', { brief_id: 'b-1' }],
    ['brief_id', { project: 'tlf' }],
    ['a blank project', { project: '   ', brief_id: 'b-1' }],
    ['a blank brief_id', { project: 'tlf', brief_id: '   ' }],
  ])('refuses a request with no %s', async (_label, query) => {
    await controller.listBriefCampaigns(listReq(query), res, next);

    expect(listBriefCampaigns).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  // possiblyStale is the caller's only signal that an empty list may mean "not indexed yet"
  // rather than "nothing exists". Dropping it would let the UI assert a spend does not exist.
  it('forwards possiblyStale to the caller', async () => {
    await controller.listBriefCampaigns(listReq({ project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ possiblyStale: true }));
  });

  /**
   * `statusToggleEnabled: false` is the default that suppresses every toggle button, so a
   * controller-side reshape that dropped the field would disable the feature fleet-wide. Pinned
   * here because this is the only test of the /list response shape.
   */
  it('forwards statusToggleEnabled through the passthrough', async () => {
    listBriefCampaigns.mockResolvedValue({ campaigns: [], possiblyStale: false, statusToggleEnabled: true, demandGenEnabled: false });

    await controller.listBriefCampaigns(listReq({ project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusToggleEnabled: true, demandGenEnabled: false }));
  });

  it('lets a query-service failure reach the error middleware', async () => {
    listBriefCampaigns.mockRejectedValue(new Error('query service unavailable'));

    await controller.listBriefCampaigns(listReq({ project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

/**
 * What is only decidable at this layer: which query parameters are required, and whether a value
 * the wire contract cannot represent is refused here rather than sent and silently reinterpreted.
 */
describe('CampaignController.getBriefMetrics', () => {
  let controller: CampaignController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
  });

  function metricsReq(query: Record<string, unknown>): Request {
    return { query, path: '/api/campaigns/brief/metrics' } as unknown as Request;
  }

  it('reads the brief and passes a valid window through', async () => {
    const payload = { brief_id: 'b-1', window: 'last_7_days', rows: [], ok_count: 0, action_items: [] };
    getBriefMetrics.mockResolvedValue(payload);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.getBriefMetrics(metricsReq({ project: 'cncf', brief_id: 'b-1', window: 'last_7_days' }), res, next);

    expect(getBriefMetrics).toHaveBeenCalledWith(expect.anything(), 'cncf', 'b-1', 'last_7_days');
    expect(res.json).toHaveBeenCalledWith(payload);
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * Omitted rather than defaulted here, so campaign-service applies its PER-PLATFORM default.
   * Upstream resolves the default per row, per platform (`last_7_days` for X Ads, `last_30_days`
   * elsewhere), and an explicit window overrides that for every row. Defaulting here would not
   * fail — it would DISCARD the fallback, turning a servable X row into an `unsupported` one.
   */
  it('passes undefined when no window is given, rather than a default', async () => {
    getBriefMetrics.mockResolvedValue({ brief_id: 'b-1', window: 'last_30_days', rows: [], ok_count: 0, action_items: [] });

    await controller.getBriefMetrics(metricsReq({ project: 'cncf', brief_id: 'b-1' }), buildRes(), vi.fn() as unknown as NextFunction);

    expect(getBriefMetrics).toHaveBeenCalledWith(expect.anything(), 'cncf', 'b-1', undefined);
  });

  /**
   * REFUSED, not dropped. Dropping an unrecognised window would serve a different period than the
   * caller asked for, and the response's own `window` field would report the default as though it
   * had been requested — so the caller could not detect the substitution from the response alone.
   */
  it('refuses an unrecognised window instead of dropping it', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await controller.getBriefMetrics(metricsReq({ project: 'cncf', brief_id: 'b-1', window: 'last_90_days' }), buildRes(), next);

    expect(getBriefMetrics).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  /**
   * `brief` is required because this read is brief-scoped, and `project` because
   * `/foundation/campaigns` is reachable by an ED of any foundation — a default here would read
   * another foundation's brief on their behalf.
   */
  it.each([
    ['no brief_id', { project: 'cncf' }],
    ['no project', { brief_id: 'b-1' }],
    ['a blank brief_id', { project: 'cncf', brief_id: '   ' }],
    ['a blank project', { project: '   ', brief_id: 'b-1' }],
    // Repeated params, which Express parses as arrays. `project` and `brief` are covered by the
    // blank guard above once an array collapses to `''`; `window` is NOT — it is legitimately
    // optional, so "absent" is a valid state and a malformed value that reads as absent would
    // fail OPEN, serving the per-platform default under a window the caller never chose.
    ['a repeated project param, which Express parses as an array', { project: ['tlf', 'cncf'], brief_id: 'b-1' }],
    ['a repeated brief_id param, which Express parses as an array', { project: 'cncf', brief_id: ['b-1', 'b-2'] }],
    ['a repeated window param, which Express parses as an array', { project: 'cncf', brief_id: 'b-1', window: ['today', 'today'] }],
    // PRESENT-BUT-EMPTY is malformed, not absent. `?window=` arrives as a string, so treating it
    // as "no window given" would skip the enum check and serve the default — the same fail-open
    // shape as the array case, one layer in. Only an OMITTED parameter may default.
    ['an empty window param', { project: 'cncf', brief_id: 'b-1', window: '' }],
    ['a whitespace-only window param', { project: 'cncf', brief_id: 'b-1', window: '   ' }],
  ])('refuses a request with %s', async (_label, query) => {
    const next = vi.fn() as unknown as NextFunction;

    await controller.getBriefMetrics(metricsReq(query), buildRes(), next);

    expect(getBriefMetrics).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  /** A failed upstream read reaches the error middleware, never a 200 the caller reads as data. */
  it('forwards an upstream failure to next rather than answering with a body', async () => {
    getBriefMetrics.mockRejectedValue(new Error('upstream exploded'));
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.getBriefMetrics(metricsReq({ project: 'cncf', brief_id: 'b-1' }), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

/**
 * The Google Ads insight reads behind `CampaignServiceInsights`.
 *
 * The conversion arithmetic has its own direct tests in `campaign-insights-mapper.spec.ts`.
 * What is only decidable HERE is the layer boundary: which backend a request reaches, that the
 * flag is read per-flag rather than as a blanket toggle, that the project the campaign-service
 * arm scopes by is required rather than defaulted, and that a failure reaches the error
 * middleware instead of being answered with a 200 the table renders as real data.
 */
describe('CampaignController Google Ads insight reads', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  /** Only the insights flag on. Everything else stays off so a blanket toggle cannot pass. */
  const onlyInsights = (flag: string): boolean => String(flag) === 'LFX_CUTOVER_CAMPAIGN_SERVICE_INSIGHTS';

  function insightsReq(query: Record<string, unknown>): Request {
    return { body: {}, query, path: '/api/campaigns/keywords' } as unknown as Request;
  }

  const keywordsPayload = {
    window: 'last_30_days',
    row_count: 1,
    truncated: true,
    rows: [
      {
        criterion_id: '305729261',
        ad_group_id: '176216228',
        campaign_id: '555',
        ad_group_name: 'Registration - Exact',
        campaign_name: 'KubeCon NA 2026 - Search',
        text: 'kubernetes training',
        match_type: 'EXACT',
        status: 'ENABLED',
        impressions: 1000,
        clicks: 40,
        cost_micros: 25_000_000,
        ctr: 0.04,
        conversions: 12.5,
        quality_score: 7,
      },
    ],
  };

  const audiencePayload = {
    window: 'last_30_days',
    bucket_count: 1,
    buckets: [{ dimension: 'age', value: 'AGE_RANGE_25_34', impressions: 1000, clicks: 40, cost_micros: 25_000_000, ctr: 0.04, conversions: 12.5 }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    svcGetKeywords.mockResolvedValue(keywordsPayload);
    svcGetAudience.mockResolvedValue(audiencePayload);
    legacyGetKeywords.mockResolvedValue({ pulledAt: 'x', days: 14, totalKeywords: 0, totals: {}, keywords: [] });
    legacyGetAudience.mockResolvedValue({ pulledAt: 'x', days: 14, age: [], gender: [], device: [] });
  });

  describe('getKeywords', () => {
    it('reads from campaign-service when the flag is on, and not from the legacy path', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(svcGetKeywords).toHaveBeenCalledWith(expect.anything(), 'tlf', 'last_30_days');
      // Asserted explicitly: a branch that called BOTH would still return the right body while
      // doubling the upstream cost and keeping the leak this cutover exists to close.
      expect(legacyGetKeywords).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('keeps the legacy path when the flag is off', async () => {
      isServerFeatureEnabled.mockReturnValue(false);

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(legacyGetKeywords).toHaveBeenCalled();
      expect(svcGetKeywords).not.toHaveBeenCalled();
    });

    // The handler must read ITS OWN flag. With a blanket `mockReturnValue(true)` this test
    // passes no matter which flag is checked, so the other flags are held OFF: a handler
    // reading, say, CampaignServiceCreate would take the legacy arm and fail here.
    it('routes on the insights flag specifically, not on any cutover flag', async () => {
      isServerFeatureEnabled.mockImplementation((flag: string) => !onlyInsights(flag));

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(legacyGetKeywords).toHaveBeenCalled();
      expect(svcGetKeywords).not.toHaveBeenCalled();
    });

    // Not defaulted to a constant: campaign-service scopes by project and /foundation/campaigns
    // is reachable by an ED of any foundation, so a fallback would report one foundation's
    // keywords to another.
    it('refuses a campaign-service read with no project rather than defaulting one', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ days: '30' }), res, next);

      expect(svcGetKeywords).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
      expect(error).toBeInstanceOf(ServiceValidationError);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('refuses a whitespace-only project', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ project: '   ', days: '30' }), res, next);

      expect(svcGetKeywords).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    // The window sent upstream must be the one the requested days SNAP to, not the raw value.
    it('sends the snapped window for an arbitrary day count', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '9' }), res, next);

      expect(svcGetKeywords).toHaveBeenCalledWith(expect.anything(), 'tlf', 'last_14_days');
      // And the body reports the EFFECTIVE days, never the requested 9 — the number is shown
      // beside the figures, so echoing 9 over a 14-day window mislabels the period.
      expect(vi.mocked(res.json).mock.calls[0][0]).toMatchObject({ days: 14 });
    });

    // `truncated` and `row_count` reach the LOG and nothing else — the UI contract has no field
    // for either. That makes the log line the only place a capped result is visible at all, so
    // it is asserted: without this, deleting the line leaves the whole suite green while the one
    // signal distinguishing "this project has 50 keywords" from "here are the top 50 of more"
    // disappears. The totals in the body are summed over a possibly-capped set, which is exactly
    // why the flag has to survive somewhere.
    it('logs the truncation flag and upstream row count, which the UI contract cannot carry', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(logger.success).toHaveBeenCalledWith(
        expect.anything(),
        'campaign_keywords',
        expect.anything(),
        expect.objectContaining({ truncated: true, rowCount: 1 })
      );
    });

    it('converts the payload into the UI contract', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      const body = vi.mocked(res.json).mock.calls[0][0] as { keywords: { spend: number; ctr: number; adGroup: string }[] };
      // Spot-checked here rather than re-tested: the point is that the controller runs the
      // conversion at all, not that the arithmetic is right, which the mapper spec pins.
      expect(body.keywords[0].spend).toBe(25);
      expect(body.keywords[0].ctr).toBe(4);
      expect(body.keywords[0].adGroup).toBe('Registration - Exact');
    });

    // A failed read must not be answered with a 200. An empty keywords table is
    // indistinguishable from a project that genuinely has no keywords, which is how an outage
    // gets read as a measurement.
    it('forwards an upstream failure to the error middleware instead of answering 200', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);
      svcGetKeywords.mockRejectedValue(new Error('campaign-service unavailable'));

      await controller.getKeywords(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getAudience', () => {
    it('reads from campaign-service when the flag is on, and not from the legacy path', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getAudience(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(svcGetAudience).toHaveBeenCalledWith(expect.anything(), 'tlf', 'last_30_days');
      expect(legacyGetAudience).not.toHaveBeenCalled();
    });

    it('keeps the legacy path when the flag is off', async () => {
      isServerFeatureEnabled.mockReturnValue(false);

      await controller.getAudience(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(legacyGetAudience).toHaveBeenCalled();
      expect(svcGetAudience).not.toHaveBeenCalled();
    });

    it('routes on the insights flag specifically, not on any cutover flag', async () => {
      isServerFeatureEnabled.mockImplementation((flag: string) => !onlyInsights(flag));

      await controller.getAudience(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(legacyGetAudience).toHaveBeenCalled();
      expect(svcGetAudience).not.toHaveBeenCalled();
    });

    it('refuses a campaign-service read with no project rather than defaulting one', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getAudience(insightsReq({ days: '30' }), res, next);

      expect(svcGetAudience).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('regroups the flat bucket array into the three the UI renders', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);

      await controller.getAudience(insightsReq({ project: 'tlf', days: '30' }), res, next);

      const body = vi.mocked(res.json).mock.calls[0][0] as { age: unknown[]; gender: unknown[]; device: unknown[] };
      expect(body.age).toHaveLength(1);
      expect(body.gender).toEqual([]);
      expect(body.device).toEqual([]);
    });

    it('forwards an upstream failure to the error middleware instead of answering 200', async () => {
      isServerFeatureEnabled.mockImplementation(onlyInsights);
      svcGetAudience.mockRejectedValue(new Error('campaign-service unavailable'));

      await controller.getAudience(insightsReq({ project: 'tlf', days: '30' }), res, next);

      expect(next).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});

/**
 * Keyword actions through campaign-service.
 *
 * The grouping and per-outcome mapping have direct tests in
 * `campaign-keyword-actions.spec.ts`. What is only decidable HERE is what the controller does
 * with the answers: whether an unowned or ambiguous campaign is refused rather than acted on,
 * whether one campaign's failure takes down the others, and whether every keyword is accounted
 * for in the response. A keyword that silently vanishes from `results` is the worst outcome —
 * the caller believes it was handled.
 */
describe('CampaignController.executeKeywordActions via campaign-service', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  const onlyActions = (flag: string): boolean => String(flag) === 'LFX_CUTOVER_CAMPAIGN_SERVICE_KEYWORD_ACTIONS';

  function actionsReq(keywords: unknown[], query: Record<string, unknown> = { project: 'tlf' }): Request {
    return { body: { keywords, action: 'pause' }, query, path: '/api/campaigns/keywords/actions' } as unknown as Request;
  }

  const keyword = (campaignId: string, criterionId: string) => ({ campaignId, adGroupId: 'ag-1', criterionId, action: 'pause' });
  const resolvedTo = (campaignId: string, briefId: string) => ({ platform_campaign_id: 'x', match_count: 1, matches: [{ campaign_id: campaignId, brief_id: briefId }] });

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    isServerFeatureEnabled.mockImplementation(onlyActions);
    svcResolveCampaign.mockResolvedValue(resolvedTo('c-1', 'b-1'));
    svcApplyKeywordActions.mockResolvedValue({ campaign_id: 'c-1', results: [], applied_count: 1 });
  });

  it('resolves the campaign and applies the batch under its brief', async () => {
    await controller.executeKeywordActions(actionsReq([keyword('24183781329', '1')]), res, next);

    expect(svcResolveCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', '24183781329');
    // The brief and campaign must come from the RESOLUTION, not from the request — the request
    // carries neither, which is the whole reason the resolver exists.
    expect(svcApplyKeywordActions).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1', 'c-1', [
      { ad_group_id: 'ag-1', criterion_id: '1', action: 'PAUSE' },
    ]);
    expect(legacyKeywordActions).not.toHaveBeenCalled();
  });

  it('keeps the legacy path when the flag is off', async () => {
    isServerFeatureEnabled.mockReturnValue(false);
    legacyKeywordActions.mockResolvedValue({ success: true, total: 1, succeeded: 1, failed: 0, results: [] });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1')]), res, next);

    expect(legacyKeywordActions).toHaveBeenCalled();
    expect(svcResolveCampaign).not.toHaveBeenCalled();
  });

  it('routes on its own flag, not on any cutover flag', async () => {
    isServerFeatureEnabled.mockImplementation((flag: string) => !onlyActions(flag));
    legacyKeywordActions.mockResolvedValue({ success: true, total: 1, succeeded: 1, failed: 0, results: [] });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1')]), res, next);

    expect(legacyKeywordActions).toHaveBeenCalled();
    expect(svcResolveCampaign).not.toHaveBeenCalled();
  });

  it('refuses a campaign-service request with no project', async () => {
    await controller.executeKeywordActions(actionsReq([keyword('555', '1')], {}), res, next);

    expect(svcResolveCampaign).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('issues one call per campaign rather than one flat batch', async () => {
    svcResolveCampaign
      .mockResolvedValueOnce(resolvedTo('c-1', 'b-1'))
      .mockResolvedValueOnce(resolvedTo('c-2', 'b-2'));

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('666', '2'), keyword('555', '3')]), res, next);

    expect(svcApplyKeywordActions).toHaveBeenCalledTimes(2);
    // Campaign 555's two keywords travel together; 666's alone. A flat batch would be one call.
    expect(svcApplyKeywordActions.mock.calls[0][4]).toHaveLength(2);
    expect(svcApplyKeywordActions.mock.calls[1][4]).toHaveLength(1);
  });

  // An unowned id is a 200 with no matches, so it must be CHECKED. Acting on it is impossible,
  // and skipping it silently would drop the keyword from the response entirely.
  it('refuses a campaign the project does not own, and says so per keyword', async () => {
    svcResolveCampaign.mockResolvedValue({ platform_campaign_id: '555', match_count: 0, matches: [] });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('555', '2')]), res, next);

    expect(svcApplyKeywordActions).not.toHaveBeenCalled();
    const body = vi.mocked(res.json).mock.calls[0][0] as { success: boolean; failed: number; results: { success: boolean }[] };
    expect(body.success).toBe(false);
    // BOTH keywords are accounted for. A response listing one would leave the other looking
    // handled.
    expect(body.results).toHaveLength(2);
    expect(body.failed).toBe(2);
  });

  // Ambiguity is refused rather than resolved by taking the first match: acting would mutate a
  // campaign nobody named.
  it('refuses an ambiguous campaign id rather than picking a match', async () => {
    svcResolveCampaign.mockResolvedValue({
      platform_campaign_id: '555',
      match_count: 2,
      matches: [
        { campaign_id: 'c-1', brief_id: 'b-1' },
        { campaign_id: 'c-2', brief_id: 'b-2' },
      ],
    });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1')]), res, next);

    expect(svcApplyKeywordActions).not.toHaveBeenCalled();
    const body = vi.mocked(res.json).mock.calls[0][0] as { failed: number };
    expect(body.failed).toBe(1);
  });

  // One campaign's failure must not take down the others: the batch is atomic per campaign, and
  // the remaining campaigns' actions should still be attempted.
  it('continues to the next campaign when one fails, and reports both outcomes', async () => {
    svcResolveCampaign
      .mockResolvedValueOnce(resolvedTo('c-1', 'b-1'))
      .mockResolvedValueOnce(resolvedTo('c-2', 'b-2'));
    svcApplyKeywordActions
      .mockRejectedValueOnce(new Error('upstream refused'))
      .mockResolvedValueOnce({ campaign_id: 'c-2', results: [], applied_count: 1 });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('666', '2')]), res, next);

    expect(svcApplyKeywordActions).toHaveBeenCalledTimes(2);
    const body = vi.mocked(res.json).mock.calls[0][0] as { success: boolean; succeeded: number; failed: number; results: { message: string }[] };
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    // A partially applied request is NOT a success, even though each campaign was atomic.
    expect(body.success).toBe(false);
    // The upstream message survives, because campaign-service distinguishes a definite failure
    // from an unconfirmed one where the mutate may already have applied — flattening that would
    // leave someone retrying an irreversible REMOVE.
    expect(body.results.some((r) => r.message.includes('upstream refused'))).toBe(true);
  });

  // A failed LOOKUP is this campaign's problem, not the request's.
  it('reports a failed resolution against that campaign and keeps going', async () => {
    svcResolveCampaign
      .mockRejectedValueOnce(new Error('resolver down'))
      .mockResolvedValueOnce(resolvedTo('c-2', 'b-2'));

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('666', '2')]), res, next);

    expect(svcApplyKeywordActions).toHaveBeenCalledTimes(1);
    const body = vi.mocked(res.json).mock.calls[0][0] as { succeeded: number; failed: number };
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
  });

  // Every keyword sent must appear in the response exactly once, whatever happened to it.
  it('accounts for every requested keyword in the response', async () => {
    svcResolveCampaign
      .mockResolvedValueOnce(resolvedTo('c-1', 'b-1'))
      .mockResolvedValueOnce({ platform_campaign_id: '666', match_count: 0, matches: [] });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('555', '2'), keyword('666', '3')]), res, next);

    const body = vi.mocked(res.json).mock.calls[0][0] as { total: number; results: { keyword: string }[] };
    expect(body.total).toBe(3);
    expect(body.results.map((r) => r.keyword).sort()).toEqual(['Criterion 1', 'Criterion 2', 'Criterion 3']);
  });
});
