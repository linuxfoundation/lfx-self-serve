// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep path, NOT the `@lfx-one/shared/utils` barrel, and deliberately so: the barrel
// re-exports `form.utils`, which imports `@angular/forms`. A server spec that pulls the
// barrel in dies with "PlatformLocation needs to be compiled using the JIT compiler".
// Verified by switching to the barrel and watching the suite fail.
import { hasVisibleHtmlText, sanitizeDisplayText, stripResourceLoadingHtml } from '@lfx-one/shared/utils/html-utils';
import { canonicalHttpUrl } from '@lfx-one/shared/utils/url.utils';
import { normalizeSponsors } from '@lfx-one/shared/utils/campaign.utils';
import { twitterTweetTextError } from '@lfx-one/shared/utils/campaign-twitter.utils';
import {
  googleAdsToUpperCode,
  googleCallExtensionRefusal,
  googlePriceExtensionRefusal,
  googlePromotionRefusal,
} from '@lfx-one/shared/utils/campaign-google-assets.utils';

import { NextFunction, Request, Response } from 'express';

import type {
  BulkKeywordActionRequest,
  CampaignAdSchedule,
  CampaignBidType,
  CampaignBidUpdateRequest,
  CampaignBidUpdateResult,
  CampaignBriefApproveResult,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignBudgetType,
  CampaignBudgetUpdateRequest,
  CampaignBudgetUpdateResult,
  CampaignCreateRequest,
  CampaignDeliveryType,
  CampaignDeviceBidModifier,
  CampaignListResult,
  CampaignMetricsWindow,
  CampaignNegativeKeywordInput,
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordsRequest,
  CampaignPlatform,
  CampaignProximityTarget,
  CampaignCallExtension,
  CampaignPriceExtension,
  CampaignPromotion,
  CampaignSitelink,
  CampaignStructuredSnippet,
  CampaignSSEEventType,
  CampaignMonitorConnections,
  CampaignServiceAccountMonitor,
  CampaignServiceMonitorProvider,
  CampaignStatusUpdateRequest,
  CampaignStatusUpdateResult,
  CampaignToggleStatus,
  FlushableResponse,
  GoogleAdsAccountOption,
  TwitterAdsAccountOption,
  TwitterAdsAccountsResult,
  TwitterCreateCapability,
  GoogleAdsGeoTargetSearchResult,
  GoogleAdsGeoTargetSuggestion,
  GoogleAdsRadiusUnit,
  GoogleCampaignChannel,
  GoogleCreativeFieldSpec,
  GoogleCreativeImageRef,
  MicrosoftCampaignCreateRequest,
  MicrosoftKeyword,
  TwitterCampaignCreateRequest,
  MicrosoftKeywordsWindow,
  MonitorConnectionAccount,
  MonitorConnectionPlatform,
} from '@lfx-one/shared/interfaces';
import {
  ACCOUNT_MONITOR_DEFAULT_DAYS,
  ACCOUNT_MONITOR_MAX_DAYS,
  ACCOUNT_MONITOR_MIN_DAYS,
  CAMPAIGN_BUDGET_X_CONFLICT_MESSAGE,
  CAMPAIGN_DELIVERY_TYPES,
  CAMPAIGN_EMAIL_STAGES,
  CAMPAIGN_ETAG_HEADER_PATTERN,
  CAMPAIGN_METRICS_WINDOWS,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_SERVICE_BUDGET_UNWRITABLE_MESSAGE_PREFIX,
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  DEFAULT_CAMPAIGN_BID_TYPE,
  GOOGLE_ADS_AGE_RANGES,
  GOOGLE_ADS_AGE_RANGE_MAP,
  GOOGLE_ADS_CUSTOM_AUDIENCE_RESOURCE_PATTERN,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_GENDERS,
  GOOGLE_ADS_GEO_SEARCH_BOUNDS,
  GOOGLE_ADS_GEO_SEARCH_COUNTRY_PATTERN,
  GOOGLE_ADS_GEO_SUGGESTION_ID_PATTERN,
  GOOGLE_ADS_GEO_TARGET_ID_PATTERN,
  GOOGLE_ADS_GEO_TARGET_MAP,
  GOOGLE_ADS_LANGUAGE_ID_PATTERN,
  GOOGLE_ADS_LANGUAGE_MAP,
  GOOGLE_ADS_MAX_AD_SCHEDULES,
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS,
  GOOGLE_ADS_MAX_BID_MODIFIER,
  GOOGLE_ADS_MAX_CALLOUTS,
  GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES,
  GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_ADS_MAX_DEVICE_BID_MODIFIERS,
  GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS,
  GOOGLE_ADS_MAX_FINAL_URL_BYTES,
  GOOGLE_ADS_MAX_GEO_TARGETS,
  GOOGLE_ADS_MAX_LANGUAGES,
  GOOGLE_ADS_MAX_PROXIMITY_TARGETS,
  GOOGLE_ADS_MAX_RADIUS,
  GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES,
  GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES,
  GOOGLE_ADS_MAX_SITELINKS,
  GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES,
  GOOGLE_ADS_MAX_SNIPPET_VALUES,
  GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS,
  GOOGLE_ADS_MAX_CALL_EXTENSIONS,
  GOOGLE_ADS_MAX_PRICE_EXTENSIONS,
  GOOGLE_ADS_MAX_PROMOTIONS,
  GOOGLE_ADS_MICROS_PER_UNIT,
  GOOGLE_ADS_MIN_BID_MODIFIER,
  GOOGLE_ADS_MIN_SNIPPET_VALUES,
  GOOGLE_ADS_RADIUS_UNITS,
  GOOGLE_ADS_SCHEDULE_DAYS,
  GOOGLE_ADS_SCHEDULE_MINUTES,
  GOOGLE_ADS_USER_LIST_RESOURCE_PATTERN,
  GOOGLE_AUDIENCE_SEGMENTS_RESTRICTED_CODE,
  GOOGLE_AUDIENCE_SEGMENTS_RESTRICTED_MESSAGE,
  GOOGLE_CAMPAIGN_CHANNELS,
  GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG,
  GOOGLE_CAMPAIGN_CHANNEL_LABELS,
  GOOGLE_CHANNELS_WITH_AD_EXTENSIONS,
  GOOGLE_CHANNELS_WITH_AD_SCHEDULES,
  GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS,
  GOOGLE_CHANNELS_WITH_CREATIVE,
  GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS,
  GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS,
  GOOGLE_CHANNELS_WITH_LANGUAGES,
  GOOGLE_CHANNELS_WITH_PROXIMITY,
  GOOGLE_CREATIVE_FIELD_SPECS,
  GOOGLE_CREATIVE_REQUEST_KEYS,
  GOOGLE_CUTOVER_ONLY_CREATE_FIELDS,
  GOOGLE_VIDEO_CREATE_SUPPORTED,
  GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON,
  ISO_CALENDAR_DATE_PATTERN,
  KEYWORD_ACTION_PLATFORMS,
  LINKEDIN_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  LINKEDIN_MIN_DAILY_BUDGET_USD,
  LINKEDIN_MIN_LIFETIME_BUDGET_USD,
  MAX_BULK_KEYWORD_ACTIONS,
  MAX_GOOGLE_CREATIVE_FIELD_LENGTH,
  MAX_GOOGLE_CREATIVE_LIST_ENTRIES,
  MAX_GOOGLE_CREATIVE_NESTED_LIST_ENTRIES,
  MAX_GOOGLE_CREATIVE_NESTED_LIST_TOTAL,
  MAX_HUBSPOT_BODY_HTML_LENGTH,
  MAX_KEYWORD_TARGETING_REVISION_LENGTH,
  MAX_NEGATIVE_KEYWORD_TEXT_LENGTH,
  MAX_NEGATIVE_KEYWORDS_PER_REQUEST,
  META_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  META_GEO_CODE_PATTERN,
  MICROSOFT_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  MICROSOFT_CONTROL_CHAR_RE,
  MICROSOFT_KEYWORDS_WINDOWS,
  MICROSOFT_MAX_BUDGET,
  MICROSOFT_MAX_CPC_BID,
  MICROSOFT_MAX_GEO_TARGETS,
  MICROSOFT_MAX_KEYWORDS,
  MICROSOFT_MAX_KEYWORD_TEXT_LENGTH,
  MICROSOFT_MIN_CPC_BID,
  MONITOR_ACCOUNT_SOURCE_CONNECTION,
  MONITOR_ACCOUNT_SOURCE_LEGACY,
  MONITOR_ACCOUNT_SOURCE_PARAM,
  MONITOR_CONNECTION_PROVIDERS,
  MONITOR_CUTOVER_LEGACY_MISMATCH_CODE,
  MONITOR_CUTOVER_MISMATCH_CODE,
  MONITOR_CUTOVER_MISMATCH_MESSAGE,
  MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE,
  MONITOR_SHARED_ACCOUNT_RESTRICTED_MESSAGE,
  NEGATIVE_KEYWORD_TEXT_PATTERN,
  REDDIT_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  TOGGLEABLE_CAMPAIGN_PLATFORMS,
  TWITTER_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  TWITTER_MAX_BUDGET,
  VALID_CAMPAIGN_BID_TYPES,
  VALID_CAMPAIGN_BUDGET_TYPES,
  VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES,
  VALID_CAMPAIGN_TOGGLE_STATUSES,
  googleAdsEchoed,
  googleAdsToLower,
  googleAdsDecodedText,
  googleAdsTrimSpace,
  googleAdsUrlGoParseFlaw,
  isCanonicalGoogleAdsResourceId,
  isCreativeAssetMimeType,
  isGoSpaceCode,
  isMicrosoftMatchType,
  sniffCreativeAssetMimeType,
} from '@lfx-one/shared/constants';

import { META_ACCOUNTS, REDDIT_ACCOUNTS } from '../constants';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { CampaignMetricsService, LinkedInMetricsService, MetaMetricsService, RedditMetricsService } from '../services/campaign-metrics.service';
import { validateScrapeUrl } from '../helpers/url-validation';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { getLinkedInConfig } from '../services/linkedin-ads.service';
import { CampaignProxyService } from '../services/campaign-proxy.service';
import { toAudienceDemographics, toKeywordMetricsResponse, toMicrosoftKeywordMetricsResponse, windowForDays } from '../services/campaign-insights-mapper';
import { applyKeywordActionsViaCampaignService } from '../services/campaign-keyword-actions';
import {
  toAccountMonitorClientError,
  toHubSpotEmailMonitorResponse,
  toLinkedInMonitorResponse,
  toMetaMonitorResponse,
  toMonitorConnectionAccount,
  toRedditMonitorResponse,
  toReportBackedMonitorResponse,
} from '../services/campaign-monitor-mapper';
import { toUtmCreateResult, toUtmLookupResult } from '../services/campaign-utm-mapper';
import {
  asResumeRefusal,
  CampaignServiceClient,
  canCreateMetaInstagramDsa,
  canCreateMicrosoftSchedule,
  canCreateTwitter,
  canCreateWithAudienceSegments,
  canCreateWithBidding,
  canCreateWithFinerGoogleGeo,
  canCreateWithGoogleCriteria,
  canSearchGoogleGeoTargets,
  canUseGoogleCreativeAssets,
  canUseLinkedInCreativeAssets,
  canUseMetaCreativeAssets,
  canUseMicrosoftCreativeAssets,
  canUseRedditCreativeAssets,
  deriveEventSlug,
  isCampaignServiceJobId,
  isCampaignServiceNotFound,
} from '../services/campaign-service.service';
import { logger } from '../services/logger.service';
import { personaDetectionService } from '../utils/persona-helper';
import { addShutdownHook, isShuttingDown } from '../utils/shutdown';

/** Platforms that support the campaign status toggle endpoint. */
const SUPPORTED_STATUS_PLATFORMS: ReadonlySet<CampaignPlatform> = new Set<CampaignPlatform>(['meta-ads', 'reddit-ads']);

/**
 * Platforms whose status toggle campaign-service can serve.
 *
 * DERIVED from the shared `TOGGLEABLE_CAMPAIGN_PLATFORMS` rather than listed, so the control the
 * UI offers and the request this route accepts cannot drift apart. That set is the create-enabled
 * platforms plus the ADOPTABLE ones, deliberately independent of `CAMPAIGN_PLATFORMS`' `disabled`
 * flag: the flag gates create, and X's create stays off while an adopted X campaign is live and
 * spending and campaign-service's `ToggleStatus` serves X. Excluding it would leave that spend
 * with no stop button here.
 *
 * Filtered through `CAMPAIGN_PLATFORMS` only to narrow the type to `CampaignPlatform`. HubSpot is
 * absent because it is in neither list: an email send has no run state to pause.
 */
const CAMPAIGN_SERVICE_STATUS_PLATFORMS: ReadonlySet<CampaignPlatform> = new Set<CampaignPlatform>(
  CAMPAIGN_PLATFORMS.filter((p) => TOGGLEABLE_CAMPAIGN_PLATFORMS.has(p.id)).map((p) => p.id)
);

/** Derived from the shared constant so the validation and its error message cannot drift apart. */
const SUPPORTED_DELIVERY_TYPES: ReadonlySet<string> = new Set(CAMPAIGN_DELIVERY_TYPES.map((d) => d.id));

const NUMERIC_ID_RE = /^\d+$/;

/**
 * One radius target as normalized for judgement and dispatch.
 *
 * Identical to {@link CampaignProximityTarget} except that `radiusUnit` is the caller's own string
 * rather than one of the two Google accepts — the body is unvalidated at that point, and narrowing
 * the type before the value has been judged would mean casting a lie. `createCampaign` refuses an
 * unknown unit by name, so what the builder dispatches always carries one of the two.
 */
type NormalizedProximityTarget = Omit<CampaignProximityTarget, 'radiusUnit'> & { radiusUnit: string };

/**
 * One ad schedule as normalized for judgement and dispatch.
 *
 * Widened from {@link CampaignAdSchedule} on the same reasoning as {@link NormalizedProximityTarget}
 * and in three places: `dayOfWeek` is the caller's own string rather than one of the seven Google
 * accepts, and the two minute fields are plain numbers rather than the four-value enum, because the
 * body is unvalidated at this point and narrowing a type before the value has been judged would
 * mean casting a lie. `createCampaign` refuses each by name, so what the builder dispatches always
 * carries a real day and real quarter-hours.
 *
 * `bidModifier` stays OPTIONAL rather than being zero-filled like every other field: upstream reads
 * an absent modifier as "listed but unadjusted" and `0` as the -100% opt-out, so the two must stay
 * distinguishable all the way to the wire.
 */
type NormalizedAdSchedule = Omit<CampaignAdSchedule, 'dayOfWeek' | 'startMinute' | 'endMinute'> & {
  dayOfWeek: string;
  startMinute: number;
  endMinute: number;
};

/**
 * One device bid modifier as normalized for judgement and dispatch.
 *
 * `device` is widened from {@link CampaignDeviceBidModifier}'s enum to the caller's own string, for
 * the same reason {@link NormalizedAdSchedule} widens its day of week: the body is unvalidated here
 * and narrowing a type before the value has been judged would mean casting a lie.
 *
 * `bidModifier` is widened the other way — from REQUIRED to optional — and that is the one place
 * this type must not be read as a copy of its ad-schedule sibling. There an absent modifier is the
 * ordinary case and must survive all the way to the wire; here an absent modifier is a REFUSAL, and
 * it is optional only so {@link googleDeviceBidModifierRefusal} can see the absence and name it.
 * Upstream's wire type carries a `*float64` for exactly this reason and `googleAdsDeviceBidModifiers`
 * (`internal/dispatch/googleads.go`) refuses the nil, because the client type it maps onto holds a
 * plain `float64` where `0` is the -100% opt-out — so an omitted modifier flattened to a zero would
 * stop the campaign serving on that device while reporting a successful create.
 */
type NormalizedDeviceBidModifier = Omit<CampaignDeviceBidModifier, 'device' | 'bidModifier'> & {
  device: string;
  bidModifier?: number;
};

/**
 * One hour-and-minute pair as `HH:MM`, for naming a window in a refusal.
 *
 * Hour 24 is printed as written rather than wrapped to `00`: it is the half-open window's
 * end-of-day, and wrapping it would misdescribe the two refusals that actually render it — the
 * overrun would read "ends at 00:15, past the end of the day", and an overlap would name the
 * window "MONDAY 09:00-00:00". Both would describe a different schedule than the caller wrote.
 * The empty-window refusal never renders hour 24: an end hour of 24 puts the end at 1440 or more
 * while a start hour of at most 23 puts the start at 1425 or less, so that branch cannot fire.
 *
 * Deliberately module-local, unlike the `googleAds*` helpers in `@lfx-one/shared/constants`. Those
 * exist because they reproduce a Go SEMANTIC the form and this guard must agree on — `TrimSpace`'s
 * NEL handling, Go's lowercasing, `url.Parse`'s flaw — so they are shared and separately specced.
 * This one reproduces nothing upstream does; it formats a server-side refusal string, and nothing
 * outside this file has a reason to render an ad schedule window.
 */
function googleAdsClockTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Which `googleAdsConfig` creative key each Google channel uses, and which of its fields are lists
 * rather than scalars — derived from the shared catalogue, never restated here.
 *
 * The normalizer below needs exactly two things per field: its name, and whether an array or a
 * string is the valid shape. Both are already stated in `GOOGLE_CREATIVE_FIELD_SPECS`, which the
 * Implementation tab reads to build the form that produces these bodies. Restating them here —
 * which this table used to do — meant the form and the normalizer could disagree about a field's
 * shape, and the disagreement would surface as a body Google rejects after the campaign already
 * exists. `display.longHeadline` is the live example: a **scalar** where Performance Max's
 * `longHeadlines` is a list.
 *
 * `images` is the subset of `lists` whose entries may also be a stored-asset ref
 * (`{ imageAssetId }`) — the fields the catalogue gives an image shape. `youtubeVideoIds` is a list
 * but not an image slot, so an object there is dropped as before.
 *
 * `video` has no entry on purpose — see `GOOGLE_VIDEO_CREATE_SUPPORTED`. `search` has none either:
 * its copy rides as top-level `headlines`/`descriptions`/`keywords`, not under a creative key.
 */
