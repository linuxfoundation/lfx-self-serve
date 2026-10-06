// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep path, NOT the `@lfx-one/shared/utils` barrel, and deliberately so: the barrel
// re-exports `form.utils`, which imports `@angular/forms`. A server spec that pulls the
// barrel in dies with "PlatformLocation needs to be compiled using the JIT compiler".
// Verified by switching to the barrel and watching the suite fail.
import { hasVisibleHtmlText, sanitizeDisplayText, stripResourceLoadingHtml } from '@lfx-one/shared/utils/html-utils';
import { canonicalHttpUrl } from '@lfx-one/shared/utils/url.utils';
import { normalizeSponsors } from '@lfx-one/shared/utils/campaign.utils';

import { NextFunction, Request, Response } from 'express';

import type {
  BulkKeywordActionRequest,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignBudgetType,
  CampaignBudgetUpdateRequest,
  CampaignBudgetUpdateResult,
  CampaignCreateRequest,
  CampaignDeliveryType,
  CampaignMetricsWindow,
  CampaignPlatform,
  CampaignSSEEventType,
  CampaignStatusUpdateRequest,
  CampaignStatusUpdateResult,
  CampaignToggleStatus,
  FlushableResponse,
  MicrosoftCampaignCreateRequest,
  MicrosoftKeyword,
} from '@lfx-one/shared/interfaces';
import {
  CAMPAIGN_DELIVERY_TYPES,
  CAMPAIGN_EMAIL_STAGES,
  CAMPAIGN_ETAG_HEADER_PATTERN,
  CAMPAIGN_METRICS_WINDOWS,
  CAMPAIGN_PLATFORMS,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_MAX_GEO_TARGETS,
  GOOGLE_ADS_MICROS_PER_UNIT,
  ISO_CALENDAR_DATE_PATTERN,
  LINKEDIN_MIN_DAILY_BUDGET_USD,
  LINKEDIN_MIN_LIFETIME_BUDGET_USD,
  MAX_BULK_KEYWORD_ACTIONS,
  MAX_HUBSPOT_BODY_HTML_LENGTH,
  META_GEO_CODE_PATTERN,
  MICROSOFT_CONTROL_CHAR_RE,
  MICROSOFT_MAX_BUDGET,
  MICROSOFT_MAX_CPC_BID,
  MICROSOFT_MAX_GEO_TARGETS,
  MICROSOFT_MAX_KEYWORDS,
  MICROSOFT_MAX_KEYWORD_TEXT_LENGTH,
  MICROSOFT_MIN_CPC_BID,
  VALID_CAMPAIGN_BUDGET_TYPES,
  VALID_CAMPAIGN_TOGGLE_STATUSES,
  isCanonicalGoogleAdsResourceId,
  isMicrosoftMatchType,
} from '@lfx-one/shared/constants';

