// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SOCIAL_LISTENING_PREFERENCE_APP_NAME, SOCIAL_LISTENING_PREFERENCE_VALUE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { isSocialListeningPreferenceName } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import {
  MAX_TAGS_LIMIT,
  parseFoundationSlug,
  parseSocialListeningAnalyticsFilters,
  parseSocialListeningAuthorFilters,
  parseSocialListeningFilters,
  parseSocialListeningLimit,
  parseSocialListeningPagination,
  parseSocialListeningScope,
} from '../helpers/social-listening-params.helper';
import { logger } from '../services/logger.service';
import { SocialListeningService } from '../services/social-listening.service';
import { UserPreferenceService } from '../services/user-preference.service';
import { isImpersonating } from '../utils/auth-helper';

import type { PreferenceReadResponse, PreferenceUpsertRequest } from '@lfx-one/shared/interfaces';

/**
 * Social Listening HTTP boundary (LFXV2-3002): query params are validated via
 * `social-listening-params.helper` before touching the service. The dashboard-access gate (ED + LF Staff) lives in the route middleware.
 */
export class SocialListeningController {
  private readonly socialListeningService: SocialListeningService;
  private readonly userPreferenceService: UserPreferenceService;

  public constructor() {
    this.socialListeningService = new SocialListeningService();
    this.userPreferenceService = new UserPreferenceService();
  }

