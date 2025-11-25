// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  FoundationContributorsMentoredResponse,
  FoundationContributorsMentoredRow,
  FoundationHealthScoreDistributionResponse,
  FoundationHealthScoreDistributionRow,
  FoundationMaintainersDailyRow,
  FoundationMaintainersResponse,
  FoundationSoftwareValueResponse,
  FoundationTopProjectBySoftwareValueRow,
  FoundationTotalMembersResponse,
  FoundationTotalProjectsResponse,
  MonthlyMemberCountWithFoundation,
  MonthlyProjectCountWithFoundation,
  PendingActionItem,
  PendingSurveyRow,
  Project,
  ProjectIssuesResolutionAggregatedRow,
  ProjectIssuesResolutionResponse,
  ProjectIssuesResolutionRow,
  ProjectPullRequestsWeeklyResponse,
  ProjectPullRequestsWeeklyRow,
  ProjectRow,
  ProjectSettings,
  ProjectsListResponse,
  ProjectSlugToIdResponse,
  QueryServiceResponse,
  UniqueContributorsWeeklyResponse,
  UniqueContributorsWeeklyRow,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { serverLogger } from '../server';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling project business logic
 */
export class ProjectService {
  private accessCheckService: AccessCheckService;
  private microserviceProxy: MicroserviceProxyService;
  private natsService: NatsService;
  private etagService: ETagService;
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.natsService = new NatsService();
    this.etagService = new ETagService();
    this.snowflakeService = new SnowflakeService();
  }

  /**
   * Fetches all projects based on query parameters
   */
  public async getProjects(req: Request, query: Record<string, any> = {}): Promise<Project[]> {
    const params = {
      ...query,
      type: 'project',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    const projects = resources.map((resource) => resource.data);

    // Add writer access field to all projects
    return await this.accessCheckService.addAccessToResources(req, projects, 'project');
  }

  /**
   * Fetches a single project by ID
   */
  public async getProjectById(req: Request, uid: string, access: boolean = true): Promise<Project> {
    const params = {
      type: 'project',
      tags: uid,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Project', uid, {
        operation: 'get_project_by_id',
        service: 'project_service',
        path: '/query/resources',
      });
    }

    if (resources.length > 1) {
      req.log.warn(
        {
          project_id: uid,
          result_count: resources.length,
        },
        'Multiple projects found for single ID lookup'
      );
    }

    const project = resources[0].data;

    // Add writer access field to the project
    if (access) {
      return await this.accessCheckService.addAccessToResource(req, project, 'project');
    }

    return project;
  }

  /**
   * Search projects by name
   */
  public async searchProjects(req: Request, searchQuery: string): Promise<Project[]> {
    const params = {
      type: 'project',
      name: searchQuery,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches a single project by slug using NATS for slug resolution
   * First resolves slug to ID via NATS, then fetches project data
   */
  public async getProjectBySlug(req: Request, projectSlug: string): Promise<Project> {
    req.log.debug(
      {
        slug: projectSlug,
        operation: 'get_project_by_slug_via_nats',
        step: 'nats_lookup',
      },
      'Resolving project slug to ID via NATS'
    );

    const natsResult = await this.getProjectIdBySlug(projectSlug);

    if (!natsResult.exists || !natsResult.uid) {
      throw new ResourceNotFoundError('Project', projectSlug, {
        operation: 'get_project_by_slug_via_nats',
        service: 'project_service',
        path: '/nats/project-slug-lookup',
      });
    }

    req.log.info(
      {
        slug: projectSlug,
        project_id: natsResult.uid,
        operation: 'get_project_by_slug_via_nats',
        step: 'nats_success',
      },
      'Successfully resolved slug to ID via NATS'
    );

    // Now fetch the project using the resolved ID
    return this.getProjectById(req, natsResult.uid);
  }

  public async getProjectSettings(req: Request, uid: string): Promise<ProjectSettings> {
    return await this.microserviceProxy.proxyRequest<ProjectSettings>(req, 'LFX_V2_SERVICE', `/projects/${uid}/settings`, 'GET');
  }

  /**
   * Unified method to update project permissions using ETag for safe updates
   */
  public async updateProjectPermissions(
    req: Request,
    uid: string,
    operation: 'add' | 'update' | 'remove',
    usernameOrEmail: string,
    role?: 'view' | 'manage',
    manualUserInfo?: { name: string; email: string; username: string; avatar?: string }
  ): Promise<ProjectSettings> {
    // Step 1: Determine the appropriate identifier for backend operations
    // For emails, use the sub; for usernames, use the username directly
    let backendIdentifier = usernameOrEmail.trim();
    if (usernameOrEmail.includes('@')) {
      // For emails, get the sub for backend operations
      backendIdentifier = await this.resolveEmailToSub(req, usernameOrEmail);
    }

    // Step 2: Fetch current settings with ETag
    const { data: settings, etag } = await this.etagService.fetchWithETag<ProjectSettings>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${uid}/settings`,
      `${operation}_user_project_permissions`
    );

    // Step 3: Update the settings based on operation
    const updatedSettings = { ...settings };

    // Initialize arrays if they don't exist
    if (!updatedSettings.writers) updatedSettings.writers = [];
    if (!updatedSettings.auditors) updatedSettings.auditors = [];

    // Remove user from both arrays first (for all operations)
    // Compare by username property since writers/auditors are now UserInfo objects
    // Use backendIdentifier (sub) for comparison to ensure proper removal
    updatedSettings.writers = updatedSettings.writers.filter((u) => u.username !== backendIdentifier);
    updatedSettings.auditors = updatedSettings.auditors.filter((u) => u.username !== backendIdentifier);

    // For 'add' or 'update', we need to add the user back with full UserInfo
    if (operation === 'add' || operation === 'update') {
      if (!role) {
        throw new Error('Role is required for add/update operations');
      }

      // Use manual user info if provided, otherwise fetch from NATS
      let userInfo: { name: string; email: string; username: string; avatar?: string };
      if (manualUserInfo) {
        req.log.debug(
          {
            username: backendIdentifier,
            operation: `${operation}_user_project_permissions`,
          },
          'Using manually provided user info'
        );
        userInfo = {
          name: manualUserInfo.name,
          email: manualUserInfo.email,
          username: backendIdentifier, // Use the sub for backend consistency
        };
        // Only include avatar if it's provided and not empty
        if (manualUserInfo.avatar) {
          userInfo.avatar = manualUserInfo.avatar;
        }
      } else {
        // Fetch user info from user service via NATS using the original input
        const fetchedUserInfo = await this.getUserInfo(req, usernameOrEmail);
        // Use the backend identifier (sub) for the username in the stored UserInfo for backend consistency
        userInfo = {
          ...fetchedUserInfo,
          username: backendIdentifier, // Use the sub for backend consistency
        };
      }

      if (role === 'manage') {
        updatedSettings.writers = [...updatedSettings.writers, userInfo];
      } else {
        updatedSettings.auditors = [...updatedSettings.auditors, userInfo];
      }
    }
    // For 'remove' operation, user is already removed from both arrays above

    // Step 3: Clean up empty avatar fields before sending to API
    // The API validation doesn't accept empty strings for avatar URLs
    updatedSettings.writers = updatedSettings.writers.map((user) => {
      const cleanUser: any = {
        name: user.name,
        email: user.email,
        username: user.username,
      };
      if (user.avatar && user.avatar.trim() !== '') {
        cleanUser.avatar = user.avatar;
      }
      return cleanUser;
    });

    updatedSettings.auditors = updatedSettings.auditors.map((user) => {
      const cleanUser: any = {
        name: user.name,
        email: user.email,
        username: user.username,
      };
      if (user.avatar && user.avatar.trim() !== '') {
        cleanUser.avatar = user.avatar;
      }
      return cleanUser;
    });

    // Step 4: Update settings with ETag
    const result = await this.etagService.updateWithETag<ProjectSettings>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${uid}/settings`,
      etag,
      updatedSettings,
      `${operation}_user_project_permissions`
    );

    req.log.info(
      {
        operation: `${operation}_user_project_permissions`,
        project_id: uid,
        username: backendIdentifier,
        role: role || 'N/A',
      },
      `User ${operation} operation completed successfully`
    );

    return result;
  }

  /**
   * Resolve email address to sub using NATS request-reply pattern
   * @param req - Express request object for logging
   * @param email - Email address to lookup
   * @returns Sub associated with the email (used for backend auditors/writers)
   * @throws ResourceNotFoundError if user not found
   */
  public async resolveEmailToSub(req: Request, email: string): Promise<string> {
    const codec = this.natsService.getCodec();

    // Normalize email input
    const normalizedEmail = email.trim().toLowerCase();

    try {
      req.log.debug({ email: normalizedEmail }, 'Resolving email to sub via NATS');

      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_USERNAME, codec.encode(normalizedEmail), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const responseText = codec.decode(response.data);

      // Parse once and branch on the result shape
      let username: string;
      try {
        const parsed = JSON.parse(responseText);

        // Check if it's an error response
        if (typeof parsed === 'object' && parsed !== null && parsed.success === false) {
          req.log.warn({ email: normalizedEmail, error: parsed.error }, 'User email not found via NATS');

          throw new ResourceNotFoundError('User', normalizedEmail, {
            operation: 'resolve_email_to_sub',
            service: 'project_service',
            path: '/nats/email-to-sub',
          });
        }

        // Extract sub (username) from JSON success response or JSON string
        username = typeof parsed === 'string' ? parsed : parsed.sub || parsed.username;
      } catch (parseError) {
        // Re-throw ResourceNotFoundError as-is
        if (parseError instanceof ResourceNotFoundError) {
          throw parseError;
        }

        // JSON parsing failed - use raw text as username
        username = responseText;
      }

      // Trim and validate sub (username)
      username = username.trim();

      if (!username || username === '') {
        req.log.warn({ email: normalizedEmail }, 'Empty sub returned from NATS');

        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_sub',
          service: 'project_service',
          path: '/nats/email-to-sub',
        });
      }

      req.log.info({ email: normalizedEmail, sub: username }, 'Successfully resolved email to sub');

      return username;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

      req.log.error({ err: error, email: normalizedEmail }, 'Failed to resolve email to sub via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_sub',
          service: 'project_service',
          path: '/nats/email-to-sub',
        });
      }

      throw error;
    }
  }

  /**
   * Resolve email address to username using NATS request-reply pattern
   * @param req - Express request object for logging
   * @param email - Email address to lookup
   * @returns Username associated with the email (used for display purposes)
   * @throws ResourceNotFoundError if user not found
   */
  public async resolveEmailToUsername(req: Request, email: string): Promise<string> {
    const codec = this.natsService.getCodec();

    // Normalize email input
    const normalizedEmail = email.trim().toLowerCase();

    try {
      req.log.debug({ email: normalizedEmail }, 'Resolving email to username via NATS');

      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_USERNAME, codec.encode(normalizedEmail), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const responseText = codec.decode(response.data);

      // Parse once and branch on the result shape
      let username: string;
      try {
        const parsed = JSON.parse(responseText);

        // Check if it's an error response
        if (typeof parsed === 'object' && parsed !== null && parsed.success === false) {
          req.log.warn({ email: normalizedEmail, error: parsed.error }, 'User email not found via NATS');

          throw new ResourceNotFoundError('User', normalizedEmail, {
            operation: 'resolve_email_to_username',
            service: 'project_service',
            path: '/nats/email-to-username',
          });
        }

        // Extract username from JSON success response or JSON string
        username = typeof parsed === 'string' ? parsed : parsed.username;
      } catch (parseError) {
        // Re-throw ResourceNotFoundError as-is
        if (parseError instanceof ResourceNotFoundError) {
          throw parseError;
        }

        // JSON parsing failed - use raw text as username
        username = responseText;
      }

      // Trim and validate username
      username = username.trim();

      if (!username || username === '') {
        req.log.warn({ email: normalizedEmail }, 'Empty username returned from NATS');

        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_username',
          service: 'project_service',
          path: '/nats/email-to-username',
        });
      }

      req.log.info({ email: normalizedEmail, username }, 'Successfully resolved email to username');

      return username;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

      req.log.error({ err: error, email: normalizedEmail }, 'Failed to resolve email to username via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_username',
          service: 'project_service',
          path: '/nats/email-to-username',
        });
      }

      throw error;
    }
  }

  /**
   * Fetch user information by username or email using NATS request-reply pattern
   * For emails, it resolves to username first, then uses the username for user metadata lookup
   * @param req - Express request object for logging
   * @param usernameOrEmail - Username or email to lookup
   * @returns UserInfo object with name, email, username, and optional avatar
   * @throws ResourceNotFoundError if user not found
   */
  public async getUserInfo(req: Request, usernameOrEmail: string): Promise<{ name: string; email: string; username: string; avatar?: string }> {
    const codec = this.natsService.getCodec();

    // For emails, resolve to username for the NATS lookup
    // For usernames, use them directly
    let usernameForLookup = usernameOrEmail.trim();
    let originalEmail = '';

    if (usernameOrEmail.includes('@')) {
      originalEmail = usernameOrEmail;
      // First confirm the user exists with email_to_sub
      await this.resolveEmailToSub(req, usernameOrEmail);
      // Then get the username for user metadata lookup
      usernameForLookup = await this.resolveEmailToUsername(req, usernameOrEmail);
      req.log.debug({ email: originalEmail, resolvedUsername: usernameForLookup }, 'Resolved email to username for user metadata lookup');
    }

    try {
      req.log.debug({ username: usernameForLookup }, 'Fetching user metadata via NATS');

      const response = await this.natsService.request(NatsSubjects.USER_METADATA_READ, codec.encode(usernameForLookup), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const userMetadata = JSON.parse(responseText);

      // Validate response structure
      if (!userMetadata || typeof userMetadata !== 'object') {
        throw new ResourceNotFoundError('User', usernameForLookup, {
          operation: 'get_user_info',
          service: 'project_service',
          path: '/nats/user-metadata-read',
        });
      }

      // Check if it's an error response
      if (userMetadata.success === false) {
        req.log.warn({ username: usernameForLookup, error: userMetadata.error }, 'User metadata not found via NATS');

        throw new ResourceNotFoundError('User', usernameForLookup, {
          operation: 'get_user_info',
          service: 'project_service',
          path: '/nats/user-metadata-read',
        });
      }

      req.log.info({ username: usernameForLookup }, 'Successfully fetched user metadata');

      const userData = userMetadata.data || {};

      const result: { name: string; email: string; username: string; avatar?: string } = {
        // Use the name from metadata, fallback to constructed name from given_name/family_name
        name: userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim() || usernameForLookup,
        // Use the original email if we had one, otherwise leave empty
        email: originalEmail || '',
        username: usernameForLookup,
      };

      // Use picture field as avatar if available
      if (userData.picture && userData.picture.trim() !== '') {
        result.avatar = userData.picture;
      }

      return result;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

      req.log.error({ err: error, username: usernameForLookup }, 'Failed to fetch user metadata via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        throw new ResourceNotFoundError('User', usernameForLookup, {
          operation: 'get_user_info',
          service: 'project_service',
          path: '/nats/user-metadata-read',
        });
      }

      throw error;
    }
  }

  /**
   * Get list of projects with maintainers from Snowflake
   * @returns List of projects with ID, name, and slug that have maintainers
   */
  public async getProjectsWithMaintainersList(): Promise<ProjectsListResponse> {
    const query = `
      SELECT PROJECT_ID, NAME, SLUG
      FROM ANALYTICS.SILVER_DIM.PROJECTS P
      WHERE EXISTS (SELECT 1 FROM ANALYTICS.SILVER_DIM.MAINTAINERS M WHERE P.PROJECT_ID = M.PROJECT_ID)
      ORDER BY NAME
    `;

    const result = await this.snowflakeService.execute<ProjectRow>(query, []);

    // Transform Snowflake response to camelCase API response
    const projects = result.rows.map((row) => ({
      uid: row.PROJECT_ID,
      name: row.NAME,
      slug: row.SLUG,
    }));

    return { projects };
  }

  /**
   * Get project issues resolution data (opened vs closed issues) from Snowflake
   * Combines daily trend data with aggregated metrics
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Daily issue resolution data with aggregated totals and metrics
   */
  public async getProjectIssuesResolution(slug: string, entityType: 'foundation' | 'project'): Promise<ProjectIssuesResolutionResponse> {
    // Query switching based on entity type for daily trend data
    const dailyQuery =
      entityType === 'foundation'
        ? `
      SELECT
        METRIC_DATE,
        OPENED_ISSUES_COUNT,
        CLOSED_ISSUES_COUNT
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.FOUNDATION_ISSUES_RESOLUTION_DAILY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY METRIC_DATE DESC
    `
        : `
      SELECT
        METRIC_DATE,
        OPENED_ISSUES_COUNT,
        CLOSED_ISSUES_COUNT
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.PROJECT_ISSUES_RESOLUTION_DAILY
      WHERE PROJECT_SLUG = ?
      ORDER BY METRIC_DATE DESC
    `;

    // Query switching based on entity type for aggregated metrics
    const aggregatedQuery =
      entityType === 'foundation'
        ? `
      SELECT
        OPENED_ISSUES,
        CLOSED_ISSUES,
        TOTAL_ISSUES,
        RESOLUTION_RATE_PCT,
        AVG_DAYS_TO_CLOSE,
        MEDIAN_DAYS_TO_CLOSE
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.FOUNDATION_ISSUES_RESOLUTION
      WHERE FOUNDATION_SLUG = ?
    `
        : `
      SELECT
        OPENED_ISSUES,
        CLOSED_ISSUES,
        TOTAL_ISSUES,
        RESOLUTION_RATE_PCT,
        AVG_DAYS_TO_CLOSE,
        MEDIAN_DAYS_TO_CLOSE
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.PROJECT_ISSUES_RESOLUTION
      WHERE PROJECT_SLUG = ?
    `;

    const params = [slug];
    const aggregatedParams = [slug];

    // Execute both queries in parallel
    const [dailyResult, aggregatedResult] = await Promise.all([
      this.snowflakeService.execute<ProjectIssuesResolutionRow>(dailyQuery, params),
      this.snowflakeService.execute<ProjectIssuesResolutionAggregatedRow>(aggregatedQuery, aggregatedParams),
    ]);

    // Get aggregated metrics or use defaults
    const aggregated = aggregatedResult.rows[0] || {
      OPENED_ISSUES: 0,
      CLOSED_ISSUES: 0,
      RESOLUTION_RATE_PCT: 0,
      MEDIAN_DAYS_TO_CLOSE: 0,
    };

    return {
      data: dailyResult.rows,
      totalOpenedIssues: aggregated.OPENED_ISSUES,
      totalClosedIssues: aggregated.CLOSED_ISSUES,
      resolutionRatePct: aggregated.RESOLUTION_RATE_PCT,
      medianDaysToClose: aggregated.MEDIAN_DAYS_TO_CLOSE,
      totalDays: dailyResult.rows.length,
    };
  }

  /**
   * Get project pull requests weekly data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (aggregates all projects under foundation) or 'project' (single project)
   * @returns Weekly PR merge velocity data with aggregated metrics
   */
  public async getProjectPullRequestsWeekly(slug: string, entityType: 'foundation' | 'project'): Promise<ProjectPullRequestsWeeklyResponse> {
    // Query switching based on entity type
    const query =
      entityType === 'foundation'
        ? `
      SELECT
        WEEK_START_DATE,
        MERGED_PR_COUNT,
        AVG_MERGED_IN_DAYS,
        AVG_REVIEWERS_PER_PR,
        PENDING_PR_COUNT
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.FOUNDATION_PULL_REQUESTS_WEEKLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY WEEK_START_DATE DESC
      LIMIT 26
    `
        : `
      SELECT
        WEEK_START_DATE,
        MERGED_PR_COUNT,
        AVG_MERGED_IN_DAYS,
        AVG_REVIEWERS_PER_PR,
        PENDING_PR_COUNT
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.PROJECT_PULL_REQUESTS_WEEKLY
      WHERE PROJECT_SLUG = ?
      ORDER BY WEEK_START_DATE DESC
      LIMIT 26
    `;

    const result = await this.snowflakeService.execute<ProjectPullRequestsWeeklyRow>(query, [slug]);

    // Calculate aggregated metrics
    const totalMergedPRs = result.rows.reduce((sum, row) => sum + row.MERGED_PR_COUNT, 0);
    const totalMergeTime = result.rows.reduce((sum, row) => sum + row.AVG_MERGED_IN_DAYS * row.MERGED_PR_COUNT, 0);
    const avgMergeTime = totalMergedPRs > 0 ? totalMergeTime / totalMergedPRs : 0;

    return {
      data: result.rows,
      totalMergedPRs,
      avgMergeTime: Math.round(avgMergeTime * 10) / 10, // Round to 1 decimal place
      totalWeeks: result.rows.length,
    };
  }

  /**
   * Get contributors mentored weekly data from Snowflake
   * Always uses foundation_slug for filtering regardless of entity type
   * @param slug - Foundation slug for filtering
   * @returns Weekly contributors mentored data with aggregated metrics
   */
  public async getContributorsMentored(slug: string): Promise<FoundationContributorsMentoredResponse> {
    const query = `
      SELECT
        WEEK_START_DATE,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        WEEKLY_MENTORED_CONTRIBUTOR_COUNT,
        MENTORED_CONTRIBUTOR_COUNT
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.FOUNDATION_CONTRIBUTORS_MENTORED_WEEKLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY WEEK_START_DATE DESC
      LIMIT 52
    `;

    const result = await this.snowflakeService.execute<FoundationContributorsMentoredRow>(query, [slug]);

    // Calculate aggregated metrics
    const latestRow = result.rows[0];
    const totalMentored = latestRow?.MENTORED_CONTRIBUTOR_COUNT || 0;

    // Calculate average weekly new contributors
    const totalWeeklyNew = result.rows.reduce((sum, row) => sum + row.WEEKLY_MENTORED_CONTRIBUTOR_COUNT, 0);
    const avgWeeklyNew = result.rows.length > 0 ? Math.round((totalWeeklyNew / result.rows.length) * 10) / 10 : 0;

    return {
      data: result.rows,
      totalMentored,
      avgWeeklyNew,
      totalWeeks: result.rows.length,
    };
  }

  /**
   * Get unique contributors weekly data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (aggregates all projects) or 'project' (single project)
   * @returns Weekly unique contributor data with aggregated metrics
   */
  public async getUniqueContributorsWeekly(slug: string, entityType: 'foundation' | 'project'): Promise<UniqueContributorsWeeklyResponse> {
    // Query switching based on entity type
    const query =
      entityType === 'foundation'
        ? `
      SELECT
        WEEK_START_DATE,
        UNIQUE_CONTRIBUTORS,
        TOTAL_ACTIVE_CONTRIBUTORS,
        NEW_CONTRIBUTORS,
        RETURNING_CONTRIBUTORS
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.FOUNDATION_UNIQUE_CONTRIBUTORS_WEEKLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY WEEK_START_DATE DESC
      LIMIT 26
    `
        : `
      SELECT
        WEEK_START_DATE,
        UNIQUE_CONTRIBUTORS,
        TOTAL_ACTIVE_CONTRIBUTORS,
        NEW_CONTRIBUTORS,
        RETURNING_CONTRIBUTORS
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.PROJECT_UNIQUE_CONTRIBUTORS_WEEKLY
      WHERE PROJECT_SLUG = ?
      ORDER BY WEEK_START_DATE DESC
      LIMIT 26
    `;

    const result = await this.snowflakeService.execute<UniqueContributorsWeeklyRow>(query, [slug]);

    // Calculate aggregated metrics
    const totalUniqueContributors = result.rows.reduce((max, row) => Math.max(max, row.UNIQUE_CONTRIBUTORS), 0);
    const totalUniqueSum = result.rows.reduce((sum, row) => sum + row.UNIQUE_CONTRIBUTORS, 0);
    const avgUniqueContributors = result.rows.length > 0 ? totalUniqueSum / result.rows.length : 0;

    return {
      data: result.rows,
      totalUniqueContributors,
      avgUniqueContributors: Math.round(avgUniqueContributors * 10) / 10,
      totalWeeks: result.rows.length,
    };
  }

  /**
   * Get pending survey actions for a user
   * Queries for non-responded surveys and transforms them into PendingActionItem format
   * @param email - User's email from OIDC authentication
   * @param projectSlug - Project slug to filter surveys
   * @returns Array of pending action items with survey links
   */
  public async getPendingActionSurveys(email: string, projectSlug: string): Promise<PendingActionItem[]> {
    const query = `
      SELECT
        SURVEY_TITLE,
        SURVEY_CUTOFF_DATE,
        PROJECT_NAME,
        SURVEY_LINK
      FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_PENDING_ACTION_SURVEYS
      WHERE EMAIL = ?
        AND PROJECT_SLUG = ?
        AND SURVEY_CUTOFF_DATE > CURRENT_DATE()
        AND RESPONSE_TYPE = 'non_response'
        AND COMMITTEE_CATEGORY = 'Board'
      ORDER BY SURVEY_CUTOFF_DATE ASC
    `;

    const result = await this.snowflakeService.execute<PendingSurveyRow>(query, [email, projectSlug]);

    // Transform database rows to PendingActionItem format
    return result.rows.map((row) => {
      // Format the cutoff date as a readable string
      const cutoffDate = new Date(row.SURVEY_CUTOFF_DATE);
      const formattedDate = cutoffDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      return {
        type: 'Submit Feedback',
        badge: row.PROJECT_NAME,
        text: `${row.SURVEY_TITLE} is due ${formattedDate}`,
        icon: 'fa-regular fa-clipboard-list',
        color: 'amber',
        buttonText: 'Submit Survey',
        buttonLink: row.SURVEY_LINK,
      };
    });
  }

  /**
   * Get total projects count for a foundation from Snowflake
   * Queries MEMBER_DASHBOARD_TOTAL_PROJECTS table with monthly cumulative aggregation
   * Optimized single query including foundation metadata
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation total projects response with cumulative monthly data and metadata
   */
  public async getFoundationTotalProjects(foundationSlug: string): Promise<FoundationTotalProjectsResponse> {
    const query = `
      WITH monthly_counts AS (
        SELECT
          FOUNDATION_SEGMENT_ID,
          FOUNDATION_NAME,
          FOUNDATION_SOURCE_ID,
          FOUNDATION_SLUG,
          DATE_TRUNC('MONTH', CHILD_START_DATE) AS MONTH_START,
          COUNT(DISTINCT CHILD_SEGMENT_ID) AS MONTHLY_COUNT
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_TOTAL_PROJECTS
        WHERE FOUNDATION_SLUG = ?
        GROUP BY FOUNDATION_SEGMENT_ID, FOUNDATION_NAME, FOUNDATION_SOURCE_ID, FOUNDATION_SLUG, DATE_TRUNC('MONTH', CHILD_START_DATE)
      )
      SELECT
        FOUNDATION_SEGMENT_ID,
        FOUNDATION_NAME,
        FOUNDATION_SOURCE_ID,
        FOUNDATION_SLUG,
        MONTH_START,
        SUM(MONTHLY_COUNT) OVER (ORDER BY MONTH_START ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS PROJECT_COUNT
      FROM monthly_counts
      ORDER BY MONTH_START ASC
    `;

    const result = await this.snowflakeService.execute<MonthlyProjectCountWithFoundation>(query, [foundationSlug]);

    // Convert monthly data to arrays of counts and labels
    const monthlyData = result.rows.map((row) => row.PROJECT_COUNT);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.MONTH_START);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    // Total projects is the last cumulative count
    const totalProjects = result.rows.length > 0 ? result.rows[result.rows.length - 1].PROJECT_COUNT : 0;

    return {
      totalProjects,
      monthlyData,
      monthlyLabels,
    };
  }

  /**
   * Get total members count for a foundation from Snowflake
   * Queries MEMBER_DASHBOARD_MEMBERSHIP_TIER table with monthly cumulative aggregation
   * Counts distinct member organizations over time
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation total members response with cumulative monthly data and metadata
   */
  public async getFoundationTotalMembers(foundationSlug: string): Promise<FoundationTotalMembersResponse> {
    const query = `
      WITH monthly_counts AS (
        SELECT
          PROJECT_ID,
          PROJECT_NAME,
          PROJECT_SLUG,
          DATE_TRUNC('MONTH', START_DATE) AS MONTH_START,
          COUNT(DISTINCT ACCOUNT_ID) AS MONTHLY_COUNT
        FROM ANALYTICS_DEV.DEV_ADESILVA_PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MEMBERSHIP_TIER
        WHERE PROJECT_SLUG = ?
        GROUP BY PROJECT_ID, PROJECT_NAME, PROJECT_SLUG, DATE_TRUNC('MONTH', START_DATE)
      )
      SELECT
        PROJECT_ID,
        PROJECT_NAME,
        PROJECT_SLUG,
        MONTH_START,
        SUM(MONTHLY_COUNT) OVER (ORDER BY MONTH_START ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS MEMBER_COUNT
      FROM monthly_counts
      ORDER BY MONTH_START ASC
    `;

    const result = await this.snowflakeService.execute<MonthlyMemberCountWithFoundation>(query, [foundationSlug]);

    // Convert monthly data to arrays of counts and labels
    const monthlyData = result.rows.map((row) => row.MEMBER_COUNT);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.MONTH_START);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    // Total members is the last cumulative count
    const totalMembers = result.rows.length > 0 ? result.rows[result.rows.length - 1].MEMBER_COUNT : 0;

    return {
      totalMembers,
      monthlyData,
      monthlyLabels,
    };
  }

  /**
   * Get foundation software value and top projects from Snowflake
   * Queries FOUNDATION_TOP_PROJECTS_BY_SOFTWARE_VALUE table
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation software value response with total value and top projects
   */
  public async getFoundationSoftwareValue(foundationSlug: string): Promise<FoundationSoftwareValueResponse> {
    const query = `
      SELECT
        PROJECT_ID,
        PROJECT_NAME,
        PROJECT_SLUG,
        SOFTWARE_VALUE,
        VALUE_RANK
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_SOFTWARE_VALUE_TOP_PROJECTS
      WHERE FOUNDATION_SLUG = ?
      ORDER BY VALUE_RANK ASC
    `;

    const result = await this.snowflakeService.execute<FoundationTopProjectBySoftwareValueRow>(query, [foundationSlug]);

    // Calculate total value (sum of all projects) and convert to millions
    const totalValue = result.rows.reduce((sum, row) => sum + row.SOFTWARE_VALUE, 0) / 1000000;

    // Get top 3 projects and convert values to millions
    const topProjects = result.rows.slice(0, 3).map((row) => ({
      name: row.PROJECT_NAME,
      value: row.SOFTWARE_VALUE / 1000000,
    }));

    return {
      totalValue,
      topProjects,
    };
  }

  /**
   * Get foundation maintainers data from Snowflake
   * Queries FOUNDATION_MAINTAINERS_YEARLY table (contains daily data despite name)
   * Returns daily maintainer counts for detailed trend visualization
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation maintainers response with average and daily trend data
   */
  public async getFoundationMaintainers(foundationSlug: string): Promise<FoundationMaintainersResponse> {
    const query = `
      SELECT
        METRIC_DATE,
        ACTIVE_MAINTAINERS,
        AVG_MAINTAINERS_YEARLY
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_MAINTAINERS_YEARLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY METRIC_DATE ASC
    `;

    const result = await this.snowflakeService.execute<FoundationMaintainersDailyRow>(query, [foundationSlug]);

    // Get average maintainers from first row (same across all rows)
    const avgMaintainers = result.rows.length > 0 ? Math.round(result.rows[0].AVG_MAINTAINERS_YEARLY) : 0;

    // Extract daily data and labels
    const trendData = result.rows.map((row) => row.ACTIVE_MAINTAINERS);
    const trendLabels = result.rows.map((row) => {
      const date = new Date(row.METRIC_DATE);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    });

    return {
      avgMaintainers,
      trendData,
      trendLabels,
    };
  }

  /**
   * Get foundation health score distribution from Snowflake
   * Queries FOUNDATION_HEALTH_SCORE_DISTRIBUTION table
   * Returns project count breakdown by health category
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation health score distribution with counts by category
   */
  public async getFoundationHealthScoreDistribution(foundationSlug: string): Promise<FoundationHealthScoreDistributionResponse> {
    const query = `
      SELECT
        HEALTH_SCORE_CATEGORY,
        PROJECT_COUNT
      FROM ANALYTICS_DEV.DEV_MSALOMAO_PLATINUM_LFX_ONE.FOUNDATION_HEALTH_SCORE_DISTRIBUTION
      WHERE FOUNDATION_SLUG = ?
    `;

    const result = await this.snowflakeService.execute<FoundationHealthScoreDistributionRow>(query, [foundationSlug]);

    // Map categories to response structure (case-insensitive)
    const distribution = {
      excellent: 0,
      healthy: 0,
      stable: 0,
      unsteady: 0,
      critical: 0,
    };

    result.rows.forEach((row) => {
      const category = row.HEALTH_SCORE_CATEGORY.toLowerCase();
      if (category === 'excellent') distribution.excellent = row.PROJECT_COUNT;
      if (category === 'healthy') distribution.healthy = row.PROJECT_COUNT;
      if (category === 'stable') distribution.stable = row.PROJECT_COUNT;
      if (category === 'unsteady') distribution.unsteady = row.PROJECT_COUNT;
      if (category === 'critical') distribution.critical = row.PROJECT_COUNT;
    });

    return distribution;
  }

  /**
   * Get project UID by slug using NATS request-reply pattern
   * @private
   */
  private async getProjectIdBySlug(slug: string): Promise<ProjectSlugToIdResponse> {
    const codec = this.natsService.getCodec();

    try {
      const response = await this.natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(slug), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const uid = codec.decode(response.data);

      // Check if we got a valid project ID
      if (!uid || uid.trim() === '') {
        serverLogger.info({ slug }, 'Project slug not found via NATS');
        return {
          uid: '',
          slug,
          exists: false,
        };
      }

      serverLogger.info({ slug, project_id: uid }, 'Successfully resolved project slug to ID');

      return {
        uid: uid.trim(),
        slug,
        exists: true,
      };
    } catch (error) {
      serverLogger.error({ err: error, slug }, 'Failed to resolve project slug via NATS');

      // If it's a timeout or no responder error, treat as not found
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          uid: '',
          slug,
          exists: false,
        };
      }

      throw error;
    }
  }
}