import { META_ACCOUNTS, REDDIT_ACCOUNTS } from '../constants';
import { ServiceValidationError } from '../errors';
import { CampaignMetricsService, LinkedInMetricsService, MetaMetricsService, RedditMetricsService } from '../services/campaign-metrics.service';
import { validateScrapeUrl } from '../helpers/url-validation';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { getLinkedInConfig } from '../services/linkedin-ads.service';
import { CampaignProxyService } from '../services/campaign-proxy.service';
import { toAudienceDemographics, toKeywordMetricsResponse, windowForDays } from '../services/campaign-insights-mapper';
import { applyKeywordActionsViaCampaignService } from '../services/campaign-keyword-actions';
import { toUtmCreateResult, toUtmLookupResult } from '../services/campaign-utm-mapper';
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

      // BEFORE `createConfigEnvelope`, which sanitises both HubSpot bodies unconditionally. This
      // route has no body validator, so the only other bound on that input is express.json's
      // 15 MB limit — refusing an oversized body here keeps the sanitiser's cost bounded
      // independently of it.
      for (const field of ['bodyHtml', 'bodyHtmlB'] as const) {
        const value = body?.hubspotConfig?.[field];
        if (typeof value === 'string' && value.length > MAX_HUBSPOT_BODY_HTML_LENGTH) {
          next(
            ServiceValidationError.forField(`hubspotConfig.${field}`, `the email body exceeds the maximum length of ${MAX_HUBSPOT_BODY_HTML_LENGTH}`, {
              operation: 'campaign_create',
              service: 'campaign_controller',
            })
          );
          return;
        }
      }

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

      // Every pre-dispatch refusal below goes out as a bare `next(ServiceValidationError.forField(
      // ...))`, with no `logger.warning` beside it. `apiErrorHandler` already logs each one at WARN
      // — `getSeverity()` maps a validation error there, and `ServiceValidationError.getLogContext`
      // puts the field and the operator-facing reason in `validation_errors` — so a local warning
      // would be a second WARN line for one event. Bare `next` is also how the rest of this server
      // raises a named refusal (e.g. `meeting.controller.ts`'s `generate_agenda`).
      if (cutoverOn && platforms.includes('google-ads')) {
        // A gate google-ads fails before its first mutate, and one this request is responsible
        // for: `preflightCampaign` refuses a budget that rounds to zero micros ("campaign budget
        // must be > 0"). `buildGoogleAdsConfig` derives it from `budgetUsd` times the Search
        // share, so a zero (or absent) budget — or a share that multiplies out to zero — produces
        // exactly that refusal, reported as the opaque "platform campaign creation failed".
        // Named here so the operator sees the field instead.
        // Compared in MICROS, not as the raw float, because micros is the denomination upstream
        // actually judges: it scales by GOOGLE_ADS_MICROS_PER_UNIT, ROUNDS, and refuses a zero.
        // A positive budget below half a micro therefore survives a naive `> 0` test and is still
        // refused upstream — reachable here because `buildGoogleAdsConfig` derives this value from
        // `budgetUsd` TIMES the Search share, so a small budget on a small share multiplies down
        // into exactly that gap. Rounding the same way upstream does makes the refused set
        // identical to upstream's rather than a subset of it.
        //
        // `Math.round(NaN)` is `NaN` and every comparison against it is false, so a NaN budget
        // passes through rather than being refused here — deliberate, and the same choice the
        // LinkedIn guard below makes with its explicit `Number.isFinite` test. Meta's guard does
        // refuse a NaN, because its `!(budget > 0)` form mirrors the `> 0` test Meta itself
        // applies; that is the upstream contract differing, not these two guards disagreeing.
        // Either way no guard may be the only reason a create fails.
        const googleBudget = (configEnvelope['googleAdsConfig'] as { budget?: unknown } | undefined)?.budget;
        if (typeof googleBudget === 'number' && Math.round(googleBudget * GOOGLE_ADS_MICROS_PER_UNIT) < 1) {
          next(
            ServiceValidationError.forField(
              'budgetUsd',
              'the Google Ads budget must be greater than 0 — this one resolves to no spend at all once the Search share is applied. Set a larger budget and create again.',
              { operation: 'campaign_create', service: 'campaign_controller' }
            )
          );
          return;
        }
      }

      // LinkedIn enforces platform MINIMUMS, not just a positive budget: $10 for a daily budget
      // and $100 for a lifetime (total) one — `minDailyBudgetUSD` / `minLifetimeBudgetUSD` in
      // `internal/platform/linkedin/config.go`, enforced inside `CreateCampaign`
      // (`internal/platform/linkedin/client.go`) under the comment "Enforce LinkedIn's
      // per-campaign budget minimums BEFORE any POST". A $25 total budget is therefore a certain,
      // silent, pre-spend refusal today — and an entirely plausible thing for an operator to
      // enter, since nothing in the Implementation tab says the floor exists or that it moves
      // tenfold with the budget-type toggle.
      //
      // Both inputs are first-class on the request (`LinkedInCampaignCreateRequest.budgetUsd` /
      // `.lifetimeBudget`) and `buildLinkedInConfig` passes them through untouched, so the value
      // judged here is exactly the one the Go validator will see.
      if (cutoverOn && platforms.includes('linkedin-ads')) {
        const linkedInEnvelope = configEnvelope['linkedInConfig'] as { budgetUsd?: unknown; lifetimeBudget?: unknown } | undefined;
        const linkedInBudget = linkedInEnvelope?.budgetUsd;
        if (typeof linkedInBudget === 'number' && Number.isFinite(linkedInBudget)) {
          const isLifetime = linkedInEnvelope?.lifetimeBudget === true;
          const minimum = isLifetime ? LINKEDIN_MIN_LIFETIME_BUDGET_USD : LINKEDIN_MIN_DAILY_BUDGET_USD;
          // Compared against the ROUNDED value, matching the Go side, which validates the amount
          // it is about to put on the wire (`strconv.FormatFloat(.., 'f', 2, 64)`) rather than the
          // raw float. Comparing the raw value instead would refuse 99.999 on a lifetime budget —
          // a value Go rounds to 100.00 and accepts.
          const rounded = Math.round(linkedInBudget * 100) / 100;
          if (rounded < minimum) {
            next(
              ServiceValidationError.forField(
                'budgetUsd',
                `LinkedIn requires at least $${minimum} for a ${isLifetime ? 'total (lifetime)' : 'daily'} budget, and this campaign is set to $${rounded}. Raise the budget${isLifetime ? ` or switch it to a daily budget, which has a $${LINKEDIN_MIN_DAILY_BUDGET_USD} minimum` : ''} and create again.`,
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }
        }
      }

      // Google Ads resolves every country code against a CURATED map before its first mutate and
      // hard-errors on a miss — `validateGeoTargets` (`internal/platform/googleads/geo.go`):
      // "geo target %q is not a supported country code". The map holds 30 entries, and
      // `GOOGLE_ADS_GEO_TARGET_MAP` is the same 30 (verified code-for-code), which is why gating on
      // it cannot over-refuse: a code this guard rejects is one the dispatcher would reject too.
      //
      // The shape test in `buildGoogleAdsConfig` is not enough on its own. It admits any two-letter
      // code, so `PT` or `ZA` — well-formed, assigned, and offered nowhere in this map — passes the
      // builder, reaches Go, and comes back as the orchestrator's opaque "platform campaign
      // creation failed" with the real reason only in the pod log. Naming the code here is the
      // whole point of the guard; the builder stays shape-only so the two judgements do not drift.
      //
      // The count cap is upstream's too, and is checked BEFORE de-duplication there, so this one is
      // too: a list that is only over the cap because it repeats a code is still refused, which is
      // what the dispatcher does.
      if (cutoverOn && platforms.includes('google-ads')) {
        const googleGeoTargets = (configEnvelope['googleAdsConfig'] as { geoTargets?: unknown } | undefined)?.geoTargets;
        if (Array.isArray(googleGeoTargets)) {
          const unsupported = googleGeoTargets.filter((g): g is string => typeof g === 'string' && !(g in GOOGLE_ADS_GEO_TARGET_MAP));
          if (unsupported.length > 0) {
            next(
              ServiceValidationError.forField(
                'countryCode',
                `Google Ads cannot target ${unsupported.join(', ')} on this path. Pick a different country and create again.`,
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }

          if (googleGeoTargets.length > GOOGLE_ADS_MAX_GEO_TARGETS) {
            next(
              ServiceValidationError.forField(
                'countryCode',
                `Google Ads accepts at most ${GOOGLE_ADS_MAX_GEO_TARGETS} countries on one campaign, and this one has ${googleGeoTargets.length}. Remove some and create again.`,
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }
        }
      }

      // Meta refuses a non-positive budget before its first mutate ("invalid budget: must be a
      // positive number", `internal/platform/meta/client.go`), exactly as google-ads does above.
      // Microsoft's equivalent is already covered — `buildMicrosoftConfig` returns null for a
      // non-positive budget and `hasPlatformConfig` then names it — but Meta's builder only
      // RENAMES the key (`budgetUsd` becomes `budget`) and forwards whatever it was given, so
      // nothing between the form and the ad platform judges this value today.
      if (cutoverOn && platforms.includes('meta-ads')) {
        const metaBudget = (configEnvelope['metaConfig'] as { budget?: unknown } | undefined)?.budget;
        if (typeof metaBudget === 'number' && !(metaBudget > 0)) {
          next(
            // States the CONSTRAINT rather than reporting the submitted value. This route has no
            // body validator, so a direct caller can reach this branch with a negative budget,
            // and a message asserting it "is 0" would then describe a value the caller did not
            // send and hand them a remedy that does not match what they did.
            //
            // Judged as a raw float, where google-ads above is judged in micros. Meta's own floor
            // is one MINOR currency unit, whose scale depends on the ad account's currency — 100
            // for USD, 1 for JPY — and this application cannot see that currency (same gap the
            // builder's FX note describes). Mirroring the arithmetic would mean guessing the
            // offset, and guessing high refuses creates Meta accepts. Non-positive is the part
            // that is refused under every currency, so it is the only part asserted here.
            ServiceValidationError.forField(
              'budgetUsd',
              'the Meta Ads budget must be greater than 0 to fund a campaign. Set a budget above 0 and create again.',
              {
                operation: 'campaign_create',
                service: 'campaign_controller',
              }
            )
          );
          return;
        }
      }

      // Meta and Reddit both require the flight to END AFTER it starts, and both refuse before
      // their first mutate — `!endDate.After(startDate)` in each `CreateCampaign`
      // (`internal/platform/meta/client.go`, `internal/platform/reddit/client.go`). The
      // comparison is STRICT on both sides, so a one-day campaign entered as the same date twice
      // is refused, which is the likeliest way an operator trips this.
      //
      // Only these two are checked. Google and LinkedIn take no flight window on this path, and
      // `buildMicrosoftConfig` deliberately DROPS `startDate`/`endDate` because `microsoftConfig`
      // declares no scheduling fields — so a window that never reaches the wire must not be
      // judged here.
      //
      // Meta additionally refuses a start date already in the past, which is NOT replicated: it
      // compares against the pod's current UTC calendar day, so a create submitted near the date
      // boundary could be judged differently here than upstream. Refusing a create the platform
      // would have accepted is the one failure mode these guards must not have, so that case is
      // left to Go.
      for (const platform of ['meta-ads', 'reddit-ads'] as const) {
        if (!cutoverOn || !platforms.includes(platform)) continue;

        const envelopeKey = platform === 'meta-ads' ? 'metaConfig' : 'redditConfig';
        const schedule = configEnvelope[envelopeKey] as { startDate?: unknown; endDate?: unknown } | undefined;
        if (!this.isReversedFlightWindow(schedule?.startDate, schedule?.endDate)) continue;

        next(
          ServiceValidationError.forField(
            'endDate',
            `the campaign end date must be after its start date, and ${platform === 'meta-ads' ? 'Meta' : 'Reddit'} will refuse this flight. Set an end date at least one day after the start date and create again.`,
            { operation: 'campaign_create', service: 'campaign_controller' }
          )
        );
        return;
      }

      // EVERY enabled platform refuses a create whose STORED BRIEF has no usable registration
      // URL, and each refuses BEFORE its first mutate — so nothing is created on the ad account
      // and the operator sees only the orchestrator's opaque "platform campaign creation failed".
      // This is not a google-ads quirk; it was verified across all five:
      // google-ads `buildAdFinalURL` (`internal/platform/googleads/ad_copy.go`); microsoft's
      // `validateAdURL`, called from `campaign.go` with the comment "BEFORE the campaign is
      // created"; and the three `validateRegistrationURL` siblings in linkedin, meta and reddit,
      // each called from `CreateCampaign` ahead of any POST. The guard is therefore keyed on the
      // cutover arm, not on a platform selection.
      //
      // The Implementation tab makes Registration URL a `Validators.required` field, which reads
      // as "this value is being sent". It is not: the cutover create request below carries only
      // (briefId, projectSlug, platforms, configEnvelope, campaignTypes), and campaign-service
      // reads the destination exclusively from the brief it already stores — `decodeBriefFields`
      // takes `brief.url` and falls back to the nested `event_details.registrationUrl`
      // (`internal/dispatch/reddit.go`). Only the PLANNING tab ever persists that field.
      //
      // Refuse here instead, naming the field. This is a READ and a refusal, deliberately: the
      // brief is NOT patched from `body.registrationUrl`, because replacing a brief moves its
      // version and campaign-service gates the create on the brief still being approved AT the
      // version approval was read at (`internal/service/brief.go`, "brief is no longer approved
      // at the expected version"). A write here would trade one confusing failure for another.
      //
      // Refusing the WHOLE create rather than dropping the affected platform matches the contract
      // this file already keeps: `hasPlatformConfig` refuses every platform when ONE is
      // unconfigurable ("No configuration was built for: …") rather than quietly creating the
      // rest. A platform that cannot be satisfied is an operator input error, not a partial
      // outcome to absorb.
      //
      // Gated on an AD platform being selected, not on `cutoverOn` alone. Every platform surveyed
      // above is an ad platform; `hubspot` is also legal on this request, and its dispatcher never
      // reads the brief's destination at all — `internal/dispatch/hubspot.go` takes only an
      // OPTIONAL `ButtonURL` from `hubspotConfig`. The `platforms.includes('hubspot')` refusal
      // further down sits on the LEGACY arm, after this one, so an email-only create does reach
      // here. Without the predicate it would be refused for a field campaign-service would never
      // have looked at — refusing a create the platform would have accepted, which is the one
      // failure mode these guards must not have.
      if (cutoverOn && platforms.some((p) => p !== 'hubspot')) {
        const briefDestination = await this.readBriefDestinationUrl(req, typeof body?.eventSlug === 'string' ? body.eventSlug : '', projectSlug, briefId);
        // `read: false` means the brief lookup could not be ESTABLISHED, which is explicitly not a
        // refusal — this guard exists to name a knowable input error, never to add a new way for a
        // create to fail. Only a brief that was read and judged is acted on.
        if (briefDestination.read) {
          // Shape, not just emptiness. Each platform's validator requires an absolute http/https
          // URL with a hostname and no userinfo, so a registration URL typed without a scheme
          // ("agenticsday.org") is PRESENT and still refused upstream — invisible to a
          // present/absent check, and the likeliest way an operator-typed URL reaches here looking
          // fine. `describeDestinationUrl` mirrors those validators' judgement, so this can only
          // refuse what upstream was already going to refuse.
          const shape = this.describeDestinationUrl(briefDestination.url);
          if (shape !== 'ok' && shape !== 'ok-http') {
            next(
              ServiceValidationError.forField(
                'registrationUrl',
                shape === 'empty'
                  ? 'the saved brief has no registration URL, so the ad platforms have no destination for the paid traffic. Set Registration URL on the Planning tab and save the brief, then create again.'
                  : "the saved brief's registration URL is not a complete web address, so the ad platforms will refuse it. Set Registration URL on the Planning tab to a full https:// address and save the brief, then create again.",
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }

          // Meta alone requires HTTPS (`internal/platform/meta/client.go`, "registration URL must
          // use HTTPS"); the other four accept either scheme. So a plain-http brief URL is a
          // certain refusal for a create that selects Meta and a perfectly good one otherwise —
          // which is why the scheme is judged here, against the selection, rather than folded
          // into the shape check above and applied to everyone.
          if (shape === 'ok-http' && platforms.includes('meta-ads')) {
            next(
              ServiceValidationError.forField(
                'registrationUrl',
                "Meta Ads only accepts an https:// destination, and the saved brief's registration URL uses http://. Update Registration URL on the Planning tab to https:// and save the brief, then create again.",
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }
        }
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
    // The flag is necessary but NOT sufficient to route. With CREATE off — an ordinary
    // deployment state, whether from a staged rollout override or a pod that has not rolled yet —
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
      // On a FAILED job, carry the reason into the log and not just the verdict. `status` is
      // returned to the browser whole, so `error` and `platformResults` were always on the wire;
      // logging `status.status` alone left the server log saying `"error"` and nothing else, which
      // is what sends an operator to the pod logs for a reason the BFF already had in hand.
      logger.success(req, 'campaign_job_status', startTime, {
        jobId,
        status: status.status,
        source: viaCampaignService ? 'campaign_service' : 'in_process',
        ...(status.status === 'error' ? { job_error: status.error, platform_results: status.platformResults } : {}),
      });
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Read back the audiences campaign-service already holds for this brief.
   *
   * `project` and `brief_id` are PATH segments upstream and travel here as query params.
   */
  public async listAudiences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';

    if (projectSlug === '' || briefId === '') {
      next(
        ServiceValidationError.forField('project', 'project and brief_id are required', {
          operation: 'list_audiences',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'list_audiences', { projectSlug });

    try {
      const result = await this.campaignServiceClient.listAudiences(req, projectSlug, briefId);
      logger.success(req, 'list_audiences', startTime, { enabled: result.enabled, count: result.audiences?.length ?? 0 });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate email copy for a brief.
   *
   * A thin proxy to campaign-service, which owns generation (LFXV2-2775). `project` and
   * `brief_id` travel as query params because both are PATH segments upstream.
   */
  public async generateEmailCopy(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';

    if (projectSlug === '' || briefId === '') {
      next(
        ServiceValidationError.forField('project', 'project and brief_id are required', {
          operation: 'generate_email_copy',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'generate_email_copy', { projectSlug });

    try {
      // Forwarded, NOT validated here. Duplicating the stage's valid set in this layer would give
      // two sources of truth that drift -- the BFF is a thin proxy.
      //
      // An unknown stage is NOT rejected: LFXV2-1940 specifies a fallback, and the Goa enum that
      // would have refused a typo was removed for it, so campaign-service resolves an
      // unrecognised value to Registration Push and answers 200. This comment previously said it
      // "comes back as upstream's 400 naming the valid values", which contradicted the frontend's
      // comment on the same path and is no longer true of the contract.
      const rawStage = (req.body as { stage?: unknown } | undefined)?.stage;
      const stage = typeof rawStage === 'string' && rawStage.trim() !== '' ? rawStage.trim() : undefined;
      // `variant` follows the same forward-without-validating shape as `stage` above.
      const rawVariant = (req.body as { variant?: unknown } | undefined)?.variant;
      const variant = typeof rawVariant === 'string' && rawVariant.trim() !== '' ? rawVariant.trim() : undefined;
      // `segment` likewise. Independent of `variant` -- neither implies nor excludes the other.
      const rawSegment = (req.body as { segment?: unknown } | undefined)?.segment;
      const segment = typeof rawSegment === 'string' && rawSegment.trim() !== '' ? rawSegment.trim() : undefined;
      const result = await this.campaignServiceClient.generateEmailCopy(req, projectSlug, briefId, stage, variant, segment);
      logger.success(req, 'generate_email_copy', startTime, { enabled: result.enabled });
      res.json(result);
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
   * an error for the cutover to be dark — an ordinary deployment state, not a fault — and a
   * non-2xx would make the client's error arm fire on that case,
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
      // Only meaningful without an etag: it says the absence is DELIBERATE — the user proceeded
      // past a stale-brief warning, or restored a brief whose read carried no validator — rather
      // than "the write returned no validator", where nothing was shown and nothing was chosen.
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
      res.json({ status: 'off', briefId: null, brief: null, etag: null, approved: false } satisfies CampaignBriefLoadResult);
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

    // ABSENT means paid; an explicit unrecognised value is REJECTED. A caller predating this
    // parameter cannot say which surface it wants, and defaulting to paid is what keeps those
    // callers restoring exactly as before.
    //
    // The default is a wire convention, not a statement about the stored row: pre-field email
    // briefs exist and share this identity after the backfill
    // (linuxfoundation/lfx-self-serve#2214).
    //
    // An earlier revision also narrowed an explicit typo to paid, reasoning that failing closed
    // toward the pre-existing behavior could not expose a brief that was hidden before. True, and
    // beside the point: `?delivery_type=emial` then returns the PAID brief under a 200, which is a
    // confident answer to a question the caller did not ask. Upstream's `find-brief` restricts this
    // param to `paid-marketing | email`, so honouring a third value was never the contract — and
    // `stage` two lines below already rejects rather than narrows. The two now agree.
    // PRESENT-but-not-a-string is rejected before the absent-value default, matching
    // `getBriefMetrics`' handling of `window`. A repeated `?delivery_type=a&delivery_type=b`
    // arrives as an ARRAY, and a bare `typeof === 'string'` test collapses that to `''` — which is
    // indistinguishable from "omitted" and therefore silently answered with the PAID brief. The
    // same applies to `stage` below.
    for (const key of ['delivery_type', 'stage']) {
      if (req.query[key] !== undefined && typeof req.query[key] !== 'string') {
        next(
          ServiceValidationError.forField(key, `${key} must be a single value`, {
            operation: 'campaign_load_brief',
            service: 'campaign_controller',
            path: req.path,
          })
        );
        return;
      }
    }
    // PRESENCE, not emptiness. `?delivery_type=` is a parameter the caller SENT, and an empty
    // string is not one of the two values upstream accepts -- treating it as "omitted" answered a
    // malformed request with the paid brief. Absence is `undefined`; anything present must be one
    // of the two. Same rule as `stage` below, where `''` IS a legal value (the paid brief's stage)
    // and so is checked differently -- the asymmetry is in the contract, not in the handling.
    const deliveryTypeRaw = req.query['delivery_type'];
    const deliveryTypeParam = typeof deliveryTypeRaw === 'string' ? deliveryTypeRaw : '';
    if (deliveryTypeRaw !== undefined && deliveryTypeParam !== 'email' && deliveryTypeParam !== 'paid-marketing') {
      next(
        ServiceValidationError.forField('delivery_type', 'delivery_type must be one of: paid-marketing, email', {
          operation: 'campaign_load_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    // `stage` completes the key. Without it every lookup asked upstream for the empty stage, which
    // is the PAID brief's stage — so an email caller naming a real stage was answered `none` for a
    // brief sitting right there.
    //
    // A non-empty stage outside the list is REJECTED, not narrowed. An earlier revision folded it
    // to `''` and claimed that addressed the paid slot; it did not — `delivery_type` stayed
    // `email`, so the lookup addressed `(email, '')`, a real and different key, and the caller got
    // a confident answer about a brief it never asked for. Unlike `delivery_type` above, where
    // every unknown value collapses toward the one pre-existing surface and can expose nothing
    // that was hidden before, there is no "narrower" stage to fall back to: they are siblings, not
    // a hierarchy. Campaign-service rejects a bad stage at its own edge for the same reason, so
    // answering here keeps the two ends agreeing.
    //
    // The EMPTY string stays valid and means the paid brief's stage — that is an omitted `stage`,
    // not a malformed one.
    const stageParam = typeof req.query['stage'] === 'string' ? req.query['stage'] : '';
    if (stageParam !== '' && !(CAMPAIGN_EMAIL_STAGES as readonly string[]).includes(stageParam)) {
      next(
        ServiceValidationError.forField('stage', `stage must be one of: ${CAMPAIGN_EMAIL_STAGES.join(', ')}`, {
          operation: 'campaign_load_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const stage = stageParam;

    const deliveryType: CampaignDeliveryType = deliveryTypeParam === 'email' ? 'email' : 'paid-marketing';
    // The PAIR, matching campaign-service exactly. Each value is valid alone and the COMBINATION
    // is not: paid has no series, so its stage must be empty, and an email send is always some
    // stage. Upstream refuses both with a 400 (`campaign_briefs_delivery_stage_pair_valid` and the
    // service guard above it), so without this check the BFF forwards a request that cannot
    // succeed and relays an upstream error for something it could have named here.
    const pairIsValid = deliveryType === 'paid-marketing' ? stage === '' : (CAMPAIGN_EMAIL_STAGES as readonly string[]).includes(stage);
    if (!pairIsValid) {
      next(
        ServiceValidationError.forField(
          'stage',
          deliveryType === 'paid-marketing'
            ? 'a paid-marketing brief has no series, so stage must be empty'
            : `an email brief names one send in the series, so stage must be one of: ${CAMPAIGN_EMAIL_STAGES.join(', ')}`,
          { operation: 'campaign_load_brief', service: 'campaign_controller', path: req.path }
        )
      );
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_load_brief', { eventSlug, projectSlug, deliveryType });

    try {
      const result = await this.campaignServiceClient.loadBrief(req, eventSlug, projectSlug, deliveryType, stage);
      // `status` is logged on every arm, `unreadable` included: it is the one outcome that says
      // a stored brief exists and this build cannot open it, and nothing else would record it.
      logger.success(req, 'campaign_load_brief', startTime, { eventSlug, projectSlug, status: result.status, briefId: result.briefId });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Read campaign-service's own metrics and action items for one brief.
   *
   * Distinct from `getMonitorData` and its three per-platform siblings below, which query the ad
   * platforms directly and derive action items from FOUR rule engines in this BFF. Those engines
   * disagree with each other and with campaign-service on the low-CTR threshold, the impression
   * floor beneath which CTR is judged at all, and whether a paused campaign raises anything. This
   * route exposes the single-source version; nothing is cut over to it yet.
   *
   * The two are NOT interchangeable. The monitor routes are ACCOUNT-scoped — every campaign in
   * the ad account — while this is BRIEF-scoped. A consumer swapping one for the other narrows
   * what an operator sees, which is why `brief` is required rather than defaulted.
   *
   * `window` is optional and is NOT defaulted here, so campaign-service can resolve the default
   * PER ROW, PER PLATFORM: `defaultMetricsWindowFor` (`internal/service/brief.go`) runs inside
   * the fan-out and yields `last_7_days` for X Ads — whose stats endpoint caps a query at 7 days
   * — and `last_30_days` for everything else. An explicit window overrides that for EVERY row.
   *
   * So sending `last_30_days` on the caller's behalf would not fail the request; it would
   * DISCARD the per-platform fallback and turn a servable X row into an `unsupported` one, while
   * the other rows carried on unchanged. Losing a row quietly is the cost, not an error.
   *
   * An unrecognised value is refused rather than dropped: dropping it would silently serve a
   * different window than the caller asked for, and a caller cannot detect that from the
   * response, whose `window` field would report the default as though it had been requested.
   */
  public async getBriefMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    // `brief_id`, matching `listBriefCampaigns`, `createCampaign` and `persistBrief` — and matching
    // what `campaign.service.ts` already sends for `/api/campaigns/list`. A lone `brief` here would
    // give the first UI integration a spurious 400 for copying the established param pair.
    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';
    if (briefId.length === 0) {
      next(
        ServiceValidationError.forField('brief_id', 'a brief is required to read its campaign metrics', {
          operation: 'campaign_brief_metrics',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // Refused, not defaulted, for the reason `loadBrief` refuses: `/foundation/campaigns` is
    // reachable by an ED of any foundation, and a constant here would read another foundation's
    // brief on their behalf.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation: 'campaign_brief_metrics',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // ABSENT and MALFORMED are separated before the enum check, because collapsing them makes the
    // malformed case fail OPEN. A repeated `?window=a&window=b` arrives as an ARRAY, and a
    // `typeof === 'string'` test alone turns that into `''` — indistinguishable from "no window
    // given", so the enum check is skipped and the read proceeds on the per-platform default.
    // That is the substitution this method refuses by design: the response's own `window` field
    // would then report a period the caller never asked for, as though it had. `project` and
    // `brief` are safe from the same shape only because an array collapses to `''` and THEIR
    // guard refuses empty; `window` is legitimately optional, so it has no such backstop.
    // Matches the repeated-param handling `persistBrief`, `loadBrief` and `searchHubSpotEmails`
    // already carry.
    const windowParam = req.query['window'];
    if (windowParam !== undefined && typeof windowParam !== 'string') {
      next(
        ServiceValidationError.forField('window', 'window must be given at most once', {
          operation: 'campaign_brief_metrics',
          service: 'campaign_controller',
        })
      );
      return;
    }
    // PRESENT-BUT-EMPTY is malformed, not absent. `?window=` and `?window=%20` arrive as a string,
    // and treating them as "no window given" would skip the enum check and serve the default —
    // the same fail-open shape as the array case above, one layer in. Only an OMITTED parameter
    // may default; every supplied value must be in the enum.
    const rawWindow = windowParam === undefined ? undefined : windowParam.trim();
    if (rawWindow !== undefined && !CAMPAIGN_METRICS_WINDOWS.includes(rawWindow as CampaignMetricsWindow)) {
      next(
        ServiceValidationError.forField('window', `window must be one of: ${CAMPAIGN_METRICS_WINDOWS.join(', ')}`, {
          operation: 'campaign_brief_metrics',
          service: 'campaign_controller',
        })
      );
      return;
    }
    const window = rawWindow as CampaignMetricsWindow | undefined;

    const startTime = logger.startOperation(req, 'campaign_brief_metrics', { briefId, projectSlug, window });

    try {
      const result = await this.campaignServiceClient.getBriefMetrics(req, projectSlug, briefId, window);
      // `okCount` beside `rowCount` deliberately: they are the pair that says whether an empty
      // `action_items` is an all-clear or a blind spot, and a log carrying only the row count
      // would answer the easier question.
      logger.success(req, 'campaign_brief_metrics', startTime, {
        briefId,
        projectSlug,
        rowCount: result.rows.length,
        okCount: result.ok_count,
        actionItemCount: result.action_items.length,
      });
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

  /**
   * Keyword performance for the campaigns table.
   *
   * Behind `CampaignServiceInsights` this reads from campaign-service, scoped to the
   * project's OWN campaigns; with the flag off it keeps the legacy account-wide Google Ads
   * query. The cutover therefore makes the table SMALLER on a shared ad account, because the
   * rows it drops belong to other foundations — see the flag's own docs.
   *
   * The project is REQUIRED on the campaign-service arm and not defaulted: campaign-service
   * scopes by project, and `/foundation/campaigns` is reachable by an ED of any foundation,
   * so a fallback constant would report one foundation's keywords to another. The legacy arm
   * ignores the project entirely, which is precisely the leak being closed.
   */
  public async getKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceInsights);
    const startTime = logger.startOperation(req, 'campaign_keywords', { days, viaCampaignService });

    try {
      if (viaCampaignService) {
        const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
        if (projectSlug === '') {
          next(
            ServiceValidationError.forField('project', 'A project is required to read keywords', {
              operation: 'campaign_keywords',
              service: 'campaign_controller',
              path: req.path,
            })
          );
          return;
        }

        // The window is what campaign-service actually applies; effectiveDays is what the
        // response reports. They must come from the same call — deriving the label separately
        // is how a 30-day figure ends up labelled as 20 days.
        const { window, effectiveDays } = windowForDays(days);
        const payload = await this.campaignServiceClient.getGoogleAdsKeywords(req, projectSlug, window);
        const data = toKeywordMetricsResponse(payload, effectiveDays, new Date().toISOString());

        // `truncated` reaches the client through the response as well as this log line — the
        // totals are a subtotal over the capped slice, and both keyword consumers qualify what
        // they claim when it is set. It is logged too because the log is where a capped result
        // is visible to whoever is investigating a number, not just to whoever is looking at it.
        logger.success(req, 'campaign_keywords', startTime, {
          viaCampaignService: true,
          keywords: data.totalKeywords,
          // Upstream's own count alongside the converted one. They should agree; logging both
          // means a conversion that silently drops rows shows up as a disagreement here rather
          // than as a quietly shorter table.
          rowCount: payload.row_count,
          truncated: payload.truncated,
        });
        res.json(data);
        return;
      }

      const data = await this.metricsService.getKeywords(req, days);
      logger.success(req, 'campaign_keywords', startTime, { viaCampaignService: false });
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

    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceHubSpotUtm);
    // Read ONCE, above the branch, because BOTH producers emit the tokenless `found: true` shape
    // and both must gate it identically -- otherwise flipping the feature flag would change
    // whether an old bundle can be told a campaign is absent when it is not.
    const clientUnderstandsTokenlessFound = req.query['tokenless_found'] === '1';
    const startTime = logger.startOperation(req, 'hubspot_utm_lookup', { eventName, viaCampaignService });

    try {
      if (viaCampaignService) {
        const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
        if (projectSlug === '') {
          next(
            ServiceValidationError.forField('project', 'A project is required for HubSpot campaign lookup', {
              operation: 'hubspot_utm_lookup',
              service: 'campaign_controller',
              path: req.path,
            })
          );
          return;
        }

        const payload = await this.campaignServiceClient.searchHubSpotCampaigns(req, projectSlug, eventName);
        const result = toUtmLookupResult(payload, eventName, clientUnderstandsTokenlessFound);
        // `matches` is upstream's raw fuzzy count; `found` is whether one candidate was
        // CONFIDENT enough to auto-apply -- an exact normalized match, alone in that, from a
        // result set proven complete.
        //
        // Both are logged because the gap is diagnostic, but NOT as "noise". A large gap is the
        // normal shape for a weak, tied or capped search: candidates scored, none earned an
        // unattended apply. Reading it as noise would send someone tuning the scorer when the
        // right answer is that the operator picks (Copilot).
        logger.success(req, 'hubspot_utm_lookup', startTime, {
          viaCampaignService: true,
          // Guarded: `toUtmLookupResult` fail-closes on a malformed envelope (`{}` or a body with
          // no `campaigns` array) and returns `inconclusive: true` -- a TESTED safe path. Reading
          // `.length` off it unguarded threw a TypeError before `res.json(result)`, converting
          // that deliberate safe answer into a 500 (dealako, blocking).
          matches: Array.isArray(payload?.campaigns) ? payload.campaigns.length : null,
          found: result.found,
        });
        res.json(result);
        return;
      }

      const result = await this.proxyService.lookupHubSpotUtm(req, eventName, clientUnderstandsTokenlessFound);
      logger.success(req, 'hubspot_utm_lookup', startTime, { viaCampaignService: false, found: result.found });
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

    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceHubSpotUtm);
    const startTime = logger.startOperation(req, 'hubspot_utm_create', { eventName, viaCampaignService });

    try {
      if (viaCampaignService) {
        const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
        if (projectSlug === '') {
          next(
            ServiceValidationError.forField('project', 'A project is required to create a HubSpot campaign', {
              operation: 'hubspot_utm_create',
              service: 'campaign_controller',
              path: req.path,
            })
          );
          return;
        }

        // ALWAYS creates: upstream performs no duplicate check, deliberately, because a
        // search-then-create still races a concurrent caller. The UI searches and warns first.
        const created = await this.campaignServiceClient.createHubSpotCampaign(req, projectSlug, eventName);
        logger.success(req, 'hubspot_utm_create', startTime, { viaCampaignService: true, campaignId: created.id });
        res.json(toUtmCreateResult(created));
        return;
      }

      const result = await this.proxyService.createHubSpotUtm(req, eventName);
      logger.success(req, 'hubspot_utm_create', startTime, { viaCampaignService: false, created: result.created });
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

  /**
   * Age/gender/device breakdowns for the campaigns table.
   *
   * Same flag, same project requirement and same narrowing as `getKeywords` above.
   *
   * Campaign-service fails the whole read if any one breakdown fails rather than returning
   * the two that loaded, so there is no partial-success arm to handle here: an error is an
   * error, and a rendered pair of breakdowns is never a silently-missing third.
   */
  public async getAudience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceInsights);
    const startTime = logger.startOperation(req, 'campaign_audience', { days, viaCampaignService });

    try {
      if (viaCampaignService) {
        const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
        if (projectSlug === '') {
          next(
            ServiceValidationError.forField('project', 'A project is required to read audience demographics', {
              operation: 'campaign_audience',
              service: 'campaign_controller',
              path: req.path,
            })
          );
          return;
        }

        const { window, effectiveDays } = windowForDays(days);
        const payload = await this.campaignServiceClient.getGoogleAdsAudience(req, projectSlug, window);
        const data = toAudienceDemographics(payload, effectiveDays, new Date().toISOString());

        logger.success(req, 'campaign_audience', startTime, {
          viaCampaignService: true,
          buckets: payload.bucket_count,
        });
        res.json(data);
        return;
      }

      const data = await this.metricsService.getAudience(req, days);
      logger.success(req, 'campaign_audience', startTime, { viaCampaignService: false });
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

    // Bounded before grouping, because the cost is per CAMPAIGN in the body: each one is a
    // resolver call and then a mutation call, made sequentially while the request is held open.
    // Only a non-empty array was required here, so one authenticated request could amplify into
    // thousands of upstream calls against a live ad account and trip rate limiting that fails
    // campaigns for reasons unrelated to the request. The cap is above anything this UI can
    // produce, so it bounds abuse rather than the product.
    if (body.keywords.length > MAX_BULK_KEYWORD_ACTIONS) {
      next(
        ServiceValidationError.forField('keywords', `keywords array must contain at most ${MAX_BULK_KEYWORD_ACTIONS} rows`, {
          operation: 'keyword_actions',
          service: 'campaign_controller',
        })
      );
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
      // FORMAT too, not just presence. Campaign-service declares these ids as `^[0-9]+$`, so a
      // malformed one was refused upstream instead — and by then the rows AHEAD of it in the same
      // request have already been mutated, because the fan-out below is sequential. A keyword
      // REMOVE is irreversible, so a half-applied batch is not recoverable by retrying.
      //
      // Refusing the whole request here is what keeps it all-or-nothing, and matches the
      // reject-all rule the Microsoft keyword path already states: a partial application that
      // reports success is worse than a refusal the operator can act on.
      if (!isCanonicalGoogleAdsResourceId(kw.campaignId) || !isCanonicalGoogleAdsResourceId(kw.adGroupId) || !isCanonicalGoogleAdsResourceId(kw.criterionId)) {
        next(
          ServiceValidationError.forField('keywords', 'campaignId, adGroupId, and criterionId must each be a positive integer id', {
            operation: 'keyword_actions',
            service: 'campaign_controller',
          })
        );
        return;
      }
    }

    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceKeywordActions);
    const startTime = logger.startOperation(req, 'keyword_actions', { action: body.action, count: body.keywords.length, viaCampaignService });

    try {
      if (viaCampaignService) {
        const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
        if (projectSlug === '') {
          next(
            ServiceValidationError.forField('project', 'A project is required to change keywords', {
              operation: 'keyword_actions',
              service: 'campaign_controller',
              path: req.path,
            })
          );
          return;
        }

        const result = await applyKeywordActionsViaCampaignService(req, this.campaignServiceClient, projectSlug, body);
        logger.success(req, 'keyword_actions', startTime, {
          viaCampaignService: true,
          succeeded: result.succeeded,
          failed: result.failed,
        });
        res.json(result);
        return;
      }

      const result = await this.proxyService.executeKeywordActions(req, body);
      logger.success(req, 'keyword_actions', startTime, { viaCampaignService: false, succeeded: result.succeeded, failed: result.failed });
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
    // spending a round trip. It is NOT the exclusion boundary -- that is `supportedPlatforms`
    // just below.
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

  /**
   * Change a campaign's budget through campaign-service's `update-campaign-budget`, for the
   * Optimize tab.
   *
   * Only campaign-service can do this, so there is no legacy arm and no cutover flag. A campaign
   * is addressed by its campaign-service UUID alone. The checks below refuse what is malformed on
   * its face. Everything that depends on the campaign (platform support, the platform's own
   * minimum, shared budget, pacing mismatch, currency) is decided upstream, and its status and
   * message reach the caller unchanged through `apiErrorHandler`.
   */
  public async updateCampaignBudget(req: Request, res: Response, next: NextFunction): Promise<void> {
    const campaignId = req.params['campaignId'];

    if (!campaignId || !isCampaignServiceJobId(campaignId)) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId must be a campaign UUID', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const body = req.body as Partial<CampaignBudgetUpdateRequest>;

    // A real JSON number only. A numeric string is refused rather than coerced, and the value is
    // never rounded: it is in the ad account's own currency and goes upstream exactly as sent.
    // Upstream enforces the range and each platform's own minimum, and names the reason.
    if (typeof body.budget !== 'number' || !Number.isFinite(body.budget) || body.budget <= 0) {
      next(
        ServiceValidationError.forField('budget', 'budget must be a finite number greater than zero', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (typeof body.budgetType !== 'string' || !VALID_CAMPAIGN_BUDGET_TYPES.has(body.budgetType as CampaignBudgetType)) {
      next(
        ServiceValidationError.forField('budgetType', `budgetType must be one of: ${[...VALID_CAMPAIGN_BUDGET_TYPES].join(', ')}`, {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    // Refused rather than defaulted, for the same reasons as the status toggle: a guessed brief
    // addresses a route that 404s, and a missing If-Match is a 428 upstream.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof body.briefId === 'string' ? body.briefId.trim() : '';
    const etag = typeof body.etag === 'string' ? body.etag.trim() : '';
    if (!projectSlug) {
      next(
        ServiceValidationError.forField('project', 'project is required', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!briefId) {
      next(
        ServiceValidationError.forField('briefId', 'briefId is required to change a campaign budget', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!etag) {
      next(
        ServiceValidationError.forField('etag', 'etag is required so a concurrent edit cannot be overwritten', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    // The etag becomes the If-Match header. One fetch cannot send (an internal CR/LF, a character
    // above U+00FF) is rejected before any network I/O, and would surface as an UNCONFIRMED budget
    // write although nothing left the BFF. Refused here as the malformed input it is.
    if (!CAMPAIGN_ETAG_HEADER_PATTERN.test(etag)) {
      next(
        ServiceValidationError.forField('etag', 'etag must be a valid HTTP header value', {
          operation: 'campaign_budget_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const budgetType = body.budgetType as CampaignBudgetType;
    const startTime = logger.startOperation(req, 'campaign_budget_update', { campaignId, briefId, budgetType });

    try {
      const campaign = await this.campaignServiceClient.updateCampaignBudget(req, {
        projectSlug,
        briefId,
        campaignId,
        budget: body.budget,
        budgetType,
        etag,
      });
      // `platform`, `etag` and `serviceStatus` come from the ROW. The fresh etag is what lets the
      // caller make a second change without a 412. `budget` and `budgetType` echo the request: the
      // amount requested, which the platform accepted; the platform may hold it rounded to its
      // smallest settable unit.
      const result: CampaignBudgetUpdateResult = {
        platform: campaign.platform,
        campaignId,
        budget: body.budget,
        budgetType,
        etag: campaign.etag,
        serviceStatus: campaign.status,
      };
      logger.success(req, 'campaign_budget_update', startTime, { campaignId, budgetType, platform: result.platform });
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
   * Read the destination URL the STORED brief carries, for the pre-dispatch guard in
   * `createCampaign`.
   *
   * BY BRIEF ID whenever the request carries one, because that is the brief this create dispatches
   * against — `POST /projects/{project}/briefs/{brief_id}/campaigns`. The slug read is the
   * fallback, and only the fallback: `loadBrief` resolves `(project, event_slug, 'paid-marketing',
   * '')` to whichever row that key names now, which is normally the same brief and is not
   * guaranteed to be. Judging the slug's brief while dispatching the id's would let this guard
   * refuse a create over a URL belonging to a brief the request never mentioned — an over-refusal,
   * the one failure mode these guards must not have.
   *
   * Either read merges campaign-service's first-class `url` column over the copy nested in the
   * opaque `event_details` blob (`fromBriefResponse`), which is the same precedence the dispatcher
   * applies upstream — so what this returns is what google-ads' preflight will see.
   *
   * `read: false` means "could not be established", NOT "empty": nothing to look the brief up by,
   * no brief stored, a brief this build cannot open, or an upstream failure. The caller acts only
   * on `read: true`, so this guard can never invent a new failure for a create that would
   * otherwise have been dispatched.
   */
  private async readBriefDestinationUrl(req: Request, eventSlug: string, projectSlug: string, briefId = ''): Promise<{ read: boolean; url: string }> {
    const slug = eventSlug.trim();
    const id = briefId.trim();
    if ((slug === '' && id === '') || projectSlug === '') {
      // Worth a line rather than a silent `read: false`: an absent event slug means the create
      // request itself cannot identify the brief to check, which is a different problem from a
      // brief that exists and has no URL.
      logger.warning(req, 'campaign_create', 'cannot check the brief registration URL: no brief id or event slug, or no project, on the request', {
        hasBriefId: id !== '',
        hasEventSlug: slug !== '',
        hasProjectSlug: projectSlug !== '',
      });
      return { read: false, url: '' };
    }

    try {
      const stored =
        id !== ''
          ? await this.campaignServiceClient.loadBriefById(req, projectSlug, id)
          : await this.campaignServiceClient.loadBrief(req, slug, projectSlug, 'paid-marketing', '');
      if (stored.status !== 'loaded' || stored.brief === null) {
        logger.warning(req, 'campaign_create', 'cannot check the brief registration URL: no readable stored brief', {
          briefId: id,
          eventSlug: slug,
          projectSlug,
          // 'off' (briefs flag off), 'none' (nothing stored), or 'unreadable' (this build cannot
          // open what is stored) — each points somewhere different.
          loadStatus: stored.status,
        });
        return { read: false, url: '' };
      }

      return { read: true, url: (stored.brief.eventDetails?.registrationUrl ?? '').trim() };
    } catch (error) {
      logger.warning(req, 'campaign_create', 'could not read the saved brief to check its registration URL; dispatching anyway', {
        briefId: id,
        eventSlug: slug,
        projectSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { read: false, url: '' };
    }
  }

  /**
   * Whether a flight window is one Meta and Reddit will refuse for ending on or before its start.
   *
   * Answers only the question those two platforms' `CreateCampaign` asks — `!endDate.After(
   * startDate)` — and answers `false` for anything it cannot judge with certainty. That asymmetry
   * is the point: a `true` here refuses an operator's create, so it is returned ONLY for a window
   * whose two ends are both unambiguous and genuinely reversed.
   *
   * Hence the deliberately narrow accept: both values must be strings matching `YYYY-MM-DD` with
   * real calendar components (the round-trip check rejects `2026-02-31`, which `new Date` would
   * silently roll forward to March 3 and compare as a valid date). A value this cannot parse —
   * `2026-1-2`, a number, a timestamp with a time part — returns `false` and travels on to Go
   * rather than being refused here, because a malformed date is refused upstream anyway with a
   * message that names it, and judging it here could only ever turn a named refusal into this
   * guard's different one or, worse, refuse a shape Go would have accepted.
   *
   * Once both ends are known-valid zero-padded ISO dates, a lexicographic comparison orders them
   * identically to the `time.Time` comparison upstream, so no date arithmetic is needed.
   */
  private isReversedFlightWindow(rawStart: unknown, rawEnd: unknown): boolean {
    const asCalendarDate = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!ISO_CALENDAR_DATE_PATTERN.test(trimmed)) return null;
      // Round-trip through UTC to reject a well-formed string naming a day that does not exist.
      const parsed = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
    };

    const start = asCalendarDate(rawStart);
    const end = asCalendarDate(rawEnd);
    if (start === null || end === null) return false;

    return end <= start;
  }

  /**
   * Describe a destination URL the way google-ads' `buildAdFinalURL` judges it, for the guard in
   * `createCampaign`.
   *
   * Returns a short shape token rather than the URL itself, because the interesting question is
   * never "what is it" but "which of the platforms' refusals does it hit": each requires an
   * absolute http/https URL with a hostname and no userinfo
   * (`internal/platform/googleads/ad_copy.go`, and the `validateAdURL` /
   * `validateRegistrationURL` siblings in microsoft, linkedin, meta and reddit). A registration
   * URL saved without a scheme is PRESENT and non-empty yet still refused, and a present/absent
   * check cannot see that.
   *
   * `ok` and `ok-http` are BOTH accepted by four of the five platforms; they are reported apart
   * only because Meta additionally requires https (`internal/platform/meta/client.go`). Callers
   * that are not deciding for Meta must treat them the same, or a plain-http brief URL would be
   * refused for platforms that would have taken it.
   */
  private describeDestinationUrl(raw: string): string {
    const value = raw.trim();
    if (value === '') return 'empty';

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      // No scheme, or otherwise not absolute — the single most likely way an operator-typed URL
      // reaches this point looking fine and fails upstream.
      return 'not-absolute';
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `bad-scheme:${parsed.protocol}`;
    if (parsed.hostname === '') return 'no-hostname';
    if (parsed.username !== '' || parsed.password !== '') return 'has-userinfo';
    return parsed.protocol === 'https:' ? 'ok' : 'ok-http';
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
   * `channel: "demand-gen"` — not null. Since LFXV2-3257 ported `createDemandGenCampaign` into
   * campaign-service there is no Search campaign to split the budget with, so the whole amount
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
   * platform lands here — see `hasPlatformConfig`. The refusal must happen HERE: the caller
   * passes `platforms` through unfiltered, and campaign-service reads an absent config key as a
   * zero value, so an unrefused google-ads would dispatch with budget 0 and no headlines.
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

    // The operator's geo selection, which this builder used to DROP on the floor.
    //
    // campaign-service has carried `googleAdsConfig.geoTargets` since LFXV2-3283
    // (`internal/dispatch/googleads.go`), and the dispatcher passes it straight into the campaign's
    // location criteria. Omitting it is not neutral: the service ACCEPTS the empty case (so
    // pre-LFXV2-3283 callers keep working), logs "google ads campaign created with NO geo
    // targeting (it will serve wherever the ad account allows once enabled)", and creates a
    // campaign that serves worldwide. That warning is in the pod log, not in front of the operator
    // who picked a country on the Implementation tab and was never told it went nowhere.
    //
    // Normalized the way `buildMicrosoftConfig` normalizes its own list — same `META_GEO_CODE_PATTERN`,
    // same trim-and-uppercase, same `Array.isArray` guard, same shape-only judgement (whether a
    // well-formed code is one Google targets stays the upstream client's call). TWO deliberate
    // divergences, both of them the same cause: Microsoft's list is REQUIRED by its dispatcher and
    // arrives already normalized by the frontend, while Google's is OPTIONAL upstream and arrives
    // raw. So Google drops blanks (below) and accepts the empty result (further below); Microsoft
    // refuses both.
    //
    // `Array.isArray`, not `?? []`: this route has no body validator, so `geoTargets: {}` or a bare
    // `"US"` would otherwise reach `.map` and answer a malformed request with a 500. The Microsoft
    // sibling guards the same hazard the same way. A non-array takes the empty path rather than
    // `return null` — the divergence below applies here too, and an unreadable list is not grounds
    // to refuse a create Google accepts untargeted.
    const rawGeoTargets = Array.isArray(body.geoTargets) ? body.geoTargets : [];
    // Blanks are dropped BEFORE the shape test, which is the whole reason this is a filter and not
    // just a map. `countryCode` carries no validator on the Implementation tab and `canSubmit` does
    // not gate it, so a cleared or half-typed field arrives as `['']` — and `['']` failing the
    // pattern would refuse the entire create ("No configuration was built for: google-ads") for a
    // campaign that is simply untargeted, which upstream accepts (`dispatch/googleads.go:341`).
    //
    // Only BLANK STRINGS are dropped. A non-string survives the filter, maps to `''`, and fails the
    // shape test — a malformed body is still refused rather than quietly becoming an untargeted
    // campaign.
    const cleanGeoTargets = rawGeoTargets
      .filter((g) => typeof g !== 'string' || g.trim() !== '')
      .map((g) => (typeof g === 'string' ? g.trim().toUpperCase() : ''));

    // DIVERGENCE FROM THE MICROSOFT SIBLING, and it is the empty case only.
    //
    // Microsoft returns null on an empty list because its dispatcher REQUIRES geo targets, so an
    // empty list there is an unconfigurable platform. Google's does not: empty is a documented,
    // accepted input upstream. Refusing it here would convert every create that works today —
    // untargeted, but created — into "No configuration was built for: google-ads", which is a
    // regression dressed as a fix. Empty therefore omits the key and leaves today's behaviour
    // exactly as it is.
    //
    // A MALFORMED code is refused like the sibling refuses it. Dropping it silently would leave
    // the campaign untargeted while the operator believes they picked a market — the same
    // wrong-market defect, reached by a different road.
    if (!cleanGeoTargets.every((g) => META_GEO_CODE_PATTERN.test(g))) return null;

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
      return { budget: body.budgetUsd ?? 0, channel: 'demand-gen', ...(cleanGeoTargets.length > 0 ? { geoTargets: cleanGeoTargets } : {}) };
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
      // Omitted rather than sent empty, so the upstream default is reached by the same absent-key
      // route pre-LFXV2-3283 callers take. `geoTargets: []` and no key at all mean the same thing
      // to the dispatcher today; only one of them stays true if that default is ever tightened.
      ...(cleanGeoTargets.length > 0 ? { geoTargets: cleanGeoTargets } : {}),
    };
  }

  /**
   * LinkedIn's config, translated from `linkedInConfig` on the legacy request.
   *
   * Passing the legacy object through unchanged fails the dispatch twice over, which is why this
   * adapter exists at all:
   *
   * 1. `adAccountId` is DELETED, because forwarding it can only ever cost a create and can never
   *    win one.
   *
   *    The field is an assertion, never a selector. `internal/dispatch/linkedin.go:304-309` builds
   *    the runtime allowlist from the connection's own account alone and says so: "Do NOT append a
   *    caller-supplied adAccountId — that would defeat the client's cross-tenant fail-closed
   *    check... A caller override is therefore only honored when it MATCHES the connection's
   *    account." So of the three possible values, two are the same outcome and the third is a
   *    refusal: omitted uses the connection's account, a matching override uses the connection's
   *    account, and anything else fails the `adAccountID != "" && adAccountID != accountID` guard
   *    at `:322` with "cross-account campaigns are not allowed".
   *
   *    That matters because this app cannot tell which case it is in. The id the operator picked
   *    comes from `getLinkedInAccounts` (this controller, `:1496`) — note the `_req`: it ignores
   *    the project entirely and serves this application's own mounted
   *    `/etc/lfx-self-serve/linkedin/linkedin.json`. campaign-service compares against the
   *    PROJECT's connection row. Two unrelated sources, and nothing makes them agree per project.
   *    The form compounds it by auto-selecting `accounts[0]` when a restored id is not in the
   *    catalogue, so an untouched form forwards a global default that was never a human choice.
   *
   *    Deleting it is therefore not a lost opportunity to catch a mismatch — the mismatch this app
   *    can observe is not the one upstream checks. Naming a genuine mismatch needs the connection's
   *    chosen account, which campaign-service does not expose: `list-linkedin-ads-accounts` returns
   *    the credential-reachable superset ("ready to store as the connection's account_id"), and
   *    `monitor-linkedin-ads-account` takes the id as an input. Scoping the picker to the project's
   *    own connection is tracked separately; until then, letting the connection decide is both the
   *    pre-existing behaviour and the only one that cannot refuse a working create.
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

    const rest: Record<string, unknown> = { ...body.linkedInConfig };
    const runtime = getLinkedInConfig();

    delete rest['adAccountId'];

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

    const { budgetUsd, cpcBid, timeZone, keywords, geoTargets, startDate, endDate, ...rest } = body.microsoftConfig as MicrosoftCampaignCreateRequest & {
      startDate?: string;
      endDate?: string;
    };
    // Dropped, not forwarded. `microsoftConfig` declares NO scheduling fields (unlike `metaConfig`),
    // so `unmarshalPlatformConfig` would silently discard these — putting keys on the wire that
    // imply a flight the campaign never gets. Named here rather than left to `...rest` because a
    // direct caller can still send them: the legacy request shape carries dates for every other
    // platform, so they arrive by habit.
    void startDate;
    void endDate;

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
        !MICROSOFT_CONTROL_CHAR_RE.test(k.text) &&
        isMicrosoftMatchType(k.matchType)
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
    // SHAPE ONLY, deliberately. Whether a well-formed code is one Microsoft targets stays the
    // client's call: it validates against Microsoft's own country table and REFUSES THE CREATE
    // before anything is created, so an unknown code costs a clear upstream error rather than a
    // half-built campaign.
    //
    // Not tightened to this app's `ASSIGNED_COUNTRY_CODES`, and the reason is measured rather than
    // assumed: that list and Microsoft's genuinely diverge — `AN` is in Microsoft's table and not
    // in ours, and 23 codes (`CU`, `IR`, `KP`, `SY`, ...) are in ours and not Microsoft's. Gating
    // here on our list would SILENTLY DROP a code Microsoft accepts, which is the same
    // wrong-market defect `normalizeMicrosoftGeoTargets` exists to prevent. The cost of shape-only
    // is that a syntactically valid but unsupported code (`ZZ`) reaches upstream and fails the job
    // by name; the cost of the alternative is a campaign quietly targeting somewhere else.
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
   * A blank value does NOT suppress the upstream default:
   * `utm.Resolve` (`internal/utm/resolve.go:47-60`) trims the value and falls
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

    // The generated copy, forwarded rather than dropped. This mapper is an ALLOW-LIST -- anything
    // it does not name never reaches campaign-service -- and it named only the two original
    // fields, so a staged draft silently kept the cloned template's own subject and body while
    // the UI showed the generated ones. Observed live: draft 220597885197 went out with the
    // template's "Reminder: Complete your OpenSearch Ambassador application".
    //
    // Same runtime type check as `sourceEmailId` above, for the same reason: this route has no
    // body validator, so a non-string must take the "absent" exit rather than throw.
    // SANITIZED here, not only in the component. The client strips resource-loading markup
    // before staging, but this is a public API: a direct request never runs that code, so
    // trusting it made the browser-side sanitizer the only guard on a value that reaches the
    // recipient's mail client. Both HTML bodies go through `stripResourceLoadingHtml` and every
    // display-text field through `sanitizeDisplayText`, at the boundary, once.
    const rawSubject = body.hubspotConfig?.subject;
    const subject = sanitizeDisplayText(typeof rawSubject === 'string' ? rawSubject.trim() : '');
    // The destinations this request VOUCHES FOR, computed before the bodies because both bodies
    // are judged against them.
    //
    // An `<a href>` in a model-written body is a promise of a destination, and campaign-service
    // states in its api-catalog that its "every href must be the brief's url" prompt is "NOT an
    // enforced guarantee ... a caller needing certainty must check the returned body itself."
    // These two fields ARE that certainty: the operator-confirmed button destination and hero
    // link, already canonicalised. A body anchor pointing anywhere else keeps its text and loses
    // its link -- the same answer this handler gives a button with no usable url.
    const buttonUrl = canonicalHttpUrl(body.hubspotConfig?.buttonUrl);
    const heroLinkUrl = canonicalHttpUrl(body.hubspotConfig?.heroLinkUrl);
    // `buttonUrl`, which the client derives from `emailCtaDestination` -- the same signal its
    // preview vouches against, so the two agree by construction rather than by coincidence.
    //
    // Not `heroLinkUrl`: that is sent only when a hero image exists, so folding it in would make
    // this pass vouch for a host the preview did not.
    //
    // A request that sends no `buttonUrl` -- including one whose CTA label is empty, since the
    // client withholds the pair together -- vouches for nothing, and body links are dropped. That
    // is the conservative direction of the same rule: absent evidence is not permission.
    const allowedBodyDestinations = [buttonUrl].filter((url) => url !== '');

    const rawBody = body.hubspotConfig?.bodyHtml;
    const bodyHtml = stripResourceLoadingHtml(typeof rawBody === 'string' ? rawBody : '', allowedBodyDestinations).trim();

    // Same allow-list gap as subject/bodyHtml above, but for the preheader: unnamed here, it
    // would stay dropped even after the AI generates one, and a staged draft would keep the
    // clone source's own preview_text widget on a real send.
    const rawPreheader = body.hubspotConfig?.preheader;
    const preheader = sanitizeDisplayText(typeof rawPreheader === 'string' ? rawPreheader.trim() : '');

    // Same allow-list gap as above, but for the CTA button: the frontend has always sent
    // buttonText/buttonUrl when the AI generated a CTA, but neither was named here, so the
    // button never reached campaign-service and no draft ever got a button widget.
    const rawButtonText = body.hubspotConfig?.buttonText;
    const buttonText = sanitizeDisplayText(typeof rawButtonText === 'string' ? rawButtonText.trim() : '');

    // Same allow-list gap as above, but for the A/B test: the frontend has always sent these
    // three fields when the operator opted in, but none was named here, so `cfg.ABTestEnabled`
    // on the Go side was always false regardless of what the toggle showed in the UI.
    const abTestEnabled = body.hubspotConfig?.abTestEnabled === true;
    const rawSubjectB = body.hubspotConfig?.subjectB;
    const subjectB = sanitizeDisplayText(typeof rawSubjectB === 'string' ? rawSubjectB.trim() : '');
    const rawBodyB = body.hubspotConfig?.bodyHtmlB;
    // Variant B gets the SAME allow-list as A. B is not operator-authored in the general case:
    // `onGenerateAbTestCopy` calls the same `/email-copy` endpoint and writes the result straight
    // into the control, so a scraped page can steer a phishing href into B exactly as it can
    // into A. The client preview judges B against this same list, so preview and draft agree.
    const bodyHtmlB = stripResourceLoadingHtml(typeof rawBodyB === 'string' ? rawBodyB : '', allowedBodyDestinations).trim();
    const rawPreheaderB = body.hubspotConfig?.preheaderB;
    const preheaderB = sanitizeDisplayText(typeof rawPreheaderB === 'string' ? rawPreheaderB.trim() : '');

    // Same allow-list gap as above, but for the hero image and sponsor logos: campaign-service's
    // `hubspotConfig` (`internal/dispatch/hubspot.go`) has always accepted `heroImageUrl`,
    // `heroLinkUrl`, and `sponsors` and rendered each as its own module, but none was named here,
    // so the frontend baked their HTML into `bodyHtml` instead — HubSpot's rich-text sanitizer then
    // stripped the `<table>`/`<hr>` wrapper, leaving only one sponsor logo and no hosted hero image.
    const heroImageUrl = canonicalHttpUrl(body.hubspotConfig?.heroImageUrl);
    const sponsors = Array.isArray(body.hubspotConfig?.sponsors)
      ? // The logo goes through the SAME validator as the other link fields: it becomes an
        // `<img src>` in a sent email and is fetched server-side, so a non-empty check alone let
        // `javascript:` and `data:` reach that sink from a direct campaign-manager request.
        // preSliceFactor 2: bounds the work BEFORE the per-entry URL parse, so a direct
        // request cannot make this parse an unbounded list. The client's input is already
        // bounded, so it passes the default.
        normalizeSponsors(body.hubspotConfig.sponsors, 2)
      : [];

    // Each field is included only when set. Upstream treats all of these as OPTIONAL and leaves
    // the template's own value (or no button/variant) in place when a field is absent, so sending
    // "" would be a request to blank the draft rather than to leave it alone.
    return {
      sourceEmailId,
      ...(utmCampaign ? { utmCampaign } : {}),
      ...(subject ? { subject } : {}),
      // `hasVisibleHtmlText`, not truthiness: `.trim()` removes only whitespace-category characters,
      // so a body of zero-width spaces or a Hangul filler is non-empty as a STRING while
      // rendering blank. The service layer already judges the same question this way; asking it
      // differently here is what lets a body the service would reject still gate a hero block.
      ...(hasVisibleHtmlText(bodyHtml) ? { bodyHtml } : {}),
      // Sent as `previewText`, NOT `preheader`. campaign-service decodes this config into a
      // struct whose tag is `previewText` (internal/dispatch/hubspot.go), so a `preheader` key
      // is silently ignored by the Go decoder -- the generated preview text was dropped and the
      // cloned draft kept the template's own. The local field keeps its name; only the wire
      // key changes, which is the boundary this mapper exists to own.
      ...(preheader ? { previewText: preheader } : {}),
      // Hero, button and sponsors require a NON-BLANK bodyHtml, for the same reason the A/B gate
      // below requires both halves: the client gate stops the UI sending them without a body, but
      // a direct campaign-manager request bypasses it entirely — and this one is DATA LOSS rather
      // than a dropped field. campaign-service's RebuildEmailContent replaces the whole widget
      // tree, so a rebuild carrying a hero and no body drops the cloned template's body
      // (internal/dispatch/hubspot.go; TestHubSpot_APreheaderOnlyConfigLeavesTheDraftAlone).
      // Same predicate as the body-forwarding gate above, not `.trim()` truthiness. These two
      // gates ask the same question about the same value, so answering them differently is how
      // one gets fixed and the other keeps the bug: a body of zero-width spaces would forward no
      // `bodyHtml` yet still attach a hero and sponsors to it.
      ...(hasVisibleHtmlText(bodyHtml)
        ? {
            ...(buttonUrl ? { buttonUrl, ...(buttonText ? { buttonText } : {}) } : {}),
            ...(heroImageUrl ? { heroImageUrl, ...(heroLinkUrl ? { heroLinkUrl } : {}) } : {}),
            ...(sponsors.length > 0 ? { sponsors } : {}),
          }
        : {}),
      // BOTH halves, matching `abTestIsStageable` on the client. This is the boundary that
      // actually matters: the client gate stops the UI from sending a half-filled variant, but a
      // direct campaign-manager request bypasses it entirely, and upstream reads an empty string
      // as "blank this field" — so `||` here could still stage a variant whose body was cleared
      // by the very request meant to set it. Both are already trimmed above.
      // Renamed `preheaderB` -> `previewTextB` for the same reason `preheader` becomes
      // `previewText` above: the Go decoder reads the latter and silently drops the former.
      // Rides INSIDE the A/B gate and is dropped when blank -- upstream preserves the parent's
      // preview text for an absent value, so forwarding '' would BLANK B's preheader.
      ...(abTestEnabled && subjectB !== '' && hasVisibleHtmlText(bodyHtmlB)
        ? { abTestEnabled, subjectB, bodyHtmlB, ...(preheaderB !== '' ? { previewTextB: preheaderB } : {}) }
        : {}),
    };
  }
}
