// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import type {
  BulkKeywordActionRequest,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignPlatform,
  CampaignSSEEventType,
  CampaignStatusUpdateRequest,
  CampaignStatusUpdateResult,
  CampaignToggleStatus,
  FlushableResponse,
  MicrosoftKeyword,
} from '@lfx-one/shared/interfaces';
import {
  CAMPAIGN_DELIVERY_TYPES,
  CAMPAIGN_PLATFORMS,
  META_GEO_CODE_PATTERN,
  MICROSOFT_MATCH_TYPES,
  MICROSOFT_MAX_BUDGET,
  MICROSOFT_MAX_CPC_BID,
  MICROSOFT_MAX_GEO_TARGETS,
  MICROSOFT_MAX_KEYWORDS,
  MICROSOFT_MAX_KEYWORD_TEXT_LENGTH,
  MICROSOFT_MIN_CPC_BID,
  VALID_CAMPAIGN_TOGGLE_STATUSES,
} from '@lfx-one/shared/constants';

import { META_ACCOUNTS, REDDIT_ACCOUNTS } from '../constants';
import { ServiceValidationError } from '../errors';
import { CampaignMetricsService, LinkedInMetricsService, MetaMetricsService, RedditMetricsService } from '../services/campaign-metrics.service';
import { validateScrapeUrl } from '../helpers/url-validation';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { getLinkedInConfig } from '../services/linkedin-ads.service';
import { CampaignProxyService } from '../services/campaign-proxy.service';
import { CampaignServiceClient, deriveEventSlug, isCampaignServiceJobId } from '../services/campaign-service.service';
import { logger } from '../services/logger.service';
import { addShutdownHook, isShuttingDown } from '../utils/shutdown';

/** Platforms that support the campaign status toggle endpoint. */
const SUPPORTED_STATUS_PLATFORMS: ReadonlySet<CampaignPlatform> = new Set<CampaignPlatform>(['meta-ads', 'reddit-ads']);

/**
 * Platforms whose status toggle campaign-service can serve.
 *
 * DERIVED from `CAMPAIGN_PLATFORMS` rather than listed, because a hardcoded set is a claim that
 * goes stale silently: enabling a platform in the shared constant would leave pause unreachable
 * for it with nothing failing. Every paid platform in that constant has a `ToggleStatus`
 * dispatcher upstream, so the shared list IS the correct source.
 *
 * `disabled: true` entries (currently X only — LFXV2-3312 enabled Microsoft) are excluded
 * deliberately. Their
 * dispatchers exist upstream, but disabling a platform means this app does not offer it, and
 * accepting a toggle for a campaign the UI cannot create is a route to nowhere. They join by
 * flipping the flag in the shared constant — one edit, not two.
 *
 * HubSpot is absent because it is not in `CAMPAIGN_PLATFORMS` at all: `CampaignPlatform` covers
 * the six paid channels, and an email send has no run state to pause.
 */
const CAMPAIGN_SERVICE_STATUS_PLATFORMS: ReadonlySet<CampaignPlatform> = new Set<CampaignPlatform>(
  CAMPAIGN_PLATFORMS.filter((p) => !p.disabled).map((p) => p.id)
);

/** Derived from the shared constant so the validation and its error message cannot drift apart. */
const SUPPORTED_DELIVERY_TYPES: ReadonlySet<string> = new Set(CAMPAIGN_DELIVERY_TYPES.map((d) => d.id));

const NUMERIC_ID_RE = /^\d+$/;

export class CampaignController {
  private readonly proxyService = new CampaignProxyService();
  private readonly campaignServiceClient = new CampaignServiceClient();
  private readonly metricsService = new CampaignMetricsService();
  private readonly linkedInMetricsService = new LinkedInMetricsService();
  private readonly redditMetricsService = new RedditMetricsService();
  private readonly metaMetricsService = new MetaMetricsService();
  private readonly activeStreams = new Set<Response>();

  public constructor() {
    addShutdownHook(() => this.closeAllStreams());
  }

