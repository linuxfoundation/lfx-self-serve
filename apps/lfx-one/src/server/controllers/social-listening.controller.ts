// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import {
  parseFoundationSlug,
  parseSocialListeningAuthorFilters,
  parseSocialListeningFilters,
  parseSocialListeningLimit,
  parseSocialListeningPagination,
  parseSocialListeningScope,
} from '../helpers/social-listening-params.helper';
import { logger } from '../services/logger.service';
import { SocialListeningService } from '../services/social-listening.service';

/**
 * Social Listening HTTP boundary (LFXV2-3002). Every handler validates its query params through
 * `social-listening-params.helper` before touching the service, logs the HTTP operation, and defers
 * error logging to `apiErrorHandler` via a bare `next(error)`.
 *
 * The ED gate is enforced by route middleware, not here — see `social-listening.route.ts`.
 */
export class SocialListeningController {
  private readonly socialListeningService: SocialListeningService;

  public constructor() {
    this.socialListeningService = new SocialListeningService();
  }

  /**
   * GET /api/social-listening/mentions-feed
   * One page of mentions for a foundation, newest first.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, limit, offset, feed filters
   */
  public async getMentionsFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_feed';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const { limit, offset } = parseSocialListeningPagination(req, operation);

      const response = await this.socialListeningService.getMentionsFeed(req, {
        ...scope,
        ...parseSocialListeningFilters(req, operation),
        limit,
        offset,
      });

      logger.success(req, operation, startTime, {
        foundation_slug: scope.foundationSlug,
        limit,
        offset,
        returned_count: response.mentions.length,
      });

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-count
   * Total mentions matching the same scope + filters as the feed, for the paginator.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters
   */
  public async getMentionsCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_count';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);

      const total = await this.socialListeningService.getMentionsCount(req, {
        ...scope,
        ...parseSocialListeningFilters(req, operation),
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, total });

      res.json({ total });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-projects
   * Sub-project options for the scope select. Spans the foundation's whole history (no period).
   * Query params: foundationSlug (required)
   */
  public async getMentionsProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      const foundationSlug = parseFoundationSlug(req, operation);
      const projects = await this.socialListeningService.getMentionsProjects(req, { foundationSlug });

      logger.success(req, operation, startTime, { foundation_slug: foundationSlug, project_count: projects.length });

      res.json(projects);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-platforms
   * Platform options for the scope select. Also period-independent.
   * Query params: foundationSlug (required)
   */
  public async getMentionsPlatforms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_platforms';
    const startTime = logger.startOperation(req, operation);

    try {
      const foundationSlug = parseFoundationSlug(req, operation);
      const platforms = await this.socialListeningService.getMentionsPlatforms(req, { foundationSlug });

      logger.success(req, operation, startTime, { foundation_slug: foundationSlug, platform_count: platforms.length });

      res.json(platforms);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-languages
   * Distinct languages within the current scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getMentionsLanguages(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_languages';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const languages = await this.socialListeningService.getMentionsLanguages(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, language_count: languages.length });

      res.json(languages);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-keywords
   * Distinct tracked keywords within the current scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getMentionsKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_keywords';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const keywords = await this.socialListeningService.getMentionsKeywords(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, keyword_count: keywords.length });

      res.json(keywords);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-tags
   * Tags with their mention volume, highest first. Serves both the tag filter and the analytics
   * top-tags panel — the filter re-sorts alphabetically client-side. Capped at MENTION_TOP_TAGS_LIMIT.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getMentionsTags(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_tags';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const tags = await this.socialListeningService.getMentionsTags(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, tag_count: tags.length });

      res.json(tags);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-authors
   * Author options, cascading off every other active filter so the list narrows with the feed.
   * Caveat: authors arrive comma-joined, so an author name containing a comma can't be re-selected
   * as a filter value (accepted limitation of the 3016 client codec).
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters
   * except `authors` / `mentionIds`
   */
  public async getMentionsAuthors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_authors';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);

      const authors = await this.socialListeningService.getMentionsAuthors(req, {
        ...scope,
        ...parseSocialListeningAuthorFilters(req, operation),
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, author_count: authors.length });

      res.json(authors);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-overview
   * Headline KPIs plus change against the immediately preceding, equal-length window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getAnalyticsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_overview';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const overview = await this.socialListeningService.getAnalyticsOverview(req, scope);

      logger.success(req, operation, startTime, {
        foundation_slug: scope.foundationSlug,
        total_mentions: overview.TOTAL_MENTIONS,
      });

      res.json(overview);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-over-time
   * Mention volume bucketed by day (windows up to ~2 months) or month (anything longer).
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getAnalyticsOverTime(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_over_time';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const points = await this.socialListeningService.getAnalyticsOverTime(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, data_points: points.length });

      res.json(points);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-platform-distribution
   * Mention share per platform within the current scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getAnalyticsPlatformDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_platform_distribution';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const distribution = await this.socialListeningService.getAnalyticsPlatformDistribution(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, platform_count: distribution.length });

      res.json(distribution);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-sentiment-distribution
   * Mention share per sentiment bucket within the current scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform
   */
  public async getAnalyticsSentimentDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_sentiment_distribution';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const distribution = await this.socialListeningService.getAnalyticsSentimentDistribution(req, scope);

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, bucket_count: distribution.length });

      res.json(distribution);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-top-projects
   * Sub-projects ranked by mention volume.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, limit
   */
  public async getAnalyticsTopProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_top_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const limit = parseSocialListeningLimit(req, operation);
      const projects = await this.socialListeningService.getAnalyticsTopProjects(req, { ...scope, limit });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, project_count: projects.length });

      res.json(projects);
    } catch (error) {
      next(error);
    }
  }
}