  /**
   * GET /api/social-listening/preferences/:name — one preference value for the current user.
   * `:name` is the URL-encoded full preference name; names outside the allowlist are 400s.
   */
  public async getPreference(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_preference';
    const startTime = logger.startOperation(req, operation);

    try {
      const name = this.parsePreferenceName(req, operation);

      // The API Gateway token always resolves the impersonator's profile — during impersonation
      // answer "no preference" so the target-scoped page never renders the impersonator's state.
      if (isImpersonating(req)) {
        const response: PreferenceReadResponse = { name, value: null };
        res.json(response);
        return;
      }

      const value = await this.userPreferenceService.getPreference(req, SOCIAL_LISTENING_PREFERENCE_APP_NAME, name);

      logger.success(req, operation, startTime, { found: value !== null });

      const response: PreferenceReadResponse = { name, value };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/social-listening/preferences/:name — upsert one preference value for the current user.
   * Body must be `{ value: string }` where value is stringified JSON (AppName/Type stay server-pinned).
   */
  public async upsertPreference(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'upsert_social_listening_preference';
    const startTime = logger.startOperation(req, operation);

    try {
      const name = this.parsePreferenceName(req, operation);
      const value = this.parsePreferenceValue(req, operation);
      await this.userPreferenceService.upsertPreference(req, SOCIAL_LISTENING_PREFERENCE_APP_NAME, name, value);

      logger.success(req, operation, startTime);

      const response: PreferenceReadResponse = { name, value };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/social-listening/preferences/:name — remove one preference for the current user.
   * Idempotent: deleting an absent preference succeeds with `value: null`.
   */
  public async deletePreference(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'delete_social_listening_preference';
    const startTime = logger.startOperation(req, operation);

    try {
      const name = this.parsePreferenceName(req, operation);
      await this.userPreferenceService.deletePreference(req, SOCIAL_LISTENING_PREFERENCE_APP_NAME, name);

      logger.success(req, operation, startTime);

      const response: PreferenceReadResponse = { name, value: null };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-feed — one page of mentions for a foundation, newest first.
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
   * GET /api/social-listening/mentions-count — total mentions matching the feed's scope + filters.
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
   * GET /api/social-listening/mentions-projects — sub-project options, spanning the foundation's whole history (no period).
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
   * GET /api/social-listening/mentions-platforms — platform options, also period-independent.
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
   * GET /api/social-listening/mentions-languages — distinct languages within the current scope + window.
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
   * GET /api/social-listening/mentions-keywords — distinct tracked keywords within the current scope + window.
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
   * GET /api/social-listening/mentions-tags — tags with mention volume (tag filter = scope-only; analytics top-tags = full predicate).
   * Query params: foundationSlug (required), period, sourceProjectId, platform, limit, feed filters
   */
  public async getMentionsTags(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_mentions_tags';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      // Tags serve the analytics panel and the filter panel — both read-state-blind, so the unread
      // feed/count params are not accepted here (parseSocialListeningAnalyticsFilters omits them).
      const tags = await this.socialListeningService.getMentionsTags(req, {
        ...scope,
        ...parseSocialListeningAnalyticsFilters(req, operation),
        limit: parseSocialListeningLimit(req, operation, MAX_TAGS_LIMIT),
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, tag_count: tags.length });

      res.json(tags);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/mentions-authors — author options cascading off every other filter.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters except `authors` / `mentionIds`
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
   * GET /api/social-listening/analytics-overview — headline KPIs plus change vs. the preceding equal-length window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters except `mentionIds`
   */
  public async getAnalyticsOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_overview';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const overview = await this.socialListeningService.getAnalyticsOverview(req, { ...scope, ...parseSocialListeningAnalyticsFilters(req, operation) });

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
   * GET /api/social-listening/analytics-over-time — mention volume bucketed by day (≤ ~2 months) or month.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters except `mentionIds`
   */
  public async getAnalyticsOverTime(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_over_time';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const points = await this.socialListeningService.getAnalyticsOverTime(req, { ...scope, ...parseSocialListeningAnalyticsFilters(req, operation) });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, data_points: points.length });

      res.json(points);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-platform-distribution — mention share per platform in scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters except `mentionIds`
   */
  public async getAnalyticsPlatformDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_platform_distribution';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const distribution = await this.socialListeningService.getAnalyticsPlatformDistribution(req, {
        ...scope,
        ...parseSocialListeningAnalyticsFilters(req, operation),
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, platform_count: distribution.length });

      res.json(distribution);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-sentiment-distribution — mention share per sentiment bucket in scope + window.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, feed filters except `mentionIds`
   */
  public async getAnalyticsSentimentDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_sentiment_distribution';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const distribution = await this.socialListeningService.getAnalyticsSentimentDistribution(req, {
        ...scope,
        ...parseSocialListeningAnalyticsFilters(req, operation),
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, bucket_count: distribution.length });

      res.json(distribution);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/social-listening/analytics-top-projects — sub-projects ranked by mention volume.
   * Query params: foundationSlug (required), period, sourceProjectId, platform, limit, feed filters except `mentionIds`
   */
  public async getAnalyticsTopProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_social_listening_analytics_top_projects';
    const startTime = logger.startOperation(req, operation);

    try {
      const scope = parseSocialListeningScope(req, operation);
      const limit = parseSocialListeningLimit(req, operation);
      const projects = await this.socialListeningService.getAnalyticsTopProjects(req, {
        ...scope,
        ...parseSocialListeningAnalyticsFilters(req, operation),
        limit,
      });

      logger.success(req, operation, startTime, { foundation_slug: scope.foundationSlug, project_count: projects.length });

      res.json(projects);
    } catch (error) {
      next(error);
    }
  }

  private parsePreferenceName(req: Request, operation: string): string {
    const name = req.params['name'] ?? '';

    if (!isSocialListeningPreferenceName(name)) {
      throw ServiceValidationError.forField('name', 'Unknown social-listening preference name', { operation });
    }

    return name;
  }

  private parsePreferenceValue(req: Request, operation: string): string {
    const body = req.body as PreferenceUpsertRequest | undefined;

    if (typeof body?.value !== 'string') {
      throw ServiceValidationError.forField('value', 'Request body must be { value: string }', { operation });
    }

    if (body.value.length > SOCIAL_LISTENING_PREFERENCE_VALUE_MAX_LENGTH) {
      throw ServiceValidationError.forField('value', 'value exceeds the maximum allowed size', { operation });
    }

    try {
      JSON.parse(body.value);
    } catch {
      throw ServiceValidationError.forField('value', 'value must be valid JSON', { operation });
    }

    return body.value;
  }
}
