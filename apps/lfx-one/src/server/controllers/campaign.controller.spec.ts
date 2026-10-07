// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { KEYWORD_ACTION_DEADLINE_MS } from '../services/campaign-keyword-actions';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON,
  MAX_BULK_KEYWORD_ACTIONS,
  MAX_HUBSPOT_BODY_HTML_LENGTH,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_NEGATIVE_KEYWORDS_PER_REQUEST,
  MAX_SPONSORS,
} from '@lfx-one/shared/constants';
import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';

import { MicroserviceError, ServiceValidationError } from '../errors';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const {
  saveBrief,
  loadBrief,
  loadBriefById,
  createCampaigns,
  generateEmailCopy,
  legacyCreate,
  svcGetJobStatus,
  legacyGetJobStatus,
  searchHubSpotEmails,
  toggleCampaignStatus,
  updateCampaignBudget,
  updateCampaignBid,
  addNegativeKeywords,
  svcGetMicrosoftKeywords,
  listBriefCampaigns,
  getBriefMetrics,
  svcListAudiences,
  svcGetKeywords,
  svcResolveCampaign,
  svcResolveMicrosoftCampaign,
  svcApplyKeywordActions,
  legacyKeywordActions,
  svcGetAudience,
  svcSearchHsCampaigns,
  svcCreateHsCampaign,
  legacyLookupUtm,
  legacyCreateUtm,
  legacyGetKeywords,
  legacyGetAudience,
  legacyUpdateStatus,
  isServerFeatureEnabled,
  logger,
} = vi.hoisted(() => ({
  saveBrief: vi.fn(),
  loadBrief: vi.fn(),
  loadBriefById: vi.fn(),
  createCampaigns: vi.fn(),
  generateEmailCopy: vi.fn(),
  legacyCreate: vi.fn(),
  svcGetJobStatus: vi.fn(),
  legacyGetJobStatus: vi.fn(),
  searchHubSpotEmails: vi.fn(),
  toggleCampaignStatus: vi.fn(),
  updateCampaignBudget: vi.fn(),
  updateCampaignBid: vi.fn(),
  addNegativeKeywords: vi.fn(),
  svcGetMicrosoftKeywords: vi.fn(),
  listBriefCampaigns: vi.fn(),
  getBriefMetrics: vi.fn(),
  svcListAudiences: vi.fn(),
  svcGetKeywords: vi.fn(),
  svcResolveCampaign: vi.fn(),
  svcResolveMicrosoftCampaign: vi.fn(),
  svcApplyKeywordActions: vi.fn(),
  legacyKeywordActions: vi.fn(),
  svcGetAudience: vi.fn(),
  svcSearchHsCampaigns: vi.fn(),
  svcCreateHsCampaign: vi.fn(),
  legacyLookupUtm: vi.fn(),
  legacyCreateUtm: vi.fn(),
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
      public loadBriefById = loadBriefById;
      public createCampaigns = createCampaigns;
      public generateEmailCopy = generateEmailCopy;
      public getJobStatus = svcGetJobStatus;
      public searchHubSpotEmails = searchHubSpotEmails;
      public toggleCampaignStatus = toggleCampaignStatus;
      public updateCampaignBudget = updateCampaignBudget;
      public updateCampaignBid = updateCampaignBid;
      public addNegativeKeywords = addNegativeKeywords;
      public getMicrosoftAdsKeywords = svcGetMicrosoftKeywords;
      public listBriefCampaigns = listBriefCampaigns;
      public getBriefMetrics = getBriefMetrics;
      public listAudiences = svcListAudiences;
      public getGoogleAdsKeywords = svcGetKeywords;
      public resolveGoogleAdsCampaign = svcResolveCampaign;
      public resolveMicrosoftAdsCampaign = svcResolveMicrosoftCampaign;
      public applyKeywordActions = svcApplyKeywordActions;
      public getGoogleAdsAudience = svcGetAudience;
      public searchHubSpotCampaigns = svcSearchHsCampaigns;
      public createHubSpotCampaign = svcCreateHsCampaign;
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
    public lookupHubSpotUtm = legacyLookupUtm;
    public createHubSpotUtm = legacyCreateUtm;
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

  // An earlier revision folded an unrecognised stage to `''` and claimed that addressed the paid
  // slot. It did not: `delivery_type` stayed `email`, so the lookup addressed `(email, '')` -- a
  // real and DIFFERENT key -- and the caller got a confident answer about a brief it never asked
  // for. Unlike `delivery_type`, where every unknown collapses toward the one pre-existing surface
  // and can expose nothing that was hidden, stages are siblings with no narrower fallback.
  it('refuses a stage outside the known list instead of silently querying another brief', async () => {
    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'email', stage: 'Fnal Countdown' }), res, next);

    expect(loadBrief, 'a malformed stage still reached campaign-service').not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect((error.toResponse()['errors'] as { field: string }[])[0].field).toBe('stage');
  });

  // The EMPTY stage is the paid brief's real stage, not a malformed value, so it must pass. A
  // guard written as "reject anything not in CAMPAIGN_EMAIL_STAGES" would refuse every paid
  // lookup -- the common case -- which is why this is asserted next to the rejection above.
  it.each([
    ['an omitted stage', { event_slug: 'kubecon-eu-2026', project: 'tlf' }],
    ['an explicitly empty stage', { event_slug: 'kubecon-eu-2026', project: 'tlf', stage: '' }],
    ['a recognised stage', { event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'email', stage: 'Final Countdown' }],
  ])('accepts %s', async (_label, query) => {
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });

    await controller.loadBrief(buildLoadReq(query), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(loadBrief).toHaveBeenCalled();
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

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
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

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
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

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'unreadable', briefId: 'brief-def456', brief: null, etag: 'W/"9"', approved: false });
  });

  it('forwards delivery_type=email so an email caller cannot be handed a paid brief', async () => {
    // The parameter is what scopes the read to one surface. Briefs were stored one row per
    // `(project, event_slug)` with no delivery dimension BEFORE LFXV2-3198 widened the key, so an
    // email caller and a paid caller resolved to the SAME row -- which is why the email restore
    // path was disabled outright rather than shipped with a known wrong answer.
    //
    // A STAGE is sent with it, because `(email, '')` is not an identity any brief can have: paid
    // has no series and an email send is always some stage. An earlier version of this test
    // asserted that impossible pair, mocking an upstream state that cannot exist.
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });

    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'email', stage: 'Registration Push' }), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'email', 'Registration Push');
    expect(next).not.toHaveBeenCalled();
  });

  // The pair the BFF now refuses locally rather than forwarding. Upstream rejects it with a 400,
  // so relaying it would spend a round trip to learn something this layer already knows.
  it.each([
    ['email with no stage', { event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'email' }],
    ['paid with an email stage', { event_slug: 'kubecon-eu-2026', project: 'tlf', stage: 'CFP Launch' }],
  ])('refuses %s without calling campaign-service', async (_label, query) => {
    await controller.loadBrief(buildLoadReq(query), res, next);

    expect(loadBrief, 'an impossible identity pair was forwarded upstream').not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  // Regression: the controller read `delivery_type` and NOT `stage`, so every lookup asked
  // upstream for the empty stage — the PAID brief's stage. An email caller naming a real stage was
  // answered `none` for a brief sitting right there in the database. Caught by driving the browser
  // against a live service, not by any unit test, because both halves were individually correct:
  // the client sent the stage and the service used it; only the controller dropped it in between.
  it('forwards stage, so a send in an email series is reachable', async () => {
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });

    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'email', stage: 'Registration Push' }), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'email', 'Registration Push');
    expect(next).not.toHaveBeenCalled();
  });

  // The unrecognised-stage case is asserted above, as a REJECTION. An earlier revision of this
  // suite pinned the opposite -- that a bad stage silently became `''` -- which is the behavior
  // the fix removed: with `delivery_type` still `email`, `''` is not the paid slot but the real
  // and different key `(email, '')`, so the caller was answered about a brief nobody asked for.
  // The two assertions cannot both stand, so that test is gone rather than left contradicting.

  // A repeated `?delivery_type=a&delivery_type=b` arrives as an ARRAY. A bare `typeof === 'string'`
  // test collapses that to `''`, which is indistinguishable from "omitted" and therefore answered
  // with the PAID brief — so a malformed request got a confident answer about a brief it never
  // asked for. Rejected before the absent-value default, as `getBriefMetrics` does for `window`.
  it.each([
    ['delivery_type', { event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: ['email', 'paid-marketing'] }],
    ['stage', { event_slug: 'kubecon-eu-2026', project: 'tlf', stage: ['CFP Launch', 'Post-Event'] }],
  ])('refuses a repeated %s rather than defaulting it', async (field, query) => {
    await controller.loadBrief(buildLoadReq(query), res, next);

    expect(loadBrief, 'a repeated parameter still reached campaign-service').not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect((error.toResponse()['errors'] as { field: string }[])[0].field).toBe(field);
  });

  it('refuses an explicitly unrecognised delivery_type instead of returning the paid brief', async () => {
    // An earlier revision narrowed a typo to paid, reasoning that failing closed toward the
    // pre-existing behavior could not expose a brief that was hidden before. True, and beside the
    // point: `?delivery_type=emial` then answered 200 with the PAID brief — a confident answer to a
    // question the caller never asked. Upstream restricts this param to two values, so a third was
    // never the contract, and `stage` already rejects rather than narrows.
    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: 'not-a-surface' }), res, next);

    expect(loadBrief, 'a malformed delivery_type still reached campaign-service').not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
    expect((error.toResponse()['errors'] as { field: string }[])[0].field).toBe('delivery_type');
  });

  // The OMITTED case keeps its old meaning, and that half is what the rejection above must not
  // break: every caller predating the parameter is paid, so an absent value has to keep restoring
  // paid briefs exactly as before.
  // An EXPLICIT `?delivery_type=` is a parameter the caller sent, and `''` is not one of the two
  // values upstream accepts. Treating it as "omitted" answered a malformed request with the paid
  // brief. Contrast `stage`, where `''` IS legal — it is the paid brief's real stage — so the two
  // are checked differently on purpose.
  it('refuses an explicitly empty delivery_type rather than defaulting it to paid', async () => {
    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf', delivery_type: '' }), res, next);

    expect(loadBrief, 'an empty delivery_type was treated as absent and answered with the paid brief').not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('still defaults an omitted delivery_type to paid-marketing', async () => {
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });

    await controller.loadBrief(buildLoadReq({ event_slug: 'kubecon-eu-2026', project: 'tlf' }), res, next);

    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
    expect(next).not.toHaveBeenCalled();
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
    // The brief-destination guard reads the stored brief on every cutover create. `none` is the
    // "could not be established" answer, which the guard treats as not-a-refusal — so every test
    // in this block that is not about that guard dispatches exactly as it did before it existed.
    // Stubbed explicitly rather than left unset: an unstubbed mock returns undefined, the guard
    // throws on it, and the catch happens to produce the same outcome — so the tests would pass
    // for the wrong reason and stop pinning anything the day the catch changes.
    loadBriefById.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
    loadBrief.mockResolvedValue({ status: 'none', briefId: null, brief: null, etag: null, approved: false });
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

  it('passes an INDETERMINATE create through, so the client holds it rather than reading a refusal', async () => {
    // The service and component specs mock opposite sides of this hop; without this, dropping the
    // field here would leave both green while production released the stage hold.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: null, error: 'Campaign creation could not be confirmed.', indeterminate: true });

    await controller.createCampaign(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ jobId: '', error: 'Campaign creation could not be confirmed.', indeterminate: true });
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

  // The flight window is on the base fixture, not only on the tests that assert it, because the
  // form REQUIRES both dates — every real Google create carries them, and a fixture that omits
  // them would let a regression that drops them again pass every assertion below.
  const googleBody = (overrides: Record<string, unknown> = {}) => ({
    platforms: ['google-ads'],
    campaignTypes: ['search'],
    budgetUsd: 1000,
    searchBudgetPct: 60,
    startDate: '2026-04-01',
    endDate: '2026-04-30',
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
      // The flight window the operator entered. Forwarded verbatim; campaign-service applies it
      // via `applyCampaignConfig`, and without it Google defaults to a campaign that starts when
      // enabled and never ends.
      startDate: '2026-04-01',
      endDate: '2026-04-30',
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
   *   - `adAccountId` is an assertion, never a selector: `internal/dispatch/linkedin.go:304-309`
   *     builds the allowlist from the connection's account alone and honours an override only when
   *     it matches, so omitting it and matching it reach the SAME account while any other value is
   *     refused at `:322` ("cross-account campaigns are not allowed"). The id this request carries
   *     comes from this app's own global account file, which has no per-project relationship to the
   *     connection, so forwarding it can only ever cost a create. Dropped.
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
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
  });

  /**
   * Regression guard for a bug that shipped and had to be backed out.
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
      startDate: '2026-04-01',
      endDate: '2026-04-30',
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

  /**
   * The three newer channels take the SAME shape as the demand-gen branch above, and the
   * tests are pinned the same way — `toEqual`, not a field check.
   *
   * What the exact-shape assertion is actually guarding is upstream refusal, not tidiness:
   * campaign-service REFUSES `keywords` and `audienceSegments` on every channel but Search rather
   * than dropping them, so a builder that leaked the Implementation tab's keyword list onto one of
   * these channels would turn a servable create into a refusal. `headlines`/`descriptions` are
   * absent for the matching reason — these channels take their own creative objects, which this
   * request has no source for yet.
   */
  it.each([['performance-max' as const], ['video' as const], ['display' as const]])(
    'gives a %s-only create the whole budget and no search-shaped fields',
    async (channel) => {
      createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
      legacyCreate.mockResolvedValue({ jobId: 'job_1' });

      await controller.createCampaign(
        buildReq(googleBody({ campaignTypes: [channel], budgetUsd: 500, searchBudgetPct: 70 }), { project: 'tlf', brief_id: 'b-1' }),
        res,
        next
      );

      expect(envelopeFor(createCampaigns)['googleAdsConfig']).toEqual({
        budget: 500,
        channel,
        // The flight window reaches the NON-Search branch too. It is the same campaign-level
        // `start_date_time`/`end_date_time` on every kind — the client's `validateFlightWindow`
        // runs before the cascade picks one — so a fix applied to Search alone would leave these
        // three silently unscheduled.
        startDate: '2026-04-01',
        endDate: '2026-04-30',
      });
    }
  );

  /**
   * The flight window's absent case, pinned on BOTH branches.
   *
   * A blank date omits the key rather than sending `''`. The two are equivalent to the dispatcher
   * today (`validateFlightWindow` tests `startDate != ""`), so this is a contract assertion, not a
   * behaviour one — the same reason `geoTargets` reaches its default by the absent-key route.
   */
  it.each([
    ['search' as const, 1000],
    ['performance-max' as const, 1000],
  ])('omits the flight window on a %s create when the dates are blank', async (channel, budget) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: [channel], startDate: '   ', endDate: undefined }), { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['budget']).toBe(budget);
    expect(sent).not.toHaveProperty('startDate');
    expect(sent).not.toHaveProperty('endDate');
  });

  /**
   * A malformed or reversed window travels on to Go rather than being judged here, for the reason
   * `isReversedFlightWindow` records: `validateFlightWindow` refuses it BEFORE the first mutate,
   * names the offending value, and strands no budget. Judging it locally could only replace that
   * named refusal with a vaguer one — or refuse a window Google accepts, since Google's test is
   * `end.Before(start)` and a SAME-DAY flight is legal there while Meta and Reddit refuse it.
   */
  it.each([
    ['a reversed window', '2026-04-30', '2026-04-01'],
    ['a same-day window Google accepts', '2026-04-01', '2026-04-01'],
    ['a shape this cannot read', '2026-4-1', 'next friday'],
  ])('forwards %s to Go rather than refusing it here', async (_label, startDate, endDate) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ startDate, endDate }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['startDate']).toBe(startDate);
    expect(sent['endDate']).toBe(endDate);
  });

  /**
   * The creative, forwarded under the channel's OWN request key.
   *
   * Pinned per channel rather than once, because the key and the field list differ for each and a
   * mapper that sent Demand Gen's shape for all three would be refused upstream on the two it does
   * not fit — after the budget mutate on nothing, since the refusal is the client's own preflight.
   */
  it.each([
    ['demand-gen' as const, 'demandGenCreative', { headlines: [' Join us '], descriptions: ['Register'], logoUrls: ['https://cdn.example/logo.png'] }],
    ['performance-max' as const, 'performanceMaxCreative', { headlines: ['H1', 'H2', 'H3'], descriptions: ['D1'], finalUrl: ' https://example.com/ ' }],
    ['display' as const, 'displayCreative', { headlines: ['H1'], longHeadline: 'A single long headline', descriptions: ['D1'] }],
  ])('forwards the %s creative under its own request key', async (channel, key, creative) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: [channel], [key]: creative }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent[key]).toBeDefined();
    // Trimmed, never counted — every width and count rule is the upstream client's preflight.
    expect((sent[key] as Record<string, unknown>)['headlines']).toEqual(channel === 'demand-gen' ? ['Join us'] : creative.headlines);
  });

  /** A creative keyed to a channel that was not selected is not the selected channel's creative. */
  it('ignores a creative belonging to another channel', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: ['display'], demandGenCreative: { headlines: ['H1'] } }), { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('demandGenCreative');
    expect(sent).not.toHaveProperty('displayCreative');
  });

  /**
   * The empty cases, all three of which must OMIT rather than send an empty object or list.
   *
   * Upstream distinguishes "no creative asked for" (nil — the pre-existing shell behaviour) from
   * "a creative with an empty headline list" (a validation failure), so sending `[]` would turn an
   * operator who skipped the section into a refused create rather than the shell they had before.
   */
  it.each([
    ['no creative key at all', {}],
    ['a creative whose every entry is blank', { displayCreative: { headlines: ['', '   '], longHeadline: '  ' } }],
    ['a creative of the wrong shape entirely', { displayCreative: ['not', 'an', 'object'] }],
    ['a creative carrying non-string entries', { displayCreative: { headlines: [1, null, {}] } }],
  ])('omits the creative key for %s', async (_label, overrides) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['display'], ...overrides }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('displayCreative');
  });

  /**
   * The bidding plan reaches BOTH branches of the builder.
   *
   * Search and the non-Search channels build their config in two separate return statements, and a
   * plan spread into only one of them would silently drop every bid an operator set on the other.
   */
  it.each([['search' as const], ['display' as const]])('carries the bidding plan on a %s create', async (channel) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: [channel], biddingStrategy: 'target-cpa', targetCpa: 25.5, conversionActions: ['12345'] }), {
        project: 'tlf',
        brief_id: 'b-1',
      }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['biddingStrategy']).toBe('target-cpa');
    expect(sent['targetCpa']).toBe(25.5);
    expect(sent['conversionActions']).toEqual(['12345']);
  });

  /**
   * Shape only, and deliberately so.
   *
   * Every per-channel, per-strategy and bounds rule lives in `validateBiddingPlan`
   * (`internal/platform/googleads/bidding.go`) as PURE preflight — no network, no clock — so an
   * invalid plan is refused before the budget mutate, named, with nothing stranded. A second copy
   * here could only diverge by refusing a create upstream would have accepted. These three are
   * each invalid upstream for a different reason and all three must travel.
   */
  it.each([
    ['a strategy the channel does not accept', { biddingStrategy: 'manual-cpc', campaignTypes: ['display'] }, 'biddingStrategy', 'manual-cpc'],
    ['a target below the accepted minimum', { biddingStrategy: 'target-cpa', targetCpa: 0.001 }, 'targetCpa', 0.001],
    ['a target above the accepted maximum', { biddingStrategy: 'target-roas', targetRoas: 5000 }, 'targetRoas', 5000],
  ])('forwards %s rather than refusing it here', async (_label, overrides, field, expected) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody(overrides), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect((envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>)[field]).toBe(expected);
  });

  /**
   * What the plan DOES drop: values that cannot be a value at all.
   *
   * Zero is "absent" rather than a bid — upstream reads `0` on all three numbers as "not
   * supplied", so a typed zero and an omitted key are the same request and only omission stays
   * true if that ever changes. `NaN` and the infinities are dropped because `JSON.stringify`
   * renders all three as `null`, which upstream reads as a type error on a `float64` field: a
   * create refused for a number the operator never typed.
   */
  it('omits a blank strategy, a zero or non-finite amount, and blank conversion entries', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        googleBody({
          biddingStrategy: '   ',
          cpcBid: 0,
          targetCpa: Number.NaN,
          targetRoas: Number.POSITIVE_INFINITY,
          conversionActions: ['', '   ', 12345, null],
        }),
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    for (const key of ['biddingStrategy', 'cpcBid', 'targetCpa', 'targetRoas', 'conversionActions']) {
      expect(sent).not.toHaveProperty(key);
    }
  });

  /** A conversion list is trimmed and the blanks dropped, but the surviving ids are not judged. */
  it('trims the conversion actions it keeps without judging them', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ conversionActions: [' 12345 ', '', 'customers/999/conversionActions/678', 'not-an-id'] }), {
        project: 'tlf',
        brief_id: 'b-1',
      }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['conversionActions']).toEqual(['12345', 'customers/999/conversionActions/678', 'not-an-id']);
  });

  /**
   * The split arm, for a channel that is not demand-gen. The two demand-gen tests above cannot
   * cover this: `normalizeBudgetSplit` has always known `demand-gen`, so a builder that special-cased
   * that one type and treated the rest as single-channel would still pass them and would then
   * overfund Search here by the newer channel's whole share.
   */
  it('funds Google with the SEARCH share when performance max is also selected', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(googleBody({ campaignTypes: ['search', 'performance-max'], budgetUsd: 500, searchBudgetPct: 70 }), {
        project: 'tlf',
        brief_id: 'b-1',
      }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>;
    expect(sent['channel']).toBe('search');
    expect(sent['budget']).toBe(350);
  });

  /**
   * The legacy fall-through refusal.
   *
   * With the cutover dark the legacy in-process path owns creation, and it does not reject an
   * unknown campaign type — `executeGoogleCampaignCreation` sends everything that is not
   * `search` to `createDemandGenCampaign`. So an unrefused Performance Max request does not
   * fail; it creates a funded DEMAND GEN campaign and reports success. Refusing is the only
   * outcome that tells the truth.
   */
  it.each([
    ['performance-max' as const, 'Performance Max'],
    ['display' as const, 'Display'],
  ])('refuses a %s create outright while the cutover is dark', async (channel, label) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: [channel] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).not.toHaveBeenCalled();
    const body = vi.mocked(res.json).mock.calls[0][0] as { jobId: string; error: string };
    expect(body.jobId).toBe('');
    expect(body.error).toContain(label);
    // The cutover IS the fix for these two, so the message is allowed to say so.
    expect(body.error).toContain('cutover');
  });

  /**
   * Video is refused by the same guard but must NOT be given the same reason.
   *
   * The other two are waiting on a deployment; Video is waiting on Google, and
   * `CreateVideoCampaign` refuses unconditionally upstream whatever this deployment does. A
   * message promising that a cutover will fix it sends an operator to enable a flag that changes
   * nothing. The cutover road already refuses to say "ask an administrator" for Video — asserted
   * one layer over in `campaign-service.service.spec.ts` — and this pins the legacy road to the
   * same answer so the two cannot drift apart.
   *
   * Asserting the absence of 'cutover' as well as the presence of the reason is what makes this
   * mutation-proof: a revert to the shared string still contains the word "Video", so a
   * `toContain(label)` assertion alone would stay green.
   */
  it('refuses a video create with the API limit, not the cutover message, while the cutover is dark', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: ['video'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).not.toHaveBeenCalled();
    const body = vi.mocked(res.json).mock.calls[0][0] as { jobId: string; error: string };
    expect(body.jobId).toBe('');
    expect(body.error).toBe(GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON);
    expect(body.error).not.toContain('cutover');
    expect(body.error).not.toContain('administrator');
  });

  /**
   * The other half of the refusal, and the half that keeps it from being over-broad: the legacy
   * path serves Search and Demand Gen perfectly well, and refusing either would break creates that
   * work in production today.
   */
  it.each([['search' as const], ['demand-gen' as const]])('still runs the legacy path for a %s create while the cutover is dark', async (channel) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_legacy_ok' });

    await controller.createCampaign(buildReq(googleBody({ campaignTypes: [channel] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_legacy_ok' });
  });

  /**
   * The refusal is keyed on the GOOGLE channel list, not on the request carrying the string
   * anywhere. A LinkedIn-only create whose brief happens to name `video` must still reach the
   * legacy path — `platforms` is what decides whether a Google channel is being asked for.
   */
  it('does not refuse a non-google create that happens to carry a flagged campaign type', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_li_1' });

    const linkedInBody = {
      platforms: ['linkedin-ads'],
      campaignTypes: ['video'],
      linkedInConfig: { budgetUsd: 100, targetingProfile: { id: 'cloud-native' } },
    };
    await controller.createCampaign(buildReq(linkedInBody, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ jobId: 'job_li_1' });
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
   * The client refuses these BEFORE its first create call (`targeting.go:183` and its siblings,
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
    // normalization that could only drift.
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
    // cases run with the cutover dark, where reaching the legacy path is correct behavior.
    expect(envelopeFor(createCampaigns)).not.toHaveProperty('microsoftConfig');
  });

  /**
   * LFXV2-3256. The envelope key and field names are a CONTRACT with
   * `internal/dispatch/hubspot.go:47-56` — the dispatcher reads `hubspotConfig.sourceEmailId`, and
   * `unmarshalPlatformConfig` treats a missing key as a zero value rather than an error. A typo on
   * either side therefore produces a silent zero-value dispatch, not a type error, which is why
   * these assert the exact strings.
   */
  it.each([
    ['only a subject', { subjectB: 'S', bodyHtmlB: '' }],
    ['only a body', { subjectB: '', bodyHtmlB: '<p>b</p>' }],
    ['a whitespace-only body', { subjectB: 'S', bodyHtmlB: '   ' }],
    // `.trim()` removes only whitespace-category characters, so each of these is a NON-EMPTY
    // string that renders blank. Gating on truthiness staged a variant whose body a reader
    // cannot see; the gate now asks `hasVisibleHtmlText`, the same predicate the service layer uses.
    ['a body of zero-width spaces', { subjectB: 'S', bodyHtmlB: '<p>\u200B\u200B</p>' }],
    ['a body of soft hyphens', { subjectB: 'S', bodyHtmlB: '<p>\u00AD</p>' }],
    ['a body of Hangul filler', { subjectB: 'S', bodyHtmlB: '<p>\u3164</p>' }],
  ])('refuses to stage an A/B variant from a direct request carrying %s', async (_label, half) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', abTestEnabled: true, ...half } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    // This is the boundary that matters: the client gate stops the UI sending a half-filled
    // variant, but a direct campaign-manager request bypasses it, and upstream reads '' as
    // "blank this field" -- so the request meant to SET variant B's body would clear it.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['abTestEnabled']).toBeUndefined();
    expect(sent['subjectB']).toBeUndefined();
    expect(sent['bodyHtmlB']).toBeUndefined();
  });

  /**
   * Two gates in this handler ask the same question about the same value: whether the body has
   * anything a reader can see. One was switched to the shared predicate and its sibling was left
   * on `.trim()` truthiness, so a body of invisible characters forwarded no `bodyHtml` and still
   * attached a hero and sponsors to it -- a rebuild carrying a hero and no body, which upstream
   * treats as data loss rather than a dropped field.
   */
  it('attaches no hero or sponsors to a body that renders nothing', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            bodyHtml: '<p>\u200B\u200B</p>',
            heroImageUrl: 'https://cdn.example.com/hero.png',
            buttonUrl: 'https://example.com/register',
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['bodyHtml']).toBeUndefined();
    expect(sent['heroImageUrl']).toBeUndefined();
    expect(sent['buttonUrl']).toBeUndefined();
  });

  it('bounds the sponsor list before parsing, then caps the survivors', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    // 100 entries. The pre-slice bounds the work at MAX_SPONSORS * 2 BEFORE the per-entry
    // canonicalHttpUrl parse, so a direct request cannot make the controller parse an unbounded
    // list; the cap after it is what limits what actually ships.
    const sponsors = Array.from({ length: 100 }, (_, i) => ({ name: `S${i}`, logoUrl: `https://cdn.example.com/${i}.png` }));

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: '<p>b</p>', sponsors } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect((sent['sponsors'] as unknown[]).length).toBe(MAX_SPONSORS);
    // From the FRONT of the list -- the pre-slice keeps the first 2N, so the first N survive.
    expect((sent['sponsors'] as { name: string }[])[0].name).toBe('S0');
  });

  it('forwards a URL-less CTA as text, without its presentational classes', async () => {
    // What the WIRE carries, as opposed to what the service emits. The service renders a
    // destination-less button as `<div class="lfx-block lfx-button"><strong>`, but `class` is not
    // an allowed attribute, so by the time the body reaches campaign-service the classes are
    // gone. The ELEMENT and the label are the part that survives, and the part that matters --
    // `<strong>` is what carries the emphasis in a client that drops CSS.
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            bodyHtml: '<p>Hi</p><div class="lfx-block lfx-button"><strong>Submit Your Proposal</strong></div>',
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['bodyHtml']).toContain('<strong>Submit Your Proposal</strong>');
    expect(sent['bodyHtml']).not.toContain('lfx-block');
    expect(sent['bodyHtml']).not.toContain('class=');
  });

  it('sanitizes both HTML bodies and every display field at the request boundary', async () => {
    // This is a public API. The component sanitizes before staging, but a DIRECT request never
    // runs that code -- so without this the browser-side sanitizer was the only guard on values
    // that reach the recipient's mail client.
    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            bodyHtml: '<p>A</p><img src="https://evil.test/a.gif">',
            subject: 'Subj\u202Eevil',
            preheader: 'Pre\u202Eevil',
            buttonText: 'Click\u202Eevil',
            // A buttonUrl is required for buttonText to survive the allow-list -- without it the
            // pair is dropped and the field could never be observed.
            buttonUrl: 'https://events.linuxfoundation.org/register/',
            abTestEnabled: true,
            subjectB: 'SubjB\u202Eevil',
            bodyHtmlB: '<p>B</p><img src="https://evil.test/b.gif">',
            preheaderB: 'PreB\u202Eevil',
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const cfg = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, string>;
    // Both bodies: the fetch is gone, the copy survives.
    for (const key of ['bodyHtml', 'bodyHtmlB']) {
      expect(cfg[key]).not.toContain('evil.test');
      expect(cfg[key]).not.toContain('<img');
    }
    expect(cfg['bodyHtml']).toContain('A');
    expect(cfg['bodyHtmlB']).toContain('B');
    // Every display field, under the names the CONTROLLER emits: `preheader` is renamed to
    // `previewText` on the wire (and `preheaderB` to `previewTextB`), so asserting the payload
    // key rather than the request key is what makes this test about what actually ships.
    // `buttonText` IS present: the fixture supplies a `buttonUrl`, without which the allow-list
    // would drop the pair together -- which is why the url above is not incidental to this test.
    for (const key of ['subject', 'previewText', 'subjectB', 'previewTextB', 'buttonText']) {
      expect(cfg[key]).not.toContain('\u202E');
      expect(cfg[key]).toContain('evil');
    }
  });

  it.each(['bodyHtml', 'bodyHtmlB'])('refuses an oversized %s before sanitising or dispatching', async (field) => {
    // The sanitiser runs in `createConfigEnvelope`, ahead of every other check, and the only
    // other bound on its input is the 15 MB body-parser limit. The cap keeps its cost bounded.
    const createConfigEnvelope = vi.spyOn(controller as unknown as { createConfigEnvelope: (body: unknown) => unknown }, 'createConfigEnvelope');
    await controller.createCampaign(
      buildReq(
        { platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', [field]: `<p>${'x'.repeat(MAX_HUBSPOT_BODY_HTML_LENGTH)}</p>` } },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(createConfigEnvelope).not.toHaveBeenCalled();
    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    expect(loadBriefById).not.toHaveBeenCalled();
  });

  it('accepts a body exactly at the size cap', async () => {
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-000000000001', error: null });

    await controller.createCampaign(
      buildReq(
        { platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: `<p>${'x'.repeat(MAX_HUBSPOT_BODY_HTML_LENGTH - 7)}</p>` } },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  it('sanitizes a sponsor name from a DIRECT request, not just the scrape path', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            bodyHtml: '<p>b</p>',
            sponsors: [{ name: 'Acme <script>alert(1)</script>', logoUrl: 'https://cdn.example.com/a.png' }],
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // A direct campaign-manager request bypasses the scrape path entirely, so sanitizing only
    // there left this sink open -- the name lands in a HubSpot image module's alt attribute in
    // a sent email.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    const sponsors = sent['sponsors'] as { name: string }[];
    expect(sponsors[0].name).not.toContain('<');
    expect(sponsors[0].name).not.toContain('>');
  });

  it('renames preheaderB to previewTextB on the wire, like preheader to previewText', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            abTestEnabled: true,
            subjectB: 'S',
            bodyHtmlB: '<p>b</p>',
            preheaderB: '  B preheader  ',
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // The Go decoder reads `previewTextB` (internal/dispatch/hubspot.go); a `preheaderB` key is
    // silently dropped. That is exactly the bug the original preheader/previewText rename fixed,
    // so the B half is tested rather than assumed -- and trimmed, matching the A half.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['previewTextB']).toBe('B preheader');
    expect(sent['preheaderB']).toBeUndefined();
  });

  it('omits previewTextB entirely when blank, rather than blanking B preheader', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: { sourceEmailId: 'e-1', abTestEnabled: true, subjectB: 'S', bodyHtmlB: '<p>b</p>', preheaderB: '   ' },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // ABSENT, not ''. Upstream preserves the parent's preview text for an absent value, so an
    // empty string would BLANK variant B's preheader instead of leaving it alone.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['previewTextB']).toBeUndefined();
    expect(sent['abTestEnabled']).toBe(true);
  });

  it('canonicalizes a scheme-relative-looking URL rather than forwarding it verbatim', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        { platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: '<p>b</p>', heroImageUrl: 'http:example.com/hero.png' } },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // WHATWG `URL` accepts `http:example.com` and reports an `http:` protocol, so a validator
    // that returns the INPUT forwards a non-network-absolute value the Go downloader cannot
    // use -- and the hero then degrades silently, because the upload is best-effort.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['heroImageUrl']).toBe('http://example.com/hero.png');
  });

  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data'],
    ['loopback', 'http://127.0.0.1/hero.png'],
    ['localhost with a trailing root dot', 'http://localhost./hero.png'],
    ['rfc1918', 'http://10.0.0.5/hero.png'],
    ['ipv4-mapped metadata', 'http://[::ffff:169.254.169.254]/hero.png'],
  ])('drops a hero image pointing at %s', async (_label, heroImageUrl) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: '<p>b</p>', heroImageUrl } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    // This route has no body validator, so a direct campaign-manager request is the whole attack
    // surface: campaign-service FETCHES heroImageUrl server-side and re-hosts the bytes as a
    // publicly readable file, which makes an unguarded host a read-back channel out of the
    // cluster. The trailing-dot case is not decoration — `new URL('http://localhost./x').hostname`
    // keeps the dot, which evaded the check until the host is normalized.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['heroImageUrl']).toBeUndefined();
  });

  it('DOES forward hero, button and sponsors when a body is present', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            bodyHtml: '<p>Join us</p>',
            heroImageUrl: 'https://cdn.example.com/hero.png',
            buttonText: 'Register',
            buttonUrl: 'https://events.example/register',
            sponsors: [{ name: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' }],
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // The POSITIVE case. Every other test around this gate asserts what is WITHHELD, so a gate
    // that withheld everything unconditionally would have passed all of them -- this is the one
    // that proves the fields still reach campaign-service when they should.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['heroImageUrl']).toBe('https://cdn.example.com/hero.png');
    expect(sent['buttonText']).toBe('Register');
    expect(sent['buttonUrl']).toBe('https://events.example/register');
    expect(sent['sponsors']).toEqual([{ name: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' }]);
  });

  it.each([
    ['no body at all', {}],
    ['a whitespace-only body', { bodyHtml: '   ' }],
  ])('refuses to forward hero, button or sponsors with %s', async (_label, body) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            ...body,
            heroImageUrl: 'https://cdn.example.com/hero.png',
            buttonText: 'Register',
            buttonUrl: 'https://events.example/register',
            sponsors: [{ name: 'Acme', logoUrl: 'https://cdn.example.com/acme.png' }],
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // The client gate stops the UI sending these without a body; a direct campaign-manager
    // request bypasses it, and this route has no body validator. DATA LOSS rather than a dropped
    // field: campaign-service's RebuildEmailContent replaces the whole widget tree, so a rebuild
    // carrying a hero or button and no body drops the cloned template's body.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['heroImageUrl']).toBeUndefined();
    expect(sent['buttonUrl']).toBeUndefined();
    expect(sent['buttonText']).toBeUndefined();
    expect(sent['sponsors']).toBeUndefined();
    // The clone itself still proceeds — this withholds content, it does not block staging.
    expect(sent['sourceEmailId']).toBe('e-1');
  });

  it('strips userinfo from a forwarded URL rather than carrying credentials into the email', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        { platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: '<p>b</p>', heroImageUrl: 'https://user:secret@cdn.example.com/hero.png' } },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['heroImageUrl']).toBe('https://cdn.example.com/hero.png');
    expect(String(sent['heroImageUrl'])).not.toContain('secret');
  });

  it('caps and sanitizes the sponsor list from a direct request', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    const sponsors = [
      ...Array.from({ length: 14 }, (_, i) => ({ name: `Sponsor ${i}`, logoUrl: `https://cdn.example.com/s${i}.png` })),
      { name: '   ', logoUrl: 'https://cdn.example.com/blank-name.png' },
      { name: 'X'.repeat(300), logoUrl: 'https://cdn.example.com/long.png', unexpected: 'dropped' },
    ];

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', bodyHtml: '<p>b</p>', sponsors } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    const got = sent['sponsors'] as { name: string; logoUrl: string }[];
    // Capped: each entry is a server-side fetch downstream, so an unbounded array is fan-out.
    expect(got).toHaveLength(10);
    // Blank names dropped, long names bounded, and no key the allow-list did not name.
    expect(got.every((sponsor) => sponsor.name.trim() !== '')).toBe(true);
    expect(got.every((sponsor) => sponsor.name.length <= 100)).toBe(true);
    expect(got.every((sponsor) => Object.keys(sponsor).sort().join(',') === 'logoUrl,name')).toBe(true);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['not a url', 'not-a-url'],
  ])('drops a sponsor whose logo is %s rather than forwarding it as an image source', async (_label, logoUrl) => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            // A body is required for hero/button/sponsors to be forwarded at all, so it is
            // present here to reach the logo validation this test is about.
            bodyHtml: '<p>b</p>',
            sponsors: [
              { name: 'Bad', logoUrl },
              { name: 'Good', logoUrl: 'https://cdn.example.com/good.png' },
            ],
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // A sponsor logo becomes an <img src> in a SENT email and is fetched server-side, so a
    // non-empty check alone let a script URL reach that sink from a direct request.
    const sent = envelopeFor(createCampaigns)['hubspotConfig'] as Record<string, unknown>;
    expect(sent['sponsors']).toEqual([{ name: 'Good', logoUrl: 'https://cdn.example.com/good.png' }]);
  });

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

  it('forwards the body stage to the campaign-service client', async () => {
    generateEmailCopy.mockResolvedValue({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } });

    await controller.generateEmailCopy(buildReq({ stage: 'Post-Event' }, { project: 'tlf', brief_id: 'b-1' }), res, next);

    // The whole selector is inert if this argument is dropped, and nothing else would say so:
    // generation still succeeds, just with default-stage copy under the operator's chosen label.
    expect(generateEmailCopy).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1', 'Post-Event', undefined, undefined);
  });

  it('forwards the body variant to the campaign-service client', async () => {
    generateEmailCopy.mockResolvedValue({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } });

    await controller.generateEmailCopy(buildReq({ variant: 'B' }, { project: 'tlf', brief_id: 'b-1' }), res, next);

    // Same inert-if-dropped hazard as `stage`: generation still succeeds, silently producing
    // variant-A copy for an operator who asked for B, and the A/B test compares A against A.
    expect(generateEmailCopy).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1', undefined, 'B', undefined);
  });

  it.each([
    ['whitespace only', { variant: '   ' }],
    ['not a string', { variant: 42 }],
    ['absent', {}],
  ])('sends no variant when the body carries %s', async (_label, body) => {
    generateEmailCopy.mockResolvedValue({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } });

    await controller.generateEmailCopy(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(generateEmailCopy).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1', undefined, undefined, undefined);
  });

  it.each([
    ['whitespace only', { stage: '   ' }],
    ['not a string', { stage: 42 }],
    ['absent', {}],
  ])('sends no stage when the body carries %s', async (_label, body) => {
    generateEmailCopy.mockResolvedValue({ enabled: true, copy: { subject: 's', preheader: 'p', body: '<p>b</p>', cta: 'c', ctaUrl: '' } });

    await controller.generateEmailCopy(buildReq(body, { project: 'tlf', brief_id: 'b-1' }), res, next);

    // `undefined`, not '' -- upstream reads absence as "the caller did not say" and defaults,
    // while an empty string would fail its enum and 400 a request the operator did not make.
    expect(generateEmailCopy).toHaveBeenCalledWith(expect.anything(), 'tlf', 'b-1', undefined, undefined, undefined);
  });

  it('forwards the generated subject, body, and preheader to the dispatcher', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq(
        {
          platforms: ['hubspot'],
          hubspotConfig: {
            sourceEmailId: 'e-1',
            subject: 'Join us in Nairobi',
            bodyHtml: '<p>Hello</p>',
            preheader: 'Secure your spot in Nairobi',
          },
        },
        { project: 'tlf', brief_id: 'b-1' }
      ),
      res,
      next
    );

    // This mapper is an ALLOW-LIST: anything it does not name never reaches campaign-service.
    // It once named only sourceEmailId and utmCampaign, so a staged draft silently kept the
    // cloned template's own subject and body while the UI showed the generated ones (observed
    // live on draft 220597885197); preheader had the same gap until it was named here too, so a
    // staged draft kept the clone source's own preview text on a real send.
    expect(envelopeFor(createCampaigns)['hubspotConfig']).toEqual({
      sourceEmailId: 'e-1',
      subject: 'Join us in Nairobi',
      bodyHtml: '<p>Hello</p>',
      previewText: 'Secure your spot in Nairobi',
    });
  });

  it('omits subject, bodyHtml, and preheader when no copy was generated', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', subject: '   ', preheader: '   ' } }, { project: 'tlf', brief_id: 'b-1' }),
      res,
      next
    );

    // Upstream leaves the template's own value in place when a field is ABSENT, so sending ""
    // would be a request to blank the draft's subject rather than to leave it alone.
    expect(envelopeFor(createCampaigns)['hubspotConfig']).toEqual({ sourceEmailId: 'e-1' });
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

  it('drops a non-string preheader rather than throwing on it', async () => {
    createCampaigns.mockResolvedValue({ enabled: false, jobId: null, error: null });
    legacyCreate.mockResolvedValue({ jobId: 'job_1' });

    await controller.createCampaign(
      buildReq({ platforms: ['hubspot'], hubspotConfig: { sourceEmailId: 'e-1', preheader: 42 } } as unknown as Record<string, unknown>, {
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

  /**
   * The pre-dispatch guards.
   *
   * Every one of them converts a refusal the Go side makes BEFORE its first mutate — and which the
   * orchestrator then collapses into the opaque "platform campaign creation failed" — into a named
   * field error. So each guard is tested in a pair: the input upstream refuses must be refused
   * here, and the nearest input upstream ACCEPTS must still dispatch. The second half is the one
   * that matters, because over-refusing a create the platform would have taken is the only way
   * these guards can make things worse than they were.
   */
  const refusalFrom = (): { field: string; message: string; statusCode: number } => {
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    // The operator-facing reason lives in `validationErrors[0]`, not in `error.message` — the
    // top-level message is the wire contract's "Validation failed for <field>" prefix that both
    // frontend readers branch on. Asserting on `error.message` would pass on a guard that named
    // the right field with the wrong explanation.
    return { field: error.validationErrors[0].field, message: error.validationErrors[0].message, statusCode: error.statusCode };
  };

  /** The 30 codes `GOOGLE_ADS_GEO_TARGET_MAP` holds, which are the 30 `geo.go` holds. */
  const ALL_MAPPED_GEOS = [
    'US',
    'CA',
    'GB',
    'DE',
    'FR',
    'JP',
    'AU',
    'IN',
    'BR',
    'CN',
    'KR',
    'NL',
    'SE',
    'CH',
    'IL',
    'SG',
    'IE',
    'ES',
    'IT',
    'AT',
    'FI',
    'NO',
    'DK',
    'BE',
    'PL',
    'CZ',
    'NZ',
    'TW',
    'HK',
    'MX',
  ];

  it('names an unsupported-but-well-formed country code instead of letting Google refuse it opaquely', async () => {
    // `PT` is assigned, two letters, and passes `buildGoogleAdsConfig`'s shape test — and is absent
    // from `geo.go`'s map, so `validateGeoTargets` hard-errors on it before the first mutate.
    await controller.createCampaign(buildReq(googleBody({ geoTargets: ['US', 'PT'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('countryCode');
    expect(error.message).toContain('PT');
    // Only the unsupported code is named — `US` is fine and saying otherwise would send the
    // operator looking at the wrong field.
    expect(error.message).not.toContain('US');
  });

  it('dispatches a list of all 30 supported codes, which is exactly what upstream accepts', async () => {
    // The contrast for both geo guards at once: every code mapped, and the count at the cap rather
    // than over it. Without this the two refusals above and below would pass on a controller that
    // refused every targeted Google create.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000a', error: null });

    await controller.createCampaign(buildReq(googleBody({ geoTargets: ALL_MAPPED_GEOS }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect((envelopeFor(createCampaigns)['googleAdsConfig'] as Record<string, unknown>)['geoTargets']).toHaveLength(30);
  });

  it('refuses a 31-code list even when the 31st is a repeat, because upstream caps before it de-duplicates', async () => {
    // `validateGeoTargets` checks `len(geoTargets) > maxGeoTargets` on the raw slice, so a list
    // that is only over the cap because it repeats a code is still refused there. Judging the
    // de-duplicated length here would accept a create Go then kills.
    await controller.createCampaign(buildReq(googleBody({ geoTargets: [...ALL_MAPPED_GEOS, 'US'] }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('countryCode');
    expect(error.message).toContain('31');
  });

  it.each([
    ['a zero budget', 0],
    ['a negative budget, which no body validator on this route stops', -50],
    ['a positive budget that rounds to zero micros, the denomination Google bills in', 0.0000004],
  ])('names %s rather than letting Google refuse it before any mutate', async (_label, budgetUsd) => {
    await controller.createCampaign(buildReq(googleBody({ budgetUsd }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    expect(legacyCreate).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('budgetUsd');
    // States the CONSTRAINT. A negative budget reported as "is 0" would describe a value the
    // caller did not send, so the message must not assert one.
    expect(error.message).not.toContain('is 0');
  });

  it('dispatches a budget of exactly one micro, which is the smallest Google accepts', async () => {
    // The boundary that makes the rounding deliberate, and the contrast without which the three
    // refusals above would pass on a controller that refused every Google create. 0.0000004
    // rounds DOWN to zero micros and is refused; 0.000001 is one whole micro and is dispatched.
    // Comparing the raw float against zero would accept both — which is the defect this pins.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000d', error: null });

    await controller.createCampaign(buildReq(googleBody({ budgetUsd: 0.000001 }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  const linkedInBody = (overrides: Record<string, unknown> = {}) => ({
    platforms: ['linkedin-ads'],
    linkedInConfig: { budgetUsd: 100, ...overrides },
  });

  it.each([
    ['a lifetime budget under the 100-dollar floor', { budgetUsd: 25, lifetimeBudget: true }, '$100'],
    ['a daily budget under the 10-dollar floor', { budgetUsd: 9, lifetimeBudget: false }, '$10'],
  ])('names %s rather than letting LinkedIn refuse it before any POST', async (_label, config, expectedFloor) => {
    await controller.createCampaign(buildReq(linkedInBody(config), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('budgetUsd');
    expect(error.message).toContain(expectedFloor);
  });

  it.each([
    ['99.999 on a lifetime budget, which Go rounds to 100.00 and accepts', { budgetUsd: 99.999, lifetimeBudget: true }],
    ['exactly the 10-dollar daily floor', { budgetUsd: 10, lifetimeBudget: false }],
  ])('dispatches %s', async (_label, config) => {
    // 99.999 is the boundary that makes the rounding deliberate: Go validates the value it is
    // about to format to two decimals, so comparing the raw float here would refuse a budget
    // upstream takes.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000b', error: null });

    await controller.createCampaign(buildReq(linkedInBody(config), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  const metaBody = (overrides: Record<string, unknown> = {}) => ({
    platforms: ['meta-ads'],
    metaConfig: { budgetUsd: 250, lifetimeBudget: false, geoTargets: ['US'], variants: [{ primaryText: 'p', headline: 'h' }], ...overrides },
  });

  it('refuses a flight whose end date equals its start date, which Meta compares strictly', async () => {
    // The likeliest way an operator trips this: a one-day campaign entered as the same date twice.
    await controller.createCampaign(buildReq(metaBody({ startDate: '2026-03-01', endDate: '2026-03-01' }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('endDate');
  });

  it.each([
    ['a zero budget', 0],
    ['a negative budget, which no body validator on this route stops', -250],
  ])('names %s rather than letting Meta refuse it before any mutate', async (_label, budgetUsd) => {
    await controller.createCampaign(buildReq(metaBody({ budgetUsd }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('budgetUsd');
    expect(error.message).not.toContain('is 0');
  });

  it('dispatches a sub-dollar Meta budget, which the account currency may well accept', async () => {
    // The contrast for the pair above, and the reason Meta is judged as a raw float where Google
    // is judged in micros: Meta's floor is one MINOR currency unit, and the offset depends on the
    // ad account's currency — 0.50 is 50 minor units under USD and refused under JPY. This app
    // cannot see that currency, so anything above zero is passed through for Meta to judge.
    // Mirroring Google's arithmetic here would refuse creates Meta accepts.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000e', error: null });

    await controller.createCampaign(buildReq(metaBody({ budgetUsd: 0.5 }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  const redditBody = (overrides: Record<string, unknown> = {}) => ({
    platforms: ['reddit-ads'],
    redditConfig: { budgetUsd: 300, geoTargets: ['US'], ...overrides },
  });

  it('refuses a reversed Reddit flight, which Reddit compares as strictly as Meta does', async () => {
    // The Reddit half of the same guard. Without this the loop could be narrowed to meta-ads
    // alone and the suite would stay green, leaving Reddit's identical refusal opaque again.
    await controller.createCampaign(buildReq(redditBody({ startDate: '2026-03-10', endDate: '2026-03-04' }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('endDate');
    expect(error.message).toContain('Reddit');
  });

  it('dispatches a Reddit flight that ends one day after it starts, the nearest window upstream takes', async () => {
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000f', error: null });

    await controller.createCampaign(buildReq(redditBody({ startDate: '2026-03-04', endDate: '2026-03-05' }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an impossible calendar date', '2026-02-31', '2026-03-05'],
    ['a date that is not zero-padded', '2026-1-2', '2026-3-4'],
  ])('passes %s through to Go rather than judging a shape it cannot read', async (_label, startDate, endDate) => {
    // A value this guard cannot parse is refused upstream anyway, with a message that names it.
    // Refusing here could only turn that named refusal into this guard's different one — or, for
    // `2026-02-31`, refuse a create on a date `new Date` would have silently rolled to March 3.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000c', error: null });

    await controller.createCampaign(buildReq(metaBody({ startDate, endDate }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  const briefWithUrl = (registrationUrl: string) => ({
    status: 'loaded',
    briefId: 'b-1',
    brief: { eventDetails: { registrationUrl } },
    etag: 'W/"1"',
    approved: true,
  });

  it('reads the brief the create dispatches against — by id — and not whichever brief the slug names today', async () => {
    // `POST /projects/{project}/briefs/{brief_id}/campaigns` dispatches against the id. Judging the
    // slug's brief instead would let this guard refuse a create over a registration URL belonging
    // to a brief the request never mentioned.
    loadBriefById.mockResolvedValue(briefWithUrl('https://events.example.org/register'));
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000d', error: null });

    await controller.createCampaign(buildReq(googleBody({ eventSlug: 'kubecon-eu-2026' }), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(loadBriefById).toHaveBeenCalledWith(expect.any(Object), 'tlf', 'b-1');
    expect(loadBrief, 'the slug lookup ran even though the request carried a brief id').not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  it('falls back to the slug lookup only when the request carries no brief id', async () => {
    loadBrief.mockResolvedValue(briefWithUrl('https://events.example.org/register'));
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000e', error: null });

    await controller.createCampaign(buildReq(googleBody({ eventSlug: 'kubecon-eu-2026' }), { project: 'tlf' }), res, next);

    expect(loadBriefById).not.toHaveBeenCalled();
    expect(loadBrief).toHaveBeenCalledWith(expect.any(Object), 'kubecon-eu-2026', 'tlf', 'paid-marketing', '');
  });

  it.each([
    ['has no registration URL at all', '', 'no registration URL'],
    ['has one typed without a scheme, which every platform validator refuses', 'agenticsday.org', 'not a complete web address'],
  ])('refuses a create whose stored brief %s', async (_label, registrationUrl, expectedText) => {
    loadBriefById.mockResolvedValue(briefWithUrl(registrationUrl));

    await controller.createCampaign(buildReq(googleBody(), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('registrationUrl');
    expect(error.message).toContain(expectedText);
  });

  it('dispatches a plain-http brief URL when Meta is not one of the selected platforms', async () => {
    // Four of the five platforms accept either scheme, so refusing http outright would refuse a
    // create those four would have taken.
    loadBriefById.mockResolvedValue(briefWithUrl('http://events.example.org/register'));
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-00000000000f', error: null });

    await controller.createCampaign(buildReq(googleBody(), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  it('refuses the same plain-http brief URL once Meta is selected, because Meta requires HTTPS', async () => {
    loadBriefById.mockResolvedValue(briefWithUrl('http://events.example.org/register'));

    await controller.createCampaign(buildReq(metaBody(), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(createCampaigns).not.toHaveBeenCalled();
    const error = refusalFrom();
    expect(error.statusCode).toBe(400);
    expect(error.field).toBe('registrationUrl');
    expect(error.message).toContain('https://');
  });

  it('dispatches when the brief could not be read, because an unreadable brief is not an operator error', async () => {
    // The guard exists to name a knowable input error, never to add a new way for a create to
    // fail. A lookup that could not be ESTABLISHED must therefore not refuse anything.
    loadBriefById.mockRejectedValue(new Error('campaign-service unreachable'));
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-000000000010', error: null });

    await controller.createCampaign(buildReq(googleBody(), { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(createCampaigns).toHaveBeenCalledTimes(1);
  });

  it('does not read the brief at all for an email-only create, which never reads a destination upstream', async () => {
    // `internal/dispatch/hubspot.go` takes only an OPTIONAL `ButtonURL` from `hubspotConfig`, so
    // refusing a hubspot-only create for a missing registration URL would refuse a create the
    // platform would have accepted.
    createCampaigns.mockResolvedValue({ enabled: true, jobId: '9f1c2d3e-0000-4000-8000-000000000011', error: null });

    await controller.createCampaign(buildReq({ platforms: ['hubspot'], hubspotConfig: { emailId: 'e-1' } }, { project: 'tlf', brief_id: 'b-1' }), res, next);

    expect(loadBriefById).not.toHaveBeenCalled();
    expect(loadBrief).not.toHaveBeenCalled();
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
  // reverting the client fix broke a test while leaving production behavior identical.
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
 * The client spec pins what goes on the wire. What only this layer decides is which requests are
 * refused before a round trip, and that an upstream refusal reaches `next` as the same error so
 * `apiErrorHandler` renders its status and message unchanged.
 */
describe('CampaignController.updateCampaignBudget', () => {
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const validBody = { briefId: 'b-1', etag: '"1"', budget: 150.25, budgetType: 'daily' };
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function budgetReq(campaignId: string, body: unknown, query: Record<string, unknown> = { project: 'tlf' }): Request {
    return { params: { campaignId }, body, query, path: `/api/campaigns/${campaignId}/budget` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    updateCampaignBudget.mockResolvedValue({ id: UUID, platform: 'google-ads', status: 'active', version: 2, etag: '"2"' });
  });

  it('sends the change to campaign-service and reports the row it answered with', async () => {
    await controller.updateCampaignBudget(budgetReq(UUID, validBody), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateCampaignBudget).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: 'b-1',
      campaignId: UUID,
      budget: 150.25,
      budgetType: 'daily',
      etag: '"1"',
    });
    expect(res.json).toHaveBeenCalledWith({
      platform: 'google-ads',
      campaignId: UUID,
      budget: 150.25,
      budgetType: 'daily',
      etag: '"2"',
      serviceStatus: 'active',
    });
  });

  // The row's platform is checked against CAMPAIGN_PLATFORMS, never cast: an unknown value is
  // logged and reported as null rather than passed off as a CampaignPlatform.
  it.each([['google_ads'], ['hubspot'], [undefined]])('reports an unknown row platform %s as null, with a warning', async (platform) => {
    updateCampaignBudget.mockResolvedValue({ id: UUID, platform, status: 'active', version: 2, etag: '"2"' });

    await controller.updateCampaignBudget(budgetReq(UUID, validBody), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ platform: null }));
    expect(logger.warning).toHaveBeenCalledWith(
      expect.anything(),
      'campaign_budget_update',
      expect.stringContaining('outside CampaignPlatform'),
      expect.anything()
    );
  });

  // A budget change leaves the row's status as found, so a created_degraded campaign keeps its
  // reconciliation marker. Reporting anything else would hide that.
  it('reports the service status of a degraded campaign unchanged', async () => {
    updateCampaignBudget.mockResolvedValue({ id: UUID, platform: 'meta-ads', status: 'created_degraded', version: 5, etag: '"5"' });

    await controller.updateCampaignBudget(budgetReq(UUID, { ...validBody, budgetType: 'lifetime' }), res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ serviceStatus: 'created_degraded', budgetType: 'lifetime', etag: '"5"' }));
  });

  it.each([
    ['a numeric string', '150'],
    ['zero', 0],
    ['a negative amount', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a missing amount', undefined],
  ])('refuses %s as the budget', async (_label, budget) => {
    await controller.updateCampaignBudget(budgetReq(UUID, { ...validBody, budget }), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([['DAILY'], ['monthly'], [undefined]])('refuses budgetType %s', async (budgetType) => {
    await controller.updateCampaignBudget(budgetReq(UUID, { ...validBody, budgetType }), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([
    ['briefId', { ...validBody, briefId: '   ' }],
    ['etag', { ...validBody, etag: undefined }],
  ])('refuses a request with no %s', async (_field, body) => {
    await controller.updateCampaignBudget(budgetReq(UUID, body), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  // fetch rejects such a header before any network I/O, and that rejection would otherwise be
  // reported as an UNCONFIRMED write although nothing left the BFF.
  it.each([
    ['an embedded newline', '"1"\r\nX-Injected: 1'],
    ['a character above U+00FF', '"1☃"'],
    ['a non-ASCII latin-1 character', '"café"'],
    ['an internal space', '"1" "2"'],
  ])('refuses an etag with %s, which cannot be sent as If-Match', async (_label, etag) => {
    await controller.updateCampaignBudget(budgetReq(UUID, { ...validBody, etag }), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it.each([['"1"'], ['W/"1"'], ['abc-123']])('forwards the valid etag %s as given', async (etag) => {
    await controller.updateCampaignBudget(budgetReq(UUID, { ...validBody, etag }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateCampaignBudget).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ etag }));
  });

  it('refuses a request with no project', async () => {
    await controller.updateCampaignBudget(budgetReq(UUID, validBody, {}), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // Only campaign-service can change a budget, and it keys campaigns by UUID. A platform's numeric
  // id has no row to address.
  it.each([['123456'], ['not-an-id']])('refuses campaign id %s, which is not a campaign-service UUID', async (campaignId) => {
    await controller.updateCampaignBudget(budgetReq(campaignId, validBody), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a body that is not a JSON object', async () => {
    await controller.updateCampaignBudget(budgetReq(UUID, [validBody]), res, next);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  // The UI needs upstream's own status and words: the platform's minimum on a 400, the refusal on
  // a 409, the precondition on a 412/428, and "verify upstream" on an unconfirmed 503.
  it.each([
    [400, 'LinkedIn requires a daily budget of at least 10.00'],
    [409, "budget_type 'lifetime' does not match the campaign's current daily pacing"],
    [412, 'ETag mismatch'],
    [428, 'If-Match header required'],
    [503, 'the budget change is unconfirmed: it may have been applied. Verify the campaign in Google Ads before retrying'],
  ])('passes an upstream %s to the error handler unchanged', async (status, message) => {
    const upstream = new MicroserviceError(message, status, 'UPSTREAM', { errorBody: { code: String(status), message } });
    updateCampaignBudget.mockRejectedValue(upstream);

    await controller.updateCampaignBudget(budgetReq(UUID, validBody), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(upstream);
    expect(logger.success).not.toHaveBeenCalled();
  });
});

/**
 * The bid lever mirrors the budget lever, so these pin the same refusals plus the one difference:
 * `bidType` is optional and defaults to upstream's only value.
 */
describe('CampaignController.updateCampaignBid', () => {
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const validBody = { briefId: 'b-1', etag: '"1"', bid: 2.5, bidType: 'cpc' };
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function bidReq(campaignId: string, body: unknown, query: Record<string, unknown> = { project: 'tlf' }): Request {
    return { params: { campaignId }, body, query, path: `/api/campaigns/${campaignId}/bid` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    updateCampaignBid.mockResolvedValue({ id: UUID, platform: 'microsoft-ads', status: 'active', version: 2, etag: '"2"' });
  });

  it('sends the change to campaign-service and reports the row it answered with', async () => {
    await controller.updateCampaignBid(bidReq(UUID, validBody), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateCampaignBid).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: 'b-1',
      campaignId: UUID,
      bid: 2.5,
      bidType: 'cpc',
      etag: '"1"',
    });
    expect(res.json).toHaveBeenCalledWith({
      platform: 'microsoft-ads',
      campaignId: UUID,
      bid: 2.5,
      bidType: 'cpc',
      etag: '"2"',
      serviceStatus: 'active',
    });
  });

  it('reports an unknown row platform as null, with a warning, and never logs one for a known platform', async () => {
    await controller.updateCampaignBid(bidReq(UUID, validBody), res, next);
    expect(logger.warning).not.toHaveBeenCalled();

    updateCampaignBid.mockResolvedValue({ id: UUID, platform: 'microsoft', status: 'active', version: 2, etag: '"2"' });
    await controller.updateCampaignBid(bidReq(UUID, validBody), res, next);

    expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ platform: null }));
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'campaign_bid_update', expect.stringContaining('outside CampaignPlatform'), {
      platform: 'microsoft',
    });
  });

  it('defaults an omitted bidType to cpc, upstream’s only value', async () => {
    await controller.updateCampaignBid(bidReq(UUID, { ...validBody, bidType: undefined }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateCampaignBid).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bidType: 'cpc' }));
  });

  it.each([
    ['a numeric string', '2.5'],
    ['zero', 0],
    ['a negative amount', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a missing amount', undefined],
  ])('refuses %s as the bid', async (_label, bid) => {
    await controller.updateCampaignBid(bidReq(UUID, { ...validBody, bid }), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([['CPC'], ['cpm'], [''], [null]])('refuses bidType %s', async (bidType) => {
    await controller.updateCampaignBid(bidReq(UUID, { ...validBody, bidType }), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([
    ['briefId', { ...validBody, briefId: '   ' }],
    ['etag', { ...validBody, etag: undefined }],
  ])('refuses a request with no %s', async (_field, body) => {
    await controller.updateCampaignBid(bidReq(UUID, body), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([
    ['an embedded newline', '"1"\r\nX-Injected: 1'],
    ['a character above U+00FF', '"1☃"'],
    ['an internal space', '"1" "2"'],
  ])('refuses an etag with %s, which cannot be sent as If-Match', async (_label, etag) => {
    await controller.updateCampaignBid(bidReq(UUID, { ...validBody, etag }), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    const error = vi.mocked(next).mock.calls[0][0] as unknown as ServiceValidationError;
    expect(error).toBeInstanceOf(ServiceValidationError);
    expect(error.statusCode).toBe(400);
  });

  it('refuses a request with no project', async () => {
    await controller.updateCampaignBid(bidReq(UUID, validBody, {}), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([['123456'], ['not-an-id']])('refuses campaign id %s, which is not a campaign-service UUID', async (campaignId) => {
    await controller.updateCampaignBid(bidReq(campaignId, validBody), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a body that is not a JSON object', async () => {
    await controller.updateCampaignBid(bidReq(UUID, [validBody]), res, next);

    expect(updateCampaignBid).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, 'Microsoft Advertising refused the bid: below the minimum of 0.01'],
    [409, 'the campaign bids under an automated strategy (MaxClicks); a manual bid would be ignored'],
    [412, 'ETag mismatch'],
    [428, 'If-Match header required'],
    [503, 'the bid change is unconfirmed: verify the bid in the platform before retrying'],
  ])('passes an upstream %s to the error handler unchanged', async (status, message) => {
    const upstream = new MicroserviceError(message, status, 'UPSTREAM', { errorBody: { code: String(status), message } });
    updateCampaignBid.mockRejectedValue(upstream);

    await controller.updateCampaignBid(bidReq(UUID, validBody), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(upstream);
    expect(logger.success).not.toHaveBeenCalled();
  });
});

describe('CampaignController.addNegativeKeywords', () => {
  const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const validBody = {
    briefId: 'b-1',
    negativeKeywords: [
      { text: 'free download', matchType: 'Phrase' },
      { text: 'crack', matchType: 'Exact' },
    ],
  };
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function negReq(campaignId: string, body: unknown, query: Record<string, unknown> = { project: 'tlf' }): Request {
    return { params: { campaignId }, body, query, path: `/api/campaigns/${campaignId}/negative-keywords` } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
  });

  // The order is the contract: the caller zips results[i] onto negativeKeywords[i]. Mixed
  // outcomes, with the failure in the MIDDLE, so any filter or sort moves an entry.
  it('sends the batch in request order and returns the results exactly as the client mapped them', async () => {
    const mapped = {
      campaignId: UUID,
      results: [
        { text: 'free download', matchType: 'Phrase', outcome: 'APPLIED', negativeKeywordId: '81' },
        { text: 'crack', matchType: 'Exact', outcome: 'FAILED', errorCode: 'CampaignServiceNegativeKeywordMatchesKeyword' },
        { text: 'torrent', matchType: 'Phrase', outcome: 'ALREADY_PRESENT' },
      ],
      appliedCount: 2,
    };
    addNegativeKeywords.mockResolvedValue(mapped);
    const body = { ...validBody, negativeKeywords: [...validBody.negativeKeywords, { text: 'torrent', matchType: 'Phrase' }] };

    await controller.addNegativeKeywords(negReq(UUID, body), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(addNegativeKeywords).toHaveBeenCalledWith(expect.anything(), {
      projectSlug: 'tlf',
      briefId: 'b-1',
      campaignId: UUID,
      negativeKeywords: [
        { text: 'free download', matchType: 'Phrase' },
        { text: 'crack', matchType: 'Exact' },
        { text: 'torrent', matchType: 'Phrase' },
      ],
    });
    expect(res.json).toHaveBeenCalledWith(mapped);
  });

  it('accepts letters outside ASCII, which the upstream pattern admits', async () => {
    addNegativeKeywords.mockResolvedValue({ campaignId: UUID, results: [], appliedCount: 0 });

    await controller.addNegativeKeywords(negReq(UUID, { ...validBody, negativeKeywords: [{ text: 'café gratuit', matchType: 'Exact' }] }), res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['no array', undefined],
    ['an empty array', []],
    ['more than the maximum', Array.from({ length: MAX_NEGATIVE_KEYWORDS_PER_REQUEST + 1 }, (_, i) => ({ text: `term ${i}`, matchType: 'Exact' }))],
    ['a null entry', [null]],
    ['blank text', [{ text: '   ', matchType: 'Exact' }]],
    ['text over the limit', [{ text: 'a'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH + 1), matchType: 'Exact' }]],
    ['a disallowed symbol', [{ text: 'free @ download', matchType: 'Exact' }]],
    ['quote syntax', [{ text: '"free"', matchType: 'Exact' }]],
    ['Broad, which is not a negative match type', [{ text: 'free', matchType: 'Broad' }]],
    ['a lower-case match type', [{ text: 'free', matchType: 'exact' }]],
  ])('refuses %s', async (_label, negativeKeywords) => {
    await controller.addNegativeKeywords(negReq(UUID, { ...validBody, negativeKeywords }), res, next);

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('counts characters, not UTF-16 units, against the text limit', async () => {
    addNegativeKeywords.mockResolvedValue({ campaignId: UUID, results: [], appliedCount: 0 });
    // 100 astral-plane letters: 200 UTF-16 units but 100 characters.
    const text = '𝐀'.repeat(MAX_NEGATIVE_KEYWORD_TEXT_LENGTH);

    await controller.addNegativeKeywords(negReq(UUID, { ...validBody, negativeKeywords: [{ text, matchType: 'Exact' }] }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(addNegativeKeywords).toHaveBeenCalled();
  });

  it.each([
    ['project', validBody, {}],
    ['briefId', { ...validBody, briefId: '' }, { project: 'tlf' }],
  ])('refuses a request with no %s', async (_field, body, query) => {
    await controller.addNegativeKeywords(negReq(UUID, body, query), res, next);

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a campaign id that is not a campaign-service UUID', async () => {
    await controller.addNegativeKeywords(negReq('123456', validBody), res, next);

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it.each([
    [400, 'negative keyword "free  download" contains consecutive punctuation'],
    [409, 'the campaign was created under a different ad account'],
    [503, 'the negative keywords are unconfirmed: verify the campaign negative keywords before retrying'],
  ])('passes an upstream %s to the error handler unchanged', async (status, message) => {
    const upstream = new MicroserviceError(message, status, 'UPSTREAM', { errorBody: { code: String(status), message } });
    addNegativeKeywords.mockRejectedValue(upstream);

    await controller.addNegativeKeywords(negReq(UUID, validBody), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(upstream);
  });
});

describe('CampaignController.getMicrosoftKeywords', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  function kwReq(query: Record<string, unknown>): Request {
    return { query, path: '/api/campaigns/microsoft/keywords' } as unknown as Request;
  }

  const payload = {
    window: 'last_7_days',
    rows: [
      {
        criterion_id: '7001',
        ad_group_id: '1301',
        campaign_id: '5501',
        ad_group_name: 'Registration',
        campaign_name: 'KubeCon - Search',
        text: 'kubernetes training',
        match_type: 'PHRASE',
        status: 'ENABLED',
        impressions: 1000,
        clicks: 50,
        cost_micros: 25_000_000,
        ctr: 0.05,
        conversions: 0,
      },
    ],
    row_count: 1,
    truncated: false,
    metrics_as_of: '2026-10-05T14:30:00Z',
    metrics_pending: true,
    conversions_complete: false,
    data_incomplete: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    svcGetMicrosoftKeywords.mockResolvedValue(payload);
  });

  it('reads the project’s Microsoft keywords for the window asked and passes report freshness through', async () => {
    await controller.getMicrosoftKeywords(kwReq({ project: 'tlf', window: 'last_7_days' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(svcGetMicrosoftKeywords).toHaveBeenCalledWith(expect.anything(), 'tlf', 'last_7_days');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        window: 'last_7_days',
        metricsAsOf: '2026-10-05T14:30:00Z',
        metricsPending: true,
        conversionsComplete: false,
        totalKeywords: 1,
        keywords: [expect.objectContaining({ criterionId: '7001', adGroupId: '1301', spend: 25, ctr: 5 })],
      })
    );
  });

  it('leaves the window to upstream when none is given', async () => {
    await controller.getMicrosoftKeywords(kwReq({ project: 'tlf' }), res, next);

    expect(svcGetMicrosoftKeywords).toHaveBeenCalledWith(expect.anything(), 'tlf', undefined);
  });

  // Microsoft has no 14-day or yesterday window; a value it cannot serve is refused here rather
  // than forwarded to a 400, or silently snapped to a window the figures would then be mislabelled with.
  it.each([['last_14_days'], ['yesterday'], ['30'], [['last_7_days']]])('refuses window %s', async (window) => {
    await controller.getMicrosoftKeywords(kwReq({ project: 'tlf', window }), res, next);

    expect(svcGetMicrosoftKeywords).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a read with no project', async () => {
    await controller.getMicrosoftKeywords(kwReq({ project: '  ' }), res, next);

    expect(svcGetMicrosoftKeywords).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('passes an upstream failure to the error handler', async () => {
    const upstream = new MicroserviceError('Microsoft metrics are not supported', 400, 'BAD_REQUEST', { errorBody: { code: '400', message: 'x' } });
    svcGetMicrosoftKeywords.mockRejectedValue(upstream);

    await controller.getMicrosoftKeywords(kwReq({ project: 'tlf' }), res, next);

    expect(next).toHaveBeenCalledWith(upstream);
    expect(res.json).not.toHaveBeenCalled();
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
    // The EMPTY string specifically, not just whitespace. The disabled-persist path reports
    // `briefId: ''`, and a client that forwarded it here to read a deployment capability would
    // get a 400 rather than an answer — the request never reaches the service branch that
    // returns `demandGenEnabled` for a blank id.
    ['an empty brief_id', { project: 'tlf', brief_id: '' }],
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
 * The audience read-back behind `GET /api/campaigns/audiences`.
 *
 * What is only decidable HERE is the layer boundary. The mapping and the flag-off shape are the
 * client's and have their own tests; this block covers the part a mapper test cannot see: that a
 * request with no usable scope never reaches upstream, that the two query params arrive as the
 * client's positional arguments in the right ORDER, and that a read failure reaches the error
 * middleware rather than a 200 the restore path would read as "this brief has no audience".
 *
 * That last one matters more here than on most reads. The caller is the restore path, and an
 * empty-looking answer there does not merely show less -- it offers a Build button, and a build
 * mints a SECOND HubSpot contact list for a brief that already has one.
 */
describe('CampaignController.listAudiences', () => {
  let controller: CampaignController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
  });

  function audiencesReq(query: Record<string, unknown>): Request {
    return { query, path: '/api/campaigns/audiences' } as unknown as Request;
  }

  it('passes both scope params through in the order the client reads them', async () => {
    const payload = { enabled: true, audiences: [{ id: 'aud-1', briefId: 'b-1', platform: 'hubspot', status: 'built', version: 1 }] };
    svcListAudiences.mockResolvedValue(payload);
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.listAudiences(audiencesReq({ project: 'cncf', brief_id: 'b-1' }), res, next);

    expect(svcListAudiences).toHaveBeenCalledWith(expect.anything(), 'cncf', 'b-1');
    expect(res.json).toHaveBeenCalledWith(payload);
    expect(next).not.toHaveBeenCalled();
  });

  /**
   * Trimmed before forwarding, because both values become PATH segments upstream. A slug with
   * surrounding whitespace percent-encodes into a different project than the one asked for, and
   * that 404 is indistinguishable here from "this brief has no audience".
   */
  it('trims the scope params rather than encoding whitespace into the upstream path', async () => {
    svcListAudiences.mockResolvedValue({ enabled: true, audiences: [] });

    await controller.listAudiences(audiencesReq({ project: ' cncf ', brief_id: ' b-1 ' }), buildRes(), vi.fn() as unknown as NextFunction);

    expect(svcListAudiences).toHaveBeenCalledWith(expect.anything(), 'cncf', 'b-1');
  });

  /**
   * Both params are required and neither may default. `brief_id` scopes the read to one campaign;
   * `project` is the authorisation boundary -- `/foundation/campaigns` is reachable by an ED of
   * any foundation, so a defaulted project would read another foundation's audience on their
   * behalf.
   */
  it.each([
    ['no project', { brief_id: 'b-1' }],
    ['no brief_id', { project: 'cncf' }],
    ['a blank project', { project: '   ', brief_id: 'b-1' }],
    ['a blank brief_id', { project: 'cncf', brief_id: '   ' }],
    // Repeated params, which Express parses as arrays. Neither is a string, so both collapse to
    // '' and are refused by the same guard -- asserted rather than assumed, because the guard
    // reads `typeof === 'string'` and an array that stringified would slip past it.
    ['a repeated project param, which Express parses as an array', { project: ['tlf', 'cncf'], brief_id: 'b-1' }],
    ['a repeated brief_id param, which Express parses as an array', { project: 'cncf', brief_id: ['b-1', 'b-2'] }],
  ])('refuses a request with %s without reading anything upstream', async (_label, query) => {
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.listAudiences(audiencesReq(query), res, next);

    expect(svcListAudiences).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  /**
   * The flag being off is NOT a failure and must reach the caller intact. `{ enabled: false }` is
   * how the restore path knows to stay silent; turning it into an error would put a banner on
   * every campaign in an environment where the feature simply is not on.
   */
  it('passes a flag-off result through untouched', async () => {
    svcListAudiences.mockResolvedValue({ enabled: false });
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.listAudiences(audiencesReq({ project: 'cncf', brief_id: 'b-1' }), res, next);

    expect(res.json).toHaveBeenCalledWith({ enabled: false });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a thrown read to next rather than answering with a body', async () => {
    svcListAudiences.mockRejectedValue(new Error('upstream exploded'));
    const res = buildRes();
    const next = vi.fn() as unknown as NextFunction;

    await controller.listAudiences(audiencesReq({ project: 'cncf', brief_id: 'b-1' }), res, next);

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

    // Assert the operational log metadata: `row_count` identifies the upstream result size and
    // `truncated` records whether the returned rows are capped.
    it('logs the truncation flag and upstream row count', async () => {
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

  // `adGroupId` is a real Google ad-group id shape (digits), not a label: campaign-service
  // declares ad_group_id/criterion_id as `^[0-9]+$` with MaxLength(19), and the controller now
  // enforces that before any fan-out. A placeholder like 'ag-1' would make every fixture an
  // invalid request and the suite would test the refusal path by accident.
  const keyword = (campaignId: string, criterionId: string) => ({ campaignId, adGroupId: '176216228', criterionId, action: 'pause' });
  // `platform_campaign_id` ECHOES the requested id, as the real contract does. It was hardcoded
  // 'x', which meant every fixture described a different campaign than the one asked for -- fine
  // while nothing checked the echo, and exactly what the new guard refuses.
  const resolvedTo = (campaignId: string, briefId: string, platformCampaignId = '24183781329') => ({
    platform_campaign_id: platformCampaignId,
    match_count: 1,
    matches: [{ campaign_id: campaignId, brief_id: briefId }],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    isServerFeatureEnabled.mockImplementation(onlyActions);
    // Echoes the REQUESTED id, as the real contract does, so a test using any campaign id gets a
    // consistent resolution without restating it. The guard refuses a mismatched echo.
    svcResolveCampaign.mockImplementation((_req: unknown, _slug: string, platformCampaignId: string) =>
      Promise.resolve(resolvedTo('c-1', 'b-1', platformCampaignId))
    );
    // Confirms exactly what a single-keyword request sends. An empty `results` array is NOT a
    // valid confirmation — the controller now checks the returned multiset against the request,
    // because upstream derives applied_count from its own results rather than from the request.
    svcApplyKeywordActions.mockResolvedValue({
      campaign_id: 'c-1',
      applied_count: 1,
      results: [{ ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' }],
    });
  });

  it('refuses a bulk request above the fan-out cap before calling upstream', async () => {
    // The cost is per CAMPAIGN in the body: a resolver call and then a mutation call each,
    // sequentially, while the request is held open. Unbounded, one authenticated request
    // amplifies into thousands of upstream calls against a live ad account. Refused BEFORE any
    // upstream call, so an oversized request costs nothing rather than being half-applied.
    const tooMany = Array.from({ length: MAX_BULK_KEYWORD_ACTIONS + 1 }, (_, i) => keyword(String(24183781329 + i), String(i)));

    await controller.executeKeywordActions(actionsReq(tooMany), res, next);

    // The operator-facing text lives in validationErrors, not on the error's own message.
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: expect.arrayContaining([expect.objectContaining({ field: 'keywords', message: expect.stringContaining('at most') })]),
      })
    );
    expect(svcResolveCampaign).not.toHaveBeenCalled();
    expect(svcApplyKeywordActions).not.toHaveBeenCalled();
  });

  it('refuses a malformed id in the LAST row before mutating the rows ahead of it', async () => {
    // The position is the point. Campaign-service declares these ids as `^[0-9]+$`, so a malformed
    // one was previously refused UPSTREAM — by which time the earlier rows in the same request had
    // already been mutated, because the fan-out is sequential. A keyword REMOVE is irreversible,
    // so a half-applied batch is not something a retry can undo.
    //
    // A valid row FIRST, so passing this cannot be explained by the request being rejected on its
    // very first entry.
    const rows = [keyword('24183781329', '1'), keyword('24183781329', '2'), keyword('not-an-id', '3')];

    await controller.executeKeywordActions(actionsReq(rows), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: expect.arrayContaining([expect.objectContaining({ field: 'keywords', message: expect.stringContaining('positive integer') })]),
      })
    );
    // Nothing upstream, not even for the two well-formed rows that preceded the bad one.
    expect(svcResolveCampaign).not.toHaveBeenCalled();
    expect(svcApplyKeywordActions).not.toHaveBeenCalled();
  });

  it('allows a bulk request exactly at the fan-out cap', async () => {
    // The boundary is inclusive: a request the UI can actually produce must not be refused.
    // 1-based: "0" is not a canonical Google Ads resource id, and validation now enforces that.
    const atCap = Array.from({ length: MAX_BULK_KEYWORD_ACTIONS }, (_, i) => keyword(String(24183781329 + i), String(i + 1)));

    await controller.executeKeywordActions(actionsReq(atCap), res, next);

    expect(svcResolveCampaign).toHaveBeenCalled();
  });

  it('resolves the campaign and applies the batch under its brief', async () => {
    await controller.executeKeywordActions(actionsReq([keyword('24183781329', '1')]), res, next);

    // Fourth arg is the resolver's share of the request budget -- matched loosely because it is
    // wall-clock. Bounding the mutation alone left THIS call able to overrun the window.
    expect(svcResolveCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', '24183781329', expect.any(Number));
    const resolveBudget = svcResolveCampaign.mock.calls[0][3] as number;
    expect(resolveBudget, 'the resolver was given no deadline, or one outside the budget').toBeGreaterThan(0);
    expect(resolveBudget).toBeLessThanOrEqual(KEYWORD_ACTION_DEADLINE_MS);
    // The brief and campaign must come from the RESOLUTION, not from the request — the request
    // carries neither, which is the whole reason the resolver exists.
    expect(svcApplyKeywordActions).toHaveBeenCalledWith(
      expect.anything(),
      'tlf',
      'b-1',
      'c-1',
      [{ ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' }],
      // The fan-out's REMAINING budget, so the mutation cannot outlive the request deadline.
      // Matched as "a positive number within the budget" rather than an exact value: it is
      // wall-clock, so pinning it would make this test fail on a slow machine for no reason.
      expect.any(Number)
    );
    const passedTimeout = svcApplyKeywordActions.mock.calls[0][5] as number;
    expect(passedTimeout, 'the mutation was given no deadline, or one outside the budget').toBeGreaterThan(0);
    expect(passedTimeout).toBeLessThanOrEqual(KEYWORD_ACTION_DEADLINE_MS);
    expect(legacyKeywordActions).not.toHaveBeenCalled();
  });

  it('hands the MUTATION only the time the resolve left, not a fresh budget', async () => {
    // dealako (#1923 round 7): the invariant of this round is that the resolve and the
    // irreversible mutation cannot outlive the 45s deadline, because each is handed the REMAINING
    // time. The assertions above are `> 0` and `<= DEADLINE`, which both still pass if the
    // mutation is handed a fresh full budget -- the exact regression they exist to catch.
    //
    // A controlled clock makes the remainder observable: the resolve consumes 30s, so the
    // mutation must receive strictly less than the resolve did.
    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      svcResolveCampaign.mockImplementation(() => {
        now += 30_000;
        return Promise.resolve({ platform_campaign_id: '555', match_count: 1, matches: [{ campaign_id: 'c-1', brief_id: 'b-1' }] });
      });

      await controller.executeKeywordActions(actionsReq([keyword('555', '1')]), res, next);

      const resolveBudget = svcResolveCampaign.mock.calls[0][3] as number;
      const mutateBudget = svcApplyKeywordActions.mock.calls[0][5] as number;

      expect(resolveBudget).toBeLessThanOrEqual(KEYWORD_ACTION_DEADLINE_MS);
      // The binding assertion: the mutation is bounded by what is LEFT.
      expect(mutateBudget, 'the mutation was handed a fresh budget rather than the remainder').toBeLessThan(resolveBudget);
      expect(mutateBudget).toBeLessThanOrEqual(KEYWORD_ACTION_DEADLINE_MS - 30_000);
      // And the two together cannot exceed the deadline, which is the property that matters.
      expect(30_000 + mutateBudget, 'resolve + mutate can outlive the request deadline').toBeLessThanOrEqual(KEYWORD_ACTION_DEADLINE_MS);
    } finally {
      nowSpy.mockRestore();
    }
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
    svcResolveCampaign.mockResolvedValueOnce(resolvedTo('c-1', 'b-1', '555')).mockResolvedValueOnce(resolvedTo('c-2', 'b-2', '666'));

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
  /**
   * A 2xx is not proof the batch applied as asked.
   *
   * Upstream derives `applied_count` from the results it actually returns rather than asserting
   * it against the request, so a short or altered confirmation agrees with itself. Marking every
   * requested keyword as changed on that basis would tell someone a still-spending keyword was
   * paused — the one thing this path must never do.
   *
   * Reported as UNCONFIRMED rather than failed: upstream returned a 2xx, so the mutation
   * probably ran, and a retried REMOVE is irreversible.
   */
  it.each([
    ['a short confirmation', { campaign_id: 'c-1', applied_count: 1, results: [{ ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' }] }],
    [
      'a criterion that was not requested',
      {
        campaign_id: 'c-1',
        applied_count: 2,
        results: [
          { ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' },
          { ad_group_id: '176216228', criterion_id: '999', action: 'PAUSE' },
        ],
      },
    ],
  ])('reports %s as unconfirmed rather than applied', async (_label, applied) => {
    svcApplyKeywordActions.mockResolvedValue(applied);

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('555', '2')]), res, next);

    const body = vi.mocked(res.json).mock.calls[0][0] as { succeeded: number; failed: number; results: { message: string }[] };
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(2);
    // The wording must send the caller to verify, not to retry: a retried REMOVE cannot be undone.
    expect(body.results[0].message).toMatch(/check the campaign/i);
  });

  it('accepts a confirmation that matches the request regardless of order', async () => {
    svcApplyKeywordActions.mockResolvedValue({
      campaign_id: 'c-1',
      applied_count: 2,
      // Reversed: order is not part of the contract, membership and count are.
      results: [
        { ad_group_id: '176216228', criterion_id: '2', action: 'PAUSE' },
        { ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' },
      ],
    });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('555', '2')]), res, next);

    const body = vi.mocked(res.json).mock.calls[0][0] as { succeeded: number; failed: number };
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('continues to the next campaign when one fails, and reports both outcomes', async () => {
    svcResolveCampaign.mockResolvedValueOnce(resolvedTo('c-1', 'b-1', '555')).mockResolvedValueOnce(resolvedTo('c-2', 'b-2', '666'));
    svcApplyKeywordActions
      // A 422, not a bare Error. This case is "campaign-service REFUSED this one, keep going"; a
      // bare Error has no status and is a transport failure by definition, which now stops the
      // fan-out -- so a bare Error here would assert the opposite of what the name describes.
      .mockRejectedValueOnce(Object.assign(new Error('upstream refused'), { statusCode: 422 }))
      .mockResolvedValueOnce({ campaign_id: 'c-2', applied_count: 1, results: [{ ad_group_id: '176216228', criterion_id: '2', action: 'PAUSE' }] });

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
  it('stops the fan-out after a transport failure instead of probing every campaign', async () => {
    // The loop is sequential and the controller admits up to MAX_BULK_KEYWORD_ACTIONS distinct
    // campaigns, each costing a lookup at the client's 30s default -- so an outage held ONE
    // request open for ~25 minutes while sending 50 doomed probes for a single user action.
    // 1-based: "0" is not a canonical Google Ads resource id and is refused before the fan-out.
    const rows = Array.from({ length: 5 }, (_, i) => keyword(String(24183781329 + i), String(i + 1)));
    // Every lookup fails the same way a dead service does: no status at all.
    svcResolveCampaign.mockRejectedValue(new Error('socket hang up'));

    await controller.executeKeywordActions(actionsReq(rows), res, next);

    // ONE probe, not five. The remaining groups are reported without being attempted.
    expect(svcResolveCampaign).toHaveBeenCalledTimes(1);
    expect(svcApplyKeywordActions).not.toHaveBeenCalled();

    const body = vi.mocked(res.json).mock.calls[0][0] as { failed: number; results: { success: boolean; message: string }[] };
    // Every keyword still gets a result -- the client zips results onto the list it sent, so a
    // short array would misalign a still-spending keyword onto another row's outcome.
    expect(body.results).toHaveLength(5);
    expect(body.failed).toBe(5);
    // And they read as retryable, not as "not managed here": nothing was established about them.
    expect(body.results.every((r) => /try again/i.test(r.message))).toBe(true);
  });

  it('reports a failed resolution against that campaign and keeps going', async () => {
    // A 4xx: campaign-service ANSWERED and refused this campaign, which says nothing about the
    // next one -- so the batch must keep going. A bare Error (no status) is a TRANSPORT failure
    // and now deliberately stops the fan-out, so it can no longer stand in for this case.
    const refused = Object.assign(new Error('resolver refused'), { statusCode: 422 });
    svcResolveCampaign.mockRejectedValueOnce(refused).mockResolvedValueOnce(resolvedTo('c-2', 'b-2', '666'));
    // Campaign 666 sends criterion 2, so its confirmation must name criterion 2 — the default
    // stub confirms criterion 1 and would now be rejected as a mismatch.
    svcApplyKeywordActions.mockResolvedValue({
      campaign_id: 'c-2',
      applied_count: 1,
      results: [{ ad_group_id: '176216228', criterion_id: '2', action: 'PAUSE' }],
    });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('666', '2')]), res, next);

    expect(svcApplyKeywordActions).toHaveBeenCalledTimes(1);
    const body = vi.mocked(res.json).mock.calls[0][0] as { succeeded: number; failed: number; results: { success: boolean; message: string }[] };
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
    // A FAILED lookup must not read as "not managed here". That message tells the caller the
    // campaign will never be actionable, so they stop retrying — and a campaign they meant to
    // pause keeps spending. It must invite a retry instead.
    const failedEntry = body.results.find((r) => !r.success);
    expect(failedEntry?.message).toMatch(/try again/i);
    expect(failedEntry?.message).not.toMatch(/not managed here/i);
  });

  // Every keyword sent must appear in the response exactly once, whatever happened to it.
  it('accounts for every requested keyword in the response', async () => {
    svcResolveCampaign
      .mockResolvedValueOnce(resolvedTo('c-1', 'b-1', '555'))
      .mockResolvedValueOnce({ platform_campaign_id: '666', match_count: 0, matches: [] });

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), keyword('555', '2'), keyword('666', '3')]), res, next);

    const body = vi.mocked(res.json).mock.calls[0][0] as { total: number; results: { keyword: string }[] };
    expect(body.total).toBe(3);
    expect(body.results.map((r) => r.keyword).sort()).toEqual(['Criterion 1', 'Criterion 2', 'Criterion 3']);
  });

  // ─── Microsoft Advertising (LFXV2-2665) ───

  const msKeyword = (campaignId: string, criterionId: string) => ({ ...keyword(campaignId, criterionId), platform: 'microsoft-ads' });

  it('resolves a Microsoft keyword through the Microsoft campaign-ref, never the Google one', async () => {
    svcResolveMicrosoftCampaign.mockResolvedValue(resolvedTo('c-ms', 'b-ms', '413296582'));
    svcApplyKeywordActions.mockResolvedValue({
      campaign_id: 'c-ms',
      applied_count: 1,
      results: [{ ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE', outcome: 'APPLIED' }],
    });

    await controller.executeKeywordActions(actionsReq([msKeyword('413296582', '1')]), res, next);

    expect(svcResolveMicrosoftCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', '413296582', expect.any(Number));
    expect(svcResolveCampaign, 'a Microsoft id was looked up as a Google one').not.toHaveBeenCalled();
    expect(svcApplyKeywordActions).toHaveBeenCalledWith(
      expect.anything(),
      'tlf',
      'b-ms',
      'c-ms',
      [{ ad_group_id: '176216228', criterion_id: '1', action: 'PAUSE' }],
      expect.any(Number)
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, succeeded: 1, failed: 0 }));
  });

  it('refuses an unknown platform before calling upstream', async () => {
    await controller.executeKeywordActions(actionsReq([{ ...keyword('555', '1'), platform: 'meta-ads' }]), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: expect.arrayContaining([expect.objectContaining({ field: 'keywords', message: expect.stringContaining('platform') })]),
      })
    );
    expect(svcResolveCampaign).not.toHaveBeenCalled();
    expect(svcResolveMicrosoftCampaign).not.toHaveBeenCalled();
  });

  it('refuses a Microsoft keyword on the legacy path rather than sending it to Google', async () => {
    isServerFeatureEnabled.mockReturnValue(false);

    await controller.executeKeywordActions(actionsReq([keyword('555', '1'), msKeyword('413296582', '2')]), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        validationErrors: expect.arrayContaining([expect.objectContaining({ field: 'keywords', message: expect.stringContaining('Microsoft') })]),
      })
    );
    // The WHOLE request is refused: the Google row ahead of it is not half-applied.
    expect(legacyKeywordActions).not.toHaveBeenCalled();
  });
});

describe('CampaignController HubSpot UTM', () => {
  let controller: CampaignController;
  let res: Response;
  let next: NextFunction;

  /** Only the UTM flag on. Everything else stays off so a blanket toggle cannot pass. */
  const onlyUtm = (flag: string): boolean => String(flag) === 'LFX_CUTOVER_CAMPAIGN_SERVICE_HUBSPOT_UTM';

  function utmReq(query: Record<string, unknown>, body: Record<string, unknown> = {}): Request {
    return { body, query, path: '/api/campaigns/hubspot/utm' } as unknown as Request;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CampaignController();
    res = buildRes();
    next = vi.fn();
    svcSearchHsCampaigns.mockResolvedValue({ campaigns: [{ id: '1', name: 'KubeCon NA 2026', utm: 'kubecon-na-2026' }], capped: false });
    svcCreateHsCampaign.mockResolvedValue({ id: '1', name: 'KubeCon NA 2026', utm: 'kubecon-na-2026' });
    legacyLookupUtm.mockResolvedValue({ found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false });
    legacyCreateUtm.mockResolvedValue({ created: true, hs_utm: 'x', campaign_name: 'KubeCon NA 2026' });
  });

  describe('lookupHubSpotUtm', () => {
    it('reads from campaign-service when the flag is on, and not from the legacy path', async () => {
      isServerFeatureEnabled.mockImplementation(onlyUtm);

      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(svcSearchHsCampaigns).toHaveBeenCalledWith(expect.anything(), 'tlf', 'KubeCon NA 2026');
      // Asserted explicitly: a branch calling BOTH would still return the right body while
      // doubling the upstream cost and keeping the legacy path live.
      expect(legacyLookupUtm).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards the client capability flag to the mapper, and withholds without it', async () => {
      // dealako (#1923): nothing asserted that the controller READS the capability and forwards
      // it, so the seam could invert or disappear with every test green -- and the whole gate
      // depends on it. A tokenless winner is the shape the flag governs.
      isServerFeatureEnabled.mockImplementation(onlyUtm);
      svcSearchHsCampaigns.mockResolvedValue({ campaigns: [{ id: '1', name: 'KubeCon NA 2026' }], capped: false });

      // Declared: the tokenless winner is reported as found.
      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026', tokenless_found: '1' }), res, next);
      const declared = vi.mocked(res.json).mock.calls[0][0] as { found: boolean; hs_utm: string | null };
      expect(declared.found, 'a capable client was denied the tokenless shape').toBe(true);
      expect(declared.hs_utm).toBeNull();

      vi.mocked(res.json).mockClear();

      // Absent: the same upstream answer is withheld, as inconclusive rather than proven absence.
      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);
      const bare = vi.mocked(res.json).mock.calls[0][0] as { found: boolean; inconclusive: boolean };
      expect(bare.found, 'the tokenless shape reached a client that cannot parse it').toBe(false);
      expect(bare.inconclusive, 'an existing campaign was reported to an old bundle as proven absence').toBe(true);
    });

    it('treats any value other than "1" as an undeclared capability', async () => {
      // Fail-closed on the parse too: `tokenless_found=true` is not the contract, and reading it
      // loosely would hand the new shape to a client that never declared it.
      isServerFeatureEnabled.mockImplementation(onlyUtm);
      svcSearchHsCampaigns.mockResolvedValue({ campaigns: [{ id: '1', name: 'KubeCon NA 2026' }], capped: false });

      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026', tokenless_found: 'true' }), res, next);

      const body = vi.mocked(res.json).mock.calls[0][0] as { found: boolean };
      expect(body.found).toBe(false);
    });

    it('answers a malformed upstream envelope with the mapper safe result, not a 500', async () => {
      // dealako (#2079, blocking): `toUtmLookupResult` deliberately fail-closes on a body with no
      // `campaigns` array and returns `inconclusive: true` -- a TESTED safe path. The success log
      // then read `payload.campaigns.length` unguarded and threw a TypeError before
      // `res.json(result)`, converting that deliberate safe answer into a generic 500.
      isServerFeatureEnabled.mockImplementation(onlyUtm);
      svcSearchHsCampaigns.mockResolvedValueOnce({ capped: false } as never);

      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(next, 'the fail-closed lookup was turned into an error by its own success log').not.toHaveBeenCalled();
      const body = vi.mocked(res.json).mock.calls[0][0] as { found: boolean; inconclusive: boolean };
      expect(body.found).toBe(false);
      expect(body.inconclusive, 'a malformed envelope must not read as proven absence').toBe(true);
    });

    it('keeps the legacy path when the flag is off', async () => {
      isServerFeatureEnabled.mockReturnValue(false);

      await controller.lookupHubSpotUtm(utmReq({ event_name: 'KubeCon NA 2026' }), res, next);

      expect(legacyLookupUtm).toHaveBeenCalled();
      expect(svcSearchHsCampaigns).not.toHaveBeenCalled();
    });

    // With a blanket `mockReturnValue(true)` this passes no matter which flag is read, so every
    // OTHER flag is held on and this one off: a handler checking the wrong flag fails here.
    it('routes on the UTM flag specifically, not on any cutover flag', async () => {
      isServerFeatureEnabled.mockImplementation((flag: string) => !onlyUtm(flag));

      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(legacyLookupUtm).toHaveBeenCalled();
      expect(svcSearchHsCampaigns).not.toHaveBeenCalled();
    });

    it('requires the project on the campaign-service arm rather than defaulting one', async () => {
      // campaign-service scopes the HubSpot connection BY PROJECT. Defaulting would read another
      // project's portal, so the absence must be an error rather than a guess.
      isServerFeatureEnabled.mockImplementation(onlyUtm);

      await controller.lookupHubSpotUtm(utmReq({ event_name: 'KubeCon NA 2026' }), res, next);

      expect(svcSearchHsCampaigns).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('sends an upstream failure to the error middleware, not a 200', async () => {
      // A failure answered as 200 renders as "no campaign found" -- the one answer the panel
      // acts on by creating a campaign, which is how a duplicate gets made from an outage.
      isServerFeatureEnabled.mockImplementation(onlyUtm);
      svcSearchHsCampaigns.mockRejectedValue(new Error('campaign-service unavailable'));

      await controller.lookupHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createHubSpotUtm', () => {
    it('writes through campaign-service when the flag is on, and not the legacy path', async () => {
      isServerFeatureEnabled.mockImplementation(onlyUtm);

      await controller.createHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(svcCreateHsCampaign).toHaveBeenCalledWith(expect.anything(), 'tlf', 'KubeCon NA 2026');
      // Calling BOTH would create TWO campaigns in a shared namespace, not merely duplicate work.
      expect(legacyCreateUtm).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('keeps the legacy path when the flag is off', async () => {
      isServerFeatureEnabled.mockReturnValue(false);

      await controller.createHubSpotUtm(utmReq({ event_name: 'KubeCon NA 2026' }), res, next);

      expect(legacyCreateUtm).toHaveBeenCalled();
      expect(svcCreateHsCampaign).not.toHaveBeenCalled();
    });

    it('routes on the UTM flag specifically, not on any cutover flag', async () => {
      isServerFeatureEnabled.mockImplementation((flag: string) => !onlyUtm(flag));

      await controller.createHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(legacyCreateUtm).toHaveBeenCalled();
      expect(svcCreateHsCampaign).not.toHaveBeenCalled();
    });

    it('requires the project on the campaign-service arm rather than defaulting one', async () => {
      isServerFeatureEnabled.mockImplementation(onlyUtm);

      await controller.createHubSpotUtm(utmReq({ event_name: 'KubeCon NA 2026' }), res, next);

      expect(svcCreateHsCampaign).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('sends an upstream failure to the error middleware, not a 200', async () => {
      isServerFeatureEnabled.mockImplementation(onlyUtm);
      svcCreateHsCampaign.mockRejectedValue(new Error('campaign-service unavailable'));

      await controller.createHubSpotUtm(utmReq({ project: 'tlf', event_name: 'KubeCon NA 2026' }), res, next);

      expect(res.json).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