const GOOGLE_CREATIVE_FIELDS: Record<string, { key: string; lists: readonly string[]; images: readonly string[]; scalars: readonly string[] }> =
  Object.fromEntries(
    GOOGLE_CHANNELS_WITH_CREATIVE.map((channel) => {
      const fields: readonly GoogleCreativeFieldSpec[] = GOOGLE_CREATIVE_FIELD_SPECS[channel];
      return [
        channel,
        {
          key: GOOGLE_CREATIVE_REQUEST_KEYS[channel],
          lists: fields.filter((f) => f.kind === 'list').map((f) => f.control),
          images: fields.filter((f) => f.image !== undefined).map((f) => f.control),
          scalars: fields.filter((f) => f.kind === 'text').map((f) => f.control),
        },
      ];
    })
  );

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

    // Same reason as the create route's guard, and the shapes divide in two. An absent or null
    // body makes the field read below throw a TypeError, turning a malformed request into a 500
    // where every sibling returns a named 400. An array or a string does NOT throw — `[].url` and
    // `'x'.url` are both `undefined` — so it already reached the `url` guard and was refused, just
    // with a message about a missing field rather than a malformed body. Never over-refusal either
    // way: neither shape can carry a `url`.
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      _next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_generate_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
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

    // See the create route's guard. An absent or null body makes the field read below throw a
    // TypeError and return a 500 instead of a named 400; an array or a string does not throw and
    // was already refused by the `feedback` guard, only less legibly. Not over-refusal — neither
    // shape carries a `feedback`.
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      _next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
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

      // The same guard the other write handlers on this controller open with, and for the same
      // reason: `express.json()` leaves `req.body` UNDEFINED for a request that is not
      // `application/json` (and an array body survives it intact), so the cast below is a
      // statement about a value nothing has checked. Everything downstream that reads a field
      // off it is optional-chained, but the resource bound walks its keys — `Object.values(...)
      // .map((key) => [key, raw[key]])` — and that throws on undefined, turning a malformed
      // request into a 500 where every sibling returns a named 400. Not over-refusal: a body
      // that is not an object carries no `platforms`, so neither the cutover nor the legacy path
      // could have created anything from it.
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        next(
          ServiceValidationError.forField('body', 'request body must be a JSON object', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      const body = req.body as CampaignCreateRequest;
      const platforms = Array.isArray(body?.platforms) ? body.platforms : [];

      // Google audience segments are ROOT-ONLY until a user list can be mapped to a project. Every
      // foundation's Google Ads connection points at one shared LF customer, so a segment is a
      // resource name on THAT account, and a non-root operator could name another foundation's list
      // (campaign-service refuses to list user lists on the shared account for the same reason,
      // linuxfoundation/lfx-v2-campaign-service#411). First of every guard, so nothing is
      // normalised, judged or created for a caller who may not send the field at all, and on either
      // path: the legacy creator drops the list, but the request still asked for it.
      //
      // A 403 with a code, not a 400 naming the field: the body is well formed and the refusal is
      // about WHO is asking, which is how `requireSharedAccountMonitorAccess` answers the same
      // shared-account question for reads. Any present value other than an empty list counts as
      // carrying segments, so a malformed one cannot slip past to a shape refusal a non-root caller
      // could probe with.
      const rawSegments = body?.audienceSegments as unknown;
      const carriesSegments = rawSegments !== undefined && rawSegments !== null && !(Array.isArray(rawSegments) && rawSegments.length === 0);
      if (platforms.includes('google-ads') && carriesSegments && !(await this.isRootCampaignPrincipal(req))) {
        next(
          new AuthorizationError(GOOGLE_AUDIENCE_SEGMENTS_RESTRICTED_MESSAGE, {
            operation: 'campaign_create',
            service: 'campaign_controller',
            path: req.path,
            code: GOOGLE_AUDIENCE_SEGMENTS_RESTRICTED_CODE,
          })
        );
        return;
      }
      // Then, for a caller who MAY send them, refused rather than dropped when the serving create
      // path cannot carry them — the `bidding` reasoning below. Only campaign-service reads the key;
      // the legacy creator would create the campaign without the user lists and report success. The
      // form never sends them in that state (`googleAudienceSegmentsEnabled` is false there), but a
      // capability read and a create can land on pods with different flags mid-rollout.
      if (platforms.includes('google-ads') && carriesSegments && !canCreateWithAudienceSegments()) {
        next(
          ServiceValidationError.forField('audienceSegments', 'Google audience segments are not enabled on this deployment; omit audienceSegments', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // BEFORE `createConfigEnvelope`, which sanitises both HubSpot bodies unconditionally. This
      // route validates the body's SHAPE only — no field schema — so the only other bound on that
      // input is express.json's
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

      // The same bound for the other half of this handler. `googleCreative`, `googleBidding` and
      // `googleCallouts` filter, trim and re-allocate every string they are handed, and nothing upstream of them
      // bounds the count — so this runs before `createConfigEnvelope` for the reason the HubSpot
      // check above does.
      const oversizedGoogleField = this.oversizedGoogleCreativeField(body);
      if (oversizedGoogleField !== null) {
        next(
          ServiceValidationError.forField(oversizedGoogleField.field, oversizedGoogleField.message, {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // A `bidding` object (#3299) is refused, not dropped, when this deployment cannot honour it.
      // Neither creator that would serve it reads the key — the legacy one never did, and a
      // campaign-service without linuxfoundation/lfx-v2-campaign-service#332 ignores it — so either
      // would create the campaign on automatic bidding while the request asked for a manual bid.
      // The form never sends it in that state (`biddingEnabled` hides the control); this protects
      // the endpoint from a caller that is not the form. Forwarded untouched otherwise:
      // campaign-service validates it and answers a broken one with a 400 naming the field.
      const unservedBiddingField = this.unservedBiddingField(body);
      if (unservedBiddingField !== null) {
        next(
          ServiceValidationError.forField(unservedBiddingField, 'bidding options are not enabled on this deployment; omit bidding to use automatic bidding', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // Postal-code ids and radius targets are refused, not dropped, on the same terms as `bidding`
      // above — and dropping them is worse than dropping a bid. The legacy creator resolves
      // `geoTargets` through the 30-country map and skips every other entry, and never reads
      // `proximityTargets`, so a postal-only or radius-only campaign would be created with NO
      // location limit. The form never sends them in that state (`googleCreativeEnabled` hides both
      // controls and the create is blocked while any are held); this protects the endpoint.
      const unservedGoogleGeoField = this.unservedGoogleGeoField(body);
      if (unservedGoogleGeoField !== null) {
        next(
          ServiceValidationError.forField(
            unservedGoogleGeoField,
            'Google postal-code and radius targeting is not enabled on this deployment; target countries instead',
            {
              operation: 'campaign_create',
              service: 'campaign_controller',
            }
          )
        );
        return;
      }

      // X is refused, not dropped, while this deployment cannot create there — the same rule as
      // `bidding` above, applied to a whole platform. The legacy creator has no X path, so with the
      // cutover dark the X half of a request would vanish while the rest went ahead, and
      // `CampaignServiceTwitterCreate` off is a product answer that X creation is not open. The form
      // never sends either in that state (`twitterCreateEnabled` keeps X unselectable and blocks a
      // held one); this protects the endpoint from a caller that is not the form.
      const unservedTwitterField = this.unservedTwitterField(body);
      if (unservedTwitterField !== null) {
        next(
          ServiceValidationError.forField(unservedTwitterField, 'X campaign creation is not enabled on this deployment; remove twitter-ads and twitterConfig', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // With X enabled, each `twitterConfig` field is judged here by name, before anything is
      // queued, for the reason Microsoft's are judged by its builder: campaign-service refuses every
      // one of these during dispatch, after the job exists, which reaches the operator as a failed
      // job rather than as an error on the request they just made.
      const twitterRefusal = this.twitterConfigRefusal(body);
      if (twitterRefusal !== null) {
        next(
          ServiceValidationError.forField(twitterRefusal.field, twitterRefusal.message, {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // The rest of the Google criteria and ad extensions, refused, not dropped, on the same terms as
      // the postal-code ids above (#3692). The legacy creator reads none of them, so a create carrying
      // `deviceBidModifiers: [{ device: 'MOBILE', bidModifier: 0 }]` would serve on mobile anyway and
      // report success. Every guard that judges these fields sits behind `cutoverOn` below, so this
      // is the only check they get with the cutover dark — a supported state during a safe deploy
      // or a rollback. The form never sends them in that state (`googleCreativeAvailable` hides
      // every one of these sections); this protects the endpoint.
      const unservedGoogleCriteria = this.unservedGoogleCriteriaField(body);
      if (unservedGoogleCriteria !== null) {
        next(
          ServiceValidationError.forField(
            unservedGoogleCriteria.field,
            `Google ${unservedGoogleCriteria.label} cannot be applied while campaign creation is not served by campaign-service on this deployment; omit ${unservedGoogleCriteria.field}`,
            {
              operation: 'campaign_create',
              service: 'campaign_controller',
            }
          )
        );
        return;
      }

      // Microsoft flight dates are refused, not dropped, on the same terms as `bidding` above.
      // Neither creator that would serve them reads the keys — the legacy one never did, and a
      // campaign-service without linuxfoundation/lfx-v2-campaign-service#409 ignores them — so
      // either would create the campaign with no flight while the request set one. The form never
      // sends them in that state (`microsoftScheduleEnabled` withholds them). Forwarded untouched
      // otherwise, as Meta's are: campaign-service judges the format and fails the job on a bad one.
      const unservedMicrosoftScheduleField = this.unservedMicrosoftScheduleField(body);
      if (unservedMicrosoftScheduleField !== null) {
        next(
          ServiceValidationError.forField(
            unservedMicrosoftScheduleField,
            'Microsoft flight dates are not enabled on this deployment; omit startDate and endDate from microsoftConfig',
            {
              operation: 'campaign_create',
              service: 'campaign_controller',
            }
          )
        );
        return;
      }

      // The Meta Instagram id and EU DSA disclosures are refused, not dropped, on the same terms.
      // Off means either the legacy creator serves (it never reads them) or the deployed
      // campaign-service predates linuxfoundation/lfx-v2-campaign-service#414's EU rule; the form never sends them in that state
      // (`metaInstagramDsaEnabled` hides the inputs). Forwarded untouched otherwise: campaign-service
      // judges them, and answers a missing or malformed one with a 400 before any job exists.
      const unservedMetaInstagramDsaField = this.unservedMetaInstagramDsaField(body);
      if (unservedMetaInstagramDsaField !== null) {
        next(
          ServiceValidationError.forField(
            unservedMetaInstagramDsaField,
            'The Meta Instagram account and EU DSA fields are not enabled on this deployment; omit instagramUserId, dsaBeneficiary and dsaPayor from metaConfig',
            {
              operation: 'campaign_create',
              service: 'campaign_controller',
            }
          )
        );
        return;
      }

      // A stored Google image is refused, not dropped, on the same terms as the Meta one below: the
      // normalizer would otherwise forward it to a service that ignores it, or drop it, and either
      // way the campaign would launch without the image the operator picked.
      const unservedGoogleAssetField = this.unservedGoogleAssetField(body);
      if (unservedGoogleAssetField !== null) {
        next(
          ServiceValidationError.forField(unservedGoogleAssetField, 'uploaded Google images are not enabled on this deployment; supply an image URL instead', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // An uploaded Meta image is refused, not dropped, on the same terms as the Reddit one below.
      const unservedMetaAssetField = this.unservedMetaAssetField(body);
      if (unservedMetaAssetField !== null) {
        next(
          ServiceValidationError.forField(unservedMetaAssetField, 'uploaded Meta images are not enabled on this deployment; supply an image URL instead', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // An uploaded LinkedIn image, likewise.
      const unservedLinkedInAssetField = this.unservedLinkedInAssetField(body);
      if (unservedLinkedInAssetField !== null) {
        next(
          ServiceValidationError.forField(unservedLinkedInAssetField, 'uploaded LinkedIn images are not enabled on this deployment; remove the image', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // An uploaded Microsoft image, likewise.
      if (this.unservedMicrosoftAssetField(body)) {
        next(
          ServiceValidationError.forField('microsoftConfig.imageAssetId', 'uploaded Microsoft images are not enabled on this deployment; remove the image', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      // An uploaded Reddit image is refused, not dropped, when this deployment cannot use it — the
      // same reasoning as `bidding` above. The form never sends it in that state
      // (`redditAssetUploadEnabled` hides the upload control).
      const unservedRedditAssetField = this.unservedRedditAssetField(body);
      if (unservedRedditAssetField !== null) {
        next(
          ServiceValidationError.forField(unservedRedditAssetField, 'uploaded Reddit images are not enabled on this deployment; supply an image URL instead', {
            operation: 'campaign_create',
            service: 'campaign_controller',
          })
        );
        return;
      }

      const configEnvelope = this.createConfigEnvelope(body);

      // The channel the Google config resolved to, read ONCE for every channel fence below rather
      // than re-read and re-cast by each of them. `unknown`, not the channel union: it is whatever
      // `buildGoogleAdsConfig` put there, and each fence checks it is a string before using it.
      const googleChannel: unknown = (configEnvelope['googleAdsConfig'] as { channel?: unknown } | undefined)?.channel;

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
      // `GOOGLE_ADS_GEO_TARGET_MAP` is the same 30 (verified code-for-code), so no COUNTRY CODE this
      // guard rejects is one the dispatcher would accept.
      //
      // Upstream's `resolveGeoEntry` also accepts a raw NUMERIC geo target constant id in this list —
      // how a caller addresses a city, region, metro or postal code — and the Implementation tab now
      // sends one for every postal-code target the operator adds, after the country chips. Such an
      // id is judged the way upstream judges it: for its canonical SHAPE only, never against the
      // country map. Whether 9031945 names a real postal code needs Google, and upstream's own
      // comment declines that lookup ("a well-formed id naming nothing is refused by Google at the
      // criteria mutate"), so this guard cannot do better than the shape either.
      //
      // The shape test in `buildGoogleAdsConfig` is not enough on its own. It admits any two-letter
      // code, so `PT` or `ZA` — well-formed, assigned, and offered nowhere in this map — passes the
      // builder, reaches Go, and comes back as the orchestrator's opaque "platform campaign
      // creation failed" with the real reason only in the pod log. Naming the code here is the
      // whole point of the guard; the builder stays shape-only so the two judgements do not drift.
      //
      // The count cap is upstream's too, counted across BOTH spellings together because upstream
      // counts the one list, and is checked BEFORE de-duplication there, so this one is too: a list
      // that is only over the cap because it repeats an entry is still refused, which is what the
      // dispatcher does.
      if (cutoverOn && platforms.includes('google-ads')) {
        const googleGeoTargets = (configEnvelope['googleAdsConfig'] as { geoTargets?: unknown } | undefined)?.geoTargets;
        if (Array.isArray(googleGeoTargets)) {
          const entries = googleGeoTargets.filter((g): g is string => typeof g === 'string');
          // A numeric entry that is not the canonical spelling of a positive id — `02840`, `0`, a
          // 21-digit run — is refused by upstream before any mutate, with its own message, so it is
          // named here with that message rather than reported as an unsupported country.
          const nonCanonical = entries.find((g) => GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(g) && !isCanonicalGoogleAdsResourceId(g));
          if (nonCanonical !== undefined) {
            next(
              ServiceValidationError.forField(
                'geoTargets',
                `Google Ads location ${googleAdsEchoed(nonCanonical)} is not the canonical spelling of a positive geo target constant id. Use the id with no leading zeros and create again.`,
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }

          const unsupported = entries.filter((g) => !GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(g) && !(g in GOOGLE_ADS_GEO_TARGET_MAP));
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
              // `geoTargets`, not `countryCode`: the list now holds postal-code ids as well as countries.
              ServiceValidationError.forField(
                'geoTargets',
                `Google Ads accepts at most ${GOOGLE_ADS_MAX_GEO_TARGETS} countries and postal codes together on one campaign, and this one has ${googleGeoTargets.length}. Remove some and create again.`,
                { operation: 'campaign_create', service: 'campaign_controller' }
              )
            );
            return;
          }
        }

        // `validateGeoPlan`'s remaining steps, in ITS order: the EXCLUSION list resolves after the
        // targeted one, then the both-lists clash, then the Demand Gen proximity fence, then the
        // radius targets themselves. Every one of these would otherwise reach the operator as the
        // orchestrator's opaque "platform campaign creation failed", with the real reason only in
        // the pod log.
        const rawExcludedGeoTargets = body?.excludedGeoTargets;
        if (rawExcludedGeoTargets !== undefined && rawExcludedGeoTargets !== null) {
          const refuseExcluded = (message: string): void =>
            next(ServiceValidationError.forField('excludedGeoTargets', message, { operation: 'campaign_create', service: 'campaign_controller' }));
          // Go decodes `excludedGeoTargets` into a `[]string`, so a non-list or a non-string entry
          // is refused before `resolveGeoList` runs. Reading either as absent would create a
          // campaign that serves in a market the operator explicitly asked it to stay out of.
          if (!Array.isArray(rawExcludedGeoTargets) || rawExcludedGeoTargets.some((g) => typeof g !== 'string')) {
            refuseExcluded('Google Ads excluded locations must be a list of country codes or numeric geo target constant ids.');
            return;
          }

          const excluded = this.googleUpperCodeList(rawExcludedGeoTargets);
          // NO CHANNEL FENCE, and the omission is deliberate: `validateGeoPlan` applies none to the
          // exclusion list, so exclusions reach every channel including Demand Gen. Gating them the
          // way languages and proximity are gated would refuse creates upstream accepts.
          //
          // Upstream's cap, checked BEFORE the per-entry tests and before de-duplication, exactly
          // where `resolveGeoList` checks its own. It is PER LIST, not per campaign: upstream calls
          // `resolveGeoList` once for the targeted list and once for this one, each with its own
          // counter, so a full exclusion list alongside a full targeted list is accepted and must
          // not be refused here.
          if (excluded.length > GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS) {
            refuseExcluded(
              `Google Ads accepts at most ${GOOGLE_ADS_MAX_EXCLUDED_GEO_TARGETS} excluded locations on one campaign, and this one has ${excluded.length}. Remove some and create again.`
            );
            return;
          }

          // Entry by entry, refusing on the FIRST bad one, as `resolveGeoList` does.
          for (const entry of excluded) {
            const refusal = this.googleExcludedGeoRefusal(entry);
            if (refusal) {
              refuseExcluded(refusal);
              return;
            }
          }

          // A location that is both targeted and excluded is REFUSED rather than resolved: Google
          // lets the exclusion win, so the campaign would silently not serve where the operator
          // plainly asked it to. Compared by RESOLVED id, as upstream compares it, so `US` and
          // `2840` clash however each half is spelled. Judged on the DISPATCHED targeted list —
          // the same value the guard above judged and the builder sends.
          const excludedIds = new Set(excluded.map((entry) => this.googleResolvedGeoId(entry)).filter((id): id is string => id !== null));
          const dispatchedGeoTargets = Array.isArray(googleGeoTargets) ? this.googleUpperCodeList(googleGeoTargets) : [];
          const clash = dispatchedGeoTargets.find((entry) => {
            const id = this.googleResolvedGeoId(entry);
            return id !== null && excludedIds.has(id);
          });
          if (clash !== undefined) {
            refuseExcluded(
              `Google Ads cannot both target and exclude ${googleAdsEchoed(clash)} — the exclusion would win and the campaign would not serve there at all. Remove it from one of the two lists and create again.`
            );
            return;
          }
        }

        // Radius targets, after the two id lists, as `validateGeoPlan` orders them.
        const rawProximityTargets = body?.proximityTargets;
        if (rawProximityTargets !== undefined && rawProximityTargets !== null) {
          const refuseProximity = (message: string): void =>
            next(ServiceValidationError.forField('proximityTargets', message, { operation: 'campaign_create', service: 'campaign_controller' }));
          // The Go decode into `[]googleAdsProximityConfig` refuses a non-list, a non-object entry,
          // a non-numeric coordinate or radius, or a non-string unit. A null entry or field decodes
          // to a zero, which the entry checks below refuse by name.
          if (!Array.isArray(rawProximityTargets) || !rawProximityTargets.every((entry) => this.isProximityShape(entry))) {
            refuseProximity('Google Ads radius targets must be a list of objects with a numeric latitude, longitude and radius and a radius unit.');
            return;
          }

          if (rawProximityTargets.length > 0 && typeof googleChannel === 'string') {
            // REFUSED by name, not withheld, and checked BEFORE the cap because `validateGeoPlan`
            // checks it before it calls `validateProximityTargets`. Demand Gen attaches location
            // criteria at the ad group level, where upstream has not verified that a proximity
            // criterion is accepted, so it refuses rather than creating a paid campaign to find out.
            if (!(GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(googleChannel)) {
              refuseProximity(
                `Google Ads does not accept radius targets on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns, which target locations at the ad group level. Remove the radius targets or pick a different channel, then create again.`
              );
              return;
            }

            // Upstream's cap, checked against the SUBMITTED count before any exact repeat is
            // collapsed — "a caller handing over a list longer than this has lost track of what it
            // is asking for, and silently shrinking it into the cap would hide that".
            if (rawProximityTargets.length > GOOGLE_ADS_MAX_PROXIMITY_TARGETS) {
              refuseProximity(
                `Google Ads accepts at most ${GOOGLE_ADS_MAX_PROXIMITY_TARGETS} radius targets on one campaign, and this one has ${rawProximityTargets.length}. Remove some and create again.`
              );
              return;
            }

            // Entry by entry, refusing on the FIRST bad one, in `validateProximityTargets`' order.
            // A REPEAT is not among the refusals: upstream collapses an exact repeat rather than
            // refusing it, so refusing one here would be an over-refusal of a create that works.
            const targets = this.googleProximityList(rawProximityTargets);
            for (const [index, target] of targets.entries()) {
              const refusal = this.googleProximityRefusal(target, index);
              if (refusal) {
                refuseProximity(refusal);
                return;
              }
            }
          }
        }

        // The language twin of the two guards above: a list that fails in Go comes back as the
        // orchestrator's opaque "platform campaign creation failed". So every upstream refusal is
        // made here first, by name, in UPSTREAM'S OWN ORDER — JSON decode, `validateCriteriaPlan`'s
        // Demand Gen fence, then `resolveLanguageList`'s cap and per-entry tests — so a request that
        // breaks two rules is refused for the one upstream would name. Judged on the dispatched list.
        const rawLanguages = body?.languages;
        if (rawLanguages !== undefined && rawLanguages !== null) {
          // Upstream decodes `languages` into a Go `[]string`, so a non-array or a non-string entry
          // is refused before any validator runs. Reading either as absent would dispatch an
          // every-language campaign the caller never asked for.
          if (!Array.isArray(rawLanguages) || rawLanguages.some((l) => typeof l !== 'string')) {
            next(
              ServiceValidationError.forField('languages', 'Google Ads languages must be a list of language codes or numeric language constant ids.', {
                operation: 'campaign_create',
                service: 'campaign_controller',
              })
            );
            return;
          }

          const languages = this.googleUpperCodeList(rawLanguages);
          if (languages.length > 0 && typeof googleChannel === 'string') {
            // REFUSED by name, not dropped: upstream's contract for the field is "refused, never
            // silently dropped", and `validateCriteriaPlan` fails the whole Demand Gen create on it.
            // The UI never sends this — its control and payload gate on the same channel list.
            if (!(GOOGLE_CHANNELS_WITH_LANGUAGES as readonly string[]).includes(googleChannel)) {
              next(
                ServiceValidationError.forField(
                  'languages',
                  `Google Ads does not accept campaign languages on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the languages or pick a different channel, then create again.`,
                  { operation: 'campaign_create', service: 'campaign_controller' }
                )
              );
              return;
            }

            // Upstream's cap, checked BEFORE de-duplication there and so here too: a list over the
            // cap only because it repeats a code is still refused.
            if (languages.length > GOOGLE_ADS_MAX_LANGUAGES) {
              next(
                ServiceValidationError.forField(
                  'languages',
                  `Google Ads accepts at most ${GOOGLE_ADS_MAX_LANGUAGES} languages on one campaign, and this one has ${languages.length}. Remove some and create again.`,
                  { operation: 'campaign_create', service: 'campaign_controller' }
                )
              );
              return;
            }

            // Entry by entry, refusing on the FIRST bad one, as `resolveLanguageList` does.
            for (const language of languages) {
              const refusal = this.googleLanguageRefusal(language);
              if (refusal) {
                next(ServiceValidationError.forField('languages', refusal, { operation: 'campaign_create', service: 'campaign_controller' }));
                return;
              }
            }
          }
        }

        // Ad schedules last of the criteria, as `validateCriteriaPlan` runs `validateAdSchedules`
        // after it has resolved the language list. Same reason as the three guards above: an entry
        // Go refuses comes back as the orchestrator's opaque "platform campaign creation failed",
        // so every refusal is made here first, by name, in upstream's own order.
        const rawAdSchedules = body?.adSchedules;
        if (rawAdSchedules !== undefined && rawAdSchedules !== null) {
          const refuseAdSchedules = (message: string): void =>
            next(ServiceValidationError.forField('adSchedules', message, { operation: 'campaign_create', service: 'campaign_controller' }));
          // The Go decode into `[]googleAdsAdScheduleConfig` refuses a non-list, a non-object entry,
          // a non-string day or a non-numeric hour, minute or bid modifier. A null FIELD decodes to
          // a zero, which the entry checks below refuse by name. A null ENTRY is refused here
          // instead, unlike a null radius target — see {@link isAdScheduleShape} for why.
          if (!Array.isArray(rawAdSchedules) || !rawAdSchedules.every((entry) => this.isAdScheduleShape(entry))) {
            refuseAdSchedules('Google Ads ad schedules must be a list of objects with a day of week and numeric start and end hours and minutes.');
            return;
          }

          if (rawAdSchedules.length > 0 && typeof googleChannel === 'string') {
            // REFUSED by name, not withheld: `validateCriteriaPlan` fails the whole Demand Gen
            // create on any non-location criterion, ad schedules included. Performance Max is NOT
            // fenced out — Google documents ad schedules as a Performance Max campaign criterion,
            // and upstream keeps them there alongside languages.
            if (!(GOOGLE_CHANNELS_WITH_AD_SCHEDULES as readonly string[]).includes(googleChannel)) {
              refuseAdSchedules(
                `Google Ads does not accept ad schedules on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the ad schedules or pick a different channel, then create again.`
              );
              return;
            }

            // Upstream's cap, checked against the SUBMITTED count before any exact repeat is
            // collapsed, exactly where `validateAdSchedules` checks its own.
            if (rawAdSchedules.length > GOOGLE_ADS_MAX_AD_SCHEDULES) {
              refuseAdSchedules(
                `Google Ads accepts at most ${GOOGLE_ADS_MAX_AD_SCHEDULES} ad schedules on one campaign, and this one has ${rawAdSchedules.length}. Remove some and create again.`
              );
              return;
            }

            // One call, not a per-entry loop: three of upstream's refusals — an exact repeat with a
            // different bid modifier, an overlap, and the per-day limit — are about an entry's
            // relationship to the entries before it and cannot be decided from the entry alone.
            const scheduleRefusal = this.googleAdScheduleRefusal(this.googleAdScheduleList(rawAdSchedules));
            if (scheduleRefusal) {
              refuseAdSchedules(scheduleRefusal);
              return;
            }
          }
        }

        // Device bid modifiers then the two demographic exclusion lists, in `validateCriteriaPlan`'s
        // own order — languages, ad schedules, devices, age ranges, genders. Same reason as every
        // guard above: an entry Go refuses comes back as the orchestrator's opaque "platform
        // campaign creation failed", so every refusal is made here first, by name.
        const rawDeviceBidModifiers = body?.deviceBidModifiers;
        if (rawDeviceBidModifiers !== undefined && rawDeviceBidModifiers !== null) {
          const refuseDevices = (message: string): void =>
            next(ServiceValidationError.forField('deviceBidModifiers', message, { operation: 'campaign_create', service: 'campaign_controller' }));
          // The Go decode into `[]googleAdsDeviceBidModifierConfig` refuses a non-list, a non-object
          // entry, a non-string device or a non-numeric bid modifier. A null MODIFIER is accepted by
          // the decode because Go reads it as the same nil pointer an omitted key gives — the
          // omitted-modifier check below is what refuses both. A null ENTRY is refused here instead,
          // on the same reasoning as {@link isAdScheduleShape}: upstream refuses it too, as an entry
          // that omits its modifier, so only the wording differs — and this wording says the entry is
          // malformed rather than blaming a device the caller never wrote.
          if (!Array.isArray(rawDeviceBidModifiers) || !rawDeviceBidModifiers.every((entry) => this.isDeviceBidModifierShape(entry))) {
            refuseDevices('Google Ads device bid modifiers must be a list of objects with a device and a numeric bid modifier.');
            return;
          }

          const devices = this.googleDeviceBidModifierList(rawDeviceBidModifiers);
          // OUTSIDE the channel fence, and before it, because upstream checks it outside its own:
          // `googleAdsDeviceBidModifiers` runs in the DISPATCHER, before the channel switch, so that
          // the create and adoption paths refuse a malformed entry identically. An entry that omits
          // its modifier is therefore named even on a channel that would have refused the whole list
          // a moment later.
          for (const [index, device] of devices.entries()) {
            if (device.bidModifier === undefined) {
              refuseDevices(
                `The Google Ads device bid modifier ${index + 1} names ${googleAdsEchoed(device.device)} but no bid modifier. Supply one — 0 is not "no adjustment" but a -100% modifier that stops the campaign serving on that device — then create again.`
              );
              return;
            }
          }

          if (devices.length > 0 && typeof googleChannel === 'string') {
            // REFUSED by name, not withheld, and on one channel FEWER than ad schedules.
            // `validateCriteriaPlan` fails the whole Demand Gen create on any of these criteria, then
            // SPLITS Performance Max in two: it keeps the languages and ad schedules Google documents
            // as Performance Max campaign criteria, and refuses device bid modifiers, because that
            // channel's automated bidding owns the bid and sets no device adjustment.
            if (!(GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS as readonly string[]).includes(googleChannel)) {
              refuseDevices(
                `Google Ads does not accept device bid modifiers on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove them or pick a different channel, then create again.`
              );
              return;
            }

            // Upstream's cap, checked against the SUBMITTED count exactly where
            // `validateDeviceBidModifiers` checks its own. It is one entry per device this client
            // accepts, so a longer list necessarily repeats one — the per-entry pass would refuse it
            // anyway, but upstream names the cap first and so does this.
            if (devices.length > GOOGLE_ADS_MAX_DEVICE_BID_MODIFIERS) {
              refuseDevices(
                `Google Ads accepts at most ${GOOGLE_ADS_MAX_DEVICE_BID_MODIFIERS} device bid modifiers on one campaign, one per device, and this one has ${devices.length}. Remove some and create again.`
              );
              return;
            }

            // One call, not a per-entry loop: the repeated-device refusal is about an entry's
            // relationship to the entries before it and cannot be decided from the entry alone.
            const deviceRefusal = this.googleDeviceBidModifierRefusal(devices);
            if (deviceRefusal) {
              refuseDevices(deviceRefusal);
              return;
            }
          }
        }

        // Age ranges then genders. Both lists are capped INDEPENDENTLY at the same number, and both
        // COLLAPSE a repeat rather than refusing it — the opposite of the device list above. The
        // asymmetry is upstream's and it is about what a repeat costs: a repeated device carries a
        // second bid modifier, one of which Google would silently drop, while a repeated exclusion
        // asks twice for the one thing it already said.
        //
        // Age ranges first. The channel fence here is the second half of Performance Max's split: it
        // takes demographics as asset-group signals, which this client does not create, so a
        // campaign-level exclusion there is refused rather than created somewhere the operator
        // cannot see it.
        const ageRangeRefusal = this.googleDemographicExclusionRefusal(
          body?.excludedAgeRanges,
          'excluded age ranges',
          'age range names',
          googleChannel,
          (entry) => this.googleExcludedAgeRangeRefusal(entry)
        );
        if (ageRangeRefusal) {
          next(ServiceValidationError.forField('excludedAgeRanges', ageRangeRefusal, { operation: 'campaign_create', service: 'campaign_controller' }));
          return;
        }

        // Then genders, through the same helper. The cap is PER LIST upstream, not shared with the
        // age ranges: `validateExcludedGenders` checks `maxDemographicExclusions` against its own
        // length, so a request at the cap on BOTH lists is accepted — which is why this is a second
        // call and not a second field folded into the first.
        const genderRefusal = this.googleDemographicExclusionRefusal(body?.excludedGenders, 'excluded genders', 'gender names', googleChannel, (entry) =>
          this.googleExcludedGenderRefusal(entry)
        );
        if (genderRefusal) {
          next(ServiceValidationError.forField('excludedGenders', genderRefusal, { operation: 'campaign_create', service: 'campaign_controller' }));
          return;
        }
      }

      // Audience segments, in `validateAudienceSegments`' own order: JSON decode, the cap on the RAW
      // list, then each entry, first bad one wins — and only THEN the Search-only fence, because
      // upstream validates the list in `precomputeAdGroupAdInputs` before `preflightCampaignKind`
      // refuses it off Search. Each would otherwise fail in Go as the opaque "platform campaign
      // creation failed". A repeat is not refused: upstream collapses it.
      const rawAudienceSegments = body?.audienceSegments;
      if (cutoverOn && platforms.includes('google-ads') && rawAudienceSegments !== undefined && rawAudienceSegments !== null) {
        const refuse = (message: string): void =>
          next(ServiceValidationError.forField('audienceSegments', message, { operation: 'campaign_create', service: 'campaign_controller' }));
        // Upstream decodes `audienceSegments` into a Go `[]string`, so either fault is refused there
        // before any validator runs. Reading it as absent would create the campaign untargeted.
        if (!Array.isArray(rawAudienceSegments) || rawAudienceSegments.some((s) => typeof s !== 'string')) {
          refuse('Google Ads audience segments must be a list of user list resource names.');
          return;
        }
        const segments = this.googleAudienceSegmentList(rawAudienceSegments);
        if (segments.length > 0 && typeof googleChannel === 'string') {
          if (segments.length > GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS) {
            refuse(
              `Google Ads accepts at most ${GOOGLE_ADS_MAX_AUDIENCE_SEGMENTS} audience segments on one campaign, and this one has ${segments.length}. Remove some and create again.`
            );
            return;
          }
          for (const [index, segment] of segments.entries()) {
            const refusal = this.googleAudienceSegmentRefusal(segment, index);
            if (refusal) {
              refuse(refusal);
              return;
            }
          }
          // REFUSED by name, not withheld: upstream fails the whole create on any channel but
          // Search. The UI never sends this — its section and payload gate on the same list.
          if (!(GOOGLE_CHANNELS_WITH_AUDIENCE_SEGMENTS as readonly string[]).includes(googleChannel)) {
            refuse(
              `Google Ads only accepts audience segments on Search campaigns, not on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the segments or pick Search, then create again.`
            );
            return;
          }
        }
      }

      // Sitelinks next, BEFORE callouts, as `validateAssetPlan` runs `validateSitelinks` first: JSON
      // decode, the Search-only fence, the cap, then each entry in `validateSitelinks`' order, first
      // bad one wins. Each would otherwise fail in Go as the opaque "platform campaign creation failed".
      const rawSitelinks = body?.sitelinks;
      if (cutoverOn && platforms.includes('google-ads') && rawSitelinks !== undefined && rawSitelinks !== null) {
        const refuse = (message: string): void =>
          next(ServiceValidationError.forField('sitelinks', message, { operation: 'campaign_create', service: 'campaign_controller' }));
        // The Go decode into `[]googleAdsSitelinkConfig` refuses a non-list, a non-object entry or a
        // non-string field. A null entry or field decodes to blanks, which the entry checks refuse.
        if (!Array.isArray(rawSitelinks) || !rawSitelinks.every((entry) => this.isSitelinkShape(entry))) {
          refuse('Google Ads sitelinks must be a list of objects with text fields.');
          return;
        }
        if (rawSitelinks.length > 0 && typeof googleChannel === 'string') {
          // REFUSED by name, not withheld: `validateAssetPlan` fails the whole create on any channel
          // but Search, counting every entry. The UI never sends this.
          if (!(GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(googleChannel)) {
            refuse(
              `Google Ads only accepts sitelinks on Search campaigns, not on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the sitelinks or pick Search, then create again.`
            );
            return;
          }
          if (rawSitelinks.length > GOOGLE_ADS_MAX_SITELINKS) {
            refuse(
              `Google Ads accepts at most ${GOOGLE_ADS_MAX_SITELINKS} sitelinks on one campaign, and this one has ${rawSitelinks.length}. Remove some and create again.`
            );
            return;
          }
          const seen = new Set<string>();
          for (const [index, sitelink] of this.googleSitelinkList(rawSitelinks).entries()) {
            const refusal = this.googleSitelinkRefusal(sitelink, index, seen);
            if (refusal) {
              refuse(refusal);
              return;
            }
          }
        }
      }

      // The callout twin of the language guard above, in UPSTREAM'S OWN ORDER and after it, as
      // `validateAssetPlan` runs after `validateCriteriaPlan`: JSON decode, the Search-only fence,
      // `validateCallouts`' cap, then each entry (blank, rune bound, case-folded repeat), first bad
      // one wins. Each would otherwise fail in Go as the opaque "platform campaign creation failed".
      const rawCallouts = body?.callouts;
      if (cutoverOn && platforms.includes('google-ads') && rawCallouts !== undefined && rawCallouts !== null) {
        const refuse = (message: string): void =>
          next(ServiceValidationError.forField('callouts', message, { operation: 'campaign_create', service: 'campaign_controller' }));
        // Upstream decodes `callouts` into a Go `[]string`, so either fault is refused there before
        // any validator runs. Reading it as absent would create the campaign without them.
        if (!Array.isArray(rawCallouts) || rawCallouts.some((c) => typeof c !== 'string')) {
          refuse('Google Ads callouts must be a list of text.');
          return;
        }
        const callouts = this.googleCalloutList(rawCallouts);
        if (callouts.length > 0 && typeof googleChannel === 'string') {
          // REFUSED by name, not withheld: `validateAssetPlan` fails the whole create on any channel
          // but Search. The UI never sends this — its section and payload gate on the same list.
          if (!(GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(googleChannel)) {
            refuse(
              `Google Ads only accepts callouts on Search campaigns, not on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the callouts or pick Search, then create again.`
            );
            return;
          }
          if (callouts.length > GOOGLE_ADS_MAX_CALLOUTS) {
            refuse(
              `Google Ads accepts at most ${GOOGLE_ADS_MAX_CALLOUTS} callouts on one campaign, and this one has ${callouts.length}. Remove some and create again.`
            );
            return;
          }
          const seen = new Set<string>();
          for (const [index, callout] of callouts.entries()) {
            const refusal = this.googleCalloutRefusal(callout, index, seen);
            if (refusal) {
              refuse(refusal);
              return;
            }
          }
        }
      }

      // Structured snippets LAST of the three, as `validateAssetPlan` runs `validateStructuredSnippets`
      // after `validateCallouts`: JSON decode, the Search-only fence, the cap, then each entry in
      // `validateStructuredSnippets`' order, first bad one wins. Each would otherwise fail in Go as
      // the opaque "platform campaign creation failed".
      const rawSnippets = body?.structuredSnippets;
      if (cutoverOn && platforms.includes('google-ads') && rawSnippets !== undefined && rawSnippets !== null) {
        const refuse = (message: string): void =>
          next(ServiceValidationError.forField('structuredSnippets', message, { operation: 'campaign_create', service: 'campaign_controller' }));
        // The Go decode into `[]googleAdsStructuredSnippetConfig` refuses a non-list, a non-object
        // entry, a non-string header or a `values` holding anything but text. A null entry, field
        // or VALUE decodes to a blank instead — the entry checks refuse the first two by name, and
        // upstream's value loop skips the third exactly as it skips a typed blank.
        if (!Array.isArray(rawSnippets) || !rawSnippets.every((entry) => this.isStructuredSnippetShape(entry))) {
          refuse('Google Ads structured snippets must be a list of objects with a header and a list of values.');
          return;
        }
        if (rawSnippets.length > 0 && typeof googleChannel === 'string') {
          // REFUSED by name, not withheld: `validateAssetPlan` fails the whole create on any channel
          // but Search, counting every entry. The UI never sends this.
          if (!(GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(googleChannel)) {
            refuse(
              `Google Ads only accepts structured snippets on Search campaigns, not on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[googleChannel as GoogleCampaignChannel] ?? googleChannel} campaigns. Remove the snippets or pick Search, then create again.`
            );
            return;
          }
          if (rawSnippets.length > GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS) {
            refuse(
              `Google Ads accepts at most ${GOOGLE_ADS_MAX_STRUCTURED_SNIPPETS} structured snippets on one campaign, and this one has ${rawSnippets.length}. Remove some and create again.`
            );
            return;
          }
          const seenHeaders = new Set<string>();
          for (const [index, snippet] of this.googleStructuredSnippetList(rawSnippets).entries()) {
            const refusal = this.googleStructuredSnippetRefusal(snippet, index, seenHeaders);
            if (refusal) {
              refuse(refusal);
              return;
            }
          }
        }
      }

      // Call extensions, promotions and prices, after the snippets and in that order, as
      // `validateAssetPlan` runs `validateCallExtensions`, `validatePromotionExtensions` and
      // `validatePriceExtensions` after `validateStructuredSnippets`. Each list takes the same four
      // steps the three above do — JSON decode, the Search-only fence, the raw-slice cap, then each
      // entry in upstream's own order, first bad one wins — so they share one walk rather than
      // three copies of it. The per-entry rules live in `campaign-google-assets.utils`, the one copy
      // the Implementation tab's add guard also judges by.
      if (cutoverOn && platforms.includes('google-ads')) {
        const assetRefusal =
          this.googleAssetListRefusal(body?.callExtensions, googleChannel, {
            plural: 'call extensions',
            singular: 'call extension',
            max: GOOGLE_ADS_MAX_CALL_EXTENSIONS,
            shapeMessage: 'Google Ads call extensions must be a list of objects with a country code and a phone number.',
            isShape: (entry) => this.isCallExtensionShape(entry),
            entryRefusal: (raw) => {
              const calls = this.googleCallExtensionList(raw);
              return this.firstAssetRefusal(calls, (call, i) => googleCallExtensionRefusal(call, calls.slice(0, i)));
            },
          }) ??
          this.googleAssetListRefusal(body?.promotions, googleChannel, {
            plural: 'promotions',
            singular: 'promotion',
            max: GOOGLE_ADS_MAX_PROMOTIONS,
            shapeMessage: 'Google Ads promotions must be a list of objects whose amounts are numbers and whose other fields are text.',
            isShape: (entry) => this.isPromotionShape(entry),
            entryRefusal: (raw) => {
              const promotions = this.googlePromotionList(raw);
              return this.firstAssetRefusal(promotions, (promotion, i) => googlePromotionRefusal(promotion, promotions.slice(0, i)));
            },
          }) ??
          this.googleAssetListRefusal(body?.prices, googleChannel, {
            plural: 'price extensions',
            singular: 'price extension',
            max: GOOGLE_ADS_MAX_PRICE_EXTENSIONS,
            shapeMessage: 'Google Ads price extensions must be a list of objects with text fields and a list of rows whose amounts are numbers.',
            isShape: (entry) => this.isPriceExtensionShape(entry),
            entryRefusal: (raw) => this.firstAssetRefusal(this.googlePriceExtensionList(raw), (price) => googlePriceExtensionRefusal(price)),
          });
        if (assetRefusal) {
          next(ServiceValidationError.forField(assetRefusal.field, assetRefusal.message, { operation: 'campaign_create', service: 'campaign_controller' }));
          return;
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
      // Only these two are checked. LinkedIn takes no flight window on this path, and Microsoft's
      // (`microsoftConfig.startDate`/`endDate`, linuxfoundation/lfx-v2-campaign-service#409) is
      // left to campaign-service: either date may be sent alone, and a bad one fails the platform
      // job there, so this predicate is not its rule to borrow.
      //
      // Google DOES carry one (`googleFlightWindow`) and is still excluded, because its test is a
      // DIFFERENT one: `validateFlightWindow` refuses on `end.Before(start)`, not on
      // `!end.After(start)`, so Google accepts a same-day flight that Meta and Reddit refuse.
      // Judging it with this predicate would refuse a create Google would have taken — and it
      // refuses malformed and reversed windows itself, before its first mutate, naming the value.
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
        // `indeterminate` travels with it: a create that MAY have started must not read as a refusal.
        res.json({ jobId: '', error: viaService.error, ...(viaService.indeterminate ? { indeterminate: true } : {}) });
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

      // Performance Max, Video and Display exist ONLY on the cutover path, for the same reason
      // HubSpot does — but with a worse failure mode, so this guard is not optional.
      //
      // The legacy in-process path branches on ONE type. `executeGoogleCampaignCreation`
      // (`campaign-proxy.service.ts`) dispatches `campaignType === 'search' ? createSearchCampaign
      // : createDemandGenCampaign`, and nothing between here and that loop filters the list. It
      // does not reject an unknown type; it BUILDS A DEMAND GEN CAMPAIGN for it, funded, and
      // reports success. (`normalizeBudgetSplit` does not choose the type — it only splits the
      // budget, and for a Performance-Max-only request neither of its branches matches, so the
      // campaign is funded from the raw `displayPct`.) A user who ticked Performance Max while
      // the cutover was dark would get a Demand Gen campaign they never asked for and no error
      // saying so.
      //
      // The cutover road fails differently, which is why the two are not described in one
      // sentence: `CampaignServiceGoogleChannels` guards a path where an unknown channel is a
      // silent SEARCH campaign only against a campaign-service predating LFXV2-3257, and a named
      // refusal against any later one. On THIS path it is a silent Demand Gen against every
      // version. Different wrong campaign, same silence, same bill.
      //
      // `demand-gen` and `search` are deliberately NOT refused here: the legacy path serves both.
      const legacyUnsupported = GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG.find((c) => body?.campaignTypes?.includes(c));
      if (platforms.includes('google-ads') && legacyUnsupported) {
        logger.warning(req, 'campaign_create', 'google channel requested while the campaign-service cutover is dark', {
          briefId,
          projectSlug,
          channel: legacyUnsupported,
        });
        // Video gets the API-limit reason, not the cutover one. The cutover message tells an
        // operator that enabling something will fix this; for Video nothing will, because
        // `CreateVideoCampaign` refuses unconditionally upstream and `GOOGLE_VIDEO_CREATE_SUPPORTED`
        // is `false`. The cutover road already declines to say "ask an administrator" for Video
        // for exactly this reason; the two roads must not give contradictory answers for the same
        // channel. Reusing the shared constant rather than writing a second string keeps them one
        // edit apart when Google ships the API.
        res.json({
          jobId: '',
          error:
            legacyUnsupported === 'video' && !GOOGLE_VIDEO_CREATE_SUPPORTED
              ? GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON
              : `${GOOGLE_CAMPAIGN_CHANNEL_LABELS[legacyUnsupported]} campaigns require the campaign-service cutover to be enabled. The legacy creation path can only create Search and Demand Gen.`,
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
   * Approve a brief that is already stored, without rewriting it.
   *
   * The missing third verb beside `persistBrief` and `loadBrief`. Until now approval existed only
   * as the tail of a save, so a stored brief sitting in `draft` — the state every failed approval
   * and every replace leaves behind — could be restored and read but never made usable, because
   * campaign creation refuses an unapproved brief and the restore path deliberately does not
   * re-save. The Restore offer led to a disabled Create Campaign button with no action that could
   * enable it.
   *
   * `POST` with an EMPTY body, which is the honest shape: this sends no content at all, it moves a
   * status. The brief is named by the path, the foundation by `?project=`, and the validator by
   * the request's own `If-Match` header — a header rather than a query parameter because that is
   * what it is, and because `approve-brief` upstream requires one.
   *
   * Flag-gated with `persistBrief` and `loadBrief`, on the same flag for the same reason: all
   * three are the one cutover.
   */
  public async approveBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      // Every field present so the response satisfies `CampaignBriefApproveResult` on both arms —
      // the client branches on `enabled` alone. No `conflict`: nothing was refused, the cutover
      // is simply dark.
      res.json({ enabled: false, briefId: '', etag: null, approved: false } satisfies CampaignBriefApproveResult);
      return;
    }

    // Same rule as `persistBrief`: never defaulted. A brief is approved inside one foundation's
    // project, and guessing which would approve a row in a foundation the user did not choose.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation: 'campaign_approve_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const briefId = typeof req.params['briefId'] === 'string' ? req.params['briefId'].trim() : '';
    if (briefId.length === 0) {
      next(
        ServiceValidationError.forField('briefId', 'brief id is required', {
          operation: 'campaign_approve_brief',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_approve_brief', { briefId, projectSlug });

    try {
      // The validator the caller already holds, from the read that put this brief on their
      // screen. Absent is a classified outcome, not an error: `approveStoredBrief` refuses to
      // approve a brief it cannot verify and returns `conflict: 'unverified-validator'`, which
      // the response below carries to the client like any other conflict.
      const ifMatch = req.get('If-Match');
      const knownEtag = typeof ifMatch === 'string' && ifMatch.trim() !== '' ? ifMatch : null;
      const result = await this.campaignServiceClient.approveStoredBrief(req, projectSlug, briefId, knownEtag);
      logger.success(req, 'campaign_approve_brief', startTime, {
        briefId,
        projectSlug,
        approved: result.approved,
        conflict: result.conflict ?? null,
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
   * what an operator sees, which is why `brief` is required rather than defaulted. Because the
   * Google Ads, Meta, Reddit and X accounts (and LinkedIn's legacy allowlist account) are shared by
   * every foundation, those account monitors are root-only on every arm — see
   * `requireSharedAccountMonitorAccess` (lfx-self-serve-ops#54).
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

    const window = this.readMetricsWindow(req, 'campaign_brief_metrics', next);
    if (window === null) {
      return;
    }

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

  /**
   * `POST /api/campaigns/brief/creative-assets?project=&brief_id=` — the raw image bytes, typed
   * `image/png` or `image/jpeg`, stored against the brief by campaign-service's
   * `upload-creative-asset`. Answers `{ id, mimeType, byteSize, checksum, created }` with 201 when
   * the image was stored and 200 when an identical one already was (the id is usable either way).
   *
   * Refused before anything is sent upstream: EVERY capability off (`canUseRedditCreativeAssets`,
   * `canUseGoogleCreativeAssets`, `canUseMetaCreativeAssets`, `canUseLinkedInCreativeAssets`,
   * `canUseMicrosoftCreativeAssets` and `canCreateTwitter` (the tweet image) — nothing could use the asset; any one alone admits the upload), a missing `project` or `brief_id`, a type outside
   * `CREATIVE_ASSET_MIME_TYPES` or bytes that are not the type they claim (415), an empty body
   * (400). Over `CREATIVE_ASSET_MAX_BYTES` is a 413 from the route's raw parser before this runs;
   * the length is re-checked here so a direct caller of this method gets the same answer.
   * Upstream 4xx/5xx pass through with campaign-service's own message. Only ids, type and size are
   * logged, never the bytes.
   */
  public async uploadCreativeAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_upload_creative_asset';
    const fail = (field: string, message: string): void => {
      next(ServiceValidationError.forField(field, message, { operation, service: 'campaign_controller' }));
    };

    // ANY capability admits an upload: the stored library is one library, and a deployment that
    // can use an image on any platform is reason enough to let it in. Refusing unless Reddit's
    // flag were on would mean a Google-only deployment could read and delete the library it is not
    // allowed to add to. On GOOGLE_ASSETS the upload is what the Google image slots name as
    // `{ imageAssetId }` in a create.
    if (
      !canUseRedditCreativeAssets() &&
      !canUseGoogleCreativeAssets() &&
      !canUseMetaCreativeAssets() &&
      !canUseLinkedInCreativeAssets() &&
      !canUseMicrosoftCreativeAssets() &&
      !canCreateTwitter()
    ) {
      fail('file', 'image uploads are not enabled on this deployment; paste an image URL instead');
      return;
    }

    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';
    if (briefId.length === 0) {
      fail('brief_id', 'save the brief before uploading an image for it');
      return;
    }
    // Refused, not defaulted, for the reason `getBriefMetrics` refuses: a constant here would
    // write into another foundation's brief.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      fail('project', 'no foundation is selected; reload the campaigns page from the sidebar');
      return;
    }

    // `express.raw` skips a body whose type is not on its list, so a wrong type arrives here with
    // no Buffer — told apart from an empty file by the declared type, not by the body.
    const declaredType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const image: unknown = req.body;
    if (!isCreativeAssetMimeType(declaredType) || !Buffer.isBuffer(image)) {
      next(this.unsupportedCreativeAsset(req, operation));
      return;
    }
    if (image.byteLength === 0) {
      fail('file', 'the image is empty');
      return;
    }
    if (image.byteLength > CREATIVE_ASSET_MAX_BYTES) {
      next(
        new MicroserviceError(CREATIVE_ASSET_TOO_LARGE_MESSAGE, 413, 'PAYLOAD_TOO_LARGE', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    // The declared type is the browser's claim; campaign-service re-sniffs and would refuse a
    // mismatch with a 400. Checking the magic bytes here gives that the wrong-type answer without
    // a base64 round trip.
    if (sniffCreativeAssetMimeType(image) !== declaredType) {
      next(this.unsupportedCreativeAsset(req, operation));
      return;
    }

    const startTime = logger.startOperation(req, operation, { briefId, projectSlug, contentType: declaredType, byteSize: image.byteLength });
    try {
      const asset = await this.campaignServiceClient.uploadCreativeAsset(req, projectSlug, briefId, declaredType, image);
      logger.success(req, operation, startTime, { briefId, assetId: asset.id, created: asset.created });
      res.status(asset.created ? 201 : 200).json(asset);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/campaigns/brief/creative-assets?project=&brief_id=` — the brief's stored image
   * library with the quota the next upload is judged against.
   *
   * Behind `LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS`, like `getCampaignMetrics`: the route is addressed
   * by a campaign-service BRIEF, and with the flag off no such brief exists here, so it answers 404
   * rather than reaching upstream. It is deliberately NOT behind either creative-asset capability
   * flag — reading and pruning a library a deployment already holds must not depend on whether a
   * platform may currently consume it, or images uploaded under one flag would become unreachable
   * the moment it was turned off.
   *
   * Query parameters are `project` and `brief_id`, matching the upload sibling above rather than
   * the camelCase the Optimize metrics reads use.
   */
  public async listCreativeAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_list_creative_assets';
    const scope = this.creativeAssetScope(req, operation, next);
    if (!scope) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { briefId: scope.briefId, projectSlug: scope.projectSlug });
    try {
      const library = await this.campaignServiceClient.listCreativeAssets(req, scope.projectSlug, scope.briefId);
      logger.success(req, operation, startTime, { briefId: scope.briefId, count: library.count, bytesUsed: library.bytesUsed });
      res.json(library);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/campaigns/brief/creative-assets/plan?project=&brief_id=&platforms=` — which stored
   * images fit which platform slots, and what is still missing.
   *
   * Registered BEFORE the `:assetId` route, and gated the same way as the list above.
   *
   * `platforms` is repeatable (`?platforms=google-ads&platforms=reddit`), which Express surfaces as
   * a string for one value and an array for several; both are normalized to an array here. Absent
   * or empty means every platform the service publishes slot rules for, which is what an operator
   * asking "is my library ready" wants. An unknown platform is IGNORED upstream rather than
   * refused, so it is passed through rather than validated against a list this tier would have to
   * keep in step with the service.
   */
  public async getCreativeAssetPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_creative_asset_plan';
    const scope = this.creativeAssetScope(req, operation, next);
    if (!scope) {
      return;
    }

    const raw = req.query['platforms'];
    const platforms = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map((value) => value.trim());
    const requested = [...new Set(platforms.filter((value) => value.length > 0))];

    const startTime = logger.startOperation(req, operation, { briefId: scope.briefId, projectSlug: scope.projectSlug, platforms: requested });
    try {
      const plan = await this.campaignServiceClient.getCreativeAssetPlan(req, scope.projectSlug, scope.briefId, requested);
      logger.success(req, operation, startTime, { briefId: scope.briefId, assignments: plan.assignments.length, gaps: plan.gaps.length });
      res.json(plan);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/campaigns/brief/creative-assets/:assetId?project=&brief_id=` — one stored image's
   * metadata. Gated like the list above.
   *
   * `assetId` is validated as a UUID here as well as being registered after the literal `plan`
   * route: the ordering is what keeps `/plan` off this handler, and the shape check is what makes
   * that safe to rely on, so a later reordering fails loudly rather than reading `plan` as an id.
   */
  public async getCreativeAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_get_creative_asset';
    const scope = this.creativeAssetScope(req, operation, next);
    if (!scope) {
      return;
    }
    const assetId = this.creativeAssetId(req, operation, next);
    if (!assetId) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { briefId: scope.briefId, projectSlug: scope.projectSlug, assetId });
    try {
      const asset = await this.campaignServiceClient.getCreativeAsset(req, scope.projectSlug, scope.briefId, assetId);
      logger.success(req, operation, startTime, { briefId: scope.briefId, assetId: asset.id });
      res.json(asset);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `DELETE /api/campaigns/brief/creative-assets/:assetId?project=&brief_id=` — permanently remove
   * a stored image and free its bytes against the brief's quota. Answers 204.
   *
   * Gated like the list above, and for the same reason: pruning a full library must stay possible
   * on a deployment where no platform may currently consume it.
   *
   * Upstream refuses with 409 `reason=creative_asset_in_use` while a live campaign on the brief
   * could still need the image, and that refusal carries its own remedy text; it passes through
   * untouched rather than being restated here.
   */
  public async deleteCreativeAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_delete_creative_asset';
    const scope = this.creativeAssetScope(req, operation, next);
    if (!scope) {
      return;
    }
    const assetId = this.creativeAssetId(req, operation, next);
    if (!assetId) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { briefId: scope.briefId, projectSlug: scope.projectSlug, assetId });
    try {
      await this.campaignServiceClient.deleteCreativeAsset(req, scope.projectSlug, scope.briefId, assetId);
      logger.success(req, operation, startTime, { briefId: scope.briefId, assetId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Read campaign-service's live metrics for ONE campaign: impressions, clicks, cost and CTR, read
   * from its platform on every request. The Optimize tab shows each row's counters from the
   * brief-wide read (`getBriefMetrics`) it already makes on open, and calls this only when the
   * operator refreshes one row, or clicks a row the brief-wide read could not measure, to get this
   * read's precise reason. Each call reaches an ad platform whose rate budget is shared across
   * foundations.
   *
   * Behind `LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS`, like the adoptable-brief list: the route is
   * addressed by a campaign-service brief, and with the flag off none exists here, so it answers
   * 404 rather than reaching upstream.
   *
   * The query takes `project` and `briefId` (camelCase, like the sibling per-campaign Optimize reads)
   * and an optional `window` refused rather than defaulted or dropped, as `getBriefMetrics` does.
   * Both ids are checked as UUIDs, which upstream declares them.
   * Upstream's refusals are relayed as they come: 400 for a platform with no metrics read, 409 for
   * a campaign that cannot be measured yet or belongs to another account, 404 for a missing
   * connection, 5xx for a connection or platform failure.
   */
  public async getCampaignMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_metrics_read';
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      next(new ResourceNotFoundError('Route', undefined, { operation, service: 'campaign_controller', path: req.path }));
      return;
    }

    const campaignId = req.params['campaignId'];
    if (typeof campaignId !== 'string' || !isCampaignServiceJobId(campaignId)) {
      next(ServiceValidationError.forField('campaignId', 'campaignId must be a campaign UUID', { operation, service: 'campaign_controller', path: req.path }));
      return;
    }

    const briefId = typeof req.query['briefId'] === 'string' ? req.query['briefId'].trim() : '';
    if (!isCampaignServiceJobId(briefId)) {
      next(
        ServiceValidationError.forField('briefId', "the brief UUID is required to read a campaign's metrics", {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    // Refused, not defaulted, for the reason `getBriefMetrics` gives.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    const window = this.readMetricsWindow(req, operation, next);
    if (window === null) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { campaignId, briefId, projectSlug, window });

    try {
      const result = await this.campaignServiceClient.getCampaignMetrics(req, projectSlug, briefId, campaignId, window);
      // The window upstream SERVED, which can be narrower than the one asked for (X Ads), and the
      // counters themselves are not logged: they are the response, not a diagnostic.
      logger.success(req, operation, startTime, { campaignId, briefId, projectSlug, window: result.window });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Google Ads account monitor, read account-wide through the BFF's own credentials. That customer
   * is shared by every foundation, so the read is root-only (lfx-self-serve-ops#54); the project is
   * still required, so a request naming none is a 400 for every caller.
   */
  public async getMonitorData(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const projectSlug = this.requireMonitorProject(req, next, 'campaign_monitor');
    if (projectSlug === null) {
      return;
    }
    if (!(await this.requireSharedAccountMonitorAccess(req, next, 'campaign_monitor', 'Google Ads'))) {
      return;
    }
    const startTime = logger.startOperation(req, 'campaign_monitor', { days, projectSlug });

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
   * query, restricted to ROOT callers because it cannot isolate one foundation's data.
   *
   * The project is REQUIRED on the campaign-service arm and not defaulted: campaign-service
   * scopes by project, and `/foundation/campaigns` is reachable by an ED of any foundation,
   * so a fallback constant would report one foundation's keywords to another. The legacy arm
   * ignores the project entirely and therefore requires the shared-account ROOT gate.
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

      if (!(await this.requireSharedAccountMonitorAccess(req, next, 'campaign_keywords', 'Google Ads'))) {
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
      const listed = await this.campaignServiceClient.listBriefCampaigns(req, projectSlug, briefId);
      // The one PER-CALLER capability, so it is decided here where the caller is known rather than
      // in the service. Only on the campaign-service create path (`canCreateWithAudienceSegments`, the
      // same test the create route refuses on), and that test runs first so a deployment that cannot
      // send segments asks no persona question at all.
      const googleAudienceSegmentsEnabled = canCreateWithAudienceSegments() && (await this.isRootCampaignPrincipal(req));
      const result: CampaignListResult = { ...listed, googleAudienceSegmentsEnabled };
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

    // With the cutover on, the picker offers the project's OWN connection's account (#2519), which
    // need not be in the configured list — and the legacy fallback to the first configured account
    // would silently swap it for one campaign-service then refuses as not this connection's. So
    // the id is checked by shape instead, and campaign-service decides whether it is this project's.
    if (isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      // A read whose account came from a legacy picker was picked on a pod with the flag OFF; see `refuseLegacyReadOnCutover`.
      if (this.refuseLegacyReadOnCutover(req, next, 'linkedin_monitor')) {
        return;
      }
      const accountId = this.requireMonitorAccountId(req, next, 'linkedin_monitor', 'LinkedIn Ads', LINKEDIN_ADS_MONITOR_ACCOUNT_ID_PATTERN);
      if (accountId === null) {
        return;
      }
      const label = config.accounts.find((a) => a.accountId === accountId)?.label ?? accountId;
      await this.serveLegacyShapedMonitor(req, res, next, {
        operation: 'linkedin_monitor',
        platformLabel: 'LinkedIn Ads',
        days,
        accountId,
        read: (projectSlug) => this.campaignServiceClient.getLinkedInAdsAccountMonitor(req, projectSlug, accountId, days),
        toResponse: (payload) => toLinkedInMonitorResponse(payload, label, new Date().toISOString()),
      });
      return;
    }

    // Flag OFF here. A read whose account came from the connection path was picked on a pod with it
    // ON; serving it from the legacy path would swap or refuse that account, so it is refused instead.
    if (this.refuseCutoverMismatch(req, next, 'linkedin_monitor')) {
      return;
    }
    // The legacy allowlist account is LF's own, shared by every foundation; the connection arm above
    // reads the project's own account and stays open.
    if (!(await this.requireSharedAccountMonitorAccess(req, next, 'linkedin_monitor', 'LinkedIn Ads'))) {
      return;
    }

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
   * Same flag, project requirement and legacy shared-account ROOT gate as `getKeywords` above.
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

      if (!(await this.requireSharedAccountMonitorAccess(req, next, 'campaign_audience', 'Google Ads'))) {
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
    // See the create route's guard. An absent or null body makes the field read below throw a
    // TypeError and return a 500 instead of a named 400; an array or a string does not throw and
    // was already refused by the `keywords` guard, only less legibly. Not over-refusal — neither
    // shape carries a `keywords`.
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(ServiceValidationError.forField('body', 'request body must be a JSON object', { operation: 'keyword_actions', service: 'campaign_controller' }));
      return;
    }

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
      // OPTIONAL, defaulting to Google Ads, so a body that names no platform means what it always
      // meant. A value that is present must be one campaign-service's keyword lever serves: an
      // unknown one silently treated as Google would resolve and mutate the wrong platform's campaign.
      // Microsoft ids are positive int64s too, so the format check above holds for both.
      if (kw.platform !== undefined && !KEYWORD_ACTION_PLATFORMS.has(kw.platform)) {
        next(
          ServiceValidationError.forField('keywords', `platform must be one of: ${[...KEYWORD_ACTION_PLATFORMS].join(', ')} when given`, {
            operation: 'keyword_actions',
            service: 'campaign_controller',
          })
        );
        return;
      }
    }

    const viaCampaignService = isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceKeywordActions);

    // Microsoft keyword actions exist ONLY through campaign-service. The legacy path talks to Google
    // Ads directly and would read a Microsoft id as a Google one, so the whole request is refused —
    // before anything is sent — rather than half-applied.
    if (!viaCampaignService && body.keywords.some((kw) => kw.platform === 'microsoft-ads')) {
      next(
        ServiceValidationError.forField('keywords', 'Microsoft Advertising keyword actions are not available', {
          operation: 'keyword_actions',
          service: 'campaign_controller',
        })
      );
      return;
    }

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

    // Reddit's account is shared by every foundation, so both arms below are root-only.
    if (!(await this.requireSharedAccountMonitorAccess(req, next, 'reddit_monitor', 'Reddit Ads'))) {
      return;
    }

    // Cutover on: the connection's account, checked by shape — see the LinkedIn route.
    if (isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      // A legacy picker's account, picked on a pod with the flag OFF, is refused — see the LinkedIn route.
      if (this.refuseLegacyReadOnCutover(req, next, 'reddit_monitor')) {
        return;
      }
      const accountId = this.requireMonitorAccountId(req, next, 'reddit_monitor', 'Reddit Ads', REDDIT_ADS_MONITOR_ACCOUNT_ID_PATTERN);
      if (accountId === null) {
        return;
      }
      const label = REDDIT_ACCOUNTS.find((a) => a.accountId === accountId)?.label ?? accountId;
      await this.serveLegacyShapedMonitor(req, res, next, {
        operation: 'reddit_monitor',
        platformLabel: 'Reddit Ads',
        days,
        accountId,
        read: (projectSlug) => this.campaignServiceClient.getRedditAdsAccountMonitor(req, projectSlug, accountId, days),
        toResponse: (payload) => toRedditMonitorResponse(payload, label, new Date().toISOString()),
      });
      return;
    }

    // Flag OFF here. A read whose account came from the connection path was picked on a pod with it
    // ON; serving it from the legacy path would swap or refuse that account, so it is refused instead.
    if (this.refuseCutoverMismatch(req, next, 'reddit_monitor')) {
      return;
    }

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

  /**
   * The Google Ads accounts the project's connection can reach, from campaign-service's account
   * discovery, in the Meta/Reddit option shape. campaign-service only: there is no legacy list to
   * fall back to, so with `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR` off the route answers 404 as if it
   * were not mounted — the HubSpot monitor route's gating.
   *
   * Root-only, as the Google Ads monitor is: a project with no connection of its own is answered
   * from the LF system credential upstream, so the list is then every account the LF can reach.
   */
  public async getGoogleAdsAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'google_ads_accounts';
    if (!(await this.requireSharedAccountMonitorAccess(req, next, operation, 'Google Ads'))) {
      return;
    }
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      next(this.monitorDisabledError(operation));
      return;
    }
    const projectSlug = this.requireMonitorProject(req, next, operation);
    if (projectSlug === null) {
      return;
    }
    const startTime = logger.startOperation(req, operation, { viaCampaignService: true });

    try {
      const payload = await this.campaignServiceClient.listGoogleAdsAccounts(req, projectSlug);
      // `accounts` is required upstream; reading its absence as an empty list would say the
      // connection reaches nothing, so an unreadable body fails the read instead.
      if (!Array.isArray(payload?.accounts)) {
        throw new MicroserviceError('campaign-service returned an unreadable Google Ads account list.', 502, 'BAD_GATEWAY', {
          operation,
          service: 'campaign_controller',
        });
      }
      const accounts: GoogleAdsAccountOption[] = payload.accounts
        .filter((a) => typeof a?.id === 'string' && a.id !== '')
        .map((a) => ({ key: a.id, label: typeof a.label === 'string' && a.label.trim() !== '' ? a.label : a.id }));
      logger.success(req, operation, startTime, { count: accounts.length });
      res.json(accounts);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Whether this deployment can create X campaigns at all (`canCreateTwitter`), with no brief.
   *
   * The Plan picker needs the answer BEFORE a brief exists: `CampaignListResult.twitterCreateEnabled`
   * rides on a brief's campaign list, so a fresh Plan page would keep X "Coming soon" until a brief
   * without X had been saved. The answer is deployment-wide — flags only, no project or brief —
   * which is why it can be read up front. Answered as `{ enabled }` and never refused.
   */
  public getTwitterCreateCapability(_req: Request, res: Response): void {
    const result: TwitterCreateCapability = { enabled: canCreateTwitter() };
    res.json(result);
  }

  /**
   * Which X ad account an X create will use, and the accounts the credential reaches (LFXV2-3319):
   * campaign-service's `list-twitter-ads-accounts` beside the project's own X connection.
   *
   * `twitterConfig` names no account — the create runs under the connection's bound `account_id` and
   * is refused with `ErrAccountNotSelected` when it is empty — so the Implement tab shows this rather
   * than offering a choice the request could not carry.
   *
   * Root-only, as the Google Ads accounts route is and for the same reason: campaign-service resolves
   * a project with no X connection of its own to the LF system credential, so the list is then every
   * account the LF can reach. Gated on `canCreateTwitter` (404 while X creation is off, as if it were
   * not mounted): the read exists for the create flow only.
   */
  public async getTwitterAdsAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'twitter_ads_accounts';
    if (!canCreateTwitter()) {
      next(this.monitorDisabledError(operation));
      return;
    }
    if (!(await this.requireSharedAccountMonitorAccess(req, next, operation, 'X Ads'))) {
      return;
    }
    const projectSlug = this.requireMonitorProject(req, next, operation);
    if (projectSlug === null) {
      return;
    }
    const startTime = logger.startOperation(req, operation, { viaCampaignService: true });

    try {
      const [payload, connection] = await Promise.all([
        this.campaignServiceClient.listTwitterAdsAccounts(req, projectSlug),
        this.readMonitorConnection(req, projectSlug, 'twitter-ads'),
      ]);
      // `accounts` is required upstream; reading its absence as an empty list would say the
      // credential reaches nothing, so an unreadable body fails the read instead.
      if (!Array.isArray(payload?.accounts)) {
        throw new MicroserviceError('campaign-service returned an unreadable X Ads account list.', 502, 'BAD_GATEWAY', {
          operation,
          service: 'campaign_controller',
        });
      }
      const accounts: TwitterAdsAccountOption[] = payload.accounts
        .filter((a) => typeof a?.id === 'string' && a.id !== '')
        .map((a) => ({ key: a.id, label: typeof a.label === 'string' && a.label.trim() !== '' ? a.label : a.id }));
      const result: TwitterAdsAccountsResult = { accounts, connection };
      logger.success(req, operation, startTime, { count: accounts.length, connection: connection.state });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search Google's geo target table for the Implement tab's location picker, proxied to
   * campaign-service's `suggest-google-ads-geo-targets` (linuxfoundation/lfx-v2-campaign-service#411)
   * and answered in this app's camelCase vocabulary.
   *
   * Behind `LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_GEO_SEARCH` and the create cutover
   * (`canSearchGoogleGeoTargets`): off, the route answers 404 as if it were not mounted, the gating
   * the Google accounts route uses, because an older campaign-service has no suggest route to call.
   *
   * NOT root-only, unlike the accounts route beside it: the geo target table is Google's public
   * location data, not anything an ad account holds, so the LF system credential upstream falls back
   * to exposes nothing about any foundation. The router's `requireCampaignManager` still applies.
   *
   * Every parameter is checked against upstream's own bounds first, so a malformed search is a named
   * 400 here rather than a Goa validation error from campaign-service.
   */
  public async searchGoogleAdsGeoTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'google_ads_geo_target_search';
    if (!canSearchGoogleGeoTargets()) {
      next(this.monitorDisabledError(operation));
      return;
    }
    const refuse = (field: string, message: string): void =>
      next(ServiceValidationError.forField(field, message, { operation, service: 'campaign_controller', path: req.path }));

    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug === '') {
      refuse('project', 'A project is required to search Google Ads locations.');
      return;
    }
    const q = typeof req.query['q'] === 'string' ? googleAdsTrimSpace(req.query['q']) : '';
    if (q === '' || [...q].length > GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxQueryLength) {
      refuse('q', `Enter a place name or postal code of 1 to ${GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxQueryLength} characters.`);
      return;
    }

    const rawCountry = req.query['countryCode'];
    let countryCode: string | undefined;
    if (rawCountry !== undefined && rawCountry !== '') {
      if (typeof rawCountry !== 'string' || !GOOGLE_ADS_GEO_SEARCH_COUNTRY_PATTERN.test(rawCountry.trim())) {
        refuse('countryCode', 'A country to search within must be a two-letter ISO country code.');
        return;
      }
      countryCode = rawCountry.trim().toUpperCase();
    }

    // Repeated `?targetTypes=` arrives as an array and a single one as a string; anything else
    // (an object from `targetTypes[a]=…`) is refused rather than read as "no filter".
    const rawTypes = req.query['targetTypes'];
    let typeList: unknown[] = [];
    if (Array.isArray(rawTypes)) typeList = rawTypes;
    else if (rawTypes !== undefined) typeList = [rawTypes];
    if (!typeList.every((t): t is string => typeof t === 'string')) {
      refuse('targetTypes', 'Location types must be a list of type names.');
      return;
    }
    const targetTypes = typeList.map((t) => t.trim()).filter((t) => t !== '');
    if (targetTypes.length > GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxTargetTypes) {
      refuse('targetTypes', `At most ${GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxTargetTypes} location types can be searched at once.`);
      return;
    }
    if (targetTypes.some((t) => t.length > GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxTargetTypeLength || !/[A-Za-z0-9]/.test(t))) {
      refuse(
        'targetTypes',
        `Each location type must be a name of at most ${GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxTargetTypeLength} characters, such as Postal Code.`
      );
      return;
    }

    const rawLimit = req.query['limit'];
    let limit: number | undefined;
    if (rawLimit !== undefined && rawLimit !== '') {
      const parsed = typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxLimit) {
        refuse('limit', `The number of locations to return must be from 1 to ${GOOGLE_ADS_GEO_SEARCH_BOUNDS.maxLimit}.`);
        return;
      }
      limit = parsed;
    }

    const startTime = logger.startOperation(req, operation, { viaCampaignService: true, hasCountry: countryCode !== undefined, typeCount: targetTypes.length });
    try {
      const payload = await this.campaignServiceClient.suggestGoogleAdsGeoTargets(req, projectSlug, {
        q,
        ...(countryCode ? { country_code: countryCode } : {}),
        ...(targetTypes.length > 0 ? { target_types: targetTypes } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      // `suggestions` is required upstream; reading its absence as an empty list would say nothing
      // matched, so an unreadable body fails the search instead — the accounts route's rule.
      if (!Array.isArray(payload?.suggestions)) {
        throw new MicroserviceError('campaign-service returned an unreadable Google Ads location list.', 502, 'BAD_GATEWAY', {
          operation,
          service: 'campaign_controller',
        });
      }
      // A row whose id is not the shape `geoTargets` accepts cannot be added to a campaign, so it is
      // dropped rather than offered. Upstream patterns the field the same way; this is the belt.
      const suggestions: GoogleAdsGeoTargetSuggestion[] = payload.suggestions
        .filter((s) => typeof s?.id === 'string' && GOOGLE_ADS_GEO_SUGGESTION_ID_PATTERN.test(s.id) && typeof s.name === 'string')
        .map((s) => ({
          id: s.id,
          name: s.name,
          canonicalName: typeof s.canonical_name === 'string' && s.canonical_name.trim() !== '' ? s.canonical_name : s.name,
          countryCode: typeof s.country_code === 'string' ? s.country_code : '',
          targetType: typeof s.target_type === 'string' ? s.target_type : '',
          status: typeof s.status === 'string' ? s.status : '',
          ...(typeof s.reach === 'number' && Number.isFinite(s.reach) ? { reach: s.reach } : {}),
        }));
      const result: GoogleAdsGeoTargetSearchResult = { suggestions, truncated: payload.truncated === true };
      logger.success(req, operation, startTime, { count: suggestions.length, truncated: result.truncated });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getMetaMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');

    // Meta's account is shared by every foundation, so both arms below are root-only.
    if (!(await this.requireSharedAccountMonitorAccess(req, next, 'meta_monitor', 'Meta Ads'))) {
      return;
    }

    // Cutover on: the connection's account, checked by shape — see the LinkedIn route.
    if (isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      // A legacy picker's account, picked on a pod with the flag OFF, is refused — see the LinkedIn route.
      if (this.refuseLegacyReadOnCutover(req, next, 'meta_monitor')) {
        return;
      }
      const accountId = this.requireMonitorAccountId(req, next, 'meta_monitor', 'Meta Ads', META_ADS_MONITOR_ACCOUNT_ID_PATTERN);
      if (accountId === null) {
        return;
      }
      const label = META_ACCOUNTS.find((a) => a.accountId === accountId)?.label ?? accountId;
      await this.serveLegacyShapedMonitor(req, res, next, {
        operation: 'meta_monitor',
        platformLabel: 'Meta Ads',
        days,
        accountId,
        read: (projectSlug) => this.campaignServiceClient.getMetaAdsAccountMonitor(req, projectSlug, accountId, days),
        toResponse: (payload) => toMetaMonitorResponse(payload, label, new Date().toISOString()),
      });
      return;
    }

    // Flag OFF here. A read whose account came from the connection path was picked on a pod with it
    // ON; serving it from the legacy path would swap or refuse that account, so it is refused instead.
    if (this.refuseCutoverMismatch(req, next, 'meta_monitor')) {
      return;
    }

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

  /**
   * Which account each connection-backed Monitor panel offers, from the project's OWN connections
   * (#2519), and whether the monitors are served by campaign-service at all.
   *
   * With `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR` off this answers `viaCampaignService: false` and
   * reads nothing, and the tab keeps its legacy account lists — a 200, not the 404 the
   * campaign-service-only routes answer, because the tab must be able to tell "off" from "no
   * connection". On, it reads the five providers' connections in parallel. One provider's failure
   * is that provider's `unavailable` state, never the whole answer: the other panels still work.
   */
  public async getMonitorConnections(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'monitor_connections';
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      const off: CampaignMonitorConnections = { viaCampaignService: false, platforms: {} };
      res.json(off);
      return;
    }
    const projectSlug = this.requireMonitorProject(req, next, operation);
    if (projectSlug === null) {
      return;
    }
    const startTime = logger.startOperation(req, operation, { viaCampaignService: true });

    try {
      const entries = await Promise.all(
        (Object.entries(MONITOR_CONNECTION_PROVIDERS) as [MonitorConnectionPlatform, CampaignServiceMonitorProvider][]).map(
          async ([platform, provider]) => [platform, await this.readMonitorConnection(req, projectSlug, provider)] as const
        )
      );
      const body: CampaignMonitorConnections = { viaCampaignService: true, platforms: Object.fromEntries(entries) };
      logger.success(req, operation, startTime, {
        states: Object.fromEntries(entries.map(([platform, account]) => [platform, account.state])),
      });
      res.json(body);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Microsoft Advertising account monitor, from campaign-service only (#2519).
   *
   * No legacy path exists, so with `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR` off the route answers 404
   * as if it were not mounted. On, it maps campaign-service's `account-monitor` body onto
   * `ReportBackedMonitorResponse`: the Reddit/Meta row shape, plus the report-backed freshness
   * (`metricsAsOf`, `metricsPending`, `metricsWindow*`) a renderer needs to say how fresh the figures are.
   *
   * `accountKey` is the Microsoft account id itself — there is no LF allowlist for this platform —
   * so its shape is checked here, against the same pattern upstream enforces.
   */
  public async getMicrosoftMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.serveReportBackedMonitor(req, res, next, {
      operation: 'microsoft_monitor',
      platformLabel: 'Microsoft Ads',
      accountIdPattern: MICROSOFT_ADS_MONITOR_ACCOUNT_ID_PATTERN,
      read: (projectSlug, accountId, days) => this.campaignServiceClient.getMicrosoftAdsAccountMonitor(req, projectSlug, accountId, days),
    });
  }

  /**
   * X (Twitter) Ads account monitor, from campaign-service only (#2519). The Microsoft route's
   * sibling; additionally a 409 when the account cannot be monitored as it stands, with the
   * upstream `reason` forwarded as `upstreamCode`. Unlike Microsoft's, X's account is shared by
   * every foundation, so the read is root-only — refused before the flag-off 404 too.
   */
  public async getTwitterMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!(await this.requireSharedAccountMonitorAccess(req, next, 'twitter_monitor', 'X Ads'))) {
      return;
    }
    await this.serveReportBackedMonitor(req, res, next, {
      operation: 'twitter_monitor',
      platformLabel: 'X Ads',
      accountIdPattern: TWITTER_ADS_MONITOR_ACCOUNT_ID_PATTERN,
      read: (projectSlug, accountId, days) => this.campaignServiceClient.getTwitterAdsAccountMonitor(req, projectSlug, accountId, days),
    });
  }

  /**
   * HubSpot email monitor, from campaign-service only (#2519). PROJECT-scoped — there is no account
   * to pick — so it takes only `?project=` and `?days=`. Gated as the Microsoft route is, and mapped
   * onto `HubSpotEmailMonitorResponse`.
   */
  public async getHubSpotMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'hubspot_monitor';
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      if (!this.refuseCutoverMismatch(req, next, operation)) {
        next(this.monitorDisabledError(operation));
      }
      return;
    }
    const projectSlug = this.requireMonitorProject(req, next, operation);
    if (projectSlug === null) {
      return;
    }
    const days = this.parseMonitorDays(req);
    const startTime = logger.startOperation(req, operation, { days, viaCampaignService: true });

    try {
      const payload = await this.campaignServiceClient.getHubSpotAccountMonitor(req, projectSlug, days);
      const data = toHubSpotEmailMonitorResponse(payload, new Date().toISOString());
      logger.success(req, operation, startTime, {
        emails: data.emails.length,
        actionItems: data.actionItems.length,
        truncated: data.emailsTruncated,
      });
      res.json(data);
    } catch (error) {
      next(toAccountMonitorClientError(error, 'HubSpot', operation));
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
    // implements a toggle dispatcher for every paid platform upstream, while this set is the
    // shared TOGGLEABLE_CAMPAIGN_PLATFORMS (create-enabled plus adoptable) — so X is accepted for
    // its adopted campaigns although its create stays disabled. Deliberately not stated as a
    // count: the roster changes as platforms are enabled or become adoptable, and a number here
    // goes stale silently. HubSpot is in NEITHER set — an email send has no run state to pause.
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
      // A resume campaign-service refused (409) gets a message naming where an adopted campaign is
      // resumed, instead of a bare "try again". See `asResumeRefusal`.
      next(viaCampaignService && body.status === 'ACTIVE' ? asResumeRefusal(error, body.platform, 'campaign_status_update') : error);
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

    // The platform is a wording hint only (see `CampaignBudgetUpdateRequest.platform`), never sent
    // upstream. Optional, but a present value must be a known platform rather than silently ignored.
    if (body.platform !== undefined && !CAMPAIGN_PLATFORMS.some((p) => p.id === body.platform)) {
      next(
        ServiceValidationError.forField('platform', `platform must be one of: ${CAMPAIGN_PLATFORMS.map((p) => p.id).join(', ')}`, {
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
        platform: this.knownCampaignPlatform(req, 'campaign_budget_update', campaign.platform),
        campaignId,
        budget: body.budget,
        budgetType,
        etag: campaign.etag,
        serviceStatus: campaign.status,
      };
      logger.success(req, 'campaign_budget_update', startTime, { campaignId, budgetType, platform: result.platform });
      res.json(result);
    } catch (error) {
      next(body.platform === 'twitter-ads' ? this.explainTwitterBudgetConflict(error) : error);
    }
  }

  /**
   * Change a campaign's manual max cost-per-click bid through campaign-service's
   * `update-campaign-bid`, for the Optimize tab.
   *
   * The budget change's sibling, validated the same way. Only campaign-service can do this, so a
   * campaign is addressed by its campaign-service UUID alone. Everything that depends on the
   * campaign (platform support, the bid strategy, a recorded ad group, the platform's own floor and
   * ceiling) is decided upstream, and its status and message reach the caller unchanged through
   * `apiErrorHandler`.
   */
  public async updateCampaignBid(req: Request, res: Response, next: NextFunction): Promise<void> {
    const campaignId = req.params['campaignId'];

    if (!campaignId || !isCampaignServiceJobId(campaignId)) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId must be a campaign UUID', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const body = req.body as Partial<CampaignBidUpdateRequest>;

    // A real JSON number only, never coerced or rounded: it is in the ad account's own currency
    // and goes upstream exactly as sent. Upstream enforces the range and each platform's own
    // floor and ceiling, and names the reason.
    if (typeof body.bid !== 'number' || !Number.isFinite(body.bid) || body.bid <= 0) {
      next(
        ServiceValidationError.forField('bid', 'bid must be a finite number greater than zero', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    // Optional, unlike budgetType: upstream defaults it to its only value. A value that IS sent
    // must be that value, so a typo is refused rather than silently replaced.
    if (body.bidType !== undefined && (typeof body.bidType !== 'string' || !VALID_CAMPAIGN_BID_TYPES.has(body.bidType as CampaignBidType))) {
      next(
        ServiceValidationError.forField('bidType', `bidType must be one of: ${[...VALID_CAMPAIGN_BID_TYPES].join(', ')}`, {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof body.briefId === 'string' ? body.briefId.trim() : '';
    const etag = typeof body.etag === 'string' ? body.etag.trim() : '';
    if (!projectSlug) {
      next(
        ServiceValidationError.forField('project', 'project is required', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!briefId) {
      next(
        ServiceValidationError.forField('briefId', 'briefId is required to change a campaign bid', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!etag) {
      next(
        ServiceValidationError.forField('etag', 'etag is required so a concurrent edit cannot be overwritten', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    // Same reason as the budget change: an etag fetch cannot send as a header would surface as an
    // UNCONFIRMED bid write although nothing left the BFF.
    if (!CAMPAIGN_ETAG_HEADER_PATTERN.test(etag)) {
      next(
        ServiceValidationError.forField('etag', 'etag must be a valid HTTP header value', {
          operation: 'campaign_bid_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const bidType: CampaignBidType = (body.bidType as CampaignBidType | undefined) ?? DEFAULT_CAMPAIGN_BID_TYPE;
    const startTime = logger.startOperation(req, 'campaign_bid_update', { campaignId, briefId, bidType });

    try {
      const campaign = await this.campaignServiceClient.updateCampaignBid(req, {
        projectSlug,
        briefId,
        campaignId,
        bid: body.bid,
        bidType,
        etag,
      });
      // `platform`, `etag` and `serviceStatus` come from the ROW; `bid` and `bidType` echo the
      // request, which the platform accepted.
      const result: CampaignBidUpdateResult = {
        platform: this.knownCampaignPlatform(req, 'campaign_bid_update', campaign.platform),
        campaignId,
        bid: body.bid,
        bidType,
        etag: campaign.etag,
        serviceStatus: campaign.status,
      };
      logger.success(req, 'campaign_bid_update', startTime, { campaignId, bidType, platform: result.platform });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add campaign-level negative keywords through campaign-service's `add-negative-keywords`.
   *
   * The checks below mirror the upstream payload's own rules (1-60 entries, text 1-100 characters
   * in the allowed set, Exact, Phrase or Broad), so a malformed batch is refused before a round trip.
   * Upstream re-validates and adds what a pattern states badly (adjacent punctuation, duplicates),
   * and what depends on the campaign's platform, which only it knows: the match types that platform
   * takes, X's cap of 20, and whether `revision` belongs (required on Reddit, refused elsewhere).
   *
   * `revision` is forwarded only when the body carries one, and a present one must be a non-blank
   * string within upstream's length: an empty or blank revision is upstream's 400 on every platform,
   * so it is refused here rather than sent.
   *
   * The response is POSITIONAL: `results[i]` answers `negativeKeywords[i]`, and is passed on
   * index for index. Nothing here filters, sorts or de-duplicates it.
   */
  public async addNegativeKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const campaignId = req.params['campaignId'];

    if (!campaignId || !isCampaignServiceJobId(campaignId)) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId must be a campaign UUID', {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const body = req.body as Partial<CampaignNegativeKeywordsRequest>;
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    const briefId = typeof body.briefId === 'string' ? body.briefId.trim() : '';
    if (!projectSlug) {
      next(
        ServiceValidationError.forField('project', 'project is required', {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!briefId) {
      next(
        ServiceValidationError.forField('briefId', 'briefId is required to add negative keywords', {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const entries: unknown = body.negativeKeywords;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_NEGATIVE_KEYWORDS_PER_REQUEST) {
      next(
        ServiceValidationError.forField('negativeKeywords', `negativeKeywords must be an array of 1 to ${MAX_NEGATIVE_KEYWORDS_PER_REQUEST} entries`, {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const negativeKeywords: CampaignNegativeKeywordInput[] = [];
    for (const [i, entry] of entries.entries()) {
      const field = `negativeKeywords[${i}]`;
      const candidate = entry as Partial<CampaignNegativeKeywordInput> | null;
      const text = typeof candidate?.text === 'string' ? candidate.text : '';
      // Characters, not UTF-16 units: Microsoft counts characters, and upstream counts runes.
      if (text.trim() === '' || [...text].length > MAX_NEGATIVE_KEYWORD_TEXT_LENGTH || !NEGATIVE_KEYWORD_TEXT_PATTERN.test(text)) {
        next(
          ServiceValidationError.forField(
            `${field}.text`,
            `text must be 1 to ${MAX_NEGATIVE_KEYWORD_TEXT_LENGTH} characters of letters, digits, spaces and & ' - . only`,
            { operation: 'campaign_negative_keywords_add', service: 'campaign_controller' }
          )
        );
        return;
      }
      const matchType = candidate?.matchType;
      if (typeof matchType !== 'string' || !VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES.has(matchType as CampaignNegativeKeywordMatchType)) {
        next(
          ServiceValidationError.forField(`${field}.matchType`, `matchType must be one of: ${[...VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES].join(', ')}`, {
            operation: 'campaign_negative_keywords_add',
            service: 'campaign_controller',
          })
        );
        return;
      }
      // Sent as given. Upstream trims and collapses whitespace, and echoes the text it sent.
      negativeKeywords.push({ text, matchType: matchType as CampaignNegativeKeywordMatchType });
    }

    const rawRevision: unknown = body.revision;
    if (
      rawRevision !== undefined &&
      (typeof rawRevision !== 'string' || rawRevision.trim() === '' || rawRevision.length > MAX_KEYWORD_TARGETING_REVISION_LENGTH)
    ) {
      next(
        ServiceValidationError.forField('revision', `revision must be a non-blank string of at most ${MAX_KEYWORD_TARGETING_REVISION_LENGTH} characters`, {
          operation: 'campaign_negative_keywords_add',
          service: 'campaign_controller',
        })
      );
      return;
    }
    // Exactly as read: it is a fingerprint, compared byte for byte upstream.
    const revision = rawRevision as string | undefined;

    const startTime = logger.startOperation(req, 'campaign_negative_keywords_add', {
      campaignId,
      briefId,
      count: negativeKeywords.length,
      hasRevision: revision !== undefined,
    });

    try {
      const result = await this.campaignServiceClient.addNegativeKeywords(req, {
        projectSlug,
        briefId,
        campaignId,
        negativeKeywords,
        ...(revision !== undefined && { revision }),
      });
      logger.success(req, 'campaign_negative_keywords_add', startTime, {
        campaignId,
        requested: negativeKeywords.length,
        appliedCount: result.appliedCount,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Microsoft Advertising keyword performance for the campaigns table, from campaign-service.
   *
   * The Google read's sibling (`getKeywords`), with two differences. It has no legacy arm, so no
   * cutover flag: upstream answers 400 itself while its Microsoft metrics are off. And it takes
   * `?window=` rather than `?days=`, because Microsoft offers no 14-day window, so snapping a day
   * count would label one window's figures as another's. Omitted, upstream applies `last_30_days`.
   *
   * The project is REQUIRED and not defaulted, for the reason `getKeywords` gives.
   */
  public async getMicrosoftKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug === '') {
      next(
        ServiceValidationError.forField('project', 'A project is required to read keywords', {
          operation: 'campaign_microsoft_keywords',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    const rawWindow = req.query['window'];
    let window: MicrosoftKeywordsWindow | undefined;
    if (rawWindow !== undefined) {
      if (typeof rawWindow !== 'string' || !(MICROSOFT_KEYWORDS_WINDOWS as readonly string[]).includes(rawWindow)) {
        next(
          ServiceValidationError.forField('window', `window must be one of: ${MICROSOFT_KEYWORDS_WINDOWS.join(', ')}`, {
            operation: 'campaign_microsoft_keywords',
            service: 'campaign_controller',
            path: req.path,
          })
        );
        return;
      }
      window = rawWindow as MicrosoftKeywordsWindow;
    }

    const startTime = logger.startOperation(req, 'campaign_microsoft_keywords', { window });

    try {
      const payload = await this.campaignServiceClient.getMicrosoftAdsKeywords(req, projectSlug, window);
      const data = toMicrosoftKeywordMetricsResponse(payload, new Date().toISOString());
      logger.success(req, 'campaign_microsoft_keywords', startTime, {
        keywords: data.totalKeywords,
        rowCount: payload.row_count,
        truncated: payload.truncated,
        metricsAsOf: data.metricsAsOf,
        metricsPending: data.metricsPending,
      });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * The campaign-service arm of the LinkedIn, Meta and Reddit monitor routes: read the account monitor and
   * answer in the legacy shape the Monitor and Optimize panels already render.
   */
  private async serveLegacyShapedMonitor<T>(
    req: Request,
    res: Response,
    next: NextFunction,
    opts: {
      operation: string;
      platformLabel: string;
      days: number;
      accountId: string;
      read: (projectSlug: string) => Promise<CampaignServiceAccountMonitor>;
      toResponse: (payload: CampaignServiceAccountMonitor) => T;
    }
  ): Promise<void> {
    const projectSlug = this.requireMonitorProject(req, next, opts.operation);
    if (projectSlug === null) {
      return;
    }
    const startTime = logger.startOperation(req, opts.operation, { days: opts.days, accountId: opts.accountId, viaCampaignService: true });

    try {
      const payload = await opts.read(projectSlug);
      const data = opts.toResponse(payload);
      logger.success(req, opts.operation, startTime, {
        viaCampaignService: true,
        campaigns: payload.campaigns?.length ?? 0,
        fetchFailed: (payload.campaigns ?? []).filter((c) => c.fetch_failed).length,
      });
      res.json(data);
    } catch (error) {
      next(toAccountMonitorClientError(error, opts.platformLabel, opts.operation));
    }
  }

  /** The Microsoft and X routes: flag gate, account-id shape check, then the body mapped with its freshness. */
  private async serveReportBackedMonitor(
    req: Request,
    res: Response,
    next: NextFunction,
    opts: {
      operation: string;
      platformLabel: string;
      accountIdPattern: RegExp;
      read: (projectSlug: string, accountId: string, days: number) => Promise<CampaignServiceAccountMonitor>;
    }
  ): Promise<void> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceMonitor)) {
      if (!this.refuseCutoverMismatch(req, next, opts.operation)) {
        next(this.monitorDisabledError(opts.operation));
      }
      return;
    }
    const projectSlug = this.requireMonitorProject(req, next, opts.operation);
    if (projectSlug === null) {
      return;
    }
    const accountId = this.requireMonitorAccountId(req, next, opts.operation, opts.platformLabel, opts.accountIdPattern);
    if (accountId === null) {
      return;
    }
    const days = this.parseMonitorDays(req);
    const startTime = logger.startOperation(req, opts.operation, { days, accountId, viaCampaignService: true });

    try {
      const data = toReportBackedMonitorResponse(await opts.read(projectSlug, accountId, days), new Date().toISOString());
      logger.success(req, opts.operation, startTime, {
        campaigns: data.campaigns.length,
        metricsAsOf: data.metricsAsOf,
        metricsPending: data.metricsPending,
      });
      res.json(data);
    } catch (error) {
      next(toAccountMonitorClientError(error, opts.platformLabel, opts.operation));
    }
  }

  /**
   * The optional `?window=` of a campaign-service metrics read: the window, `undefined` when it was
   * OMITTED, or `null` once a malformed value has been reported to `next`. Shared by the brief-wide
   * and single-campaign reads, which accept the same seven values and refuse the same shapes.
   */
  private readMetricsWindow(req: Request, operation: string, next: NextFunction): CampaignMetricsWindow | undefined | null {
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
          operation,
          service: 'campaign_controller',
        })
      );
      return null;
    }
    // PRESENT-BUT-EMPTY is malformed, not absent. `?window=` and `?window=%20` arrive as a string,
    // and treating them as "no window given" would skip the enum check and serve the default —
    // the same fail-open shape as the array case above, one layer in. Only an OMITTED parameter
    // may default; every supplied value must be in the enum.
    const rawWindow = windowParam === undefined ? undefined : windowParam.trim();
    if (rawWindow !== undefined && !CAMPAIGN_METRICS_WINDOWS.includes(rawWindow as CampaignMetricsWindow)) {
      next(
        ServiceValidationError.forField('window', `window must be one of: ${CAMPAIGN_METRICS_WINDOWS.join(', ')}`, {
          operation,
          service: 'campaign_controller',
        })
      );
      return null;
    }
    return rawWindow as CampaignMetricsWindow | undefined;
  }

  /**
   * `?days=`, clamped to the account monitors' 7–90 range rather than refused — the behaviour the
   * Meta and Reddit routes already had. Upstream rejects an out-of-range value, so the clamp is
   * what keeps a stray `?days=365` a read instead of a 400.
   */
  private parseMonitorDays(req: Request): number {
    const rawDays = String(req.query['days'] ?? ACCOUNT_MONITOR_DEFAULT_DAYS);
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    return Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, ACCOUNT_MONITOR_MIN_DAYS), ACCOUNT_MONITOR_MAX_DAYS) : ACCOUNT_MONITOR_DEFAULT_DAYS;
  }

  /**
   * The project whose connection reads the account, or `null` after reporting a 400. Required, not
   * defaulted: campaign-service resolves the credential from it, and a guessed project would read
   * another foundation's connection.
   */
  private requireMonitorProject(req: Request, next: NextFunction, operation: string): string | null {
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug === '') {
      next(
        ServiceValidationError.forField('project', 'A project is required to read an account monitor', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return null;
    }
    return projectSlug;
  }

  /**
   * The `?accountKey=` a campaign-service monitor reads, or `null` after reporting a 400. Checked by
   * the provider's own shape, the pattern campaign-service enforces, so a malformed id is a named
   * 400 here rather than a Goa pattern error from upstream.
   */
  private requireMonitorAccountId(req: Request, next: NextFunction, operation: string, platformLabel: string, pattern: RegExp): string | null {
    const accountId = typeof req.query['accountKey'] === 'string' ? req.query['accountKey'].trim() : '';
    if (!pattern.test(accountId)) {
      next(
        ServiceValidationError.forField('accountKey', `A valid ${platformLabel} account id is required`, {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return null;
    }
    return accountId;
  }

  /**
   * Whether the caller is a cross-foundation principal: a ROOT writer, or a holder of ROOT
   * `global_marketing_ops`. The one test for every shared-account question — monitor reads and the
   * root-only Google audience segments. Both checks are request-cached and fail closed, and a ROOT
   * writer returns without a second lookup.
   */
  private async isRootCampaignPrincipal(req: Request): Promise<boolean> {
    return (await personaDetectionService.checkRootWriter(req)) || (await personaDetectionService.checkRootCampaignManager(req));
  }

  /**
   * Whether the caller may read shared-account monitor data or legacy Google insights, or `false`
   * after reporting a 403 `MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE` (lfx-self-serve-ops#54).
   *
   * `requireCampaignManager` authorises the caller for the ONE project it names, but an account
   * monitor on a shared account (Google Ads, Meta, Reddit, X, and LinkedIn's legacy allowlist account)
   * returns every foundation's campaigns. Only a cross-foundation principal may see that: a ROOT
   * writer, or a holder of ROOT `global_marketing_ops`. LF staff membership is not enough. Both checks
   * are request-cached and fail closed, and the refusal runs before any upstream call. A ROOT writer
   * returns immediately without a second ROOT marketing lookup.
   */
  private async requireSharedAccountMonitorAccess(req: Request, next: NextFunction, operation: string, platformLabel: string): Promise<boolean> {
    if (await this.isRootCampaignPrincipal(req)) {
      return true;
    }
    // `apiErrorHandler` logs the 403 itself; this only names the platform for tracing.
    logger.debug(req, operation, 'Refusing a shared-account monitor read for a non-root caller', { platform: platformLabel });
    next(
      new AuthorizationError(MONITOR_SHARED_ACCOUNT_RESTRICTED_MESSAGE, {
        operation,
        service: 'campaign_controller',
        path: req.path,
        code: MONITOR_SHARED_ACCOUNT_RESTRICTED_CODE,
      })
    );
    return false;
  }

  /**
   * One provider's connection as the Monitor tab's picker state. Never throws: campaign-service's
   * own 404 is `no_connection`, and anything else — a gateway 404, a 403, a transport failure — is
   * `unavailable`, because only the service's typed 404 says the connection does not exist.
   */
  private async readMonitorConnection(req: Request, projectSlug: string, provider: CampaignServiceMonitorProvider): Promise<MonitorConnectionAccount> {
    try {
      return toMonitorConnectionAccount(await this.campaignServiceClient.getConnection(req, projectSlug, provider), provider);
    } catch (error) {
      if (error instanceof MicroserviceError && !error.transportFailure && error.statusCode === 404 && isCampaignServiceNotFound(error.errorBody)) {
        return { state: 'no_connection', accountId: null, label: null };
      }
      logger.warning(req, 'monitor_connections', 'campaign-service connection read failed; reporting the platform as unavailable', {
        provider,
        status: error instanceof MicroserviceError ? error.statusCode : undefined,
        err: error,
      });
      return { state: 'unavailable', accountId: null, label: null };
    }
  }

  /**
   * On a pod with the monitor cutover OFF: refuse, with a retryable 409, a read the client marked as
   * coming from the connection path (`accountSource=connection`), and report whether it did.
   *
   * The marker means the tab learned its account — or that the panel exists at all — from a pod
   * with the cutover ON. The flag is per pod, so during a rolling change the follow-up read can
   * land here, where the legacy path would serve LinkedIn's DEFAULT account under the picked one's
   * name, refuse Reddit's or Meta's as off the allowlist, or answer the campaign-service-only routes
   * with a 404 the HubSpot panel would read as "no connection". None of that may be shown, so the
   * read is refused with a fixed message instead, and no legacy fallback runs. Unmarked requests
   * (a legacy picker) are untouched.
   */
  private refuseCutoverMismatch(req: Request, next: NextFunction, operation: string): boolean {
    if (req.query[MONITOR_ACCOUNT_SOURCE_PARAM] !== MONITOR_ACCOUNT_SOURCE_CONNECTION) {
      return false;
    }
    next(new MicroserviceError(MONITOR_CUTOVER_MISMATCH_MESSAGE, 409, MONITOR_CUTOVER_MISMATCH_CODE, { operation, service: 'campaign_controller' }));
    return true;
  }

  /**
   * The inverse of `refuseCutoverMismatch`, on a pod with the monitor cutover ON: refuse, with a
   * retryable 409 of its own code, a LinkedIn/Reddit/Meta read the Monitor tab marked as coming from
   * a LEGACY picker (`accountSource=legacy`), and report whether it did.
   *
   * That marker means the tab discovered its pickers on a pod with the cutover OFF, so the account is
   * an allowlist entry, not necessarily the project's connection's. campaign-service reads only the
   * connection's account, so serving it here would fail with an error that names the connection,
   * and a plain Retry would repeat it. The typed code tells the tab to rediscover its source instead.
   * Unmarked reads (the Optimize tab's) are served as before.
   */
  private refuseLegacyReadOnCutover(req: Request, next: NextFunction, operation: string): boolean {
    if (req.query[MONITOR_ACCOUNT_SOURCE_PARAM] !== MONITOR_ACCOUNT_SOURCE_LEGACY) {
      return false;
    }
    next(new MicroserviceError(MONITOR_CUTOVER_MISMATCH_MESSAGE, 409, MONITOR_CUTOVER_LEGACY_MISMATCH_CODE, { operation, service: 'campaign_controller' }));
    return true;
  }

  /** A 404 for a campaign-service-only monitor route while its flag is off — as if it were not mounted. */
  private monitorDisabledError(operation: string): MicroserviceError {
    return new MicroserviceError('Not found', 404, 'NOT_FOUND', { operation, service: 'campaign_controller' });
  }

  /**
   * Rewords campaign-service's platform-neutral "budget could not be addressed" 409 for an X
   * campaign. Its sentence tells the operator to change the pacing in the ad platform, which is not
   * the remedy on X: LFX One writes only the daily budget of a campaign-budget-optimized X campaign
   * with no total cap, and anything else has to be changed in X Ads Manager. The status, code and
   * upstream body are kept, and the upstream text stays on `message` for the log; only what the
   * client reads changes. Any other error — another 409 (provenance, account mismatch), a 412, an
   * unconfirmed 503 — is returned untouched.
   */
  private explainTwitterBudgetConflict(error: unknown): unknown {
    if (!(error instanceof MicroserviceError) || error.transportFailure || error.statusCode !== 409) {
      return error;
    }
    const upstreamMessage = typeof error.errorBody?.['message'] === 'string' ? (error.errorBody['message'] as string) : error.message;
    if (!upstreamMessage.trim().toLowerCase().startsWith(CAMPAIGN_SERVICE_BUDGET_UNWRITABLE_MESSAGE_PREFIX)) {
      return error;
    }
    return new MicroserviceError(error.message, error.statusCode, error.code, {
      operation: error.operation,
      service: error.service,
      path: error.path,
      errorBody: error.errorBody,
      originalMessage: error.originalMessage,
      originalError: error,
      clientMessage: CAMPAIGN_BUDGET_X_CONFLICT_MESSAGE,
    });
  }

  /**
   * The row's platform as one of `CampaignPlatform`, checked against `CAMPAIGN_PLATFORMS` rather
   * than cast. campaign-service's own vocabulary is that list; a value outside it (a contract change
   * upstream, a malformed row) is logged and reported as `null`, never passed off as a known one.
   */
  private knownCampaignPlatform(req: Request, operation: string, platform: unknown): CampaignPlatform | null {
    const known = CAMPAIGN_PLATFORMS.find((p) => p.id === platform);
    if (known) {
      return known.id;
    }
    logger.warning(req, operation, 'campaign-service reported a platform outside CampaignPlatform; returning null', {
      platform: typeof platform === 'string' ? platform : typeof platform,
    });
    return null;
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

  /** 415 for an upload that is not a PNG or JPEG, or whose bytes are not the type declared. */
  private unsupportedCreativeAsset(req: Request, operation: string): MicroserviceError {
    return new MicroserviceError(CREATIVE_ASSET_WRONG_TYPE_MESSAGE, 415, 'UNSUPPORTED_MEDIA_TYPE', {
      operation,
      service: 'campaign_controller',
      path: req.path,
    });
  }

  /**
   * `redditConfig.imageAssetId` when this deployment cannot honour it, else `null`.
   *
   * `in`, as for bidding: an explicit `imageAssetId: null` is still the field, and campaign-service
   * would refuse it. Off means either the legacy creator serves (it never reads the field, so the
   * campaign would have no ad) or campaign-service's URL signing is unconfigured (it refuses).
   */
  private unservedRedditAssetField(body: CampaignCreateRequest): string | null {
    if (canUseRedditCreativeAssets()) return null;
    const config: unknown = body?.redditConfig;
    if (config !== null && typeof config === 'object' && 'imageAssetId' in config) return 'redditConfig.imageAssetId';
    return null;
  }

  /**
   * The first `metaConfig.variants[i].imageAssetId` when this deployment cannot honour it, else
   * `null`. `in`, as for the Reddit field: an explicit `imageAssetId: null` is still the field.
   */
  private unservedMetaAssetField(body: CampaignCreateRequest): string | null {
    if (canUseMetaCreativeAssets()) return null;
    const config: unknown = body?.metaConfig;
    if (config === null || typeof config !== 'object' || !('variants' in config) || !Array.isArray(config.variants)) return null;
    const index = config.variants.findIndex((variant: unknown) => variant !== null && typeof variant === 'object' && 'imageAssetId' in variant);
    return index === -1 ? null : `metaConfig.variants[${index}].imageAssetId`;
  }

  /**
   * The first stored-image entry in a Google creative image field when this deployment cannot
   * honour it, as `<creative key>.<field>[i].imageAssetId`, else `null`.
   *
   * Every channel's creative key is scanned, not only the selected channel's: a stored image the
   * request carries anywhere is one the operator chose, and naming it is cheaper than reasoning about
   * which key the normalizer would have read. `in`, as for the Meta field: an explicit
   * `imageAssetId: null` is still the field.
   */
  private unservedGoogleAssetField(body: CampaignCreateRequest): string | null {
    if (canUseGoogleCreativeAssets()) return null;
    const raw = body as unknown as Record<string, unknown>;
    for (const spec of Object.values(GOOGLE_CREATIVE_FIELDS)) {
      const creative = raw?.[spec.key];
      if (creative === null || typeof creative !== 'object' || Array.isArray(creative)) continue;
      for (const field of spec.images) {
        const value = (creative as Record<string, unknown>)[field];
        if (!Array.isArray(value)) continue;
        const index = value.findIndex((entry: unknown) => entry !== null && typeof entry === 'object' && 'imageAssetId' in entry);
        if (index !== -1) return `${spec.key}.${field}[${index}].imageAssetId`;
      }
    }
    return null;
  }

  /** `unservedMetaAssetField`'s LinkedIn sibling: the first `linkedInConfig.variants[i].imageAssetId` this deployment cannot honour. */
  private unservedLinkedInAssetField(body: CampaignCreateRequest): string | null {
    if (canUseLinkedInCreativeAssets()) return null;
    const config: unknown = body?.linkedInConfig;
    if (config === null || typeof config !== 'object' || !('variants' in config) || !Array.isArray(config.variants)) return null;
    const index = config.variants.findIndex((variant: unknown) => variant !== null && typeof variant === 'object' && 'imageAssetId' in variant);
    return index === -1 ? null : `linkedInConfig.variants[${index}].imageAssetId`;
  }

  /**
   * Whether `microsoftConfig.imageAssetId` is present while this deployment cannot honour it. `in`,
   * as for the Reddit field: an explicit `imageAssetId: null` is still the field.
   */
  private unservedMicrosoftAssetField(body: CampaignCreateRequest): boolean {
    if (canUseMicrosoftCreativeAssets()) return false;
    const config: unknown = body?.microsoftConfig;
    return config !== null && typeof config === 'object' && 'imageAssetId' in config;
  }

  /** The first lane config carrying `bidding` while this deployment cannot honour it (see `createCampaign`), or `null`. */
  private unservedBiddingField(body: CampaignCreateRequest): string | null {
    if (canCreateWithBidding()) return null;
    for (const key of ['linkedInConfig', 'metaConfig', 'microsoftConfig', 'redditConfig', 'twitterConfig'] as const) {
      const config: unknown = body?.[key];
      // `in`, not a truthiness test: an explicit `bidding: null` is still a bidding field, and
      // campaign-service would refuse it rather than read it as automatic.
      if (config !== null && typeof config === 'object' && 'bidding' in config) return `${key}.bidding`;
    }
    return null;
  }

  /**
   * `geoTargets` or `proximityTargets` when a Google create carries a postal-code id or a radius target
   * this deployment cannot honour (see `createCampaign`), else `null`.
   *
   * A numeric `geoTargets` entry is judged after Go's trim, as the builder judges it, so a padded id
   * cannot slip past. An EMPTY `proximityTargets` list carries nothing to drop and is let through.
   */
  private unservedGoogleGeoField(body: CampaignCreateRequest): string | null {
    if (canCreateWithFinerGoogleGeo()) return null;
    if (!Array.isArray(body?.platforms) || !body.platforms.includes('google-ads')) return null;
    const geoTargets: unknown = body?.geoTargets;
    if (Array.isArray(geoTargets) && geoTargets.some((g) => typeof g === 'string' && GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(googleAdsTrimSpace(g)))) {
      return 'geoTargets';
    }
    const proximityTargets: unknown = body?.proximityTargets;
    if (proximityTargets !== undefined && proximityTargets !== null && !(Array.isArray(proximityTargets) && proximityTargets.length === 0)) {
      return 'proximityTargets';
    }
    return null;
  }

  /**
   * `twitterConfig` or `platforms` when a request asks for X while this deployment cannot create
   * there (`canCreateTwitter`), else `null`.
   *
   * `in` for the config, as for bidding: an explicit `twitterConfig: null` is still the field. The
   * config is named first because it is the more specific answer; a bare `twitter-ads` in the
   * platform list, with no config, is named as `platforms`.
   */
  private unservedTwitterField(body: CampaignCreateRequest): string | null {
    if (canCreateTwitter()) return null;
    if (body !== null && typeof body === 'object' && 'twitterConfig' in body) return 'twitterConfig';
    if (Array.isArray(body?.platforms) && body.platforms.includes('twitter-ads')) return 'platforms';
    return null;
  }

  /**
   * The first `twitterConfig` field campaign-service would refuse, by name, or `null`.
   *
   * Only for a request that selects X with X enabled; otherwise `unservedTwitterField` has already
   * answered. Each rule is the X client's own (`CreateCampaign`, `internal/platform/twitter/client.go`)
   * except the budget floor, which is this app's house floor of 1:
   *
   * - `budgetAmount`: a finite number, at least 1 and at most `TWITTER_MAX_BUDGET`.
   * - `startDate` / `endDate`: real `YYYY-MM-DD` dates, untrimmed as Go reads them, the end strictly
   *   after the start. That the start is in the future is left to campaign-service, for the
   *   clock-boundary reason Meta's past-start check is.
   * - `tweetText`: non-blank, and within X's weighted cap once the destination link is appended
   *   (copy that carries a link of its own is judged on its own weight, see `twitterTweetTextError`).
   * - `imageAssetId`: when present, a non-blank string; whether it names an asset is upstream's call.
   *
   * A missing `twitterConfig` with `twitter-ads` selected is NOT refused here: `hasPlatformConfig`
   * already refuses an unconfigured platform by name inside `createCampaigns`.
   */
  private twitterConfigRefusal(body: CampaignCreateRequest): { field: string; message: string } | null {
    if (!Array.isArray(body?.platforms) || !body.platforms.includes('twitter-ads')) return null;
    const config: unknown = body?.twitterConfig;
    if (config === undefined) return null;
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return { field: 'twitterConfig', message: 'twitterConfig must be an object' };
    }
    const raw = config as Partial<Record<keyof TwitterCampaignCreateRequest, unknown>>;
    const budget = raw.budgetAmount;
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 1 || budget > TWITTER_MAX_BUDGET) {
      return {
        field: 'twitterConfig.budgetAmount',
        message: `the X daily budget must be a number from 1 to ${TWITTER_MAX_BUDGET.toLocaleString('en-US')} in the ad account's currency`,
      };
    }
    for (const key of ['startDate', 'endDate'] as const) {
      if (!this.isCalendarDate(raw[key])) {
        return { field: `twitterConfig.${key}`, message: `the X ${key === 'startDate' ? 'start' : 'end'} date must be a real date written YYYY-MM-DD` };
      }
    }
    if ((raw.endDate as string) <= (raw.startDate as string)) {
      return {
        field: 'twitterConfig.endDate',
        message:
          'the X end date must be after its start date, and X will refuse this flight. Set an end date at least one day after the start date and create again.',
      };
    }
    // Lenient: copy carrying its own link may not get the destination appended upstream, and only
    // campaign-service knows the tagged link it compares, so that case is left to it.
    const tweetError = typeof raw.tweetText === 'string' ? twitterTweetTextError(raw.tweetText, true) : 'Enter the tweet text.';
    if (tweetError !== null) return { field: 'twitterConfig.tweetText', message: tweetError };
    if ('imageAssetId' in raw && (typeof raw.imageAssetId !== 'string' || raw.imageAssetId.trim() === '')) {
      return {
        field: 'twitterConfig.imageAssetId',
        message: 'the X image must be the id of an image uploaded to this brief; omit imageAssetId for a tweet with no image',
      };
    }
    return null;
  }

  /** A real `YYYY-MM-DD` date, exactly as written: Go's `validateDate` does not trim, so neither does this. */
  private isCalendarDate(value: unknown): value is string {
    if (typeof value !== 'string' || !ISO_CALENDAR_DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  /**
   * The first of `GOOGLE_CUTOVER_ONLY_CREATE_FIELDS` a Google create carries while this deployment
   * cannot honour it (see `createCampaign`), else `null`.
   *
   * The bidding plan and creative entries (`normalized`) count only when the cutover's own
   * normalizers would send them (see the constant). For every other entry, only a NON-EMPTY value
   * counts: absent, `null` and an empty list ask for nothing, and the legacy creator serves those
   * requests exactly as asked, so refusing one would be over-refusal. Any other present value — a
   * malformed non-list included — is a request for something the legacy creator cannot do, and is
   * named rather than dropped, as `unservedGoogleGeoField` treats a radius target.
   */
  private unservedGoogleCriteriaField(body: CampaignCreateRequest): (typeof GOOGLE_CUTOVER_ONLY_CREATE_FIELDS)[number] | null {
    if (canCreateWithGoogleCriteria()) return null;
    // The legacy creator's own platform default (`campaign-proxy.service.ts`): an omitted or empty
    // `platforms` list is a Google create there, so it is one here too, or exactly that request
    // would slip past every refusal below.
    const platforms = Array.isArray(body?.platforms) && body.platforms.length > 0 ? body.platforms : ['google-ads'];
    if (!platforms.includes('google-ads')) return null;
    const raw = body as unknown as Record<string, unknown>;
    // The keys the cutover would actually send for the `normalized` entries: its own bidding plan,
    // and every channel's creative, so a creative left behind under an unselected channel is judged
    // the way `unservedGoogleAssetField` judges it — present in the request, so asked for.
    const sent: Record<string, unknown> = { ...this.googleBidding(body) };
    for (const channel of Object.keys(GOOGLE_CREATIVE_REQUEST_KEYS) as GoogleCampaignChannel[]) {
      Object.assign(sent, this.googleCreative(body, channel));
    }
    return (
      GOOGLE_CUTOVER_ONLY_CREATE_FIELDS.find((entry) => {
        if ('normalized' in entry) return entry.field in sent;
        const value = raw[entry.field];
        return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
      }) ?? null
    );
  }

  /**
   * `metaConfig.instagramUserId`, `dsaBeneficiary` or `dsaPayor` when this deployment cannot honour
   * them, else `null`. `in`, as for the Microsoft dates below: an explicit `null` is still the field.
   */
  private unservedMetaInstagramDsaField(body: CampaignCreateRequest): string | null {
    if (canCreateMetaInstagramDsa()) return null;
    const config: unknown = body?.metaConfig;
    if (config === null || typeof config !== 'object') return null;
    for (const key of ['instagramUserId', 'dsaBeneficiary', 'dsaPayor'] as const) {
      if (key in config) return `metaConfig.${key}`;
    }
    return null;
  }

  /**
   * `microsoftConfig.startDate` or `endDate` when this deployment cannot honour them, else `null`.
   *
   * `in`, as for bidding: an explicit `startDate: null` is still the field. Off means either the
   * legacy creator serves (it never reads the dates) or campaign-service predates
   * linuxfoundation/lfx-v2-campaign-service#409 (it drops them) — a campaign with no flight either way.
   */
  private unservedMicrosoftScheduleField(body: CampaignCreateRequest): string | null {
    if (canCreateMicrosoftSchedule()) return null;
    const config: unknown = body?.microsoftConfig;
    if (config === null || typeof config !== 'object') return null;
    for (const key of ['startDate', 'endDate'] as const) {
      if (key in config) return `microsoftConfig.${key}`;
    }
    return null;
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

    const twitterConfig = this.buildTwitterConfig(body);
    if (twitterConfig) envelope['twitterConfig'] = twitterConfig;

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
   * Why upstream would refuse one entry of a trimmed sitelink list, or `null` when it would not.
   *
   * `validateSitelinks`' per-entry branches in order: link text blank, over 25 runes, then a repeat
   * keyed on Go's `strings.ToLower`; the description lines both-or-neither, then each over 35 runes;
   * then the destination, judged by {@link googleSitelinkUrlRefusal}. The echo is cut short.
   */
  private googleSitelinkRefusal(sitelink: CampaignSitelink, index: number, seen: Set<string>): string | null {
    const { text, description1 = '', description2 = '', finalUrl } = sitelink;
    if (text === '') return `Google Ads sitelink ${index + 1} has no link text. Fill it in or remove the sitelink, then create again.`;
    const shown = googleAdsEchoed(text);
    const runes = [...text].length;
    if (runes > GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES) {
      return `Google Ads accepts sitelink link text of at most ${GOOGLE_ADS_MAX_SITELINK_TEXT_RUNES} characters, and ${shown} has ${runes}. Shorten it and create again.`;
    }
    const key = googleAdsToLower(text);
    if (seen.has(key)) return `Google Ads refuses a campaign that lists the sitelink ${shown} more than once. Remove the repeat and create again.`;
    seen.add(key);

    if ((description1 === '') !== (description2 === '')) {
      return `Google Ads needs both description lines on the sitelink ${shown} or neither, and this one has just one. Fill in the other or clear both, then create again.`;
    }
    if ([description1, description2].some((line) => [...line].length > GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES)) {
      return `Google Ads accepts sitelink description lines of at most ${GOOGLE_ADS_MAX_SITELINK_DESCRIPTION_RUNES} characters, and one on ${shown} is longer. Shorten it and create again.`;
    }
    return this.googleSitelinkUrlRefusal(finalUrl, shown);
  }

  /**
   * Why upstream would refuse a sitelink destination, or `null` when it would not.
   *
   * `validateServableURL`, then the byte bound: {@link describeDestinationUrl} plus the Go parser
   * rules `new URL()` does not share ({@link googleAdsUrlGoParseFlaw}).
   *
   * The byte bound is measured on the URL as sent. Upstream measures it after `buildTaggedFinalURL`
   * adds the utm parameters, which this does not rebuild, so a URL just under the bound can still be
   * refused upstream: a known under-refusal, documented on {@link GOOGLE_ADS_MAX_FINAL_URL_BYTES}.
   */
  private googleSitelinkUrlRefusal(finalUrl: string, shown: string): string | null {
    if (finalUrl === '') return `The Google Ads sitelink ${shown} has no destination URL. Fill it in or remove the sitelink, then create again.`;
    const shape = this.describeDestinationUrl(finalUrl);
    if ((shape !== 'ok' && shape !== 'ok-http') || googleAdsUrlGoParseFlaw(finalUrl)) {
      return `The destination URL on the Google Ads sitelink ${shown} is not a web address Google accepts. Use a full https:// address with no embedded credentials, no semicolons in the query and no stray % signs, then create again.`;
    }
    const bytes = new TextEncoder().encode(finalUrl).length;
    if (bytes > GOOGLE_ADS_MAX_FINAL_URL_BYTES) {
      return `The destination URL on the Google Ads sitelink ${shown} is ${bytes} bytes, over Google's ${GOOGLE_ADS_MAX_FINAL_URL_BYTES}-byte limit. Shorten it and create again.`;
    }
    return null;
  }

  /**
   * Whether one raw sitelink entry survives the Go decode into `googleAdsSitelinkConfig`: an object
   * (or null, which decodes to a blank sitelink) whose four fields are absent, null or text.
   */
  private isSitelinkShape(entry: unknown): boolean {
    if (entry === null) return true;
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    return (['text', 'description1', 'description2', 'finalUrl'] as const).every(
      (f) => fields[f] === undefined || fields[f] === null || typeof fields[f] === 'string'
    );
  }

  /**
   * The sitelink list as judged and dispatched: each field trimmed with Go's rules as
   * `validateSitelinks` trims it, an absent or null field read as blank. Nothing is dropped, so a
   * blank entry is refused by name. Callers have checked the shape with {@link isSitelinkShape}.
   */
  private googleSitelinkList(raw: unknown): CampaignSitelink[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const field = (name: string): string => (typeof fields[name] === 'string' ? googleAdsDecodedText(fields[name] as string) : '');
      return { text: field('text'), description1: field('description1'), description2: field('description2'), finalUrl: field('finalUrl') };
    });
  }

  /**
   * Google's config, translated from the flat legacy request.
   *
   * Google is the one platform whose inputs live on the request root rather than in a
   * `<platform>Config` object, because the legacy path had a dedicated Google endpoint. Every
   * field below is one the dispatcher reads from `config` and cannot recover from the stored
   * brief: sending nothing creates a campaign with no budget and an ad group with no criteria,
   * which per `googleAdsConfig.Keywords` "can never serve". `adoptExisting` is omitted because it
   * must default to false so a re-dispatch cannot silently rebind an existing upstream campaign.
   *
   * Budget depends on WHICH channel this config is for, and the two cases differ.
   *
   * For a SEARCH create, budget is the Search SHARE rather than the whole request budget: the
   * dispatcher creates exactly one Search campaign, so handing it the combined figure would
   * spend the demand-gen half on Search.
   *
   * For a SINGLE NON-SEARCH selection — demand-gen, performance-max, video or display — this
   * returns a config carrying the FULL budget and that `channel` — not null. Since LFXV2-3257
   * ported `createDemandGenCampaign` into campaign-service there is no Search campaign to split
   * the budget with, so the whole amount funds the one campaign being created; the same holds
   * for the three channels added alongside Demand Gen.
   *
   * A MULTI-CHANNEL selection is refused DOWNSTREAM, not before this point: the controller builds
   * the envelope (line ~304) and only then calls `createCampaigns` (line ~346), where the
   * one-Google-channel guard lives. So a multi-channel selection DOES reach this builder and
   * produces a config for whichever channel it picks, which `createCampaigns` then refuses — see
   * the inline comment below for why one-config-one-channel is a limit of this builder rather
   * than of campaign-service's schema.
   *
   * Null means UNCONFIGURED, and `createCampaign` refuses the whole create when a selected
   * platform lands here — see `hasPlatformConfig`. The refusal must happen HERE: the caller
   * passes `platforms` through unfiltered, and campaign-service reads an absent config key as a
   * zero value, so an unrefused google-ads would dispatch with budget 0 and no headlines.
   */
  private buildGoogleAdsConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    if (!body?.platforms?.includes('google-ads')) return null;

    const types = body.campaignTypes ?? [];
    // The Google channels the operator selected, in the catalogue's own order so the choice of
    // which one to build is stable rather than a function of how the form happened to emit them.
    // `sponsored` and `social` name the LinkedIn and Meta shapes and are filtered out here: they
    // are not values `googleAdsConfig.channel` accepts, and a brief that carries them alongside a
    // Google selection is ordinary.
    const selectedChannels = GOOGLE_CAMPAIGN_CHANNELS.filter((c) => types.includes(c));
    const includesSearch = selectedChannels.includes('search');

    // No Google channel selected: nothing to build. Returning null marks the platform
    // UNCONFIGURED, and `hasPlatformConfig` refuses the create rather than dispatching
    // a zero-value config.
    if (selectedChannels.length === 0) return null;

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
    //
    // A numeric entry passes the shape test as well: it is a raw geo target constant id, which is how
    // the Implementation tab sends a postal-code target, and upstream's `resolveGeoEntry` tells the two
    // spellings apart by exactly this shape. Whether the id is canonical is `createCampaign`'s call,
    // made by name before this config is dispatched.
    if (!cleanGeoTargets.every((g) => META_GEO_CODE_PATTERN.test(g) || GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(g))) return null;

    // A SINGLE NON-SEARCH channel gets the WHOLE budget: there is no Search campaign to fund, so
    // the split does not apply. campaign-service creates the campaign with no ad and no keywords
    // (LFXV2-3257 for Demand Gen; the same shell shape for Performance Max, Video and Display).
    //
    // TWO OR MORE Google channels together are refused DOWNSTREAM in `createCampaigns`, not before
    // this builder runs, deliberately — and the
    // reason is THIS function, not campaign-service's schema. #130 widened the slot key to
    // (brief_id, platform, variant), so a brief can now hold a Search row and a Demand Gen row
    // at once; the database does not forbid the pair.
    //
    // What forbids it is that this builder returns ONE config with ONE channel. A mixed create
    // would dispatch a single campaign and silently drop the other half — and half the budget.
    // Serving the pair means emitting two configs, which is a change here rather than a schema
    // decision. Until then a loud refusal beats a silent partial create.
    if (!includesSearch) {
      // A NON-SEARCH channel on its own: Demand Gen, Performance Max, Video or Display. All four
      // take the same shape and the WHOLE budget, for the same reason — there is no Search
      // campaign beside them to fund, so the split does not apply.
      //
      // Headlines, descriptions and keywords are deliberately ABSENT, not empty. Upstream
      // REFUSES `keywords` and `audienceSegments` on every channel but Search rather than
      // dropping them (`validateCampaignKind`, `internal/platform/googleads`), so forwarding the
      // Implementation tab's keyword list here would turn a servable create into a refusal.
      //
      // The CREATIVE is the one thing these channels take that Search's fields cannot express, and
      // it is now forwarded — `demandGenCreative`, `performanceMaxCreative` or `displayCreative`,
      // whichever matches the single selected channel. Before this it had no source on the request
      // and every non-Search create produced a campaign with no ad: billable, un-servable, and
      // reported as a success. A creative that is absent or empty still takes the old road, so an
      // operator who skips the section gets exactly the shell they got before rather than a refusal.
      //
      // `videoCreative` is NOT built, and the omission is not an oversight to be tidied up later:
      // `GOOGLE_VIDEO_CREATE_SUPPORTED` is false because the Google Ads API has no call that
      // creates a Video campaign, so `createCampaigns` refuses a `video` channel before this config
      // is ever dispatched. There is nothing for a video creative to attach to.
      const creative = this.googleCreative(body, selectedChannels[0]);
      // Normalized only — `createCampaign` names every language refusal before this is dispatched.
      const languages = this.googleLanguages(body, selectedChannels[0]);
      return {
        budget: body.budgetUsd ?? 0,
        channel: selectedChannels[0],
        ...this.googleFlightWindow(body),
        ...this.googleBidding(body),
        ...(cleanGeoTargets.length > 0 ? { geoTargets: cleanGeoTargets } : {}),
        // Exclusions reach EVERY channel, radius targets every channel but Demand Gen — the two
        // halves of the same location plan are gated differently because `validateGeoPlan` gates
        // them differently. Both normalized only; `createCampaign` names every refusal first.
        ...this.googleExcludedGeoTargets(body),
        ...this.googleProximityTargets(body, selectedChannels[0]),
        ...this.googleAdSchedules(body, selectedChannels[0]),
        // The two halves of Performance Max's split, gated separately because upstream fences them
        // in two branches for two different reasons — either could move without the other. Both
        // normalized only; `createCampaign` names every refusal first.
        ...this.googleDeviceBidModifiers(body, selectedChannels[0]),
        ...this.googleDemographicExclusions(body, selectedChannels[0]),
        ...languages,
        ...creative,
      };
    }

    // The Search SHARE applies only when a second channel is funded alongside it. One channel
    // selected means `pct` is 100 whichever channel it is.
    const pct = selectedChannels.length > 1 ? (body.searchBudgetPct ?? 100) : 100;
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

    // Search always takes languages — it is the channel upstream's own header calls the one these
    // criteria were written for — so the channel gate inside the helper can only pass here. The call
    // is still made through the same helper so the two branches cannot normalize differently.
    const searchLanguages = this.googleLanguages(body, 'search');

    // Normalized only — `createCampaign` names every callout refusal before this is dispatched.
    const callouts = this.googleCallouts(body);
    // Normalized only, as the callouts are — `createCampaign` names every sitelink refusal first.
    const sitelinks = this.googleSitelinks(body);
    // Normalized only, as the extensions are — `createCampaign` names every segment refusal first.
    const audienceSegments = this.googleAudienceSegments(body);
    // Normalized only, as the two above are — `createCampaign` names every snippet refusal first.
    const structuredSnippets = this.googleStructuredSnippets(body);
    // Normalized only, as the three above are — `createCampaign` names every call, promotion and
    // price refusal first.
    const assetExtensions = this.googleAssetExtensions(body);

    return {
      budget,
      // Explicit rather than relying on the upstream default. Absent means Search there
      // too, but naming it keeps the two branches of this function symmetrical and makes
      // a future default change unable to repoint this one silently.
      channel: 'search',
      ...this.googleFlightWindow(body),
      ...this.googleBidding(body),
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
      // Both location lists reach Search: it is the channel upstream's campaign-level geo criteria
      // were written for, so the proximity gate inside the helper can only pass here. The call is
      // still made through the same helper so the two branches cannot normalize differently.
      ...this.googleExcludedGeoTargets(body),
      ...this.googleProximityTargets(body, 'search'),
      ...this.googleAdSchedules(body, 'search'),
      // Search takes both halves of the criteria set — it is the channel upstream's own header calls
      // the one these criteria were written for — so the gates inside the helpers can only pass
      // here. The calls are still made through the same helpers so the two branches cannot normalize
      // differently.
      ...this.googleDeviceBidModifiers(body, 'search'),
      ...this.googleDemographicExclusions(body, 'search'),
      ...searchLanguages,
      ...audienceSegments,
      ...callouts,
      ...sitelinks,
      ...structuredSnippets,
      ...assetExtensions,
    };
  }

  /**
   * The Search ad group's audience segments, spread-ready, or `{}` when the request names none.
   *
   * Search only, so only the Search branch calls it: `createCampaign` refuses segments on any other
   * channel by name, because upstream fails the whole create there. Omitted rather than sent empty,
   * the absent-key route every caller predating the field takes.
   */
  private googleAudienceSegments(body: CampaignCreateRequest): { audienceSegments?: string[] } {
    const clean = this.googleAudienceSegmentList(body?.audienceSegments);
    return clean.length > 0 ? { audienceSegments: clean } : {};
  }

  /**
   * The segment list as dispatched: strings only (`createCampaign` refuses anything else first),
   * each trimmed with Go's rules as `validateAudienceSegments` trims it. Blanks are KEPT so they are
   * refused by name, and repeats are kept for upstream to collapse.
   */
  private googleAudienceSegmentList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is string => typeof s === 'string').map((s) => googleAdsTrimSpace(s));
  }

  /**
   * Why upstream would refuse one entry of a trimmed segment list, or `null` when it would not.
   *
   * `validateAudienceSegments`' per-entry branches in order: blank, then a resource name that is not
   * `customers/{id}/userLists/{id}`, with a well-formed custom audience named for what it is —
   * upstream parses one and refuses it on Search. The echo is cut short: the text comes from an
   * unvalidated body.
   */
  private googleAudienceSegmentRefusal(segment: string, index: number): string | null {
    if (segment === '') return `Google Ads audience segments cannot include a blank entry (segment ${index + 1}). Remove it and create again.`;
    if (GOOGLE_ADS_USER_LIST_RESOURCE_PATTERN.test(segment)) return null;
    const shown = googleAdsEchoed(segment);
    if (GOOGLE_ADS_CUSTOM_AUDIENCE_RESOURCE_PATTERN.test(segment)) {
      return `Google Ads cannot target the custom audience ${shown} on a Search campaign — only user lists are accepted. Replace it with a user list and create again.`;
    }
    return `The Google Ads audience segment ${shown} is not a user list resource name. Use the form customers/{customerId}/userLists/{id}, with the customer id written without dashes, and create again.`;
  }

  /**
   * The Search campaign's callout extensions, spread-ready, or `{}` when the request names none.
   *
   * Search only, so only the Search branch calls it: `createCampaign` refuses callouts on any other
   * channel by name, because `validateAssetPlan` fails the whole create there. Omitted rather than
   * sent empty, the absent-key route every caller predating the field takes.
   */
  private googleCallouts(body: CampaignCreateRequest): { callouts?: string[] } {
    const clean = this.googleCalloutList(body?.callouts);
    return clean.length > 0 ? { callouts: clean } : {};
  }

  /**
   * The callout list as dispatched: strings only (`createCampaign` refuses anything else first),
   * each trimmed with Go's rules as `validateCallouts` trims it. Blanks are KEPT so they are refused
   * by name; upstream refuses them too ("callout %d is empty").
   */
  private googleCalloutList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((c): c is string => typeof c === 'string').map((c) => googleAdsDecodedText(c));
  }

  /**
   * Why upstream would refuse one entry of a trimmed callout list, or `null` when it would not.
   *
   * `validateCallouts`' per-entry branches in order: blank, then the rune bound (`[...text]`, which
   * counts code points as `utf8.RuneCountInString` does), then a repeat keyed on Go's
   * `strings.ToLower`. `seen` carries the keys across entries. The echo is cut short: the text comes
   * from an unvalidated body.
   */
  private googleCalloutRefusal(callout: string, index: number, seen: Set<string>): string | null {
    if (callout === '') return `Google Ads callouts cannot include a blank entry (callout ${index + 1}). Remove it and create again.`;
    const shown = googleAdsEchoed(callout);
    const runes = [...callout].length;
    if (runes > GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES) {
      return `Google Ads accepts callouts of at most ${GOOGLE_ADS_MAX_CALLOUT_TEXT_RUNES} characters, and ${shown} has ${runes}. Shorten it and create again.`;
    }
    const key = googleAdsToLower(callout);
    if (seen.has(key)) return `Google Ads refuses a campaign that lists the callout ${shown} more than once. Remove the repeat and create again.`;
    seen.add(key);
    return null;
  }

  /**
   * The Search campaign's sitelink extensions, spread-ready, or `{}` when the request names none.
   *
   * Search only, as {@link googleCallouts}: `createCampaign` refuses sitelinks on any other channel
   * by name, and every per-entry refusal, before this is dispatched. An empty description pair is
   * omitted rather than sent as two empty strings; both absent is one of upstream's two legal states.
   */
  private googleSitelinks(body: CampaignCreateRequest): { sitelinks?: CampaignSitelink[] } {
    const clean = this.googleSitelinkList(body?.sitelinks).map(({ text, description1 = '', description2 = '', finalUrl }) => ({
      text,
      ...(description1 !== '' ? { description1, description2 } : {}),
      finalUrl,
    }));
    return clean.length > 0 ? { sitelinks: clean } : {};
  }

  /**
   * The Search campaign's structured snippets, spread-ready, or `{}` when the request names none.
   *
   * Search only, as {@link googleCallouts}: `createCampaign` refuses snippets on any other channel by
   * name, and every per-entry refusal, before this is dispatched. Sent as trimmed — blanks and
   * case-folded repeats among the values are left in place for upstream to collapse, as it would
   * collapse them anyway and dropping them here would make the dispatched list disagree with the one
   * this app judged.
   */
  private googleStructuredSnippets(body: CampaignCreateRequest): { structuredSnippets?: CampaignStructuredSnippet[] } {
    const clean = this.googleStructuredSnippetList(body?.structuredSnippets);
    return clean.length > 0 ? { structuredSnippets: clean } : {};
  }

  /**
   * Whether one raw snippet entry survives the Go decode into `googleAdsStructuredSnippetConfig`: an
   * object (or null, which decodes to a blank snippet) whose `header` is absent, null or text and
   * whose `values` is absent, null or a list of text.
   *
   * A `null` ELEMENT of `values` is text as far as the decode is concerned: `Values` is a plain
   * `[]string` (`internal/dispatch/googleads.go`), and Go's `encoding/json` leaves a null element
   * at its zero value `""` — which `validateStructuredSnippets` then skips exactly as it skips a
   * blank one. Refusing it here would refuse a create upstream accepts, so it is admitted and
   * {@link googleStructuredSnippetList} drops it, which is what its `typeof v === 'string'` filter
   * has always done.
   */
  private isStructuredSnippetShape(entry: unknown): boolean {
    if (entry === null) return true;
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    const { header, values } = fields;
    if (!(header === undefined || header === null || typeof header === 'string')) return false;
    if (values === undefined || values === null) return true;
    return Array.isArray(values) && values.every((v) => v === null || typeof v === 'string');
  }

  /**
   * The snippet list as judged and dispatched: header and each value trimmed with Go's rules as
   * `validateStructuredSnippets` trims them, an absent or null field read as blank or empty. Nothing
   * but a null VALUE is dropped, so a blank header is still refused by name; upstream decodes that
   * null to a blank and skips it where this drops it, which leaves both walks judging and
   * dispatching the same values. Callers have checked the shape with
   * {@link isStructuredSnippetShape}.
   */
  private googleStructuredSnippetList(raw: unknown): CampaignStructuredSnippet[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const header = typeof fields['header'] === 'string' ? googleAdsDecodedText(fields['header']) : '';
      const rawValues = Array.isArray(fields['values']) ? (fields['values'] as unknown[]) : [];
      const values = rawValues.filter((v): v is string => typeof v === 'string').map((v) => googleAdsDecodedText(v));
      return { header, values };
    });
  }

  /**
   * Why upstream would refuse one entry of a trimmed snippet list, or `null` when it would not.
   *
   * `validateStructuredSnippets`' per-entry branches in order: header blank, header over 25 runes,
   * then a header repeat keyed on Go's `strings.ToLower` (`seenHeaders` carries those keys across
   * entries). Then the values, in ITS loop's order: a blank value is skipped, an over-long one is
   * refused, a case-folded repeat is skipped — so an over-long value that merely repeats an earlier
   * one is still refused, because the bound is checked before the repeat is collapsed. Only what
   * survives that loop is counted against the minimum and the maximum. The echo is cut short: the
   * header comes from an unvalidated body.
   */
  private googleStructuredSnippetRefusal(snippet: CampaignStructuredSnippet, index: number, seenHeaders: Set<string>): string | null {
    const { header, values } = snippet;
    if (header === '') {
      return `Google Ads structured snippet ${index + 1} has no header. Fill it in or remove the snippet, then create again.`;
    }
    const shown = googleAdsEchoed(header);
    const headerRunes = [...header].length;
    if (headerRunes > GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES) {
      return `Google Ads accepts structured snippet headers of at most ${GOOGLE_ADS_MAX_SNIPPET_HEADER_RUNES} characters, and ${shown} has ${headerRunes}. Shorten it and create again.`;
    }
    const headerKey = googleAdsToLower(header);
    if (seenHeaders.has(headerKey)) {
      return `Google Ads serves one line per structured snippet header and this campaign lists ${shown} twice, so the second would be dropped. Merge them into one snippet and create again.`;
    }
    seenHeaders.add(headerKey);

    const distinct = new Set<string>();
    for (const value of values) {
      if (value === '') continue;
      const valueRunes = [...value].length;
      if (valueRunes > GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES) {
        return `Google Ads accepts structured snippet values of at most ${GOOGLE_ADS_MAX_SNIPPET_VALUE_RUNES} characters, and one under ${shown} has ${valueRunes}. Shorten it and create again.`;
      }
      distinct.add(googleAdsToLower(value));
    }
    if (distinct.size < GOOGLE_ADS_MIN_SNIPPET_VALUES) {
      return `Google Ads needs at least ${GOOGLE_ADS_MIN_SNIPPET_VALUES} different values under the structured snippet header ${shown}, and this one has ${distinct.size} — blanks and repeats do not count. Add more and create again.`;
    }
    if (distinct.size > GOOGLE_ADS_MAX_SNIPPET_VALUES) {
      return `Google Ads accepts at most ${GOOGLE_ADS_MAX_SNIPPET_VALUES} values under one structured snippet header, and ${shown} has ${distinct.size}. Remove some and create again.`;
    }
    return null;
  }

  /**
   * Why upstream would refuse one of the call, promotion or price lists, as the field to name and the
   * message, or `null` when it would not.
   *
   * The four steps the sitelink, callout and snippet guards each spell out, in their order: an
   * absent or null list is "none asked for"; anything the Go decode refuses is refused by shape; a
   * non-empty list on a channel but Search is refused by name, because `validateAssetPlan` fails the
   * whole create there; then the raw-slice cap, and only then the entries. `entryRefusal` returns the
   * first bad entry's sentence already numbered.
   */
  private googleAssetListRefusal(
    raw: unknown,
    channel: unknown,
    spec: {
      plural: 'call extensions' | 'promotions' | 'price extensions';
      singular: string;
      max: number;
      shapeMessage: string;
      isShape: (entry: unknown) => boolean;
      entryRefusal: (raw: unknown[]) => { index: number; message: string } | null;
    }
  ): { field: string; message: string } | null {
    if (raw === undefined || raw === null) return null;
    const field = ({ 'call extensions': 'callExtensions', promotions: 'promotions', 'price extensions': 'prices' } as const)[spec.plural];
    if (!Array.isArray(raw) || !raw.every((entry) => spec.isShape(entry))) return { field, message: spec.shapeMessage };
    if (raw.length === 0 || typeof channel !== 'string') return null;
    if (!(GOOGLE_CHANNELS_WITH_AD_EXTENSIONS as readonly string[]).includes(channel)) {
      return {
        field,
        message: `Google Ads only accepts ${spec.plural} on Search campaigns, not on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel as GoogleCampaignChannel] ?? channel} campaigns. Remove the ${spec.plural} or pick Search, then create again.`,
      };
    }
    if (raw.length > spec.max) {
      return {
        field,
        message: `Google Ads accepts at most ${spec.max} ${spec.plural} on one campaign, and this one has ${raw.length}. Remove some and create again.`,
      };
    }
    const refusal = spec.entryRefusal(raw);
    if (!refusal) return null;
    return { field, message: `Google Ads ${spec.singular} ${refusal.index + 1}: ${refusal.message} Fix it and create again.` };
  }

  /** The first entry `refusalOf` refuses, with its index, or `null` when every entry passes. */
  private firstAssetRefusal<T>(entries: T[], refusalOf: (entry: T, index: number) => string | null): { index: number; message: string } | null {
    for (const [index, entry] of entries.entries()) {
      const message = refusalOf(entry, index);
      if (message) return { index, message };
    }
    return null;
  }

  /**
   * The Search campaign's call, promotion and price extensions, spread-ready, each key omitted when
   * its list is empty — the absent-key route {@link googleCallouts} takes.
   *
   * Search only, as {@link googleCallouts}: `createCampaign` refuses all three on any other channel
   * by name, and every per-entry refusal, before this is dispatched. The keys are
   * campaign-service's own (`googleAdsConfig.callExtensions`, `.promotions`, `.prices`), so nothing
   * is renamed on the way through.
   */
  private googleAssetExtensions(body: CampaignCreateRequest): {
    callExtensions?: CampaignCallExtension[];
    promotions?: CampaignPromotion[];
    prices?: CampaignPriceExtension[];
  } {
    const callExtensions = this.googleCallExtensionList(body?.callExtensions);
    const promotions = this.googlePromotionList(body?.promotions);
    const prices = this.googlePriceExtensionList(body?.prices);
    return {
      ...(callExtensions.length > 0 ? { callExtensions } : {}),
      ...(promotions.length > 0 ? { promotions } : {}),
      ...(prices.length > 0 ? { prices } : {}),
    };
  }

  /**
   * Whether one raw entry survives the Go decode into its config struct: an object (or null, which
   * decodes to a blank entry the per-entry checks then refuse by name) whose `text` fields are
   * absent, null or text and whose `numeric` fields are absent, null or a number. A number sent as a
   * string is a decode error upstream, so it is a shape refusal here rather than a coercion.
   */
  private isAssetEntryShape(entry: unknown, text: readonly string[], numeric: readonly string[] = []): boolean {
    if (entry === null) return true;
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    const absent = (f: string): boolean => fields[f] === undefined || fields[f] === null;
    return text.every((f) => absent(f) || typeof fields[f] === 'string') && numeric.every((f) => absent(f) || typeof fields[f] === 'number');
  }

  private isCallExtensionShape(entry: unknown): boolean {
    return this.isAssetEntryShape(entry, ['countryCode', 'phoneNumber']);
  }

  private isPromotionShape(entry: unknown): boolean {
    return this.isAssetEntryShape(
      entry,
      [
        'promotionTarget',
        'currencyCode',
        'promotionCode',
        'occasion',
        'languageCode',
        'startDate',
        'endDate',
        'redemptionStartDate',
        'redemptionEndDate',
        'finalUrl',
      ],
      ['discountPercent', 'discountAmount', 'ordersOverAmount']
    );
  }

  /** A price extension's own text fields, plus `offerings` as absent, null or a list of row-shaped entries. */
  private isPriceExtensionShape(entry: unknown): boolean {
    if (!this.isAssetEntryShape(entry, ['type', 'priceQualifier', 'languageCode'])) return false;
    const offerings = (entry as Record<string, unknown> | null)?.['offerings'];
    if (offerings === undefined || offerings === null) return true;
    return (
      Array.isArray(offerings) &&
      offerings.every((row) => this.isAssetEntryShape(row, ['header', 'description', 'currencyCode', 'unit', 'finalUrl'], ['amount']))
    );
  }

  /** One field of a shape-checked raw entry, decoded and trimmed as Go does ({@link googleAdsDecodedText}), or `''` when absent or null. */
  private assetText(fields: Record<string, unknown>, name: string): string {
    return typeof fields[name] === 'string' ? googleAdsDecodedText(fields[name] as string) : '';
  }

  /** One numeric field of a shape-checked raw entry, or `0` — upstream's own "unset" — when absent or null. */
  private assetNumber(fields: Record<string, unknown>, name: string): number {
    return typeof fields[name] === 'number' ? (fields[name] as number) : 0;
  }

  /**
   * The call-extension list as judged and dispatched: both fields trimmed, the country upper-cased
   * as `validateCallExtensions` upper-cases it. Nothing is dropped, so a blank entry is refused by
   * name. Callers have checked the shape with {@link isCallExtensionShape}.
   */
  private googleCallExtensionList(raw: unknown): CampaignCallExtension[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      return { countryCode: googleAdsToUpperCode(this.assetText(fields, 'countryCode')), phoneNumber: this.assetText(fields, 'phoneNumber') };
    });
  }

  /**
   * The promotion list as judged and dispatched. Every text field trimmed, the currency upper-cased
   * as `validateMoney` upper-cases it; an empty optional field and a zero amount are OMITTED — upstream
   * decodes an absent key to that same zero value, so the wire stays the shape a caller would write.
   */
  private googlePromotionList(raw: unknown): CampaignPromotion[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const promotion: CampaignPromotion = { promotionTarget: this.assetText(fields, 'promotionTarget'), finalUrl: this.assetText(fields, 'finalUrl') };
      for (const name of ['discountPercent', 'discountAmount', 'ordersOverAmount'] as const) {
        const value = this.assetNumber(fields, name);
        if (value !== 0) promotion[name] = value;
      }
      const currency = googleAdsToUpperCode(this.assetText(fields, 'currencyCode'));
      if (currency !== '') promotion.currencyCode = currency;
      for (const name of ['promotionCode', 'occasion', 'languageCode', 'startDate', 'endDate', 'redemptionStartDate', 'redemptionEndDate'] as const) {
        const value = this.assetText(fields, name);
        if (value !== '') promotion[name] = value;
      }
      return promotion;
    });
  }

  /**
   * The price-extension list as judged and dispatched, on {@link googlePromotionList}'s rules: text
   * trimmed, currency upper-cased, an empty optional field omitted. Each row keeps its own currency
   * and destination, which is where the wire carries them.
   */
  private googlePriceExtensionList(raw: unknown): CampaignPriceExtension[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(fields['offerings']) ? (fields['offerings'] as unknown[]) : [];
      const qualifier = this.assetText(fields, 'priceQualifier');
      return {
        type: this.assetText(fields, 'type'),
        ...(qualifier !== '' ? { priceQualifier: qualifier } : {}),
        languageCode: this.assetText(fields, 'languageCode'),
        offerings: rows.map((row) => {
          const cells = (row ?? {}) as Record<string, unknown>;
          const unit = this.assetText(cells, 'unit');
          return {
            header: this.assetText(cells, 'header'),
            description: this.assetText(cells, 'description'),
            amount: this.assetNumber(cells, 'amount'),
            currencyCode: googleAdsToUpperCode(this.assetText(cells, 'currencyCode')),
            ...(unit !== '' ? { unit } : {}),
            finalUrl: this.assetText(cells, 'finalUrl'),
          };
        }),
      };
    });
  }

  /**
   * The first Google creative or bidding field that breaks a resource bound, or null when none does.
   *
   * Walks the raw body rather than the normalised output, because the allocation this bounds happens
   * DURING normalisation — a check on the result would run after the work it is meant to prevent.
   * Each string is measured by {@link boundedLength}, after trimming: every field here is trimmed
   * before it is sent, and upstream trims again, so measuring the raw length would refuse a short
   * value padded with whitespace that upstream accepts. Shape-only, like everything else on this
   * road: a non-string entry is left for the normalisers to drop and is not counted — except for the
   * four lists of objects handled by `nestedStringFields` at the end, whose entries are legitimately
   * objects, so the strings inside them are measured rather than skipped.
   *
   * Names the offending field in the refusal so an operator who somehow reaches it is told which one,
   * matching the HubSpot sibling rather than failing the create anonymously.
   */
  private oversizedGoogleCreativeField(body: CampaignCreateRequest): { field: string; message: string } | null {
    const raw = body as unknown as Record<string, unknown>;
    const candidates: [string, unknown][] = Object.values(GOOGLE_CREATIVE_REQUEST_KEYS).map((key) => [key, raw[key]]);
    candidates.push(['conversionActions', raw['conversionActions']]);
    candidates.push(['callouts', raw['callouts']]);
    candidates.push(['audienceSegments', raw['audienceSegments']]);
    // The geo lists, the ad schedules and the three criteria lists are bounded here and not only by
    // their own caps further down, because `createConfigEnvelope` runs BEFORE those caps and
    // normalizes whatever it is handed — `googleProximityList`, `googleAdScheduleList` and
    // `googleDeviceBidModifierList` each allocating a fresh object per entry as they go. The named
    // caps (60 exclusions, 20 radius targets, 42 schedules, 3 devices, 20 per demographic list)
    // still make the refusal an operator can act on; this one only stops a 15mb body from being
    // walked before they are reached.
    candidates.push(['excludedGeoTargets', raw['excludedGeoTargets']]);
    candidates.push(['proximityTargets', raw['proximityTargets']]);
    candidates.push(['adSchedules', raw['adSchedules']]);
    candidates.push(['deviceBidModifiers', raw['deviceBidModifiers']]);
    candidates.push(['excludedAgeRanges', raw['excludedAgeRanges']]);
    candidates.push(['excludedGenders', raw['excludedGenders']]);

    for (const [key, source] of candidates) {
      // A creative key holds an object of fields; `conversionActions` and `callouts` are bare lists.
      const entries: [string, unknown][] = this.boundableEntries(key, source);

      for (const [field, value] of entries) {
        if (Array.isArray(value)) {
          if (value.length > MAX_GOOGLE_CREATIVE_LIST_ENTRIES) {
            return { field, message: `the list exceeds the maximum of ${MAX_GOOGLE_CREATIVE_LIST_ENTRIES} entries` };
          }
          // A stored-image ref is an object entry, so its id is measured here too: the normalizer
          // trims and forwards it, and an unbounded id is the same unbounded string a URL would be.
          const long = value.find((entry) => {
            const text = typeof entry === 'string' ? entry : this.imageAssetIdOf(entry);
            return text !== null && this.boundedLength(text) > MAX_GOOGLE_CREATIVE_FIELD_LENGTH;
          });
          if (long !== undefined) {
            return { field, message: `an entry exceeds the maximum length of ${MAX_GOOGLE_CREATIVE_FIELD_LENGTH}` };
          }
          continue;
        }
        if (typeof value === 'string' && this.boundedLength(value) > MAX_GOOGLE_CREATIVE_FIELD_LENGTH) {
          return { field, message: `the value exceeds the maximum length of ${MAX_GOOGLE_CREATIVE_FIELD_LENGTH}` };
        }
      }
    }

    // Seven request fields are lists of OBJECTS, and the loop above measures only the string ENTRIES
    // of a list — an object entry is left for the normalisers, so the strings nested inside it are
    // never reached by `boundableEntries`. They are bounded here instead, each at the limit upstream
    // already refuses it past: the sitelink URL at its byte limit, which no longer trimmed string can
    // be under, and every other field at the shared length. One table rather than a block each,
    // because `deviceBidModifiers` is the second list-of-objects to need this and a third bespoke
    // copy is how the two drift apart.
    //
    // `sitelinks`, `structuredSnippets` and the three asset lists are the ones that are not already
    // `candidates` keys, so their list lengths are checked here. For the other two the check above has already refused an
    // over-long list with the same field and message, which is why this one re-states rather than
    // contradicts.
    //
    // `structuredSnippets.values` is a nested list of STRINGS rather than a string, which is why a
    // named field is measured either way below. Its own caps — ten snippets, ten values, 25 runes
    // each — are the refusals an operator can act on, but they sit behind `cutoverOn`, the
    // `google-ads` platform and a resolvable `googleAdsConfig.channel`, all of which are read out of
    // `createConfigEnvelope`'s output and so are decided AFTER the normalisation this bounds. A body
    // that resolves none of them still reaches `googleStructuredSnippetList`, which allocates a
    // fresh object and a fresh trimmed string per value as it walks. That is the same reason the geo
    // lists and schedules are listed above, and the same reason the `callouts` and `sitelinks`
    // siblings are bounded here rather than left to their own caps.
    const nestedStringFields: readonly (readonly [string, readonly string[]])[] = [
      ['sitelinks', ['text', 'description1', 'description2', 'finalUrl']],
      ['structuredSnippets', ['header', 'values']],
      ['callExtensions', ['countryCode', 'phoneNumber']],
      [
        'promotions',
        [
          'promotionTarget',
          'currencyCode',
          'promotionCode',
          'occasion',
          'languageCode',
          'startDate',
          'endDate',
          'redemptionStartDate',
          'redemptionEndDate',
          'finalUrl',
        ],
      ],
      ['prices', ['type', 'priceQualifier', 'languageCode', 'offerings']],
      ['adSchedules', ['dayOfWeek']],
      ['deviceBidModifiers', ['device']],
    ];
    for (const [key, names] of nestedStringFields) {
      const list = raw[key];
      if (!Array.isArray(list)) continue;
      if (list.length > MAX_GOOGLE_CREATIVE_LIST_ENTRIES) {
        return { field: key, message: `the list exceeds the maximum of ${MAX_GOOGLE_CREATIVE_LIST_ENTRIES} entries` };
      }
      let nestedTotal = 0;
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        for (const name of names) {
          const value = (entry as Record<string, unknown>)[name];
          const max = name === 'finalUrl' ? GOOGLE_ADS_MAX_FINAL_URL_BYTES : MAX_GOOGLE_CREATIVE_FIELD_LENGTH;
          // A nested list is bounded on both axes, as the top-level loop bounds a list of strings:
          // its length first, then each string in it. Measured with the same `max` as a plain field,
          // so one named field cannot be bounded two different ways depending on how it is shaped.
          //
          // Only `values` is bounded at the nested ceiling, because it is the only name here that
          // upstream decodes as a LIST, and it has no raw-count cap upstream at all: blanks and
          // case-folded repeats are collapsed before the 3..10 bound is counted, so a duplicate-heavy
          // paste is a valid three-value snippet at any raw length, and the 100 above would refuse
          // it. Every other name decodes as a plain `string`, so an array under one of them is a body
          // upstream refuses outright — no over-refusal to relax, and raising its ceiling would only
          // widen what this walk admits. See MAX_GOOGLE_CREATIVE_NESTED_LIST_ENTRIES.
          const listMax = name === 'values' ? MAX_GOOGLE_CREATIVE_NESTED_LIST_ENTRIES : MAX_GOOGLE_CREATIVE_LIST_ENTRIES;
          if (Array.isArray(value)) {
            if (value.length > listMax) {
              return { field: `${key}.${name}`, message: `the list exceeds the maximum of ${listMax} entries` };
            }
            // Per-list ceilings multiply against the outer bound above, so the sum is bounded too —
            // see MAX_GOOGLE_CREATIVE_NESTED_LIST_TOTAL, which is derived from the raw snippet count
            // upstream refuses past and so cannot refuse a body upstream accepts.
            nestedTotal += value.length;
            if (nestedTotal > MAX_GOOGLE_CREATIVE_NESTED_LIST_TOTAL) {
              return { field: key, message: `its nested lists exceed the maximum of ${MAX_GOOGLE_CREATIVE_NESTED_LIST_TOTAL} entries in total` };
            }
            const long = value.find((nested) => typeof nested === 'string' && this.boundedLength(nested) > max);
            if (long !== undefined) {
              return { field: `${key}.${name}`, message: `an entry exceeds the maximum length of ${max}` };
            }
            continue;
          }
          if (typeof value === 'string' && this.boundedLength(value) > max) {
            return { field: `${key}.${name}`, message: `a value exceeds the maximum length of ${max}` };
          }
        }
      }
    }

    // `prices.offerings` is the one nested list of OBJECTS, so the walk above bounds its length
    // (at the shared 100, against upstream's own 3..8) but skips the strings inside each row. They
    // are bounded here on the same terms, because `googlePriceExtensionList` trims every one of them
    // during `createConfigEnvelope`, before the caps an operator can act on are reached.
    const prices = raw['prices'];
    if (Array.isArray(prices)) {
      for (const price of prices) {
        const rows = price && typeof price === 'object' ? (price as Record<string, unknown>)['offerings'] : undefined;
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          for (const name of ['header', 'description', 'currencyCode', 'unit', 'finalUrl']) {
            const value = (row as Record<string, unknown>)[name];
            const max = name === 'finalUrl' ? GOOGLE_ADS_MAX_FINAL_URL_BYTES : MAX_GOOGLE_CREATIVE_FIELD_LENGTH;
            if (typeof value === 'string' && this.boundedLength(value) > max) {
              return { field: `prices.offerings.${name}`, message: `a value exceeds the maximum length of ${max}` };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * A string's length once every character JS's `trim` OR Go's `strings.TrimSpace` would strip is
   * gone from both ends — the shortest any trim on the way to upstream can make it. The creative
   * and conversion normalisers use JS `trim` (which strips U+FEFF), the sitelink and callout ones
   * Go's (which strips U+0085), and upstream trims with Go's again; measuring the union means the
   * bound never refuses what any of them would shorten below it. A numeric index walk, so linear,
   * with no copy of the string.
   */
  private boundedLength(value: string): number {
    let start = 0;
    let end = value.length;
    // JS's `trim` set is Go's minus U+0085 plus U+FEFF, so the union is Go's plus U+FEFF.
    while (start < end && (isGoSpaceCode(value.charCodeAt(start)) || value.charCodeAt(start) === 0xfeff)) start++;
    while (end > start && (isGoSpaceCode(value.charCodeAt(end - 1)) || value.charCodeAt(end - 1) === 0xfeff)) end--;
    return end - start;
  }

  /**
   * The one source above, flattened into the `[label, value]` pairs the bound is applied to.
   *
   * A creative key holds an object whose fields are each bounded under their own `key.field` label;
   * `conversionActions` and `callouts` are bare lists on the body, each bounded as one value under
   * its own key.
   * Anything else — absent, a scalar, a shape the normaliser will drop — yields nothing to check.
   */
  private boundableEntries(key: string, source: unknown): [string, unknown][] {
    if (Array.isArray(source)) return [[key, source]];
    if (!source || typeof source !== 'object') return [];
    return Object.entries(source as Record<string, unknown>).map(([field, value]) => [`${key}.${field}`, value]);
  }

  /**
   * The selected channel's creative, normalized and spread-ready, or `{}` when there is nothing to
   * send.
   *
   * Three judgements, all of them the permissive one, and all of them for the same reason this
   * file's geo normalizer gives: this route has no body validator, and a BFF that refuses a create
   * campaign-service would have accepted is the costlier mistake of the two.
   *
   * 1. **Shape, never content.** Blank and non-string list entries are dropped and strings are
   *    trimmed; nothing counts anything. Every count, width and aspect-ratio rule lives in the
   *    upstream client's preflight (`internal/platform/googleads/*_creative.go`), which runs before
   *    the budget mutate, so a creative that is short a headline is refused there with a message
   *    naming the field — not here, where a second copy of those rules could only drift.
   * 2. **A field that empties out is OMITTED, not sent empty.** Upstream distinguishes "no creative
   *    asked for" (nil, the pre-existing shell behaviour) from "a creative with an empty logo
   *    list" (a validation failure). Sending `[]` would convert an operator who left the section
   *    alone into a refused create.
   * 3. **The same applies to the whole creative.** If no field survives, no creative key is emitted
   *    and the create behaves exactly as it did before this existed.
   *
   * Unknown channels — `search`, `video`, anything a future catalogue adds — return `{}` rather
   * than throwing, so a channel gaining a creative upstream is one table entry here and not a
   * crash in the meantime.
   */
  private googleCreative(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    const spec = GOOGLE_CREATIVE_FIELDS[channel];
    if (!spec) return {};

    // `as Record<string, unknown>` rather than the typed interface: the value arrives off an
    // unvalidated request body, so every field has to be re-tested at runtime anyway and the
    // declared type would only make the tests look redundant.
    const source = (body as unknown as Record<string, unknown>)[spec.key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const raw = source as Record<string, unknown>;

    const creative: Record<string, unknown> = {};
    for (const field of spec.lists) {
      const value = raw[field];
      if (!Array.isArray(value)) continue;
      const clean = spec.images.includes(field) ? this.googleImageRefList(value) : this.googleStringList(value);
      if (clean.length > 0) creative[field] = clean;
    }
    for (const field of spec.scalars) {
      const value = raw[field];
      if (typeof value !== 'string') continue;
      const clean = value.trim();
      if (clean !== '') creative[field] = clean;
    }

    return Object.keys(creative).length > 0 ? { [spec.key]: creative } : {};
  }

  /** A creative list's non-blank strings, trimmed, in order. */
  private googleStringList(value: unknown[]): string[] {
    return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  }

  /**
   * An image slot's entries as campaign-service's `googleAdsImageRef` decodes them: a URL stays a
   * bare string, and a stored asset is forwarded as `{ imageAssetId }` with the id trimmed — the
   * object form, never a bare id, because upstream finds an asset only under that key and would
   * fetch a bare id as a URL.
   *
   * Shape-only like the string lists: a blank id, or an object naming no id, is dropped rather than
   * refused, and a `url` key on the object is never forwarded — this application sends a URL as a
   * string. Whether the asset exists, belongs to the brief and fits the slot is upstream's preflight
   * to decide, by name, before the budget mutate. `createCampaign` has already refused every ref
   * when `canUseGoogleCreativeAssets()` is false, so reaching here means the deployment honours them.
   */
  private googleImageRefList(value: unknown[]): GoogleCreativeImageRef[] {
    const clean: GoogleCreativeImageRef[] = [];
    for (const entry of value) {
      if (typeof entry === 'string') {
        if (entry.trim() !== '') clean.push(entry.trim());
        continue;
      }
      const id = this.imageAssetIdOf(entry);
      if (id !== null && id.trim() !== '') clean.push({ imageAssetId: id.trim() });
    }
    return clean;
  }

  /** The `imageAssetId` string of an object entry, or `null` for anything else. */
  private imageAssetIdOf(entry: unknown): string | null {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const id = (entry as Record<string, unknown>)['imageAssetId'];
    return typeof id === 'string' ? id : null;
  }

  /**
   * The campaign's flight window, for whichever Google channel is being built.
   *
   * `googleAdsConfig` has carried `startDate`/`endDate` all along — `internal/dispatch/googleads.go`
   * declares both and `applyCampaignConfig` writes them, and the client's `validateFlightWindow`
   * turns them into `campaign.start_date_time` / `end_date_time` for EVERY kind, not only Search.
   * This builder was the only thing not sending them, so the dates the operator entered on the
   * Implementation tab were dropped at this boundary and Google applied its own defaults instead:
   * the campaign starts when someone enables it and then runs until someone stops it. The form
   * REQUIRES both fields (`canSubmit`), so the operator has no way to know their schedule was
   * ignored — which is what makes this worth fixing rather than documenting.
   *
   * Emitted on BOTH branches of `buildGoogleAdsConfig`. The gap was never specific to the
   * non-Search channels this PR adds; Search has had it since the cutover, and splitting the fix
   * would leave the two branches disagreeing about whether a flight window is a thing Google takes.
   *
   * Forwarded VERBATIM rather than validated. `<input type="date">` yields exactly the
   * `YYYY-MM-DD` upstream wants, and anything else is refused by `validateFlightWindow` BEFORE the
   * first mutate — named, with the offending value in the message, and with no budget stranded.
   * Judging the shape here could only turn that named refusal into this method's vaguer one, or
   * refuse a value Go would have taken. Note also that Google's comparison is `end.Before(start)`,
   * NOT the strict `!end.After(start)` Meta and Reddit use, so `isReversedFlightWindow` is the
   * wrong test for this platform: a same-day flight is legal here and that guard would refuse it.
   *
   * An absent or blank value omits the key, matching how `geoTargets` reaches its upstream default.
   */
  private googleFlightWindow(body: CampaignCreateRequest): Record<string, string> {
    const window: Record<string, string> = {};
    const startDate = typeof body?.startDate === 'string' ? body.startDate.trim() : '';
    const endDate = typeof body?.endDate === 'string' ? body.endDate.trim() : '';
    if (startDate) window['startDate'] = startDate;
    if (endDate) window['endDate'] = endDate;
    return window;
  }

  /**
   * The campaign's language list, normalized and spread-ready, or `{}` when the request names none.
   *
   * Omitting the key is NOT neutral in the direction the other omissions here are. An absent list
   * means Google's own default, which is to serve in EVERY language — so this field narrows, and
   * leaving it out leaves the campaign exactly as wide as it is today. That is why an empty result
   * omits rather than refuses, as `geoTargets` does.
   *
   * CHANNEL-GATED, which `geoTargets` is not. `validateCriteriaPlan`
   * (`internal/platform/googleads/campaign_criteria.go`) refuses the whole non-location criteria
   * set on the Demand Gen path — that channel attaches targeting at the ad group level — so a
   * Demand Gen create carrying languages fails upstream with nothing created. So this helper never
   * forwards a list for a channel outside {@link GOOGLE_CHANNELS_WITH_LANGUAGES}, and the `{}` it
   * returns there is never dispatched either: `createCampaign` reads the request's own list and
   * refuses such a create by name before anything is sent, on upstream's "refused, never silently
   * dropped" rule for this field.
   *
   * NORMALIZES ONLY. Every refusal is made by name in `createCampaign`, in upstream's order, before
   * this config is dispatched; judging one here too would answer it twice, and less precisely.
   */
  private googleLanguages(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    if (!(GOOGLE_CHANNELS_WITH_LANGUAGES as readonly string[]).includes(channel)) return {};
    const clean = this.googleUpperCodeList(body?.languages);
    return clean.length > 0 ? { languages: clean } : {};
  }

  /**
   * One list of upper-cased codes as judged and dispatched — languages, both halves of the geo plan,
   * and both demographic exclusion lists. `resolveLanguageList`, `resolveGeoList`,
   * `validateExcludedAgeRanges` and `validateExcludedGenders` normalize identically, so this is one
   * helper rather than a copy per field; the per-field reasons live on the callers.
   *
   * Strings only — `createCampaign` refuses anything else first. Blanks are KEPT: upstream counts a
   * blank toward the cap and then refuses it by name, so dropping one here would turn `['']` into
   * an every-language campaign, or into a campaign with no exclusion at all.
   *
   * Trimmed with {@link googleAdsTrimSpace}, NOT `String.prototype.trim`. Go's `strings.TrimSpace`
   * strips U+0085 and JS does not, so a code padded with one would be refused here as an unknown
   * country or language while upstream accepts it — the over-refusal these mirrors exist to avoid.
   */
  private googleUpperCodeList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((c): c is string => typeof c === 'string').map((c) => googleAdsTrimSpace(c).toUpperCase());
  }

  /**
   * Why upstream would refuse one entry of a normalized language list, or `null` when it would not.
   *
   * Mirrors `resolveLanguageList`'s per-entry branches in order. A blank entry is refused. A
   * NUMERIC entry is a raw language constant id: it must be canonical (`canonicalCampaignID`
   * upstream, {@link isCanonicalGoogleAdsResourceId} here) but is NOT tested against
   * {@link GOOGLE_ADS_LANGUAGE_MAP}, since upstream accepts ids outside the curated table. Anything
   * else must be a code in the map. The echo is cut short: the entry comes from an unvalidated body.
   */
  private googleLanguageRefusal(language: string): string | null {
    if (language === '') return 'Google Ads languages cannot include a blank entry. Remove it and create again.';
    const shown = googleAdsEchoed(language);
    if (GOOGLE_ADS_LANGUAGE_ID_PATTERN.test(language)) {
      return isCanonicalGoogleAdsResourceId(language)
        ? null
        : `Google Ads language ${shown} is not the canonical spelling of a positive language constant id. Use the id with no leading zeros, or pick a language from the list, and create again.`;
    }
    return Object.hasOwn(GOOGLE_ADS_LANGUAGE_MAP, language)
      ? null
      : `Google Ads cannot target ${shown} on this path. Pick a different language and create again.`;
  }

  /**
   * The campaign's excluded locations, normalized and spread-ready, or `{}` when the request names
   * none.
   *
   * NOT channel-gated, unlike {@link googleLanguages} and {@link googleProximityTargets}:
   * `validateGeoPlan` applies no channel fence to the exclusion list, so it is forwarded on every
   * channel including Demand Gen. Gating it with its two neighbours would withhold a list upstream
   * accepts and leave the campaign serving in a market the operator excluded.
   *
   * Empty omits the key rather than sending `[]`, as `geoTargets` does — the two mean the same
   * thing to the dispatcher today, and only the absent key stays true if that ever tightens.
   *
   * NORMALIZES ONLY. Every refusal is made by name in `createCampaign`, in upstream's order, before
   * this config is dispatched.
   */
  private googleExcludedGeoTargets(body: CampaignCreateRequest): Record<string, unknown> {
    const clean = this.googleUpperCodeList(body?.excludedGeoTargets);
    return clean.length > 0 ? { excludedGeoTargets: clean } : {};
  }

  /**
   * The campaign's radius targets, normalized and spread-ready, or `{}` when the request names none
   * or the channel cannot take them.
   *
   * CHANNEL-GATED on {@link GOOGLE_CHANNELS_WITH_PROXIMITY}, which is every channel but Demand Gen.
   * The `{}` returned there is never dispatched either: `createCampaign` reads the request's own
   * list and refuses such a create by name first, on upstream's "refused, never silently dropped"
   * rule — a campaign that serves nationwide when the operator asked for a 25-mile radius is the
   * same wrong-market defect the country guard exists to prevent.
   *
   * NORMALIZES ONLY, and does not collapse an exact repeat: upstream collapses repeats itself, and
   * doing it here as well would make the dispatched list disagree with the one judged.
   */
  private googleProximityTargets(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    if (!(GOOGLE_CHANNELS_WITH_PROXIMITY as readonly string[]).includes(channel)) return {};
    const clean = this.googleProximityList(body?.proximityTargets);
    return clean.length > 0 ? { proximityTargets: clean } : {};
  }

  /**
   * Why upstream would refuse one entry of a normalized EXCLUDED geo list, or `null` when it would
   * not.
   *
   * Mirrors `resolveGeoEntry`'s branches in order. A blank entry is refused. A NUMERIC entry is a
   * raw geo target constant id — how a caller addresses a city, region, metro or postal code — so
   * it must be canonical (`canonicalCampaignID` upstream, {@link isCanonicalGoogleAdsResourceId}
   * here) but is deliberately NOT tested against {@link GOOGLE_ADS_GEO_TARGET_MAP}, which holds
   * countries only; testing it there would refuse every city upstream accepts. Anything else must
   * be a country code present in that map.
   *
   * Classified by {@link GOOGLE_ADS_GEO_TARGET_ID_PATTERN} (digits only, matching Go's `numericID`)
   * rather than by a bounded resource-id pattern, so a 21-digit run is refused as a non-canonical
   * id — upstream's own answer — instead of being misreported as an unsupported country code.
   */
  private googleExcludedGeoRefusal(entry: string): string | null {
    if (entry === '') return 'Google Ads excluded locations cannot include a blank entry. Remove it and create again.';
    const shown = googleAdsEchoed(entry);
    if (GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(entry)) {
      return isCanonicalGoogleAdsResourceId(entry)
        ? null
        : `Google Ads excluded location ${shown} is not the canonical spelling of a positive geo target constant id. Use the id with no leading zeros, or pick a country from the list, and create again.`;
    }
    return Object.hasOwn(GOOGLE_ADS_GEO_TARGET_MAP, entry)
      ? null
      : `Google Ads cannot exclude ${shown} on this path. Use a supported country code or a numeric geo target constant id from Google's geo-targets table, then create again.`;
  }

  /**
   * The geo target constant id one normalized entry resolves to, or `null` when it resolves to
   * nothing (a blank, a bad code, a non-canonical id) and the callers above have already refused it.
   *
   * The resolved id is what the targeted-and-excluded clash compares, for the reason upstream
   * compares it: `US` and `2840` are one criterion, so a pair spelled two different ways still
   * clashes.
   */
  private googleResolvedGeoId(entry: string): string | null {
    if (GOOGLE_ADS_GEO_TARGET_ID_PATTERN.test(entry)) return isCanonicalGoogleAdsResourceId(entry) ? entry : null;
    return GOOGLE_ADS_GEO_TARGET_MAP[entry] ?? null;
  }

  /**
   * Whether one raw proximity entry survives the Go decode into `googleAdsProximityConfig`: an
   * object (or null, which decodes to an all-zero target) carrying a numeric `latitude` and
   * `longitude`, and a `radius` and `radiusUnit` that are absent, null or of the right type.
   *
   * The two halves are judged differently on purpose, and the difference is what an absent field
   * COSTS. An absent `radius` or `radiusUnit` decodes to a zero or an empty string that
   * {@link googleProximityRefusal} refuses by name a moment later, in upstream's own words — so
   * tolerating them here loses nothing and keeps the better message.
   *
   * An absent or null LATITUDE or LONGITUDE decodes to `0`, which is a real point in the Gulf of
   * Guinea and is refused by nothing: upstream would create a paid campaign targeting a radius
   * around it. On a PARTIALLY filled entry that is refused here — the one place this guard is
   * deliberately STRICTER than the Go decoder, on the same reasoning that makes `radiusUnit`
   * required upstream: a coordinate it has to invent is a coordinate the caller never chose, and
   * silently buying the wrong hemisphere is worse than naming the malformed entry.
   * {@link CampaignProximityTarget} declares both fields required, so no caller honouring the
   * contract can reach this.
   *
   * A WHOLLY null entry is the exception and returns `true`, because it needs no extra strictness:
   * it decodes to an all-zero target whose zero RADIUS {@link googleProximityRefusal} refuses by
   * name, in upstream's own words, before the invented coordinate can reach a mutate.
   */
  private isProximityShape(entry: unknown): boolean {
    if (entry === null) return true;
    if (typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    const coordinates = (['latitude', 'longitude'] as const).every((f) => typeof fields[f] === 'number');
    const radius = fields['radius'] === undefined || fields['radius'] === null || typeof fields['radius'] === 'number';
    const unit = fields['radiusUnit'] === undefined || fields['radiusUnit'] === null || typeof fields['radiusUnit'] === 'string';
    return coordinates && radius && unit;
  }

  /**
   * The radius targets as judged and dispatched: each absent or null field read as the zero Go
   * decodes it to, so a target missing its radius is refused by name rather than silently dropped.
   * Callers have checked the shape with {@link isProximityShape}.
   *
   * The unit is left exactly as the caller wrote it; {@link googleProximityRefusal} trims and
   * upper-cases it the way `validateProximityTargets` does before comparing.
   */
  private googleProximityList(raw: unknown): NormalizedProximityTarget[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const coordinate = (name: string): number => (typeof fields[name] === 'number' ? (fields[name] as number) : 0);
      return {
        latitude: coordinate('latitude'),
        longitude: coordinate('longitude'),
        radius: coordinate('radius'),
        radiusUnit: typeof fields['radiusUnit'] === 'string' ? fields['radiusUnit'] : '',
      };
    });
  }

  /**
   * Why upstream would refuse one normalized radius target, or `null` when it would not.
   *
   * Mirrors `validateProximityTargets`' branches in order: non-finite coordinates, latitude range,
   * longitude range, radius finite and above zero, then the unit, then the radius against THAT
   * unit's own ceiling. The two ceilings are not a converted pair — 800 km is about 497 miles — so
   * each unit is judged against its own, and a radius exactly equal to one is ACCEPTED, since
   * upstream refuses only `radius > max`.
   *
   * `index` is the caller's position in the list, reported from 1 so it matches what an operator
   * counts; upstream's own message numbers from 0. The coordinates are echoed alongside it so the
   * entry is identifiable either way.
   */
  private googleProximityRefusal(target: NormalizedProximityTarget, index: number): string | null {
    const shown = `radius target ${index + 1} (${target.latitude}, ${target.longitude})`;
    if (!Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)) {
      return `The Google Ads ${shown} needs a finite latitude and longitude. Fix the coordinates and create again.`;
    }
    if (target.latitude < -90 || target.latitude > 90) {
      return `The Google Ads ${shown} has a latitude outside -90 to 90. Fix it and create again.`;
    }
    if (target.longitude < -180 || target.longitude > 180) {
      return `The Google Ads ${shown} has a longitude outside -180 to 180. Fix it and create again.`;
    }
    if (!Number.isFinite(target.radius) || target.radius <= 0) {
      return `The Google Ads ${shown} needs a radius greater than 0. Set one and create again.`;
    }
    const unit = googleAdsTrimSpace(target.radiusUnit).toUpperCase();
    if (!(GOOGLE_ADS_RADIUS_UNITS as readonly string[]).includes(unit)) {
      // No default is invented, upstream's rule: "a radius of 50 means two very different campaigns
      // depending on the unit, and guessing one would silently buy ~2.5x the intended area".
      return `The Google Ads ${shown} needs a radius unit of ${GOOGLE_ADS_RADIUS_UNITS.join(' or ')}. Pick one and create again.`;
    }
    const maxRadius = GOOGLE_ADS_MAX_RADIUS[unit as GoogleAdsRadiusUnit];
    if (target.radius > maxRadius) {
      return `The Google Ads ${shown} has a radius of ${target.radius} ${unit}, over Google's maximum of ${maxRadius}. Reduce it and create again.`;
    }
    return null;
  }

  /**
   * The campaign's ad schedules, normalized and spread-ready, or `{}` when the request names none or
   * the channel cannot take them.
   *
   * CHANNEL-GATED on {@link GOOGLE_CHANNELS_WITH_AD_SCHEDULES}, which is every channel but Demand
   * Gen. The `{}` returned there is never dispatched either: `createCampaign` reads the request's
   * own list and refuses such a create by name first, on upstream's "refused, never silently
   * dropped" rule — a campaign that serves around the clock when the operator asked for weekday
   * evenings spends the whole budget in the hours they excluded.
   *
   * NORMALIZES ONLY, and does not collapse an exact repeat: upstream collapses repeats itself, and
   * doing it here as well would make the dispatched list disagree with the one judged.
   */
  private googleAdSchedules(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    if (!(GOOGLE_CHANNELS_WITH_AD_SCHEDULES as readonly string[]).includes(channel)) return {};
    const clean = this.googleAdScheduleList(body?.adSchedules);
    return clean.length > 0 ? { adSchedules: clean } : {};
  }

  /**
   * The campaign's device bid modifiers, spread-ready, or `{}` when the request names none or the
   * channel cannot take them.
   *
   * CHANNEL-GATED on {@link GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS}, which is one channel fewer
   * than the ad-schedule and language gates: `validateCriteriaPlan` refuses the whole criteria set
   * on Demand Gen and then refuses THIS half of it again on Performance Max, whose automated bidding
   * owns the bid and sets no device adjustment. The `{}` returned there is never dispatched either —
   * `createCampaign` reads the request's own list and refuses such a create by name first, on
   * upstream's "refused, never silently dropped" rule.
   *
   * NORMALIZES ONLY, and does not collapse a repeated device: upstream refuses a repeat rather than
   * collapsing it, and `createCampaign` names that refusal before this is dispatched.
   */
  private googleDeviceBidModifiers(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    if (!(GOOGLE_CHANNELS_WITH_DEVICE_BID_MODIFIERS as readonly string[]).includes(channel)) return {};
    const clean = this.googleDeviceBidModifierList(body?.deviceBidModifiers);
    return clean.length > 0 ? { deviceBidModifiers: clean } : {};
  }

  /**
   * The campaign's demographic EXCLUSIONS, spread-ready, or `{}` when the request names none or the
   * channel cannot take them. One helper for both lists because upstream normalizes them identically
   * — trim, upper-case, and nothing else — and the per-list reasons live on the callers.
   *
   * Exclusion-only is Google's own shape at campaign level, not a narrowing this application chose:
   * positive demographic targeting lives on the ad group, which this client does not create.
   *
   * CHANNEL-GATED on {@link GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS}, the other half of
   * Performance Max's split — it takes demographics as asset-group signals, which this client does
   * not create. Same `{}`-is-never-dispatched reasoning as {@link googleDeviceBidModifiers}.
   *
   * NORMALIZES ONLY, and does not collapse a repeated entry: upstream collapses repeats itself, and
   * doing it here as well would make the dispatched list disagree with the one judged.
   */
  private googleDemographicExclusions(body: CampaignCreateRequest, channel: GoogleCampaignChannel): Record<string, unknown> {
    if (!(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS as readonly string[]).includes(channel)) return {};
    const ageRanges = this.googleUpperCodeList(body?.excludedAgeRanges);
    const genders = this.googleUpperCodeList(body?.excludedGenders);
    return {
      ...(ageRanges.length > 0 ? { excludedAgeRanges: ageRanges } : {}),
      ...(genders.length > 0 ? { excludedGenders: genders } : {}),
    };
  }

  /**
   * Whether one raw ad-schedule entry survives the Go decode into `googleAdsAdScheduleConfig`: an
   * object carrying a string `dayOfWeek`, four INTEGER hour and minute fields, and a `bidModifier`
   * that is absent, null or a number.
   *
   * The four time fields are decoded into Go `int`s, so `9.5` is a decode error upstream rather than
   * a near miss — refusing it here reports the same thing in the caller's own words. An absent one
   * decodes to `0`, which is a real hour and a real minute, so it is tolerated here and judged by
   * {@link googleAdScheduleRefusal} alongside the fields the caller did write — and either answer
   * is upstream's. A lone `endHour` leaves an ordinary window starting at 00:00, which that guard
   * accepts exactly as upstream does; a MISSING `endHour` decodes to the 0 that the same guard
   * refuses by name as an end hour outside 1 to 24.
   *
   * `bidModifier` is the one field whose ABSENCE must survive normalization rather than being read
   * as a zero — see {@link NormalizedAdSchedule}. `null` is accepted here because Go decodes it to
   * the same nil pointer an omitted key gives.
   *
   * A null ENTRY is refused, unlike a null proximity target. Not because upstream would accept it:
   * `DayOfWeek` is a Go STRING, so a null entry decodes to an empty day and `validateAdSchedules`
   * refuses it on its very first branch. Both ends refuse it either way, and only the wording
   * differs — so this says the entry is malformed rather than blaming a day of week the caller
   * never wrote. The proximity sibling tolerates its null entry because there the derived refusal
   * is the better one: a zero RADIUS is upstream's own wording for the same defect.
   */
  private isAdScheduleShape(entry: unknown): boolean {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    if (typeof fields['dayOfWeek'] !== 'string') return false;
    const times = (['startHour', 'startMinute', 'endHour', 'endMinute'] as const).every(
      (f) => fields[f] === undefined || fields[f] === null || Number.isInteger(fields[f])
    );
    const modifier = fields['bidModifier'] === undefined || fields['bidModifier'] === null || typeof fields['bidModifier'] === 'number';
    return times && modifier;
  }

  /**
   * The ad schedules as judged and dispatched: each absent or null time field read as the zero Go
   * decodes it to, and `bidModifier` carried through as `undefined` when the caller omitted it.
   * Callers have checked the shape with {@link isAdScheduleShape}.
   *
   * The day is left exactly as the caller wrote it; {@link googleAdScheduleRefusal} trims and
   * upper-cases it the way `validateAdSchedules` does before comparing.
   *
   * `bidModifier` is the only field that is not zero-filled, and the asymmetry is the whole point:
   * upstream carries it as a `*float64` so that an omitted modifier stays distinguishable from `0`,
   * which is the -100% opt-out. Filling it with a zero here would switch the campaign off for every
   * window a caller listed without adjusting — a successful create that serves nowhere.
   */
  private googleAdScheduleList(raw: unknown): NormalizedAdSchedule[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const time = (name: string): number => (typeof fields[name] === 'number' ? (fields[name] as number) : 0);
      const modifier = fields['bidModifier'];
      return {
        dayOfWeek: typeof fields['dayOfWeek'] === 'string' ? fields['dayOfWeek'] : '',
        startHour: time('startHour'),
        startMinute: time('startMinute'),
        endHour: time('endHour'),
        endMinute: time('endMinute'),
        ...(typeof modifier === 'number' ? { bidModifier: modifier } : {}),
      };
    });
  }

  /**
   * Why upstream would refuse a normalized ad-schedule LIST, or `null` when it would not.
   *
   * A list-level guard rather than a per-entry one like {@link googleProximityRefusal}, because
   * three of `validateAdSchedules`' branches are about an entry's relationship to the ones before
   * it — an exact repeat, an overlap, and the per-day count — and none of them is decidable from a
   * single entry. The cap is checked by the caller against the SUBMITTED length, as upstream does,
   * before any repeat is collapsed.
   *
   * Mirrors `validateAdSchedules`' branch order exactly, and the order is load-bearing: day, start
   * hour, end hour, start minute, end minute, the empty-or-inverted window, the 24:15 overrun, the
   * bid modifier, THEN the repeat, THEN the overlap, THEN the per-day count. A repeat is tested
   * before the overlap because an exact duplicate is one criterion written twice rather than two
   * criteria that clash, and reporting it as an overlap would name the wrong defect.
   *
   * Overlap uses the half-open comparison upstream uses — `startA < endB && startB < endA` — so
   * 09:00-12:00 and 12:00-17:00 do NOT overlap: 12:00 is not before 12:00. A naive "do they touch"
   * test would refuse the ordinary split-day schedule, which is the over-refusal these mirrors exist
   * to avoid.
   *
   * `index` is reported from 1 so it matches what an operator counts; upstream's own message numbers
   * from 0.
   */
  private googleAdScheduleRefusal(schedules: NormalizedAdSchedule[]): string | null {
    // Accepted intervals per normalized day, as minutes of the day — the form both the overlap test
    // and the empty-window check compare in, so 24:00 is 1440 and sorts after every real end.
    const perDay = new Map<string, { start: number; end: number }[]>();
    // Accepted intervals by wire key, carrying the modifier a repeat must agree with.
    const seen = new Map<string, number | undefined>();

    for (const [index, schedule] of schedules.entries()) {
      const shown = `ad schedule ${index + 1}`;
      const day = googleAdsTrimSpace(schedule.dayOfWeek).toUpperCase();
      if (!(GOOGLE_ADS_SCHEDULE_DAYS as readonly string[]).includes(day)) {
        return `The Google Ads ${shown} needs a day of week of ${GOOGLE_ADS_SCHEDULE_DAYS.join(', ')}. Fix it and create again.`;
      }
      if (schedule.startHour < 0 || schedule.startHour > 23) {
        return `The Google Ads ${shown} has a start hour of ${schedule.startHour}, outside 0 to 23. Fix it and create again.`;
      }
      // 24 is midnight at the END of the day and is valid only as an end, which is what makes the
      // window half-open: a schedule running to midnight ends at hour 24.
      if (schedule.endHour < 1 || schedule.endHour > 24) {
        return `The Google Ads ${shown} has an end hour of ${schedule.endHour}, outside 1 to 24. Fix it and create again.`;
      }
      const minutes = GOOGLE_ADS_SCHEDULE_MINUTES as readonly number[];
      if (!minutes.includes(schedule.startMinute)) {
        return `The Google Ads ${shown} has a start minute of ${schedule.startMinute}. Google accepts only ${GOOGLE_ADS_SCHEDULE_MINUTES.join(', ')}, so pick one and create again.`;
      }
      if (!minutes.includes(schedule.endMinute)) {
        return `The Google Ads ${shown} has an end minute of ${schedule.endMinute}. Google accepts only ${GOOGLE_ADS_SCHEDULE_MINUTES.join(', ')}, so pick one and create again.`;
      }
      const start = schedule.startHour * 60 + schedule.startMinute;
      const end = schedule.endHour * 60 + schedule.endMinute;
      const window = `${googleAdsClockTime(schedule.startHour, schedule.startMinute)}-${googleAdsClockTime(schedule.endHour, schedule.endMinute)}`;
      // An end at or before the start is an empty or inverted window: the campaign would serve for
      // no time at all that day, which is never what a caller who wrote a schedule meant.
      if (end <= start) {
        return `The Google Ads ${shown} ends at ${googleAdsClockTime(schedule.endHour, schedule.endMinute)}, which is not after its start of ${googleAdsClockTime(schedule.startHour, schedule.startMinute)}. Fix it and create again.`;
      }
      // 24:00 is the only representation of end-of-day; 24:15 is past it.
      if (schedule.endHour === 24 && schedule.endMinute !== 0) {
        return `The Google Ads ${shown} ends at ${googleAdsClockTime(24, schedule.endMinute)}, past the end of the day. End hour 24 takes only minute 0, so fix it and create again.`;
      }
      if (schedule.bidModifier !== undefined) {
        const refusal = this.googleBidModifierRefusal(shown, schedule.bidModifier);
        if (refusal) return refusal;
      }

      const key = `${day}|${start}|${end}`;
      if (seen.has(key)) {
        // Collapsed when the two say the same thing, refused when they disagree about the bid —
        // Google accepts one criterion per interval, so the second value would be the one silently
        // dropped. A collapsed repeat does not reach the per-day count below, exactly as upstream.
        if (seen.get(key) !== schedule.bidModifier) {
          return `The Google Ads ${shown} repeats ${day} ${window} with a different bid modifier. Google accepts one entry per interval, so remove one and create again.`;
        }
        continue;
      }

      const accepted = perDay.get(day) ?? [];
      for (const other of accepted) {
        if (start < other.end && other.start < end) {
          const clash = `${googleAdsClockTime(Math.floor(other.start / 60), other.start % 60)}-${googleAdsClockTime(Math.floor(other.end / 60), other.end % 60)}`;
          return `The Google Ads ${shown} (${day} ${window}) overlaps ${day} ${clash}. Google rejects overlapping ad schedules on the same day, so merge them and create again.`;
        }
      }
      if (accepted.length >= GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY) {
        return `The Google Ads ${shown} is interval ${accepted.length + 1} on ${day}, and Google accepts at most ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} per day. Remove some and create again.`;
      }
      accepted.push({ start, end });
      perDay.set(day, accepted);
      seen.set(key, schedule.bidModifier);
    }
    return null;
  }

  /**
   * Whether one raw device-bid-modifier entry survives the Go decode into
   * `googleAdsDeviceBidModifierConfig`: an object carrying a string `device` and a `bidModifier`
   * that is absent, null or a number.
   *
   * `null` is accepted for the modifier for the same reason {@link isAdScheduleShape} accepts it —
   * Go decodes it to the same nil pointer an omitted key gives — but what happens NEXT is the
   * opposite: there an absent modifier is the ordinary case and reaches the wire untouched, here it
   * is a refusal. The pointer exists on both wire types; only one of them is allowed to stay nil.
   *
   * A null ENTRY is refused, as it is for an ad schedule and for the same reason: upstream refuses
   * it too — a null entry decodes to a zero struct whose nil modifier `googleAdsDeviceBidModifiers`
   * names — so only the wording differs, and saying the entry is malformed beats blaming a device
   * the caller never wrote.
   */
  private isDeviceBidModifierShape(entry: unknown): boolean {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const fields = entry as Record<string, unknown>;
    if (typeof fields['device'] !== 'string') return false;
    return fields['bidModifier'] === undefined || fields['bidModifier'] === null || typeof fields['bidModifier'] === 'number';
  }

  /**
   * The device bid modifiers as judged and dispatched, with `bidModifier` carried through as
   * `undefined` when the caller omitted it. Callers have checked the shape with
   * {@link isDeviceBidModifierShape}.
   *
   * The device is left exactly as the caller wrote it; {@link googleDeviceBidModifierRefusal} trims
   * and upper-cases it the way `validateDeviceBidModifiers` does before comparing.
   *
   * An absent modifier is NOT zero-filled, and the asymmetry with every other normalizer here is the
   * whole point: `0` is the -100% opt-out, so filling it would switch the campaign off for a device
   * the caller only meant to list — a successful create that serves on one device fewer.
   * {@link googleDeviceBidModifierRefusal}'s caller refuses the absence instead, as
   * `googleAdsDeviceBidModifiers` does upstream.
   */
  private googleDeviceBidModifierList(raw: unknown): NormalizedDeviceBidModifier[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      const fields = (entry ?? {}) as Record<string, unknown>;
      const modifier = fields['bidModifier'];
      return {
        device: typeof fields['device'] === 'string' ? fields['device'] : '',
        ...(typeof modifier === 'number' ? { bidModifier: modifier } : {}),
      };
    });
  }

  /**
   * Why upstream would refuse a normalized device-bid-modifier LIST, or `null` when it would not.
   *
   * A list-level guard rather than a per-entry one, because one of `validateDeviceBidModifiers`'
   * branches — a device named twice — is about an entry's relationship to the ones before it and is
   * not decidable from a single entry. The cap is checked by the caller against the SUBMITTED
   * length, as upstream does.
   *
   * Mirrors the per-entry branches in upstream's order: the device vocabulary, then the repeat, then
   * the bid modifier. A caller who writes `TABLET` twice with two different adjustments is refused
   * on the repeat and never reaches the range check, exactly as upstream.
   *
   * Entries reaching here have a modifier — the caller refuses an absent one first, where upstream
   * does, in the dispatcher and before the channel is known.
   *
   * `index` is reported from 1 so it matches what an operator counts; upstream's message numbers
   * from 0.
   */
  private googleDeviceBidModifierRefusal(devices: NormalizedDeviceBidModifier[]): string | null {
    const seen = new Set<string>();
    for (const [index, entry] of devices.entries()) {
      const shown = `device bid modifier ${index + 1}`;
      const device = googleAdsTrimSpace(entry.device).toUpperCase();
      if (!(GOOGLE_ADS_DEVICES as readonly string[]).includes(device)) {
        return `The Google Ads ${shown} names ${googleAdsEchoed(entry.device)}, which is not one of ${GOOGLE_ADS_DEVICES.join(', ')}. Fix it and create again.`;
      }
      if (seen.has(device)) {
        return `The Google Ads device bid modifiers name ${device} more than once. Google accepts one criterion per device, so the second adjustment would be the one silently dropped — remove one and create again.`;
      }
      seen.add(device);
      if (entry.bidModifier !== undefined) {
        const refusal = this.googleBidModifierRefusal(shown, entry.bidModifier);
        if (refusal) return refusal;
      }
    }
    return null;
  }

  /**
   * Why upstream would refuse one campaign-level demographic exclusion list, or `null` when it
   * would not. `null` is also the answer for a field that was never sent, and for a create carrying
   * no Google channel — nothing is refused for a campaign that was never going to send the field.
   *
   * ONE helper for `validateExcludedAgeRanges` and `validateExcludedGenders`, because the two are
   * the same upstream branch written twice: both decode a Go `[]string`, both fence the same
   * channels, both check `maxDemographicExclusions` against the SUBMITTED count before any repeat
   * is collapsed, and both refuse on the FIRST bad entry. Only the vocabulary differs, and that is
   * what `entryRefusal` carries. The two call sites stay separate so that if one of the upstream
   * validators moves, only its own call has to move with it.
   *
   * `listNoun` and `itemNoun` are the only text that differs between the two messages, so a new
   * demographic list upstream adds a call, not a third copy of these four strings.
   */
  private googleDemographicExclusionRefusal(
    raw: unknown,
    listNoun: string,
    itemNoun: string,
    channel: unknown,
    entryRefusal: (entry: string) => string | null
  ): string | null {
    if (raw === undefined || raw === null) return null;

    // Upstream decodes the field into a Go `[]string`, so a non-array or a non-string entry is
    // refused before any validator runs.
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
      return `Google Ads ${listNoun} must be a list of ${itemNoun}.`;
    }

    const entries = this.googleUpperCodeList(raw as string[]);
    if (entries.length === 0 || typeof channel !== 'string') return null;

    if (!(GOOGLE_CHANNELS_WITH_DEMOGRAPHIC_EXCLUSIONS as readonly string[]).includes(channel)) {
      return `Google Ads does not accept campaign-level demographic exclusions on ${GOOGLE_CAMPAIGN_CHANNEL_LABELS[channel as GoogleCampaignChannel] ?? channel} campaigns. Remove the ${listNoun} or pick a different channel, then create again.`;
    }

    if (entries.length > GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS) {
      return `Google Ads accepts at most ${GOOGLE_ADS_MAX_DEMOGRAPHIC_EXCLUSIONS} ${listNoun} on one campaign, and this one has ${entries.length}. Remove some and create again.`;
    }

    for (const entry of entries) {
      const refusal = entryRefusal(entry);
      if (refusal) return refusal;
    }
    return null;
  }

  /**
   * Why upstream would refuse one normalized excluded age range, or `null` when it would not.
   *
   * Mirrors `validateExcludedAgeRanges`' single per-entry branch: membership in
   * {@link GOOGLE_ADS_AGE_RANGE_MAP}, which carries BOTH the friendly spelling and Google's own
   * `AGE_RANGE_*` enum name for every value. A blank entry has no branch of its own, upstream or
   * here — it is simply not in the map, and the vocabulary message names what to write instead.
   *
   * A repeat is NOT refused: upstream collapses it. The echo is cut short, as every echo of an
   * unvalidated body is.
   */
  private googleExcludedAgeRangeRefusal(ageRange: string): string | null {
    if (Object.hasOwn(GOOGLE_ADS_AGE_RANGE_MAP, ageRange)) return null;
    return `Google Ads cannot exclude the age range ${googleAdsEchoed(ageRange)}. Pick one of ${GOOGLE_ADS_AGE_RANGES.join(', ')} — Google's AGE_RANGE_* enum names are accepted too — and create again.`;
  }

  /**
   * Why upstream would refuse one normalized excluded gender, or `null` when it would not.
   *
   * Mirrors `validateExcludedGenders`' single per-entry branch. UNDETERMINED is an ordinary member
   * of the vocabulary, not a non-value: it is the bucket Google puts users it could not classify
   * into, and excluding it is a real choice a campaign makes. A repeat is NOT refused — upstream
   * collapses it.
   */
  private googleExcludedGenderRefusal(gender: string): string | null {
    if ((GOOGLE_ADS_GENDERS as readonly string[]).includes(gender)) return null;
    return `Google Ads cannot exclude the gender ${googleAdsEchoed(gender)}. Pick one of ${GOOGLE_ADS_GENDERS.join(', ')} and create again.`;
  }

  /**
   * Why upstream would refuse one bid modifier, or `null` when it would not. Mirrors
   * `validateBidModifier`'s branches in order: finite, then the 0 opt-out, then the range. One
   * helper for both callers because upstream calls the one `validateBidModifier` from both
   * `validateAdSchedules` and `validateDeviceBidModifiers`.
   *
   * 0 RETURNS EARLY and is accepted. It is not a value below the minimum but the -100% opt-out —
   * "do not serve here at all" — which is how a day-parted campaign switches off the hours it does
   * not want, and how a campaign stops serving on tablets. A guard that tested the range first would
   * refuse the one modifier such a campaign is certain to carry.
   *
   * `noun` names the entry the caller wrote — an ad schedule or a device bid modifier — so the
   * message points at it rather than at the number.
   */
  private googleBidModifierRefusal(noun: string, modifier: number): string | null {
    if (!Number.isFinite(modifier)) {
      return `The Google Ads ${noun} needs a finite bid modifier. Fix it and create again.`;
    }
    if (modifier === 0) return null;
    if (modifier < GOOGLE_ADS_MIN_BID_MODIFIER || modifier > GOOGLE_ADS_MAX_BID_MODIFIER) {
      return `The Google Ads ${noun} has a bid modifier of ${modifier}. Google accepts 0 (do not serve) or ${GOOGLE_ADS_MIN_BID_MODIFIER} to ${GOOGLE_ADS_MAX_BID_MODIFIER}, so fix it and create again.`;
    }
    return null;
  }

  /**
   * The bidding plan, normalized and spread-ready, or `{}` when the request names none.
   *
   * SHAPE ONLY, deliberately — this drops what cannot be a value (a blank strategy, a
   * non-finite or zero number, a blank conversion action) and forwards everything else exactly as
   * given. It does NOT check that the strategy suits the channel, that a target belongs to the
   * strategy carrying it, or that a number is in range, even though all of that is knowable here.
   *
   * Those are campaign-service's calls and it makes every one of them in `validateBiddingPlan`
   * (`internal/platform/googleads/bidding.go`) as PURE PREFLIGHT: no network, no clock, and
   * nothing created — the refusal lands before the budget mutate, so an invalid plan costs a 400
   * and strands nothing. A second copy of those rules here could only diverge in one direction
   * that matters, refusing a create upstream would have accepted, and a duplicated rule drifts
   * the moment Google's own per-channel support moves. The form offers only the valid set per
   * channel, which is where that hazard belongs.
   *
   * Zero is "absent", not a value: upstream reads `0` on any of the three numbers as "not
   * supplied", so forwarding a typed zero and omitting the key are the same request — and only
   * omission stays true if that ever changes.
   */
  private googleBidding(body: CampaignCreateRequest): Record<string, unknown> {
    const plan: Record<string, unknown> = {};

    const strategy = typeof body?.biddingStrategy === 'string' ? body.biddingStrategy.trim() : '';
    if (strategy) plan['biddingStrategy'] = strategy;

    const cpcBid = this.googleBidAmount(body?.cpcBid);
    if (cpcBid !== undefined) plan['cpcBid'] = cpcBid;

    const targetCpa = this.googleBidAmount(body?.targetCpa);
    if (targetCpa !== undefined) plan['targetCpa'] = targetCpa;

    const targetRoas = this.googleBidAmount(body?.targetRoas);
    if (targetRoas !== undefined) plan['targetRoas'] = targetRoas;

    const conversionActions = Array.isArray(body?.conversionActions)
      ? body.conversionActions.map((action) => (typeof action === 'string' ? action.trim() : '')).filter((action) => action !== '')
      : [];
    if (conversionActions.length > 0) plan['conversionActions'] = conversionActions;

    return plan;
  }

  /**
   * One bidding number, or `undefined` when there is nothing to send.
   *
   * `NaN` and the infinities are dropped rather than forwarded because `JSON.stringify` renders
   * all three as `null`, which upstream reads as a type error on a `float64` field — a create
   * refused for a number the operator never typed.
   */
  private googleBidAmount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : undefined;
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

    // `startDate` / `endDate` travel in `rest`, untouched as Meta's are. They reach this point only
    // when the deployment can honour them: `createCampaign` refuses either key first otherwise
    // (`unservedMicrosoftScheduleField`), rather than dropping a flight the operator set.
    const { budgetUsd, cpcBid, timeZone, keywords, geoTargets, ...rest } = body.microsoftConfig as MicrosoftCampaignCreateRequest;

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
   * X's config, projected from `twitterConfig` on the request — which already carries the
   * service's own field names, so unlike Meta and Microsoft nothing is renamed.
   *
   * A PROJECTION, not a pass-through: only the fields `TwitterCampaignCreateRequest` declares are
   * sent. `tweetId` and `asUserId` are the two the dispatcher also reads and this app never sends —
   * a `tweetId` would silently replace the authored tweet (an explicit id wins over `tweetText`
   * upstream), and the publishing handle belongs to the connection, which campaign-service prefers
   * over a caller's `asUserId` for exactly that reason.
   *
   * Returns null (UNCONFIGURED, refused by `hasPlatformConfig`) for a config that is not an
   * object; `twitterConfigRefusal` has already named every field it would refuse, so a request
   * that reaches here with X selected is one the X client will accept on these fields. `bidding`
   * travels untouched, as on every lane: `unservedBiddingField` has refused it already when the
   * deployment cannot honour it, and campaign-service judges it otherwise.
   */
  private buildTwitterConfig(body: CampaignCreateRequest): Record<string, unknown> | null {
    // Only for a request that selects X. `twitterConfigRefusal` judges the config only then, so a
    // config riding beside other platforms would otherwise be forwarded unjudged.
    if (!Array.isArray(body?.platforms) || !body.platforms.includes('twitter-ads')) return null;
    const config: unknown = body?.twitterConfig;
    if (config === null || typeof config !== 'object' || Array.isArray(config)) return null;
    const { budgetAmount, startDate, endDate, tweetText, imageAssetId } = config as Partial<TwitterCampaignCreateRequest>;
    return {
      budgetAmount,
      startDate,
      endDate,
      tweetText,
      ...(typeof imageAssetId === 'string' && imageAssetId.trim() !== '' ? { imageAssetId: imageAssetId.trim() } : {}),
      ...('bidding' in config ? { bidding: (config as { bidding?: unknown }).bidding } : {}),
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

  /**
   * The flag gate and the `project` + `brief_id` pair every creative-asset READ shares.
   *
   * Returns `null` once it has handed the refusal to `next` — the caller returns immediately — so
   * the four handlers above cannot drift apart on which refusal they give for the same input.
   */
  private creativeAssetScope(req: Request, operation: string, next: NextFunction): { projectSlug: string; briefId: string } | null {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      next(new ResourceNotFoundError('Route', undefined, { operation, service: 'campaign_controller', path: req.path }));
      return null;
    }

    // DELIBERATELY stricter than `uploadCreativeAsset`, which takes any non-empty `brief_id`. The
    // upload is a write the operator just made a brief for, and a wrong id there is upstream's
    // 404 to give; these four are reads whose only caller is the campaigns page, which always has
    // the UUID campaign-service minted. Spending the shape check here keeps a malformed id out of
    // a path segment without an upstream round trip, and the upload stays lenient rather than
    // being tightened in a PR that does not own it.
    const briefId = typeof req.query['brief_id'] === 'string' ? req.query['brief_id'].trim() : '';
    if (!isCampaignServiceJobId(briefId)) {
      next(
        ServiceValidationError.forField('brief_id', 'the brief UUID is required to read its stored images', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return null;
    }
    // Refused, not defaulted, for the reason the upload refuses: a constant here would read
    // another foundation's brief.
    const projectSlug = typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
    if (projectSlug.length === 0) {
      next(
        ServiceValidationError.forField('project', 'no foundation is selected; reload the campaigns page from the sidebar', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return null;
    }

    return { projectSlug, briefId };
  }

  /** The `:assetId` path segment, refused unless it is the UUID campaign-service declares. */
  private creativeAssetId(req: Request, operation: string, next: NextFunction): string | null {
    const assetId = req.params['assetId'];
    if (typeof assetId !== 'string' || !isCampaignServiceJobId(assetId)) {
      next(
        ServiceValidationError.forField('assetId', 'assetId must be a creative asset UUID', {
          operation,
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return null;
    }
    return assetId;
  }
}
