// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_AUDIENCE_WINDOWS, CAMPAIGN_REF_ID_PATTERNS } from '@lfx-one/shared/constants';
import type {
  CampaignAudiencePlatform,
  CampaignMetricsWindow,
  CampaignRefPlatform,
  CampaignServiceCampaignResolution,
  CampaignServiceCampaignTarget,
  CampaignServiceKeywordTargeting,
  CampaignServiceMetaAdSets,
  CampaignServicePlatformAudienceMap,
  CampaignServiceRedditKeywords,
  CampaignServiceSettingsReadback,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { ServiceValidationError } from '../errors/service-validation.error';
import { encodePathSegment } from '../helpers/url-validation';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Proxies the Optimize tab's campaign-service reads that the BFF did not reach before: per-platform
 * audience reads, campaign-ref resolves, the Reddit keyword read, the campaign settings readback,
 * Meta ad sets and keyword targeting (Reddit and X).
 *
 * Kept apart from `CampaignServiceClient` so it can grow without colliding with the monitor
 * cutover's edits there. Every call runs on the caller's own bearer token, every path segment is
 * encoded with `encodePathSegment`, and a window or id travels as a QUERY parameter (fifth argument).
 */
export class CampaignOptimizeService {
  private readonly microserviceProxy = new MicroserviceProxyService();

  /**
   * One platform's audience demographics for the project's OWN campaigns.
   *
   * `platform` is the campaign-service path segment and comes from the BFF route, never from the
   * request; it is still checked against the table so a caller bug cannot address another route.
   * The window is a QUERY parameter, omitted when the caller names none so upstream applies its own
   * default. Upstream fails the whole read when any one breakdown fails, so there is no partial arm.
   */
  public async getPlatformAudience<P extends CampaignAudiencePlatform>(
    req: Request,
    projectSlug: string,
    platform: P,
    window?: string
  ): Promise<CampaignServicePlatformAudienceMap[P]> {
    if (projectSlug === '') {
      throw ServiceValidationError.forField('project', 'An audience read requires the project it is scoped to.', {
        operation: 'get_platform_audience',
        service: 'campaign_optimize_service',
      });
    }
    if (!Object.prototype.hasOwnProperty.call(CAMPAIGN_AUDIENCE_WINDOWS, platform)) {
      throw ServiceValidationError.forField('platform', 'This platform has no audience read.', {
        operation: 'get_platform_audience',
        service: 'campaign_optimize_service',
      });
    }
    logger.debug(req, 'get_platform_audience', 'Reading audience demographics from campaign-service', { platform, window });
    return this.microserviceProxy.proxyRequest<CampaignServicePlatformAudienceMap[P]>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodePathSegment(projectSlug)}/${platform}/audience`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * Resolve one platform campaign id to campaign-service's own campaign and brief, as
   * `CampaignServiceClient.resolveMicrosoftAdsCampaign` does for Microsoft: the bridge from a
   * platform-keyed row (a keyword, an ad set) to the UUID-keyed levers. An unowned id is a 200 with
   * an empty `matches`, and MORE THAN ONE match is reachable (a re-pointed connection), so the
   * caller must check `match_count` and refuse rather than choose.
   *
   * The id is a QUERY parameter (fifth argument) and is checked against the platform's id rule
   * first. `linkedin-ads` has no upstream endpoint yet (see `CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM`).
   */
  public async resolvePlatformCampaign(
    req: Request,
    projectSlug: string,
    platform: CampaignRefPlatform,
    platformCampaignId: string
  ): Promise<CampaignServiceCampaignResolution> {
    const pattern = Object.prototype.hasOwnProperty.call(CAMPAIGN_REF_ID_PATTERNS, platform) ? CAMPAIGN_REF_ID_PATTERNS[platform] : null;
    if (projectSlug === '' || !pattern || !pattern.test(platformCampaignId)) {
      throw ServiceValidationError.forField('platformCampaignId', 'A campaign reference lookup requires the project and a valid platform campaign id.', {
        operation: 'resolve_platform_campaign',
        service: 'campaign_optimize_service',
      });
    }
    return this.microserviceProxy.proxyRequest<CampaignServiceCampaignResolution>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodePathSegment(projectSlug)}/${platform}/campaign-ref`,
      'GET',
      { platform_campaign_id: platformCampaignId }
    );
  }

  /**
   * Reddit keyword performance for the project's OWN campaigns: the Microsoft keyword read's
   * sibling (`getMicrosoftAdsKeywords`), same row shape and same query-parameter window. PENDING
   * upstream: campaign-service has no `GET /projects/{p}/reddit-ads/keywords` yet, so the wire type
   * is provisional and the route is behind `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS`.
   */
  public async getRedditAdsKeywords(req: Request, projectSlug: string, window?: RedditKeywordsWindow): Promise<CampaignServiceRedditKeywords> {
    if (projectSlug === '') {
      throw ServiceValidationError.forField('project', 'A keyword read requires the project it is scoped to.', {
        operation: 'get_reddit_ads_keywords',
        service: 'campaign_optimize_service',
      });
    }
    return this.microserviceProxy.proxyRequest<CampaignServiceRedditKeywords>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodePathSegment(projectSlug)}/reddit-ads/keywords`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * The campaign's current configuration on its platform, compared field by field with what the
   * row recorded. A pure read upstream: nothing is written to the platform or the row.
   */
  public async getCampaignSettings(req: Request, ref: CampaignServiceCampaignTarget): Promise<CampaignServiceSettingsReadback> {
    logger.debug(req, 'get_campaign_settings', 'Reading campaign settings from campaign-service', { campaign_id: ref.campaignId });
    return this.microserviceProxy.proxyRequest<CampaignServiceSettingsReadback>(req, 'LFX_V2_CAMPAIGN_SERVICE', `${campaignPath(ref)}/settings`, 'GET');
  }

  /** A Meta campaign's ad sets with their delivery over `window`, read live. */
  public async listMetaAdSets(req: Request, ref: CampaignServiceCampaignTarget, window?: CampaignMetricsWindow): Promise<CampaignServiceMetaAdSets> {
    logger.debug(req, 'list_meta_ad_sets', 'Reading Meta ad sets from campaign-service', { campaign_id: ref.campaignId, window });
    return this.microserviceProxy.proxyRequest<CampaignServiceMetaAdSets>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${campaignPath(ref)}/meta-ad-sets`,
      'GET',
      window ? { window } : undefined
    );
  }

  /** The positive keywords of a Reddit ad group or X line item, read live. Any other platform is upstream's 400. */
  public async getKeywordTargeting(req: Request, ref: CampaignServiceCampaignTarget): Promise<CampaignServiceKeywordTargeting> {
    logger.debug(req, 'get_keyword_targeting', 'Reading keyword targeting from campaign-service', { campaign_id: ref.campaignId });
    return this.microserviceProxy.proxyRequest<CampaignServiceKeywordTargeting>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${campaignPath(ref)}/keyword-targeting`,
      'GET'
    );
  }
}

/** `/projects/{p}/briefs/{b}/campaigns/{c}`, every segment encoded. */
function campaignPath(ref: CampaignServiceCampaignTarget): string {
  return `/projects/${encodePathSegment(ref.projectSlug)}/briefs/${encodePathSegment(ref.briefId)}/campaigns/${encodePathSegment(ref.campaignId)}`;
}
