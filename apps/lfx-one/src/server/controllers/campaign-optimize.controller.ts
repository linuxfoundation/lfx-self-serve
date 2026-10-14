// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ADOPT_PLATFORM_CAMPAIGN_ID_PATTERN,
  CAMPAIGN_ADOPT_PLATFORMS,
  CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM,
  CAMPAIGN_AUDIENCE_WINDOWS,
  CAMPAIGN_ETAG_HEADER_PATTERN,
  CAMPAIGN_METRICS_WINDOWS,
  CAMPAIGN_REF_ID_PATTERNS,
  CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM,
  MAX_KEYWORD_TARGETING_KEYWORD_LENGTH,
  MAX_KEYWORD_TARGETING_REMOVALS,
  MAX_KEYWORD_TARGETING_REVISION_LENGTH,
  META_AD_SET_ID_PATTERN,
  META_AD_SET_STATUSES,
  REDDIT_KEYWORDS_WINDOWS,
  X_TARGETING_CRITERION_ID_PATTERN,
} from '@lfx-one/shared/constants';
import type {
  CampaignAdoptPlatform,
  CampaignAdoptRequest,
  CampaignAudiencePlatform,
  CampaignMetricsWindow,
  CampaignRefPlatform,
  CampaignServiceCampaignTarget,
  KeywordTargetingRemovalItem,
  KeywordTargetingRemovalsRequest,
  MetaAdSetStatus,
  MetaAdSetStatusRequest,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { toRedditKeywordMetricsResponse } from '../services/campaign-insights-mapper';
import { CampaignOptimizeService } from '../services/campaign-optimize.service';
import { isCampaignServiceJobId } from '../services/campaign-service.service';
import { logger } from '../services/logger.service';

/**
 * HTTP handlers for the Optimize tab's campaign-service reads and levers that the BFF did not reach
 * before. Mounted on `/api/campaigns` behind `requireCampaignManager`, like every sibling campaign
 * route, and every call runs on the caller's own bearer token.
 *
 * These have no legacy arm, so — following the Microsoft keyword read and the budget and bid
 * levers — they are not behind a cutover flag. The exceptions are the reads whose upstream
 * endpoint is not on campaign-service `main` yet (the Reddit and LinkedIn audience reads and the
 * LinkedIn campaign-ref resolve), which answer 404 unless
 * `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on.
 *
 * Inputs are checked against the upstream contract before any round trip: project slug present,
 * brief and campaign ids UUIDs (`Format(FormatUUID)` upstream), enumerations and lengths as the Goa
 * design declares them. Upstream re-validates everything and owns every campaign-dependent refusal.
 */
export class CampaignOptimizeController {
  private readonly optimizeService = new CampaignOptimizeService();

  /** `GET /api/campaigns/{meta|twitter|microsoft|reddit|linkedin}/audience?project=&window=`. */
  public async getPlatformAudience(req: Request, res: Response, next: NextFunction, platform: CampaignAudiencePlatform): Promise<void> {
    const operation = 'campaign_platform_audience';
    if (CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM.has(platform) && !isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceOptimizeReads)) {
      next(new ResourceNotFoundError('Route', undefined, { operation, service: 'campaign_optimize_controller', path: req.path }));
      return;
    }

    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'A project is required to read audience demographics', operation, req));
      return;
    }

    const allowed = CAMPAIGN_AUDIENCE_WINDOWS[platform];
    const rawWindow = req.query['window'];
    let window: string | undefined;
    if (rawWindow !== undefined) {
      if (typeof rawWindow !== 'string' || !allowed.includes(rawWindow)) {
        next(fieldError('window', `window must be one of: ${allowed.join(', ')}`, operation, req));
        return;
      }
      window = rawWindow;
    }

    const startTime = logger.startOperation(req, operation, { platform, window });
    try {
      const data = await this.optimizeService.getPlatformAudience(req, projectSlug, platform, window);
      logger.success(req, operation, startTime, { platform, buckets: data.bucket_count });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/campaigns/{meta|reddit|twitter|linkedin}/campaign-ref?project=&platformCampaignId=`.
   * Answers campaign-service's resolution as is; an unowned id is a 200 with no matches.
   */
  public async resolvePlatformCampaign(req: Request, res: Response, next: NextFunction, platform: CampaignRefPlatform): Promise<void> {
    const operation = 'campaign_platform_ref_resolve';
    if (CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM.has(platform) && !isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceOptimizeReads)) {
      next(new ResourceNotFoundError('Route', undefined, { operation, service: 'campaign_optimize_controller', path: req.path }));
      return;
    }
    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'project is required', operation, req));
      return;
    }
    const platformCampaignId = req.query['platformCampaignId'];
    if (typeof platformCampaignId !== 'string' || !CAMPAIGN_REF_ID_PATTERNS[platform].test(platformCampaignId)) {
      next(fieldError('platformCampaignId', `platformCampaignId is not a valid ${platform} campaign id`, operation, req));
      return;
    }

    const startTime = logger.startOperation(req, operation, { platform });
    try {
      const data = await this.optimizeService.resolvePlatformCampaign(req, projectSlug, platform, platformCampaignId);
      logger.success(req, operation, startTime, { platform, matchCount: data.match_count });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/campaigns/reddit/keywords?project=&window=`: Reddit keyword performance from
   * campaign-service's `get-reddit-ads-keywords` (#331), read-only. Not flag-gated: upstream serves
   * it, and answers 400 itself while its `REDDIT_METRICS_ENABLED` is off.
   */
  public async getRedditKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_reddit_keywords';
    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'A project is required to read keywords', operation, req));
      return;
    }
    const rawWindow = req.query['window'];
    let window: RedditKeywordsWindow | undefined;
    if (rawWindow !== undefined) {
      if (typeof rawWindow !== 'string' || !(REDDIT_KEYWORDS_WINDOWS as readonly string[]).includes(rawWindow)) {
        next(fieldError('window', `window must be one of: ${REDDIT_KEYWORDS_WINDOWS.join(', ')}`, operation, req));
        return;
      }
      window = rawWindow as RedditKeywordsWindow;
    }

    const startTime = logger.startOperation(req, operation, { window });
    try {
      const payload = await this.optimizeService.getRedditAdsKeywords(req, projectSlug, window);
      const data = toRedditKeywordMetricsResponse(payload, new Date().toISOString());
      logger.success(req, operation, startTime, { keywords: data.totalKeywords, truncated: data.truncated });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /** `GET /api/campaigns/:campaignId/settings?project=&briefId=`. */
  public async getCampaignSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_settings_read';
    const target = readTargetFromQuery(req, operation, next);
    if (!target) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { campaignId: target.campaignId, briefId: target.briefId });
    try {
      const data = await this.optimizeService.getCampaignSettings(req, target);
      logger.success(req, operation, startTime, {
        campaignId: target.campaignId,
        platform: data.platform,
        divergedCount: data.diverged_count,
        unknownCount: data.unknown_count,
      });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /** `GET /api/campaigns/:campaignId/meta-ad-sets?project=&briefId=&window=`. */
  public async listMetaAdSets(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_meta_ad_sets_list';
    const target = readTargetFromQuery(req, operation, next);
    if (!target) {
      return;
    }

    const rawWindow = req.query['window'];
    let window: CampaignMetricsWindow | undefined;
    if (rawWindow !== undefined) {
      if (typeof rawWindow !== 'string' || !(CAMPAIGN_METRICS_WINDOWS as readonly string[]).includes(rawWindow)) {
        next(fieldError('window', `window must be one of: ${CAMPAIGN_METRICS_WINDOWS.join(', ')}`, operation, req));
        return;
      }
      window = rawWindow as CampaignMetricsWindow;
    }

    const startTime = logger.startOperation(req, operation, { campaignId: target.campaignId, window });
    try {
      const data = await this.optimizeService.listMetaAdSets(req, target, window);
      logger.success(req, operation, startTime, { campaignId: target.campaignId, adSetCount: data.ad_set_count });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/campaigns/:campaignId/meta-ad-sets/:adSetId/status?project=` with
   * `{ briefId, status, etag }`. The etag is the campaign ROW's and goes upstream as `If-Match`; it is
   * required here because upstream answers its absence with 428, a guaranteed failure.
   */
  public async updateMetaAdSetStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_meta_ad_set_status';
    const campaignId = readCampaignId(req, operation, next);
    if (!campaignId) {
      return;
    }
    const adSetId = req.params['adSetId'];
    if (typeof adSetId !== 'string' || !META_AD_SET_ID_PATTERN.test(adSetId)) {
      next(fieldError('adSetId', 'adSetId must be a Meta ad set id: 1-32 digits without a leading zero', operation, req));
      return;
    }
    const body = readBody<MetaAdSetStatusRequest>(req, operation, next);
    if (!body) {
      return;
    }
    if (typeof body.status !== 'string' || !META_AD_SET_STATUSES.has(body.status as MetaAdSetStatus)) {
      next(fieldError('status', `status must be one of: ${[...META_AD_SET_STATUSES].join(', ')}`, operation, req));
      return;
    }
    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'project is required', operation, req));
      return;
    }
    const briefId = readBriefId(body.briefId, operation, req, next);
    if (!briefId) {
      return;
    }
    const etag = typeof body.etag === 'string' ? body.etag.trim() : '';
    if (!etag) {
      next(fieldError('etag', 'etag is required so a concurrent edit cannot be overwritten', operation, req));
      return;
    }
    // A value fetch cannot send as a header would be raised as a transport failure, which this
    // lever reports as UNCONFIRMED although nothing left the BFF. Refused as the bad input it is.
    if (!CAMPAIGN_ETAG_HEADER_PATTERN.test(etag)) {
      next(fieldError('etag', 'etag must be a valid HTTP header value', operation, req));
      return;
    }

    const status = body.status as MetaAdSetStatus;
    const startTime = logger.startOperation(req, operation, { campaignId, briefId, adSetId, status });
    try {
      const result = await this.optimizeService.updateMetaAdSetStatus(req, { projectSlug, briefId, campaignId, adSetId, status, etag });
      logger.success(req, operation, startTime, { campaignId, adSetId, status, outcome: result.outcome });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/campaigns/adopt?project=` with `{ briefId, platform, platformCampaignId }`. Answers
   * 201 with the new campaign row and its ETag. Google Ads is refused here (another owner's lane).
   */
  public async adoptCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_adopt';
    const body = readBody<CampaignAdoptRequest>(req, operation, next);
    if (!body) {
      return;
    }
    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'project is required', operation, req));
      return;
    }
    const briefId = readBriefId(body.briefId, operation, req, next);
    if (!briefId) {
      return;
    }
    if (typeof body.platform !== 'string' || !CAMPAIGN_ADOPT_PLATFORMS.has(body.platform as CampaignAdoptPlatform)) {
      next(fieldError('platform', `platform must be one of: ${[...CAMPAIGN_ADOPT_PLATFORMS].join(', ')}`, operation, req));
      return;
    }
    // Not trimmed: an id with surrounding whitespace is malformed, and upstream refuses it as such.
    const platformCampaignId = body.platformCampaignId;
    if (typeof platformCampaignId !== 'string' || !ADOPT_PLATFORM_CAMPAIGN_ID_PATTERN.test(platformCampaignId)) {
      next(fieldError('platformCampaignId', 'platformCampaignId must be 1-64 letters, digits, hyphens or underscores', operation, req));
      return;
    }

    const platform = body.platform as CampaignAdoptPlatform;
    const startTime = logger.startOperation(req, operation, { briefId, platform });
    try {
      const campaign = await this.optimizeService.adoptCampaign(req, { projectSlug, briefId, platform, platformCampaignId });
      logger.success(req, operation, startTime, { briefId, platform, campaignId: campaign.id });
      res.status(201).json(campaign);
    } catch (error) {
      next(error);
    }
  }

  /** `GET /api/campaigns/:campaignId/keyword-targeting?project=&briefId=` (Reddit and X). */
  public async getKeywordTargeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_keyword_targeting_read';
    const target = readTargetFromQuery(req, operation, next);
    if (!target) {
      return;
    }

    const startTime = logger.startOperation(req, operation, { campaignId: target.campaignId });
    try {
      const data = await this.optimizeService.getKeywordTargeting(req, target);
      logger.success(req, operation, startTime, { campaignId: target.campaignId, platform: data.platform, keywords: data.keywords?.length });
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/campaigns/:campaignId/keyword-targeting/removals?project=` with
   * `{ briefId, keywords, revision? }`. Each item names exactly one of `keyword` (Reddit) or
   * `criterionId` (X), and every item the same one. Which platform the campaign is on is upstream's
   * to decide; it refuses an item naming the wrong field, a missing Reddit revision, or a revision on X.
   */
  public async removeKeywordTargeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_keyword_targeting_remove';
    const campaignId = readCampaignId(req, operation, next);
    if (!campaignId) {
      return;
    }
    const body = readBody<KeywordTargetingRemovalsRequest>(req, operation, next);
    if (!body) {
      return;
    }
    const projectSlug = readProject(req);
    if (!projectSlug) {
      next(fieldError('project', 'project is required', operation, req));
      return;
    }
    const briefId = readBriefId(body.briefId, operation, req, next);
    if (!briefId) {
      return;
    }

    const entries: unknown = body.keywords;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_KEYWORD_TARGETING_REMOVALS) {
      next(fieldError('keywords', `keywords must be an array of 1 to ${MAX_KEYWORD_TARGETING_REMOVALS} entries`, operation, req));
      return;
    }
    const keywords: KeywordTargetingRemovalItem[] = [];
    let kind: 'keyword' | 'criterionId' | null = null;
    for (const [i, entry] of entries.entries()) {
      const item = readRemovalItem(entry);
      if (!item) {
        next(
          fieldError(
            `keywords[${i}]`,
            `each entry must name exactly one of keyword (1 to ${MAX_KEYWORD_TARGETING_KEYWORD_LENGTH} characters, not blank) or criterionId (1 to 32 letters or digits)`,
            operation,
            req
          )
        );
        return;
      }
      const itemKind = item.criterionId !== undefined ? 'criterionId' : 'keyword';
      if (kind !== null && itemKind !== kind) {
        next(fieldError(`keywords[${i}]`, 'every entry must name the same field: keyword on Reddit, criterionId on X', operation, req));
        return;
      }
      kind = itemKind;
      keywords.push(item);
    }

    let revision: string | undefined;
    if (body.revision !== undefined) {
      if (typeof body.revision !== 'string' || body.revision === '' || body.revision.length > MAX_KEYWORD_TARGETING_REVISION_LENGTH) {
        next(fieldError('revision', `revision must be a string of 1 to ${MAX_KEYWORD_TARGETING_REVISION_LENGTH} characters`, operation, req));
        return;
      }
      revision = body.revision;
    }

    const startTime = logger.startOperation(req, operation, { campaignId, briefId, count: keywords.length });
    try {
      const result = await this.optimizeService.removeKeywordTargeting(req, { projectSlug, briefId, campaignId, keywords, revision });
      logger.success(req, operation, startTime, { campaignId, requested: keywords.length, appliedCount: result.applied_count });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

/** The trimmed `?project=` slug, or `''`. */
function readProject(req: Request): string {
  return typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
}

function fieldError(field: string, message: string, operation: string, req: Request): ServiceValidationError {
  return ServiceValidationError.forField(field, message, { operation, service: 'campaign_optimize_controller', path: req.path });
}

/** The `:campaignId` route parameter when it is a campaign-service UUID; otherwise reports a 400 and returns null. */
function readCampaignId(req: Request, operation: string, next: NextFunction): string | null {
  const campaignId = req.params['campaignId'];
  if (typeof campaignId !== 'string' || !isCampaignServiceJobId(campaignId)) {
    next(fieldError('campaignId', 'campaignId must be a campaign UUID', operation, req));
    return null;
  }
  return campaignId;
}

/** A brief id from the query or body when it is a UUID (upstream `Format(FormatUUID)`); otherwise reports a 400 and returns null. */
function readBriefId(raw: unknown, operation: string, req: Request, next: NextFunction): string | null {
  const briefId = typeof raw === 'string' ? raw.trim() : '';
  if (!briefId) {
    next(fieldError('briefId', 'briefId is required', operation, req));
    return null;
  }
  if (!isCampaignServiceJobId(briefId)) {
    next(fieldError('briefId', 'briefId must be a brief UUID', operation, req));
    return null;
  }
  return briefId;
}

/** The JSON-object body, or null after reporting a 400. */
function readBody<T>(req: Request, operation: string, next: NextFunction): Partial<T> | null {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    next(fieldError('body', 'request body must be a JSON object', operation, req));
    return null;
  }
  return req.body as Partial<T>;
}

/** Campaign id (route), project and brief id (query) for a per-campaign read. */
function readTargetFromQuery(req: Request, operation: string, next: NextFunction): CampaignServiceCampaignTarget | null {
  const campaignId = readCampaignId(req, operation, next);
  if (!campaignId) {
    return null;
  }
  const projectSlug = readProject(req);
  if (!projectSlug) {
    next(fieldError('project', 'project is required', operation, req));
    return null;
  }
  const briefId = readBriefId(req.query['briefId'], operation, req, next);
  if (!briefId) {
    return null;
  }
  return { projectSlug, briefId, campaignId };
}

/**
 * One removal item, or null when it does not name exactly one valid field. A Reddit keyword is sent
 * exactly as given: upstream compares it verbatim (case and surrounding whitespace included) with
 * the keyword it read, so trimming here would make it name a different keyword.
 */
function readRemovalItem(entry: unknown): KeywordTargetingRemovalItem | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const candidate = entry as { keyword?: unknown; criterionId?: unknown };
  const hasKeyword = candidate.keyword !== undefined;
  const hasCriterion = candidate.criterionId !== undefined;
  if (hasKeyword === hasCriterion) {
    return null;
  }
  if (hasCriterion) {
    return typeof candidate.criterionId === 'string' && X_TARGETING_CRITERION_ID_PATTERN.test(candidate.criterionId)
      ? { criterionId: candidate.criterionId }
      : null;
  }
  const keyword = candidate.keyword;
  if (typeof keyword !== 'string' || keyword.trim() === '' || [...keyword].length > MAX_KEYWORD_TARGETING_KEYWORD_LENGTH) {
    return null;
  }
  return { keyword };
}