  public async generateBrief(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    const body = req.body as CampaignBriefRequest;

    if (!body.url || typeof body.url !== 'string' || !body.url.trim()) {
      const validationError = ServiceValidationError.forField('url', 'url is required', {
        operation: 'campaign_generate_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    try {
      await validateScrapeUrl(body.url);
    } catch (error) {
      const validationError = ServiceValidationError.forField('url', error instanceof Error ? error.message : 'Invalid URL', {
        operation: 'campaign_generate_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_generate_brief', {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const abortController = new AbortController();
    let clientDisconnected = false;

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
      abortController.abort();
    });

    const sendEvent = (type: CampaignSSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      for await (const event of this.proxyService.streamBrief(req, body, abortController.signal)) {
        if (clientDisconnected) return;
        sendEvent(event.type, event.data);
      }

      logger.success(req, 'campaign_generate_brief', startTime, {});
    } catch (error) {
      if (clientDisconnected) return;
      logger.error(req, 'campaign_generate_brief', startTime, error, {});
      sendEvent('error', 'Brief generation failed. Please try again.');
    } finally {
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  public async refineBrief(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    const body = req.body as CampaignBriefRefineRequest;

    if (!body.feedback || typeof body.feedback !== 'string' || !body.feedback.trim()) {
      const validationError = ServiceValidationError.forField('feedback', 'feedback is required', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const MAX_FEEDBACK_LENGTH = 2000;
    if (body.feedback.trim().length > MAX_FEEDBACK_LENGTH) {
      _next(
        ServiceValidationError.forField('feedback', `feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer`, {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    // Both delivery-type checks run BEFORE the paid-only field checks below, deliberately. An
    // email brief has no generated copy and no keywords — `structuredCopy` is null and
    // `currentKeywords` is empty — so those checks fire first and answer "currentCopy is
    // required": true, but useless, because it names a field the caller cannot supply and hides
    // the actual reason.
    //
    // VALIDATED first, not just matched. An exact `=== 'email'` test lets a typo through:
    // `'emial'` falls past it into those same paid-only checks and produces the same misleading
    // message, for a caller whose only mistake was a misspelling.
    //
    // Derived from the shared `CAMPAIGN_DELIVERY_TYPES`, and so is the MESSAGE below — the sibling
    // `platform` check already interpolates its own Set for exactly this reason. An error string
    // is the copy a reader trusts most, because it is what the API actually says, so a hardcoded
    // tail there outlives every other duplicate. The two `Unsupported deliveryType` messages in
    // `campaign-proxy.service.ts` are interpolated from the same constant for the same reason.
    if (body.deliveryType !== undefined && !SUPPORTED_DELIVERY_TYPES.has(body.deliveryType)) {
      _next(
        ServiceValidationError.forField('deliveryType', `deliveryType must be one of: ${[...SUPPORTED_DELIVERY_TYPES].join(', ')}`, {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    // The service refuses email refines too — that guard stays, since this controller is not its
    // only caller — but only this path is reached over HTTP, so only this one decides what the
    // user reads.
    if (body.deliveryType === 'email') {
      // `ServiceValidationError`, not a manual `res.status().json()` — the sibling checks below
      // all use it, and `docs/reviews/backend-checklist.md` §8 forbids the manual form. Going
      // around the error middleware would have skipped the standard error shape and its
      // centralized log line, so the one refusal a caller is most likely to hit would have been
      // the one the logs never recorded.
      _next(
        ServiceValidationError.forField('deliveryType', 'refining email copy is not supported yet', {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!body.currentCopy || typeof body.currentCopy !== 'object' || Array.isArray(body.currentCopy)) {
      const validationError = ServiceValidationError.forField('currentCopy', 'currentCopy is required', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const MAX_COPY_JSON_LENGTH = 50_000;
    if (JSON.stringify(body.currentCopy).length > MAX_COPY_JSON_LENGTH) {
      _next(
        ServiceValidationError.forField('currentCopy', 'currentCopy payload too large', {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!body.currentKeywords || !Array.isArray(body.currentKeywords) || body.currentKeywords.length === 0) {
      const validationError = ServiceValidationError.forField('currentKeywords', 'currentKeywords must be a non-empty array', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_refine_brief', {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const abortController = new AbortController();
    let clientDisconnected = false;

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
      abortController.abort();
    });

    const sendEvent = (type: CampaignSSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      let hadError = false;
      for await (const event of this.proxyService.streamRefinedBrief(req, body, abortController.signal)) {
        if (clientDisconnected) return;
        if (event.type === 'error') hadError = true;
        sendEvent(event.type, event.data);
      }

      if (hadError) {
        logger.warning(req, 'campaign_refine_brief', 'Refine stream completed with error event', {});
      } else {
        logger.success(req, 'campaign_refine_brief', startTime, {});
      }
    } catch (error) {
      if (clientDisconnected) return;
      logger.error(req, 'campaign_refine_brief', startTime, error, {});
      sendEvent('error', 'Brief refinement failed. Please try again.');
    } finally {
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  public async createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'campaign_create', {});

    try {
      // Try the cutover FIRST, and fall through to the legacy path ONLY when the cutover is dark
      // (`enabled: false`). "Anything short of an accepted job" would be the wrong rule and the
      // dangerous one: an enabled-but-REFUSED create is terminal, because the legacy path has
      // side effects on the ad platforms and would create the campaigns for real while the user
      // is being told creation failed. Both branches below are explicit about which case they
      // are, and the distinction is safety-critical for paid campaigns.
      //
      // `?project=` and `?brief_id=` mirror the persist route's convention rather than moving
      // them into the body, so a caller that already knows how to save a brief knows how to
      // create from it.
      const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
      const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';
      const body = req.body as CampaignCreateRequest;
      const platforms = Array.isArray(body?.platforms) ? body.platforms : [];
      const configEnvelope = this.createConfigEnvelope(body);

      // Validated here, matching the `jobId` and `project` checks in `getJobStatus`, rather than
      // being left to `createCampaigns`.
      //
      // Left to fall through, a missing slug produced "this campaign could not be created because
      // its brief has not been saved yet" — which is wrong (the brief may be saved; the caller
      // just omitted the param) and, worse, is a TERMINAL refusal that blocks legacy fall-through,
      // so with the cutover dark a missing slug failed a create the legacy path could have served.
      // A missing query param is a client 400.
      //
      // Only when the cutover is on: with the flags off the legacy path neither reads nor needs
      // these params, so requiring them there would be the same category error as the
      // unconfigured-platform guard was.
      //
      // All THREE flags, matching `createCampaigns` exactly. Checking CREATE alone was a narrower
      // version of that same mistake: with CREATE on but BRIEFS or JOBS off the cutover is dark,
      // `createCampaigns` returns `enabled: false`, and the request is served by the legacy path —
      // which needs no slug. Rejecting it here would 400 a request that path handles fine.
      const cutoverOn =
        isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceCreate) &&
        isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs) &&
        isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceJobs);
      if (cutoverOn && projectSlug === '') {
        next(
          ServiceValidationError.forField('project', 'creating through campaign-service requires the project the brief was saved under', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // The unconfigured-platform refusal lives INSIDE `createCampaigns`, deliberately, so that it
      // is gated by the cutover flags along with everything else there.
      //
      // It was here for one revision, above this call, and that was a regression: the guard tests
      // for a CAMPAIGN-SERVICE envelope key, but sitting here it ran unconditionally and refused
      // demand-gen-only Google creates even with every flag OFF — a case the legacy path has
      // always supported, because `includeGoogle` gates on platform membership alone and Google's
      // inputs live on the request root rather than in a config object. Gating the legacy path on
      // a concept it does not have is a category error.
      const viaService = await this.campaignServiceClient.createCampaigns(req, briefId, projectSlug, platforms, configEnvelope, {
        campaignTypes: body?.campaignTypes,
      });

      if (viaService.enabled && viaService.jobId !== null) {
        logger.success(req, 'campaign_create', startTime, { jobId: viaService.jobId, via: 'campaign-service' });
        // The SAME response shape as the legacy path, so the client polls one way. The job id is
        // a UUID here and `job_...` there, which is exactly what lets the poll route send each
        // one back to the system that owns it.
        res.json({ jobId: viaService.jobId });
        return;
      }
      if (viaService.enabled && viaService.error !== null) {
        // Enabled but refused: do NOT fall through. The legacy path would create campaigns on the
        // platforms while the user is being told creation failed, which is the one outcome worth
        // more than a confusing error message.
        logger.warning(req, 'campaign_create', 'campaign-service refused the create; not falling back', { briefId, projectSlug });
        res.json({ jobId: '', error: viaService.error });
        return;
      }

      // The email channel exists ONLY on the cutover path, so it must not fall through here.
      //
      // Widening `platforms` to `CampaignAnyPlatform` is what makes this reachable: before it,
      // `platforms: ['hubspot']` was a type error at every caller. The legacy path has no HubSpot
      // client and no `includeHubspot` arm — it pushes "Unsupported platform(s): hubspot" into its
      // `errors` array and then completes with an EMPTY promise list. That is the shape this
      // cutover exists to prevent: a job that finishes, after the inline 45s wait, having created
      // nothing, reported through a partial-success envelope rather than as a refusal.
      //
      // `hasPlatformConfig` cannot catch it — that guard lives inside `createCampaigns`,
      // deliberately gated by the flags, so with the cutover dark it never runs.
      //
      // Refused terminally rather than passed through, matching the `viaService.error` arm above:
      // when we know the create cannot succeed, saying so beats a 45-second wait for a result that
      // names zero campaigns.
      if (platforms.includes('hubspot')) {
        logger.warning(req, 'campaign_create', 'email campaign requested while the campaign-service cutover is dark', { briefId, projectSlug });
        res.json({
          jobId: '',
          error: 'Email campaigns require the campaign-service cutover to be enabled. The legacy creation path cannot stage email.',
        });
        return;
      }

      const result = await this.proxyService.createCampaign(req, req.body);
      logger.success(req, 'campaign_create', startTime, { jobId: result.jobId, via: 'legacy' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const jobId = req.params['jobId'];

    if (!jobId) {
      next(ServiceValidationError.forField('jobId', 'jobId is required', { operation: 'campaign_job_status', service: 'campaign_controller' }));
      return;
    }

    // First endpoint of the campaign-service cutover. The flag selects the SOURCE; the two
    // sources do NOT speak the same shape, so `CampaignServiceClient` adapts one onto the
    // other (see `adaptJobPollResponse` — the status vocabularies differ, and campaign-service
    // reports per-platform results rather than the vendor-direct path's `CampaignCreateResponse`).
    // The client therefore sees one `CampaignJobStatus` either way, with `result` set on the
    // in-process path and `platformResults` on the campaign-service path.
    //
    // The flag is necessary but NOT sufficient to route. With CREATE off — still the default —
    // `createCampaign` above mints `job_<epoch>_<rand>` into the in-process map, and
    // campaign-service's `get-job` declares `Format(FormatUUID)` on `job_id`, so it would answer
    // 400 for every one of them. Flag-only routing would therefore break all polling the moment
    // the JOBS flag went on, which is the failure the flag exists to fix. With CREATE on, both id
    // shapes are in flight at once — which is the case the id check really serves.
    // `isCampaignServiceJobId`
    // adds the second condition, and it needs no separate flag of its own: a `job_` id can only
    // have come from this process and a UUID can only have come from campaign-service, so ids
    // minted either side of the create cutover keep resolving against the store that holds them.
    // Rollback stays an env change (plus the pod rollout that applies it) rather than a deploy.
    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceJobs) && isCampaignServiceJobId(jobId);
    const startTime = logger.startOperation(req, 'campaign_job_status', { jobId, source: viaCampaignService ? 'campaign_service' : 'in_process' });

    try {
      // No try/catch fallback to the in-process map when the proxied call fails. The
      // in-process map does not hold this job unless this same pod created it, so a
      // fallback would answer "not found" for a job that campaign-service knows is
      // running — turning a transient outage into a spurious terminal state the client
      // stops polling on. Letting the error through keeps the failure visible and the
      // flag is the way back.
      // The slug the create was made under. campaign-service stores it on the brief and `GetJob`
      // joins on it with an EXACT comparison, so polling under a different project answers
      // `not_found` for a job that exists — and `not_found` is terminal for the poller.
      const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
      if (viaCampaignService && projectSlug === '') {
        // Refuse rather than guess. The old module constant guessed 'tlf' for everyone, which was
        // survivable only while no UUID job could exist; creation through campaign-service is what
        // makes them real. Guessing here would answer "campaign lost" for another foundation's job.
        // `ServiceValidationError`, matching the `jobId` check above and every other validation
        // failure in this file. A bare `Error` is not a `BaseApiError`, so the error middleware
        // falls through to a generic 500 `{ error: 'Internal server error' }` — the message below
        // never reaches the client, and a missing query param is reported as a server fault.
        next(
          ServiceValidationError.forField('project', 'a campaign-service job poll requires the project it was created under', {
            operation: 'campaign_job_status',
            service: 'campaign_controller',
          })
        );
        return;
      }
      const status = viaCampaignService
        ? await this.campaignServiceClient.getJobStatus(req, jobId, projectSlug)
        : await this.proxyService.getJobStatus(req, jobId);
      logger.success(req, 'campaign_job_status', startTime, { jobId, status: status.status, source: viaCampaignService ? 'campaign_service' : 'in_process' });
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Persist the generated brief so it outlives the browser tab.
   *
   * Today the approved brief lives only in a `CampaignsComponent` signal: a reload loses it and
   * the whole Planning pass has to be redone. This writes it to campaign-service, which is also
   * what later phases need — campaign creation, metrics and status writes are all nested under
   * `/briefs/{brief_id}` and cannot be cut over until a persisted brief id exists.
   *
   * With the flag off this answers `{ enabled: false }` at 200 rather than 404 or 501. It is not
   * an error for the cutover to be dark — that is the default in every environment until it is
   * switched on — and a non-2xx would make the client's error arm fire on the normal case,
   * training whoever sees it to ignore the one signal that matters.
   *
   * A FAILURE, by contrast, is reported as one. The temptation is to swallow it, because the
   * handoff to the Implementation tab works perfectly well without persistence; this repo has
   * already shipped one graceful degradation that hid a 100%-failure integration behind a clean
   * UI. A user who is not told keeps working on a brief they believe is saved.
   */
  public async persistBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      // Every field is present rather than omitted so the response satisfies
      // CampaignBriefPersistResult on both arms, and the client needs exactly one branch.
      // `enabled: false` is the whole signal; the remaining values are the empty ones the
      // client already ignores when it is false, not placeholders standing in for a real save.
      res.json({ enabled: false, briefId: '', etag: null, created: false, approved: false });
      return;
    }

    // The foundation the user has selected, from the same `?project=<slug>` the page itself is
    // scoped by. NOT defaulted: `/foundation/campaigns` is reachable by an ED of any foundation,
    // and campaign-service files briefs per project, so falling back to a constant would put one
    // foundation's work in another's table. An unresolved context is a bug worth surfacing here
    // rather than a reason to guess.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation: 'campaign_persist_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const brief = req.body as CampaignBriefOutput;
    if (!brief || typeof brief !== 'object') {
      next(ServiceValidationError.forField('brief', 'brief is required', { operation: 'campaign_persist_brief', service: 'campaign_controller' }));
      return;
    }

    // The cast above is a compile-time claim about untrusted JSON, so the shapes the server path
    // actually DEREFERENCES have to be checked at runtime. `deriveEventSlug` calls `.trim()` on
    // `eventDetails.slug`, which throws a TypeError on a number or an object — turning malformed
    // input into a 500 instead of the controlled 400 sitting right below it — and
    // `selectedPlatforms` is forwarded to campaign-service as `platforms`, where a non-array
    // becomes an upstream contract violation rather than a local one.
    //
    // Deliberately narrow: this validates the two fields whose types this request path relies on,
    // not the whole brief. The rest is stored opaquely in `Any` columns that nothing validates on
    // either side, so checking them here would claim a guarantee the system does not make — and
    // `fromBriefResponse` already treats every one of them as untrusted when reading back.
    const eventDetails: unknown = (brief as { eventDetails?: unknown }).eventDetails;
    if (eventDetails !== undefined && eventDetails !== null && typeof eventDetails !== 'object') {
      next(
        ServiceValidationError.forField('eventDetails', 'eventDetails must be an object', {
          operation: 'campaign_persist_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }
    const rawSlug: unknown = (eventDetails as { slug?: unknown } | null | undefined)?.slug;
    if (rawSlug !== undefined && rawSlug !== null && typeof rawSlug !== 'string') {
      next(
        ServiceValidationError.forField('eventDetails.slug', 'eventDetails.slug must be a string', {
          operation: 'campaign_persist_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }
    const rawPlatforms: unknown = (brief as { selectedPlatforms?: unknown }).selectedPlatforms;
    if (rawPlatforms !== undefined && rawPlatforms !== null && !Array.isArray(rawPlatforms)) {
      next(
        ServiceValidationError.forField('selectedPlatforms', 'selectedPlatforms must be an array', {
          operation: 'campaign_persist_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // Checked here rather than left to campaign-service because its 400 names `event_slug`, a
    // field the user never typed. The slug is derived from the event page URL, so an empty one
    // means the URL had no usable last path segment — which is what the message should say.
    const eventSlug = deriveEventSlug(brief);
    if (eventSlug === null) {
      next(
        ServiceValidationError.forField('eventDetails.slug', 'the brief has no event slug; check the event page URL', {
          operation: 'campaign_persist_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_persist_brief', { eventSlug, projectSlug });

    try {
      // The brief id the CLIENT holds, when this session has established ownership of that row —
      // either by loading the brief or by having created it on an earlier save. Absent on a first
      // save of a brief nobody has seen, which is the ordinary case and must CREATE. It is the
      // caller's proof of ownership — see saveBrief's guard (LFXV2-3200): without it a save can
      // replace a stored brief the user never saw, which a reload or a second tab reaches.
      const knownBriefId = typeof req.query['brief_id'] === 'string' && req.query['brief_id'].trim() !== '' ? req.query['brief_id'] : null;
      // Paired with brief_id: an ETag without the id it belongs to cannot be checked against
      // anything, and the id without the ETag is the ceremonial-header case this fixes.
      const knownEtag = typeof req.query['etag'] === 'string' && req.query['etag'].trim() !== '' ? req.query['etag'] : null;
      // Only meaningful without an etag: it says the absence is deliberate (the user was shown a
      // stale-brief warning and proceeded) rather than "the write returned no validator".
      const allowEtagFallback = req.query['etag_fallback'] === '1';
      const result = await this.campaignServiceClient.saveBrief(req, brief, eventSlug, projectSlug, knownBriefId, knownEtag, allowEtagFallback);
      logger.success(req, 'campaign_persist_brief', startTime, {
        eventSlug,
        projectSlug,
        briefId: result.briefId,
        created: result.created,
        approved: result.approved,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Read back the brief saved for an event slug — the other half of `persistBrief`.
   *
   * Gated on the SAME flag, not a new one. Read and write have to flip together: a read enabled
   * while the write is dark would find nothing and look broken, and a write enabled while the
   * read is dark is what shipped in the previous phase — briefs going into Postgres that nothing
   * ever brings back. One flag makes "the cutover is on" a single, checkable fact.
   *
   * The slug arrives as a query parameter because there is nothing else to key on: the page has
   * only the event URL the user pasted, and the slug derived from it is what `persistBrief`
   * filed the brief under.
   */
  public async loadBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      // `approved: false` is not a claim about any stored row -- with the flag off nothing was
      // read. It is the safe default the field documents: never assert approval that was not
      // observed.
      res.json({ status: 'off', briefId: null, brief: null, approved: false } satisfies CampaignBriefLoadResult);
      return;
    }

    // Rejected rather than passed through: `find-brief` declares MinLength(1) on `event_slug`,
    // so an empty one is a 400 from campaign-service naming a field the user never typed — the
    // same reason `persistBrief` checks its own slug before sending.
    // Trimmed to TEST for emptiness, never to rewrite the key — mirroring `deriveEventSlug`,
    // which does exactly the same and stores the ORIGINAL slug. Querying with a trimmed key
    // while the write stored an untrimmed one makes a padded slug unreadable: find-brief misses
    // and the caller is told `none` for a brief that exists, which the next save then PUTs over.
    const eventSlug = typeof req.query['event_slug'] === 'string' ? req.query['event_slug'] : '';
    if (eventSlug.trim().length === 0) {
      next(
        ServiceValidationError.forField('event_slug', 'event_slug is required', {
          operation: 'campaign_load_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // Refused, not defaulted, for exactly the reason `persistBrief` refuses: `/foundation/campaigns`
    // is reachable by an ED of any foundation, and a constant here would read TLF's brief table on
    // their behalf — offering to restore another foundation's brief, or finding nothing and letting
    // the next save silently replace the one that does exist.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation: 'campaign_load_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_load_brief', { eventSlug, projectSlug });

    try {
      const result = await this.campaignServiceClient.loadBrief(req, eventSlug, projectSlug);
      // `status` is logged on every arm, `unreadable` included: it is the one outcome that says
      // a stored brief exists and this build cannot open it, and nothing else would record it.
      logger.success(req, 'campaign_load_brief', startTime, { eventSlug, projectSlug, status: result.status, briefId: result.briefId });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getMonitorData(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_monitor', { days });

    try {
      const data = await this.metricsService.getMonitorData(req, days);
      logger.success(req, 'campaign_monitor', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  public async getKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_keywords', { days });

    try {
      const data = await this.metricsService.getKeywords(req, days);
      logger.success(req, 'campaign_keywords', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * List the campaigns a brief created, so a later session can address them.
   *
   * This is the read that makes every per-campaign operation reachable after the creating tab is
   * closed. The create job returns campaign ids in its per-platform results, but only to the
   * session that ran it — reload the page and those ids are gone, which is why pause/resume and
   * per-campaign metrics have no way to name a campaign today.
   *
   * Both scopes are REQUIRED and neither is defaulted: `project` is the authorization boundary
   * the platform applies FGA against, and `brief_id` is what narrows to this brief. Guessing
   * either would widen the read past what the caller asked for.
   */
  public async listBriefCampaigns(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';

    if (projectSlug === '') {
      next(
        ServiceValidationError.forField('project', 'project is required', {
          operation: 'list_brief_campaigns',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    if (briefId === '') {
      next(
        ServiceValidationError.forField('brief_id', 'brief_id is required', {
          operation: 'list_brief_campaigns',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'list_brief_campaigns', { projectSlug, briefId });

    try {
      const result = await this.campaignServiceClient.listBriefCampaigns(req, projectSlug, briefId);
      logger.success(req, 'list_brief_campaigns', startTime, { count: result.campaigns.length, possiblyStale: result.possiblyStale });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search the project's HubSpot marketing emails for the template picker.
   *
   * `?project=` is required rather than defaulted, for the same reason every other
   * campaign-service read here requires it: a HubSpot connection is per-project, and guessing the
   * project would list one foundation's templates to another.
   *
   * `?q=` is optional — an empty query lists the most recently updated templates, which is the
   * useful default when a user does not yet know what they are looking for.
   */
  public async searchHubSpotEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug === '') {
      next(
        ServiceValidationError.forField('project', 'project is required', {
          operation: 'hubspot_email_search',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    const rawQuery = req.query['q'];
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
    const startTime = logger.startOperation(req, 'hubspot_email_search', { projectSlug });

    try {
      const result = await this.campaignServiceClient.searchHubSpotEmails(req, projectSlug, query);
      logger.success(req, 'hubspot_email_search', startTime, { enabled: result.enabled, count: result.emails.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async lookupHubSpotUtm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawEventName = req.query['event_name'];
    const eventName = typeof rawEventName === 'string' ? rawEventName : undefined;
    if (!eventName) {
      next(ServiceValidationError.forField('event_name', 'event_name is required', { operation: 'hubspot_utm_lookup', service: 'campaign_controller' }));
      return;
    }

    const startTime = logger.startOperation(req, 'hubspot_utm_lookup', { eventName });

    try {
      const result = await this.proxyService.lookupHubSpotUtm(req, eventName);
      logger.success(req, 'hubspot_utm_lookup', startTime, { found: result.found });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async createHubSpotUtm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawEventName = req.query['event_name'];
    const eventName = typeof rawEventName === 'string' ? rawEventName : undefined;
    if (!eventName) {
      next(ServiceValidationError.forField('event_name', 'event_name is required', { operation: 'hubspot_utm_create', service: 'campaign_controller' }));
      return;
    }

    const startTime = logger.startOperation(req, 'hubspot_utm_create', { eventName });

    try {
      const result = await this.proxyService.createHubSpotUtm(req, eventName);
      logger.success(req, 'hubspot_utm_create', startTime, { created: result.created });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public getLinkedInAccounts(_req: Request, res: Response): void {
    const config = getLinkedInConfig();
    // Return default account first so clients defaulting to accounts[0] honour the configured default.
    const sorted = [
      ...config.accounts.filter((a) => a.accountId === config.defaultAccountId),
      ...config.accounts.filter((a) => a.accountId !== config.defaultAccountId),
    ];
    res.json(sorted);
  }

  public async getLinkedInMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const config = getLinkedInConfig();
    const account = config.accounts.find((a) => a.accountId === rawKey) ?? config.accounts[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid LinkedIn account key', {
          operation: 'linkedin_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'linkedin_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.linkedInMetricsService.getLinkedInMonitorData(req, accountId, days);
      logger.success(req, 'linkedin_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'linkedin_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public async getAudience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_audience', { days });

    try {
      const data = await this.metricsService.getAudience(req, days);
      logger.success(req, 'campaign_audience', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  public async executeKeywordActions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = req.body as BulkKeywordActionRequest;

    if (!body.keywords || !Array.isArray(body.keywords) || body.keywords.length === 0) {
      next(ServiceValidationError.forField('keywords', 'keywords array is required', { operation: 'keyword_actions', service: 'campaign_controller' }));
      return;
    }

    if (!body.action || !['pause', 'remove'].includes(body.action)) {
      next(ServiceValidationError.forField('action', 'action must be "pause" or "remove"', { operation: 'keyword_actions', service: 'campaign_controller' }));
      return;
    }

    for (const kw of body.keywords) {
      if (!kw || typeof kw !== 'object' || !kw.campaignId || !kw.adGroupId || !kw.criterionId) {
        next(
          ServiceValidationError.forField('keywords', 'each keyword must include campaignId, adGroupId, and criterionId', {
            operation: 'keyword_actions',
            service: 'campaign_controller',
          })
        );
        return;
      }
    }

    const startTime = logger.startOperation(req, 'keyword_actions', { action: body.action, count: body.keywords.length });

    try {
      const result = await this.proxyService.executeKeywordActions(req, body);
      logger.success(req, 'keyword_actions', startTime, { succeeded: result.succeeded, failed: result.failed });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public getRedditAccounts(_req: Request, res: Response): void {
    const accounts = REDDIT_ACCOUNTS.map((a) => ({ key: a.accountId, label: a.label }));
    res.json(accounts);
  }

  public async getRedditMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const account = rawKey ? REDDIT_ACCOUNTS.find((a) => a.accountId === rawKey) : REDDIT_ACCOUNTS[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid Reddit account key', {
          operation: 'reddit_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'reddit_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.redditMetricsService.getRedditMonitorData(req, accountId, days);
      logger.success(req, 'reddit_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'reddit_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public getMetaAccounts(_req: Request, res: Response): void {
    const accounts = META_ACCOUNTS.map((a) => ({ key: a.accountId, label: a.label }));
    res.json(accounts);
  }

  public async getMetaMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const account = rawKey ? META_ACCOUNTS.find((a) => a.accountId === rawKey) : META_ACCOUNTS[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid Meta account key', {
          operation: 'meta_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'meta_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.metaMetricsService.getMonitorData(req, accountId, days);
      logger.success(req, 'meta_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'meta_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public async updateCampaignStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const campaignId = req.params['campaignId'];

    if (!campaignId) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId route parameter is required', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    // Which backend owns this campaign is decided by the id's SHAPE, not by the flag alone. The
    // two id spaces are disjoint — campaign-service keys campaigns by UUID, the legacy per-platform
    // path by the ad platform's own numeric id — so no request can be claimed by both, and a
    // rolling deploy with mixed flag states cannot misroute one. See the flag's own doc.
    const viaCampaignService = isCampaignServiceJobId(campaignId);

    if (!viaCampaignService && !NUMERIC_ID_RE.test(campaignId)) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId must be a numeric string or a campaign UUID', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    // A UUID can only be served by campaign-service. Refusing when the flag is off is deliberate:
    // the alternative is handing a UUID to the legacy `switch`, whose `default` arm throws a
    // platform error that names the wrong cause entirely. Say which capability is off instead.
    if (viaCampaignService && !isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceStatusToggle)) {
      next(
        // Filed under `campaignId` because that is the field that made this request unservable —
        // a UUID names a campaign only campaign-service can address. Lowercase to match every
        // sibling message in this handler.
        ServiceValidationError.forField('campaignId', 'campaign status changes are not enabled for this deployment', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const body = req.body as Partial<CampaignStatusUpdateRequest>;

    // The allowlist is per-PATH because reach genuinely differs, and collapsing the two would be
    // wrong in both directions. The legacy path is a switch over meta/reddit whose default arm
    // throws, so widening it would turn a clear refusal into a confusing platform error;
    // keeping the campaign-service set at two would refuse Google Ads and LinkedIn, which this app
    // does offer. Note these are two different sets and must not be conflated: campaign-service
    // implements a toggle dispatcher for every paid platform upstream, while this set is only the
    // NON-DISABLED entries of CAMPAIGN_PLATFORMS — a platform can be dispatchable upstream and
    // still not offered here (X is, today). Deliberately not stated as a count: the roster changes
    // whenever a `disabled` flag flips, and a number here goes stale silently. HubSpot is in
    // NEITHER set — an email send has no run state to pause.
    //
    // On the campaign-service path this check is a FAST REJECT, not the policy boundary, and the
    // distinction is load-bearing. `platform` is caller-supplied and never sent upstream — the
    // service loads the dispatcher from the campaign ROW — so a caller could label a Microsoft
    // campaign `google-ads` and pass here. What actually enforces the narrowing is the row check
    // after the toggle returns; this one exists to refuse an obviously-unsupported request before
    // spending a round trip. Treating it as the boundary is what made an earlier version of this
    // comment claim an exclusion the code did not perform.
    const supportedPlatforms = viaCampaignService ? CAMPAIGN_SERVICE_STATUS_PLATFORMS : SUPPORTED_STATUS_PLATFORMS;
    if (!body.platform || !supportedPlatforms.has(body.platform)) {
      next(
        ServiceValidationError.forField('platform', `platform must be one of: ${[...supportedPlatforms].join(', ')}`, {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!body.status || !VALID_CAMPAIGN_TOGGLE_STATUSES.has(body.status as CampaignToggleStatus)) {
      next(
        ServiceValidationError.forField('status', 'status must be ACTIVE or PAUSED', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // campaign-service addresses a campaign by (project, brief, campaign) and requires If-Match,
    // so both are refused here rather than defaulted. There is nothing safe to default them TO:
    // a guessed brief id addresses a different route that 404s at the gateway, and an absent
    // If-Match is answered upstream with 428. Failing here names the missing field instead.
    let briefId = '';
    let etag = '';
    let projectSlug = '';
    if (viaCampaignService) {
      briefId = typeof body.briefId === 'string' ? body.briefId.trim() : '';
      etag = typeof body.etag === 'string' ? body.etag.trim() : '';
      projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
      if (!projectSlug) {
        next(
          ServiceValidationError.forField('project', 'project is required', {
            operation: 'campaign_status_update',
            service: 'campaign_controller',
          })
        );
        return;
      }
      if (!briefId) {
        next(
          ServiceValidationError.forField('briefId', 'briefId is required to change a campaign-service campaign status', {
            operation: 'campaign_status_update',
            service: 'campaign_controller',
          })
        );
        return;
      }
      if (!etag) {
        next(
          ServiceValidationError.forField('etag', 'etag is required so a concurrent edit cannot be overwritten', {
            operation: 'campaign_status_update',
            service: 'campaign_controller',
          })
        );
        return;
      }
    }

    const startTime = logger.startOperation(req, 'campaign_status_update', { campaignId, platform: body.platform, status: body.status });

    try {
      if (viaCampaignService) {
        const campaign = await this.campaignServiceClient.toggleCampaignStatus(req, {
          projectSlug,
          briefId,
          campaignId,
          status: body.status as CampaignToggleStatus,
          etag,
        });
        // Observed against the AUTHORITATIVE value. The pre-check above tested the caller's claim;
        // this reads the row campaign-service actually toggled, which is the only thing that
        // decides which dispatcher ran.
        //
        // Deliberately a LOG, not a refusal, and the reason is the ordering: by this point the
        // toggle HAS happened upstream — the ad platform moved — so an error here would tell the
        // caller nothing occurred, which is the false-absence failure this codebase keeps paying
        // for. Nor can it be moved earlier: the row's platform is not knowable until the toggle
        // returns it, because nothing in this BFF reads a campaign row (LFXV2-3099). So the honest
        // options are "log that it happened" or "read the row first", and the second needs an
        // endpoint that does not exist yet.
        //
        // What makes this acceptable rather than a hole: the platform label is cosmetic on this
        // path. It is never sent upstream, so it cannot cause the wrong dispatcher to run — the
        // worst a mislabelled request achieves is toggling a campaign the caller could already
        // toggle by naming it correctly. The response reports the ROW's platform below, so the
        // caller is not told their label was accepted.
        const rowPlatform = campaign.platform as CampaignPlatform | undefined;
        if (rowPlatform && !CAMPAIGN_SERVICE_STATUS_PLATFORMS.has(rowPlatform)) {
          logger.warning(req, 'campaign_status_update', 'toggled a campaign whose platform this app does not offer', {
            campaignId,
            requestedPlatform: body.platform,
            rowPlatform,
          });
        }

        // `previousStatus` is OMITTED, not inferred. The legacy path reports it as a fact — it
        // GETs the campaign before writing — so filling it here with "the opposite of what was
        // requested" would put a guess and an observation behind one field name. It would also be
        // wrong where it matters most: a `created_degraded` campaign is pausable, and its true
        // prior status is `created_degraded`, not ACTIVE. Absence is the honest answer, and the
        // caller already holds the row it read.
        //
        // `etag` and `serviceStatus` come from the ROW, and dropping them is not cosmetic. The
        // fresh etag is the only way a caller can chain pause→resume: its own validator went
        // stale the moment this toggle committed, and a stale If-Match is answered with 412. And
        // `newStatus` is an echo of the REQUEST, which the `created_degraded` case makes false —
        // pausing such a campaign pauses it upstream while deliberately leaving the row's status
        // unchanged, so echoing "PAUSED" would render a transition the service declined to
        // record. `serviceStatus` is what actually happened; `newStatus` is what was asked.
        const result: CampaignStatusUpdateResult = {
          // The ROW's platform, not the caller's. `platform` never reaches campaign-service — the
          // path is built from (project, brief, campaign) and the service resolves the platform
          // from the stored row — so echoing the request would let a caller who paused a Reddit
          // campaign while sending `google-ads` receive a 200 that agrees with them. Same class of
          // falsehood as the `serviceStatus` case below, in the field beside it.
          platform: (campaign.platform as CampaignPlatform) ?? body.platform,
          campaignId,
          newStatus: body.status as CampaignToggleStatus,
          success: true,
          etag: campaign.etag,
          serviceStatus: campaign.status,
        };
        logger.success(req, 'campaign_status_update', startTime, {
          campaignId,
          newStatus: result.newStatus,
          serviceStatus: result.serviceStatus,
          via: 'campaign-service',
        });
        res.json(result);
        return;
      }

      const result = await this.proxyService.updateCampaignStatus(req, campaignId, {
        platform: body.platform,
        status: body.status as CampaignToggleStatus,
        accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      });
      logger.success(req, 'campaign_status_update', startTime, { campaignId, newStatus: result.newStatus });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  private async closeAllStreams(): Promise<void> {
    const streams = [...this.activeStreams];
    this.activeStreams.clear();
    const STREAM_CLOSE_TIMEOUT_MS = 2_000;
    await Promise.all(
      streams.map(
        (res) =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            const timer = setTimeout(() => {
              logger.debug(undefined, 'campaign_sse_shutdown_timeout', 'SSE stream close timed out; force-closing', {});
              try {
                if (!res.writableEnded) res.end();
              } catch {
                /* already ended */
              }
              res.socket?.destroy();
              finish();
            }, STREAM_CLOSE_TIMEOUT_MS);
            try {
              if (!res.writableEnded) {
                res.write('event: shutdown\ndata: {"reason":"server_shutdown"}\n\n', () => {
                  clearTimeout(timer);
                  res.end(finish);
                });
              } else {
                clearTimeout(timer);
                finish();
              }
            } catch (error) {
              clearTimeout(timer);
              const isExpected = error instanceof Error && (error.message.includes('write after end') || error.message.includes('Cannot call end'));
              if (isExpected) {
                logger.debug(undefined, 'campaign_sse_shutdown_close', 'Stream already closed during shutdown', { err: error });
              } else {
                logger.warning(undefined, 'campaign_sse_shutdown_close', 'Unexpected error closing SSE stream', { err: error });
              }
              finish();
            }
          })
      )
    );
  }

  /**
   * The per-platform config envelope campaign-service expects, built from the legacy request.
   *
   * The service's `config` is an object keyed by `googleAdsConfig` / `linkedInConfig` /
   * `redditConfig` / `metaConfig` with `hsToken` as a top-level sibling. LinkedIn and Reddit carry
   * the service's own field names already, so those are projections; Google and Meta are
   * translations, because the legacy request stores their inputs in a different shape (see each
   * builder). Keys with no config are omitted rather than sent as null: the dispatcher treats an
   * absent config as "not selected", and a null one as a malformed selection.
   */
  private createConfigEnvelope(body: CampaignCreateRequest): Record<string, unknown> {
    const envelope: Record<string, unknown> = {};
    if (body?.hsToken) envelope['hsToken'] = body.hsToken;

    const googleAdsConfig = this.buildGoogleAdsConfig(body);
    if (googleAdsConfig) envelope['googleAdsConfig'] = googleAdsConfig;

    const linkedInConfig = this.buildLinkedInConfig(body);
    if (linkedInConfig) envelope['linkedInConfig'] = linkedInConfig;
    if (body?.redditConfig) envelope['redditConfig'] = body.redditConfig;

    const metaConfig = this.buildMetaConfig(body);
    if (metaConfig) envelope['metaConfig'] = metaConfig;

    const microsoftConfig = this.buildMicrosoftConfig(body);
    if (microsoftConfig) envelope['microsoftConfig'] = microsoftConfig;

    const hubspotConfig = this.buildHubSpotConfig(body);
    if (hubspotConfig) envelope['hubspotConfig'] = hubspotConfig;

    return envelope;
  }

  /**
   * Google's config, translated from the flat legacy request.
   *
   * Google is the one platform whose inputs live on the request root rather than in a
   * `<platform>Config` object, because the legacy path had a dedicated Google endpoint. Every
   * field below is one the dispatcher reads from `config` and cannot recover from the stored
   * brief: sending nothing creates a campaign with no budget and an ad group with no criteria,
   * which per `googleAdsConfig.Keywords` "can never serve". The dispatcher's remaining optional
   * fields are omitted because this request has no source for them — `audienceSegments` expects
   * pre-built Customer Match resource names the UI never collects, and `adoptExisting` must
   * default to false so a re-dispatch cannot silently rebind an existing upstream campaign.
   *
   * Budget depends on WHICH channel this config is for, and the two cases differ.
   *
   * For a SEARCH create, budget is the Search SHARE rather than the whole request budget: the
   * dispatcher creates exactly one Search campaign, so handing it the combined figure would
   * spend the demand-gen half on Search.
   *
   * For a DEMAND-GEN-ONLY selection this returns a config carrying the FULL budget and
   * `channel: "demand-gen"` — not null, which is what an earlier version of this comment said
   * and what the code did before LFXV2-3257 ported `createDemandGenCampaign` into
   * campaign-service. There is no Search campaign to split the budget with, so the whole amount
   * funds the one campaign being created.
   *
   * A MIXED selection is refused DOWNSTREAM, not before this point: the controller builds the
   * envelope (line ~304) and only then calls `createCampaigns` (line ~346), where the
   * Search+Demand-Gen guard lives. So a mixed selection DOES reach this builder and produces a
   * search-shaped config, which `createCampaigns` then refuses — see the inline comment below
   * for why one-config-one-channel is a limit of this builder rather than of campaign-service's
   * schema.
   *
   * Null means UNCONFIGURED, and `createCampaign` refuses the whole create when a selected
   * platform lands here — see `hasPlatformConfig`. An earlier version of this comment said the
   * caller already refused; it did not. `platforms` was passed through unfiltered, and
   * campaign-service reads an absent config key as a zero value, so google-ads dispatched with
   * budget 0 and no headlines. The refusal is real now rather than assumed.
   */
  private buildGoogleAdsConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    if (!body?.platforms?.includes('google-ads')) return null;

    const types = body.campaignTypes ?? [];
    const includesSearch = types.includes('search');
    const includesDemandGen = types.includes('demand-gen');

    // Neither type selected: nothing to build. Returning null marks the platform
    // UNCONFIGURED, and `hasPlatformConfig` refuses the create rather than dispatching
    // a zero-value config.
    if (!includesSearch && !includesDemandGen) return null;

    // DEMAND-GEN-ONLY is the one mixed-type case the cutover can serve today, and it
    // gets the WHOLE budget: there is no Search campaign to fund, so the split does not
    // apply. campaign-service creates a Demand Gen campaign with no ad and no keywords
    // (LFXV2-3257), which is why headlines/keywords below are harmless to send — the
    // Demand Gen path ignores them.
    //
    // Search + Demand Gen together is refused DOWNSTREAM in `createCampaigns`, not before this
    // builder runs, deliberately — and the
    // reason is THIS function, not campaign-service's schema. #130 widened the slot key to
    // (brief_id, platform, variant), so a brief can now hold a Search row and a Demand Gen row
    // at once; the database does not forbid the pair.
    //
    // What forbids it is that this builder returns ONE config with ONE channel. A mixed create
    // would dispatch a single campaign and silently drop the other half — and half the budget.
    // Serving the pair means emitting two configs, which is a change here rather than a schema
    // decision. Until then a loud refusal beats a silent partial create.
    if (!includesSearch && includesDemandGen) {
      return { budget: body.budgetUsd ?? 0, channel: 'demand-gen' };
    }

    const pct = includesDemandGen ? (body.searchBudgetPct ?? 100) : 100;
    // KNOWN GAP (LFXV2-3251) — read before enabling this cutover on a non-USD account.
    //
    // `budget` is whole units of the AD ACCOUNT'S currency, not USD: "Budget is in whole units of
    // the ad ACCOUNT's currency (NOT USD — the client does no FX)" (campaign-service
    // `internal/dispatch/googleads.go:49`; `meta.go:29` says the same). This field is fed from
    // `budgetUsd`, so on a non-USD account 5000 becomes 5000 EUR/JPY rather than $5000.
    //
    // NOT fixable here: no FX conversion exists anywhere in campaign-service, and the account's
    // currency is not exposed to this application — the connection read returns no currency field,
    // so there is nothing to convert against. The real fix is either to surface the account
    // currency on the connection and convert, or to collect an account-currency amount in the UI
    // and stop calling it USD. campaign-service already made that second choice for X/Twitter
    // (`twitter.go:42`: "The old `budgetUsd` name was misleading").
    //
    // Left as-is deliberately rather than silently renamed: renaming the variable would not change
    // the denomination, and would make the gap harder to find. Every account in play today is USD.
    const budget = ((body.budgetUsd ?? 0) * pct) / 100;

    return {
      budget,
      // Explicit rather than relying on the upstream default. Absent means Search there
      // too, but naming it keeps the two branches of this function symmetrical and makes
      // a future default change unable to repoint this one silently.
      channel: 'search',
      headlines: body.headlines ?? [],
      descriptions: body.descriptions ?? [],
      // The service's keyword shape is `{text, matchType}` with an upper-case enum; the UI carries
      // `{term, matchType}` in title case alongside brief-only fields (intentLevel, notes) the
      // dispatcher has no field for.
      keywords: (body.keywords ?? []).map((k) => ({ text: k.term, matchType: k.matchType.toUpperCase() })),
    };
  }

  /**
   * LinkedIn's config, translated from `linkedInConfig` on the legacy request.
   *
   * Passing the legacy object through unchanged fails the dispatch twice over, which is why this
   * adapter exists at all:
   *
   * 1. `adAccountId` is REJECTED on mismatch, not ignored. campaign-service resolves the account
   *    from its own connection row, and honours a caller override only when it matches exactly —
   *    `linkedin.go:143` returns "cross-account campaigns are not allowed" otherwise. The legacy
   *    request carries this application's `LINKEDIN_AD_ACCOUNT_ID`, which has no reason to equal
   *    the project's connection. Stripped: letting the connection decide is the whole point of
   *    the cutover, and an override that matches adds nothing.
   *
   * 2. The dispatcher builds its LinkedIn runtime config from `targetingProfiles` (PLURAL, the
   *    full catalogue) and `employerExclusions` in this envelope — `linkedin.go:135`. The legacy
   *    request carries `targetingProfile` (SINGULAR — the one the user picked) and no exclusions,
   *    so without this the client fails with "profile not found in runtime config" for the
   *    ordinary `cloud-native` and `mcp` selections. Both come from `getLinkedInConfig()`, which
   *    is the same source the legacy path reads.
   *
   * The singular `targetingProfile` still travels: it is the user's SELECTION, and the catalogue
   * is what that selection is resolved against. They are not duplicates of each other.
   */
  private buildLinkedInConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    if (!body?.linkedInConfig) return null;

    // Built by copy-and-delete rather than destructuring-with-rest: the lint config does not
    // exempt an underscore-prefixed destructured binding, so `{ adAccountId: _x, ...rest }` is a
    // no-unused-vars error.
    const rest: Record<string, unknown> = { ...body.linkedInConfig };
    delete rest['adAccountId'];
    const runtime = getLinkedInConfig();

    return {
      ...rest,
      targetingProfiles: runtime.targetingProfiles,
      employerExclusions: runtime.employerExclusions,
    };
  }

  /**
   * Meta's config, translated from `metaConfig` on the legacy request.
   *
   * The one difference is the budget key: the request says `budgetUsd`, the dispatcher reads
   * `budget`. Passing the object through unchanged leaves `budget` at its zero value, which the
   * Meta client rejects with "invalid budget: must be a positive number" on every dispatch.
   *
   * SAME KNOWN GAP as `buildGoogleAdsConfig` (LFXV2-3251) — the rename does NOT convert the
   * denomination.
   * `meta.go:29`: "Budget is in whole units of the ad ACCOUNT's currency (NOT USD — the client
   * does no FX conversion)". On a non-USD Meta account this spends the number in that account's
   * currency. Not fixable here (no FX anywhere in campaign-service, and the account currency is
   * not exposed to this application); see the fuller note on `buildGoogleAdsConfig`.
   */
  private buildMetaConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    if (!body?.metaConfig) return null;

    const { budgetUsd, ...rest } = body.metaConfig;
    return { ...rest, budget: budgetUsd };
  }

  /**
   * Microsoft's config, translated from `microsoftConfig` on the legacy request.
   *
   * Like Meta, the budget key is renamed — the request says `budgetUsd`, the dispatcher reads
   * `budget` — and the SAME known gap applies (LFXV2-3251): the rename does not convert the
   * denomination, and `microsoft.go` states the budget is "whole units of the ad ACCOUNT's
   * currency (NOT USD — the client does NO FX conversion)", applied as the DAILY budget.
   *
   * Unlike Meta, this builder REFUSES rather than merely translating, because Microsoft has two
   * inputs whose absence upstream is silent rather than an error. Returning null marks the
   * platform UNCONFIGURED and `hasPlatformConfig` refuses the whole create with a named reason,
   * which is the difference between an operator learning now and learning at launch:
   *
   * - A non-finite or non-positive `budget` is rejected by the client DURING dispatch. Because
   *   `CreateCampaigns` is asynchronous that surfaces as a pre-create job failure — a job the
   *   user must go and read — rather than as a refusal of the request they just made.
   * - Zero keywords creates a campaign that "can NEVER SERVE", and `ToggleStatus` then refuses to
   *   activate it locally with `ErrCampaignNotProvisioned`, without ever calling Microsoft.
   * - Zero geo targets creates a campaign Microsoft serves EVERYWHERE once enabled.
   *
   * The UI blocks all three before submit (see `canSubmit`); this is the second gate, and it is
   * not redundant. The UI guard protects the operator using the form, this one protects the
   * endpoint — the request is reachable without the form, and `unmarshalPlatformConfig` upstream
   * reads an absent config key as a ZERO VALUE rather than an error.
   *
   * `cpcBid` and `timeZone` are forwarded only when they carry meaning. An omitted or zero
   * `cpcBid` means unset, and Microsoft then applies the account-currency minimum — a documented,
   * serve-capable floor — so sending an explicit 0 would claim a bid the account does not have.
   *
   * A bid OUTSIDE `[MICROSOFT_MIN_CPC_BID, MICROSOFT_MAX_CPC_BID]` is dropped rather than
   * forwarded, because the client refuses it (`targeting.go:263-268`) and that refusal would
   * arrive as a failed job rather than as an error on this request. Dropping is the right answer
   * HERE specifically: unlike the budget/keywords/geo arms this does not refuse the whole create,
   * since unset is a valid serve-capable state and an out-of-range bid is the one input whose
   * absence still produces a working campaign. The UI blocks it before this point with a message
   * naming the range (`microsoftCpcBidValid`), so an operator using the form is told; this arm
   * protects the endpoint from a caller that is not the form.
   * A blank `timeZone` is the same non-answer as an absent one: the client substitutes its
   * default, so the key is dropped rather than sent empty. Type-checked with `typeof` rather than
   * optional chaining, which guards a NULLISH receiver but not a wrong-TYPED one — `timeZone: 123`
   * from a direct caller would reach `.trim()` and answer a malformed body with a 500 instead of
   * the controlled refusal, exactly as the keyword and geo fields above already prevent.
   */
  private buildMicrosoftConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    if (!body?.microsoftConfig) return null;

    const { budgetUsd, cpcBid, timeZone, keywords, geoTargets, ...rest } = body.microsoftConfig;

    // Finite AND positive. `Number.isFinite` rejects NaN and both infinities; the client applies
    // the same test during dispatch, so failing here reports it as a refusal instead of a job
    // failure the user has to go looking for.
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > MICROSOFT_MAX_BUDGET) return null;

    // Non-empty AFTER trimming: a whitespace-only term is not a keyword Microsoft can match a
    // query against, so counting it would let a blank row satisfy the "at least one" rule and
    // produce the unservable campaign this guard exists to prevent.
    // Type-checked at RUNTIME, not just by the `CampaignCreateRequest` cast — the same reasoning
    // as `buildHubSpotConfig`, and for the same reason: this route has no body validator, so
    // `req.body` is asserted rather than parsed. Without these checks `keywords: {}` reaches
    // `.filter` and `geoTargets: [123]` reaches `.trim`, answering a malformed request with a 500
    // instead of the controlled "unconfigured" refusal. A wrong TYPE is the same non-answer as a
    // missing value and takes the same exit.
    if (!Array.isArray(keywords)) return null;
    // REJECT-ALL, not filter-and-continue. Upstream `validateKeywords` returns an error on the
    // first bad entry rather than dropping it, and matching that is a correctness requirement
    // rather than tidiness: filtering here meant a request carrying one good keyword and one
    // `Fuzzy` keyword dispatched a campaign targeting HALF what the operator asked for, and
    // reported success. `resolveGeoTargets` states the same rule for geo — "returning the partial
    // set would create a campaign targeted at some-but-not-all of the requested countries while
    // reporting success, and a caller cannot tell that from a full result."
    //
    // Control characters are ALSO refused upstream (any `unicode.IsControl` rune, checked
    // pre-trim) and would otherwise reach POST /Keywords verbatim, to be rejected only after the
    // campaign, ad group and ad exist. Checked pre-trim here for the same reason.
    const keywordsValid = keywords.every(
      (k) =>
        typeof k?.text === 'string' &&
        k.text.trim() !== '' &&
        [...k.text.trim()].length <= MICROSOFT_MAX_KEYWORD_TEXT_LENGTH &&
        // eslint-disable-next-line no-control-regex
        !/[\u0000-\u001F\u007F]/.test(k.text) &&
        MICROSOFT_MATCH_TYPES.has(k.matchType)
    );
    if (!keywordsValid) return null;
    const cleanKeywords = keywords as MicrosoftKeyword[];
    if (cleanKeywords.length === 0) return null;
    // The count cap is a refusal, not a truncation — dropping the 61st keyword would dispatch a
    // campaign targeting less than the operator asked for, the same harm as the filtering above.
    // Per-keyword LENGTH is checked in the `every` above, in RUNES via the spread, matching the
    // client's `utf8.RuneCountInString`; `.length` counts UTF-16 units and would count an emoji
    // double, rejecting a keyword the client accepts.
    if (cleanKeywords.length > MICROSOFT_MAX_KEYWORDS) return null;

    // Same REJECT-ALL rule as the keywords above, and upstream says why in `resolveGeoTargets`:
    // it "FAILS CLOSED. Every code must resolve; the first that does not aborts". Filtering here
    // turned `['US', 'USA']` into a US-only campaign that reported success — less targeting than
    // the operator asked for, with nothing saying so.
    //
    // Shape only: whether a well-formed code is an ASSIGNED country stays the client's call, since
    // it resolves each against Microsoft's own locations file. This refuses what cannot be a code.
    if (!Array.isArray(geoTargets)) return null;
    const cleanGeoTargets = geoTargets.map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : ''));
    if (!cleanGeoTargets.every((g) => META_GEO_CODE_PATTERN.test(g))) return null;
    if (cleanGeoTargets.length === 0) return null;
    if (cleanGeoTargets.length > MICROSOFT_MAX_GEO_TARGETS) return null;

    return {
      ...rest,
      budget: budgetUsd,
      keywords: cleanKeywords.map((k) => ({ text: k.text.trim(), matchType: k.matchType })),
      geoTargets: cleanGeoTargets,
      ...(Number.isFinite(cpcBid) && (cpcBid as number) >= MICROSOFT_MIN_CPC_BID && (cpcBid as number) <= MICROSOFT_MAX_CPC_BID ? { cpcBid } : {}),
      ...(typeof timeZone === 'string' && timeZone.trim() ? { timeZone: timeZone.trim() } : {}),
    };
  }

  /**
   * The email channel's config.
   *
   * A BLANK `sourceEmailId` returns null — i.e. UNCONFIGURED — rather than an object carrying an
   * empty string. Upstream requires it (`hubspot.go:281-283` refuses a blank one), so both paths
   * end in a refusal; the difference is where. Null makes `hasPlatformConfig` refuse locally with
   * "No configuration was built for: hubspot", naming the actual problem. Sending `''` instead
   * spends a round trip to learn the same thing, and the job is created before it fails.
   *
   * Trimmed because a whitespace-only id is the same non-answer as an absent one: upstream
   * `strings.TrimSpace`s it before the check, so `' '` would pass a truthiness test here and be
   * refused there — the precise split this guard exists to avoid.
   *
   * `utmCampaign` is only forwarded when non-blank — canonicalization, not a correctness guard.
   * An earlier version of this comment claimed a blank one would suppress the upstream default;
   * that was wrong. `utm.Resolve` (`internal/utm/resolve.go:47-60`) trims the value and falls
   * through to the name-derived slug when the result is empty, so `''`, `'  '` and absent all
   * resolve identically. Omitted anyway so the envelope carries only fields that mean something,
   * and so a reader cannot mistake an empty string for a deliberate override.
   *
   * This envelope is read ONLY by the cutover path. With the flags dark, `createCampaign` refuses
   * an email create outright rather than falling through — see the guard above the legacy call.
   * The legacy path does NOT fail loudly on `hubspot`: it records "Unsupported platform(s)" in an
   * errors array and then completes with nothing created, which is why the refusal is explicit.
   */
  private buildHubSpotConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    // Type-checked at runtime, not just by the `CampaignCreateRequest` cast. This route has no
    // body validator — `req.body` is asserted, not parsed — so a caller sending
    // `sourceEmailId: 123` reaches here as a number and `.trim()` throws a TypeError, answering a
    // malformed request with a 500 instead of the controlled "unconfigured" refusal. A wrong TYPE
    // is the same non-answer as a blank one, and both should take the same exit.
    const rawId = body?.hubspotConfig?.sourceEmailId;
    const sourceEmailId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!sourceEmailId) return null;

    const rawUtm = body.hubspotConfig?.utmCampaign;
    const utmCampaign = typeof rawUtm === 'string' ? rawUtm.trim() : '';
    return utmCampaign ? { sourceEmailId, utmCampaign } : { sourceEmailId };
  }
}
