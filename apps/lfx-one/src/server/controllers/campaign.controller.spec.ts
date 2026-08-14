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
  legacyUpdateStatus,
  svcGetJobStatus,
  legacyGetJobStatus,
  searchHubSpotEmails,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  saveBrief: vi.fn(),
  loadBrief: vi.fn(),
  createCampaigns: vi.fn(),
  legacyCreate: vi.fn(),
  legacyUpdateStatus: vi.fn(),
  svcGetJobStatus: vi.fn(),
  legacyGetJobStatus: vi.fn(),
  searchHubSpotEmails: vi.fn(),
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
  },
}));
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

    // The flag being off is the default in every environment and warrants no error. A 4xx/5xx
    // would fire the client's error arm on the ordinary case and train whoever sees it to ignore
    // a UI that should never fire.
    expect(loadBrief).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'off', briefId: null, brief: null, approved: false });
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
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, approved: false });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'none', briefId: null, brief: null, approved: false });
  });

  it('returns a "loaded" status with the brief when campaign-service reconstructs it successfully', async () => {
    // A saved brief that this build can deserialize. The brief object is returned unchanged so
    // the Implementation tab can use it immediately without a second round trip.
    const mockBrief = {
      eventDetails: { slug: 'kubecon-eu-2026', name: 'KubeCon EU 2026' },
      structuredCopy: null,
      keywords: [],
    } as unknown as CampaignBriefOutput;
    loadBrief.mockResolvedValue({ status: 'loaded', briefId: 'brief-abc123', brief: mockBrief, approved: true });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'loaded', briefId: 'brief-abc123', brief: mockBrief, approved: true });
  });

  it('returns an "unreadable" status with the brief ID when a row exists but cannot be reconstructed', async () => {
    // A stored brief that has become undeserializable (e.g. a schema change, or a corrupted row).
    // Returning the ID lets whoever investigates look it up, and the distinct status prevents the
    // UI from treating this as "no brief" and silently overwriting the orphaned row with a new save.
    // The client learns "a saved brief exists but could not be opened" and can prompt the user
    // rather than pretending the slate is clean.
    loadBrief.mockResolvedValue({ status: 'unreadable', briefId: 'brief-def456', brief: null, approved: false });

    await controller.loadBrief(buildLoadReq(), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'unreadable', briefId: 'brief-def456', brief: null, approved: false });
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

  it('omits googleAdsConfig when only demand-gen is selected', async () => {
    // There is no Search campaign to fund, and the dispatcher would otherwise run a demand-gen
    // request as Search. The REFUSAL that makes this omission safe lives in `createCampaigns`
    // (see its spec) — deliberately not here, so it is gated by the cutover flags.
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(envelopeFor(createCampaigns)).not.toHaveProperty('googleAdsConfig');
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
 * The status-toggle route (LFXV2-3226).
 *
 * The handler and its BFF route have existed since the toggle work landed, but nothing in the
 * Angular service called them, so this endpoint had no coverage at all — including the platform
 * allowlist, which is load-bearing: `updateCampaignStatus` dispatches through the LEGACY proxy,
 * whose switch has cases for `meta-ads` and `reddit-ads` only. A well-meaning "re-derive the
 * allowlist from the six dispatchers campaign-service implements" would send Google Ads and
 * LinkedIn into a switch with no case for them. These tests make that refusal explicit rather
 * than incidental.
 */
describe('CampaignController.updateCampaignStatus', () => {
  let controller: CampaignController;
  let res: Response;
  let next: ReturnType<typeof vi.fn>;

  function statusReq(campaignId: string, body: unknown): Request {
    return { params: { campaignId }, body, query: {}, path: `/api/campaigns/${campaignId}/status` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
  });

  it('dispatches a supported platform to the proxy', async () => {
    legacyUpdateStatus.mockResolvedValue({ platform: 'meta-ads', campaignId: '123', previousStatus: 'ACTIVE', newStatus: 'PAUSED', success: true });

    await controller.updateCampaignStatus(statusReq('123', { platform: 'meta-ads', status: 'PAUSED' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(legacyUpdateStatus).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ newStatus: 'PAUSED', success: true }));
  });

  /**
   * The load-bearing case. Asserts the proxy is NOT called, not merely that an error came back:
   * reaching a switch with no case for the platform is the defect, and a test that only checked
   * for an error would pass even if the request got through.
   */
  it.each([['google-ads'], ['linkedin-ads'], ['twitter-ads'], ['microsoft-ads']])('refuses %s, which the legacy proxy cannot serve', async (platform) => {
    await controller.updateCampaignStatus(statusReq('123', { platform, status: 'PAUSED' }), res, next);

    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    // Assert the FIELD message, not the wrapper's generic "Validation failed for platform" —
    // the field message is what names the accepted platforms, so it is the part a caller acts on.
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: [expect.objectContaining({ field: 'platform', message: expect.stringContaining('platform must be one of') })],
      })
    );
  });

  it('refuses a non-numeric campaignId before reaching the proxy', async () => {
    await controller.updateCampaignStatus(statusReq('not-a-number', { platform: 'meta-ads', status: 'PAUSED' }), res, next);

    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: [expect.objectContaining({ field: 'campaignId', message: expect.stringContaining('numeric') })],
      })
    );
  });

  it('refuses a non-object body rather than reading fields off it', async () => {
    await controller.updateCampaignStatus(statusReq('123', 'PAUSED'), res, next);

    expect(legacyUpdateStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
