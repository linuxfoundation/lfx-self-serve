// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { saveBrief, loadBrief, createCampaigns, legacyCreate, isServerFeatureEnabled, logger } = vi.hoisted(() => ({
  saveBrief: vi.fn(),
  loadBrief: vi.fn(),
  createCampaigns: vi.fn(),
  legacyCreate: vi.fn(),
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

  /**
   * The demand-gen-only Google case, which is the reachable one: `buildGoogleAdsConfig` returns
   * null (it builds SEARCH config, and no Search campaign was selected), so google-ads would
   * otherwise travel with no `googleAdsConfig`.
   *
   * That is not a harmless no-op upstream. `unmarshalPlatformConfig` in campaign-service returns
   * nil for an absent key — "no per-platform config supplied; zero value is fine" — so the
   * dispatcher would proceed with a ZERO-VALUE config and call Google Ads with budget 0 and no
   * headlines. Nothing upstream refuses it, so it has to be refused here.
   */
  it('refuses a create when a selected platform has no config, without calling either path', async () => {
    const demandGenOnly = { platforms: ['google-ads'], campaignTypes: ['demand-gen'], budgetUsd: 5000 };

    await controller.createCampaign(buildReq(demandGenOnly, { project: 'tlf', brief_id: 'b-1' }), res, next);

    // Neither path runs: not campaign-service (nothing to dispatch) and NOT the legacy path,
    // which would create the campaigns for real while the user is told creation was refused.
    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: expect.stringContaining('google-ads') });
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

  it('refuses only the unconfigured platform in a mixed selection, rather than dispatching a partial create', async () => {
    // A silent partial success is the same class of bug the cutover exists to prevent: the user
    // asked for Google and LinkedIn, and would get LinkedIn only, with nothing saying so.
    const mixed = { platforms: ['google-ads', 'linkedin-ads'], campaignTypes: ['demand-gen'], linkedInConfig: { budgetUsd: 100 } };

    await controller.createCampaign(buildReq(mixed, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: expect.stringContaining('google-ads') });
  });

  it('passes the project slug and brief id from the query, not the body', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(body, { project: 'cncf', brief_id: 'b-9' }), res, next);

    // Slug, NOT a UUID: campaign-service stamps it into the campaign name and keys the dispatch
    // connection lookup on it, so a UUID here fails twice over.
    expect(createCampaigns).toHaveBeenCalledWith(expect.anything(), 'b-9', 'cncf', ['linkedin-ads'], {
      hsToken: 'hs-1',
      linkedInConfig: { budgetUsd: 100 },
    });
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

    expect(createCampaigns).toHaveBeenCalledWith(expect.anything(), 'b-1', 'tlf', ['linkedin-ads'], { linkedInConfig: { budgetUsd: 100 } });
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

  it('builds no googleAdsConfig when only demand-gen is selected, and refuses rather than dispatching', async () => {
    // There is no Search campaign to fund, and the dispatcher would otherwise run a demand-gen
    // request as Search.
    //
    // Previously this asserted the envelope omitted `googleAdsConfig` — true, but it let the
    // create proceed with `google-ads` still in `platforms`, which is the bug. campaign-service
    // reads the absent key as a ZERO VALUE and calls Google Ads with budget 0 and no headlines,
    // so "omitted from the envelope" was never the safe outcome it looked like. The refusal is
    // what makes the omission safe, so that is what this pins.
    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['demand-gen'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: expect.stringContaining('google-ads') });
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
