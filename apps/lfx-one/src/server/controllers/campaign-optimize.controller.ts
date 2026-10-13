// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM,
  CAMPAIGN_AUDIENCE_WINDOWS,
  CAMPAIGN_METRICS_WINDOWS,
  CAMPAIGN_REF_ID_PATTERNS,
  CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM,
  REDDIT_KEYWORDS_WINDOWS,
} from '@lfx-one/shared/constants';
import type {
  CampaignAudiencePlatform,
  CampaignMetricsWindow,
  CampaignRefPlatform,
  CampaignServiceCampaignTarget,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { toMicrosoftKeywordMetricsResponse } from '../services/campaign-insights-mapper';
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
 * endpoint is not on campaign-service `main` yet (the Reddit and LinkedIn audience reads, the
 * LinkedIn campaign-ref resolve and the Reddit keyword read), which answer 404 unless
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
   * `GET /api/campaigns/reddit/keywords?project=&window=`: the Microsoft keyword table's sibling,
   * mapped the same way. Behind `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` until campaign-service serves it.
   */
  public async getRedditKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'campaign_reddit_keywords';
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceOptimizeReads)) {
      next(new ResourceNotFoundError('Route', undefined, { operation, service: 'campaign_optimize_controller', path: req.path }));
      return;
    }
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
      const data = toMicrosoftKeywordMetricsResponse(payload, new Date().toISOString());
      logger.success(req, operation, startTime, { keywords: data.totalKeywords, metricsPending: data.metricsPending });
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
