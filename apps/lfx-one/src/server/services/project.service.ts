// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  CodeCommitsDailyResponse,
  FoundationCodeCommitsDailyRow,
  FoundationContributorsMentoredResponse,
  FoundationContributorsMentoredRow,
  FoundationHealthEventsMonthlyRow,
  FoundationHealthScoreDistributionResponse,
  FoundationHealthScoreDistributionRow,
  FoundationEventsAttendanceDistributionResponse,
  FoundationEventsAttendanceDistributionRow,
  FoundationEventsQuarterlyResponse,
  FoundationEventsQuarterlyRow,
  FoundationMaintainersDailyRow,
  FoundationMaintainersDistributionResponse,
  FoundationMaintainersDistributionRow,
  FoundationMaintainersMonthlyResponse,
  FoundationMaintainersMonthlyRow,
  FoundationMaintainersResponse,
  FoundationProjectsDetailResponse,
  FoundationProjectsDetailRow,
  FoundationProjectsLifecycleDistributionResponse,
  FoundationProjectsLifecycleDistributionRow,
  LifecycleStage,
  FoundationSoftwareValueResponse,
  FoundationValueConcentrationResponse,
  FoundationValueConcentrationRow,
  FoundationTotalProjectsMonthlyRow,
  FoundationTopProjectBySoftwareValueRow,
  FoundationTotalMembersResponse,
  FoundationTotalProjectsResponse,
  FoundationActiveContributorsMonthlyRow,
  FoundationActiveContributorsMonthlyResponse,
  FoundationContributorsDistributionResponse,
  FoundationContributorsDistributionRow,
  FoundationUniqueContributorsDailyRow,
  HealthEventsMonthlyResponse,
  HealthMetricsAggregatedRow,
  HealthMetricsDailyResponse,
  MonthlyMemberCountWithFoundation,
  PendingActionItem,
  PendingSurveyRow,
  Project,
  ProjectCodeCommitsDailyRow,
  ProjectHealthEventsMonthlyRow,
  ProjectHealthMetricsDailyRow,
  ProjectIssuesResolutionAggregatedRow,
  ProjectIssuesResolutionResponse,
  ProjectIssuesResolutionRow,
  ProjectPullRequestsWeeklyResponse,
  ProjectPullRequestsWeeklyRow,
  ProjectRow,
  ProjectSettings,
  ProjectsListResponse,
  ProjectSlugToIdResponse,
  ProjectUniqueContributorsDailyRow,
  QueryServiceResponse,
  UniqueContributorsDailyResponse,
  UniqueContributorsWeeklyResponse,
  UniqueContributorsWeeklyRow,
  WebActivitiesSummaryResponse,
  EmailCtrResponse,
  SocialMediaResponse,
  SocialReachResponse,
  MemberRetentionResponse,
  MemberAcquisitionResponse,
  EngagedCommunitySizeResponse,
  FlywheelConversionResponse,
  NorthStarMonthlyDataPoint,
  MembershipChurnPerTierSummaryResponse,
  NpsSummaryResponse,
  OutstandingBalanceSummaryResponse,
  ParticipatingOrgsSummaryResponse,
  EventsSummaryResponse,
  TrainingCertificationSummaryResponse,
  CodeContributionSummaryResponse,
  CodeContributionRange,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling project business logic
 */
export class ProjectService {
  private readonly accessCheckService: AccessCheckService;
  private readonly microserviceProxy: MicroserviceProxyService;
  private readonly natsService: NatsService;
  private readonly etagService: ETagService;
  private readonly snowflakeService: SnowflakeService;

  private static readonly rangeSuffixMap: Record<string, Record<string, string>> = {
    standard: {
      YTD: '_ytd',
      COMPLETED_YEAR: '_last_completed_year',
      COMPLETED_YEAR_2: '_prev_completed_year',
      COMPLETED_YEAR_3: '_3rd_last_completed_year',
      COMPLETED_YEAR_4: '_4th_last_completed_year',
    },
    engagementScoresGoal: {
      YTD: '_ytd',
      COMPLETED_YEAR: '_last_completed_year',
      COMPLETED_YEAR_2: '_previous_completed_year',
      COMPLETED_YEAR_3: '_third_last_completed_year',
      COMPLETED_YEAR_4: '_fourth_last_completed_year',
    },
    eventComparison: {
      YTD: '_last_completed_year',
      COMPLETED_YEAR: '_prev_completed_year',
      COMPLETED_YEAR_2: '_3rd_last_completed_year',
      COMPLETED_YEAR_3: '_4th_last_completed_year',
    },
    training: {
      YTD: 'YTD',
      COMPLETED_YEAR: 'LAST_COMPLETED_YEAR',
      COMPLETED_YEAR_2: 'PREV_COMPLETED_YEAR',
      COMPLETED_YEAR_3: '3RD_LAST_COMPLETED_YEAR',
      COMPLETED_YEAR_4: '4th_LAST_COMPLETED_YEAR',
    },
  };

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.natsService = new NatsService();
    this.etagService = new ETagService();
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Fetches all projects based on query parameters
   */
  public async getProjects(req: Request, query: Record<string, any> = {}): Promise<Project[]> {
    const params = {
      ...query,
      type: 'project',
      page_size: 100,
    };

    const resources = await fetchAllQueryResources<Project>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<Project>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Add writer access field to all projects
    return await this.accessCheckService.addAccessToResources(req, resources, 'project');
  }

  /**
   * Fetches a single project by ID
   */
  public async getProjectById(req: Request, uid: string, access: boolean = true): Promise<Project> {
    const project = await this.microserviceProxy.proxyRequest<Project>(req, 'LFX_V2_SERVICE', `/projects/${uid}`, 'GET');

    if (!project) {
      throw new ResourceNotFoundError('Project', uid, {
        operation: 'get_project_by_id',
        service: 'project_service',
        path: `/projects/${uid}`,
      });
    }

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
    const natsResult = await this.getProjectIdBySlug(req, projectSlug);

    if (!natsResult.exists || !natsResult.uid) {
      throw new ResourceNotFoundError('Project', projectSlug, {
        operation: 'get_project_by_slug_via_nats',
        service: 'project_service',
        path: '/nats/project-slug-lookup',
      });
    }

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
        logger.debug(req, `${operation}_user_project_permissions`, 'Using manual user info', {
          username: backendIdentifier,
          info_source: 'manual',
        });
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
    const startTime = logger.startOperation(req, `${operation}_user_project_permissions`, {
      project_id: uid,
      username: backendIdentifier,
      role: role || 'N/A',
    });

    const result = await this.etagService.updateWithETag<ProjectSettings>(
      req,
      'LFX_V2_SERVICE',
      `/projects/${uid}/settings`,
      etag,
      updatedSettings,
      `${operation}_user_project_permissions`
    );

    logger.success(req, `${operation}_user_project_permissions`, startTime, {
      project_id: uid,
      username: backendIdentifier,
      role: role || 'N/A',
    });

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

    const startTime = logger.startOperation(req, 'resolve_email_to_sub', { email: normalizedEmail });

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_SUB, codec.encode(normalizedEmail), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const responseText = codec.decode(response.data);

      // Parse once and branch on the result shape
      let username: string;
      try {
        const parsed = JSON.parse(responseText);

        // Check if it's an error response
        if (typeof parsed === 'object' && parsed !== null && parsed.success === false) {
          logger.warning(req, 'resolve_email_to_sub', 'User email not found via NATS', {
            email: normalizedEmail,
            error: parsed.error,
          });

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
        logger.warning(req, 'resolve_email_to_sub', 'Empty sub returned from NATS', {
          email: normalizedEmail,
        });

        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_sub',
          service: 'project_service',
          path: '/nats/email-to-sub',
        });
      }

      logger.success(req, 'resolve_email_to_sub', startTime, {
        email: normalizedEmail,
        sub: username,
      });

      return username;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

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

    const startTime = logger.startOperation(req, 'resolve_email_to_username', { email: normalizedEmail });

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_USERNAME, codec.encode(normalizedEmail), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const responseText = codec.decode(response.data);

      // Parse once and branch on the result shape
      let username: string;
      try {
        const parsed = JSON.parse(responseText);

        // Check if it's an error response
        if (typeof parsed === 'object' && parsed !== null && parsed.success === false) {
          logger.warning(req, 'resolve_email_to_username', 'User email not found via NATS', {
            email: normalizedEmail,
            error: parsed.error,
          });

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
        logger.warning(req, 'resolve_email_to_username', 'Empty username returned from NATS', {
          email: normalizedEmail,
        });

        throw new ResourceNotFoundError('User', normalizedEmail, {
          operation: 'resolve_email_to_username',
          service: 'project_service',
          path: '/nats/email-to-username',
        });
      }

      logger.success(req, 'resolve_email_to_username', startTime, {
        email: normalizedEmail,
        username,
      });

      return username;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

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
      logger.debug(req, 'get_user_info', 'Email resolved to username', {
        email: originalEmail,
        resolved_username: usernameForLookup,
      });
    }

    const startTime = logger.startOperation(req, 'get_user_info', { username: usernameForLookup });

    try {
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
        logger.warning(req, 'get_user_info', 'User metadata not found via NATS', {
          username: usernameForLookup,
          error: userMetadata.error,
        });

        throw new ResourceNotFoundError('User', usernameForLookup, {
          operation: 'get_user_info',
          service: 'project_service',
          path: '/nats/user-metadata-read',
        });
      }

      const userData = userMetadata.data || {};

      const resolvedEmail = (originalEmail || userData.email || '').trim().toLowerCase();
      if (!resolvedEmail) {
        throw ServiceValidationError.forField('email', 'User email could not be resolved from metadata', {
          operation: 'get_user_info',
          service: 'project_service',
        });
      }

      const result: { name: string; email: string; username: string; avatar?: string } = {
        // Use the name from metadata, fallback to constructed name from given_name/family_name
        name: userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim() || usernameForLookup,
        email: resolvedEmail,
        username: usernameForLookup,
      };

      // Use picture field as avatar if available
      if (userData.picture && userData.picture.trim() !== '') {
        result.avatar = userData.picture;
      }

      logger.success(req, 'get_user_info', startTime, { username: usernameForLookup });

      return result;
    } catch (error) {
      // Re-throw ResourceNotFoundError as-is
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_ISSUES_RESOLUTION_DAILY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY METRIC_DATE DESC
    `
        : `
      SELECT
        METRIC_DATE,
        OPENED_ISSUES_COUNT,
        CLOSED_ISSUES_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_ISSUES_RESOLUTION_DAILY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_ISSUES_RESOLUTION
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_ISSUES_RESOLUTION
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_PULL_REQUESTS_WEEKLY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_PULL_REQUESTS_WEEKLY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_CONTRIBUTORS_MENTORED_WEEKLY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_UNIQUE_CONTRIBUTORS_WEEKLY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_UNIQUE_CONTRIBUTORS_WEEKLY
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBER_DASHBOARD_PENDING_ACTION_SURVEYS
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

      // Format due date for display below title
      const displayDate = cutoffDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      return {
        type: 'Submit Feedback',
        badge: row.PROJECT_NAME,
        text: `${row.SURVEY_TITLE} is due ${formattedDate}`,
        icon: 'fa-regular fa-clipboard-list',
        severity: 'warn',
        buttonText: 'Submit Survey',
        buttonLink: row.SURVEY_LINK,
        date: `Due ${displayDate}`,
      };
    });
  }

  /**
   * Get total projects count for a foundation from Snowflake
   * Queries FOUNDATION_TOTAL_PROJECTS_MONTHLY with pre-computed cumulative monthly counts
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Foundation total projects response with cumulative monthly data and metadata
   */
  public async getFoundationTotalProjects(foundationSlug: string): Promise<FoundationTotalProjectsResponse> {
    const query = `
      SELECT
        MONTH_START,
        PROJECT_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_TOTAL_PROJECTS_MONTHLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY MONTH_START ASC
    `;

    const result = await this.snowflakeService.execute<FoundationTotalProjectsMonthlyRow>(query, [foundationSlug]);

    const monthlyData = result.rows.map((row) => row.PROJECT_COUNT);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.MONTH_START);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    const totalProjects = result.rows.length > 0 ? result.rows[result.rows.length - 1].PROJECT_COUNT : 0;

    return { totalProjects, monthlyData, monthlyLabels };
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
        FROM ANALYTICS.PLATINUM_LFX_ONE.MEMBER_DASHBOARD_MEMBERSHIP_TIER
        WHERE PROJECT_SLUG = ?
        GROUP BY PROJECT_ID, PROJECT_NAME, PROJECT_SLUG, DATE_TRUNC('MONTH', START_DATE)
      ),
      cumulative AS (
        SELECT
          PROJECT_ID,
          PROJECT_NAME,
          PROJECT_SLUG,
          MONTH_START,
          SUM(MONTHLY_COUNT) OVER (ORDER BY MONTH_START ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS MEMBER_COUNT
        FROM monthly_counts
      )
      SELECT
        PROJECT_ID,
        PROJECT_NAME,
        PROJECT_SLUG,
        MONTH_START,
        MEMBER_COUNT
      FROM cumulative
      WHERE MONTH_START >= DATE_TRUNC('MONTH', DATEADD('month', -11, CURRENT_DATE()))
      ORDER BY MONTH_START ASC
    `;

    const result = await this.snowflakeService.execute<MonthlyMemberCountWithFoundation>(query, [foundationSlug]);

    // Convert monthly data to arrays of counts and labels
    const monthlyData = result.rows.map((row) => row.MEMBER_COUNT);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.MONTH_START);
      return date.toLocaleDateString('en-US', { month: 'short' });
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
   * Get monthly average active contributors for a foundation (last 12 months)
   * Aggregates FOUNDATION_UNIQUE_CONTRIBUTORS_DAILY by month
   * @param foundationSlug - Foundation slug to filter by
   * @returns Monthly contributor counts with short month labels
   */
  public async getFoundationActiveContributorsMonthly(foundationSlug: string): Promise<FoundationActiveContributorsMonthlyResponse> {
    logger.debug(undefined, 'get_foundation_active_contributors_monthly', 'Fetching monthly active contributors', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        DATE_TRUNC('MONTH', ACTIVITY_DATE) AS MONTH_START,
        ROUND(AVG(DAILY_UNIQUE_CONTRIBUTORS)) AS MONTHLY_AVG_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_UNIQUE_CONTRIBUTORS_DAILY
      WHERE FOUNDATION_SLUG = ?
        AND ACTIVITY_DATE >= DATE_TRUNC('MONTH', DATEADD('month', -11, CURRENT_DATE()))
      GROUP BY DATE_TRUNC('MONTH', ACTIVITY_DATE)
      ORDER BY MONTH_START ASC
    `;

    const result = await this.snowflakeService.execute<FoundationActiveContributorsMonthlyRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_active_contributors_monthly', 'Fetched monthly active contributors', { row_count: result.rows.length });

    const monthlyData = result.rows.map((row) => row.MONTHLY_AVG_CONTRIBUTORS);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.MONTH_START);
      return date.toLocaleDateString('en-US', { month: 'short' });
    });

    return { monthlyData, monthlyLabels };
  }

  /**
   * Get contributor distribution by percentile band for a foundation
   * Queries FOUNDATION_CONTRIBUTORS_DISTRIBUTION for last_12_months time range
   * @param foundationSlug - Foundation slug to filter by
   * @returns Distribution of contribution share across Top 10%, Next 40%, Bottom 50%
   */
  public async getFoundationContributorsDistribution(foundationSlug: string): Promise<FoundationContributorsDistributionResponse> {
    logger.debug(undefined, 'get_foundation_contributors_distribution', 'Fetching contributors distribution', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        PERCENTILE_BAND,
        CONTRIBUTOR_COUNT,
        CONTRIBUTION_SHARE_PERCENTAGE
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_CONTRIBUTORS_DISTRIBUTION
      WHERE FOUNDATION_SLUG = ?
        AND TIME_RANGE = 'last_12_months'
      ORDER BY
        CASE PERCENTILE_BAND
          WHEN 'Top 10%' THEN 1
          WHEN 'Next 40%' THEN 2
          WHEN 'Bottom 50%' THEN 3
          ELSE 4
        END
    `;

    const result = await this.snowflakeService.execute<FoundationContributorsDistributionRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_contributors_distribution', 'Fetched contributors distribution', { row_count: result.rows.length });

    const distribution = result.rows.map((row) => ({
      band: row.PERCENTILE_BAND,
      contributionSharePercentage: row.CONTRIBUTION_SHARE_PERCENTAGE,
      contributorCount: row.CONTRIBUTOR_COUNT,
    }));

    return { distribution };
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_SOFTWARE_VALUE_TOP_PROJECTS
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
   * Get foundation value concentration data from Snowflake
   * Queries FOUNDATION_VALUE_CONCENTRATION table
   * @param foundationSlug - Foundation slug to filter by
   * @returns Value concentration response with total value and per-bucket breakdowns in millions
   */
  public async getFoundationValueConcentration(foundationSlug: string): Promise<FoundationValueConcentrationResponse> {
    logger.debug(undefined, 'get_foundation_value_concentration', 'Fetching foundation value concentration', { foundationSlug });

    const query = `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_SLUG,
        TOTAL_VALUE,
        TOTAL_PROJECTS_COUNT,
        LAST_METRIC_DATE,
        TOP_1_VALUE,
        TOP_3_VALUE,
        TOP_5_VALUE,
        ALL_OTHER_VALUE,
        TOP_1_PROJECTS_COUNT,
        TOP_3_PROJECTS_COUNT,
        TOP_5_PROJECTS_COUNT,
        ALL_OTHER_PROJECTS_COUNT,
        TOP_1_PERCENTAGE,
        TOP_3_PERCENTAGE,
        TOP_5_PERCENTAGE,
        ALL_OTHER_PERCENTAGE
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_VALUE_CONCENTRATION
      WHERE FOUNDATION_SLUG = ?
      ORDER BY LAST_METRIC_DATE DESC
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<FoundationValueConcentrationRow>(query, [foundationSlug]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Foundation value concentration data', foundationSlug, {
        operation: 'get_foundation_value_concentration',
      });
    }

    const row = result.rows[0];
    const toMillions = (v: number): number => v / 1_000_000;

    return {
      totalValue: toMillions(row.TOTAL_VALUE),
      top1Value: toMillions(row.TOP_1_VALUE),
      top3Value: toMillions(row.TOP_3_VALUE),
      top5Value: toMillions(row.TOP_5_VALUE),
      allOtherValue: toMillions(row.ALL_OTHER_VALUE),
      totalProjectsCount: row.TOTAL_PROJECTS_COUNT,
      top1Percentage: row.TOP_1_PERCENTAGE,
      top3Percentage: row.TOP_3_PERCENTAGE,
      top5Percentage: row.TOP_5_PERCENTAGE,
      allOtherPercentage: row.ALL_OTHER_PERCENTAGE,
    };
  }

  /**
   * Get foundation maintainers data from Snowflake
   * Queries FOUNDATION_MAINTAINERS_DAILY table
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_MAINTAINERS_DAILY
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
   * Get monthly maintainer counts for a foundation (last 12 months, all repos aggregated)
   * Queries FOUNDATION_MAINTAINERS_REPOSITORY_MONTHLY table
   * @param foundationSlug - Foundation slug to filter by
   * @returns Monthly maintainer counts with short month labels
   */
  public async getFoundationMaintainersMonthly(foundationSlug: string): Promise<FoundationMaintainersMonthlyResponse> {
    logger.debug(undefined, 'get_foundation_maintainers_monthly', 'Fetching monthly maintainers', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        METRIC_MONTH,
        ACTIVE_MAINTAINERS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_MAINTAINERS_REPOSITORY_MONTHLY
      WHERE FOUNDATION_SLUG = ?
        AND REPOSITORY_SCOPE = 'all_repos'
        AND METRIC_MONTH >= DATE_TRUNC('MONTH', DATEADD('month', -11, CURRENT_DATE()))
      ORDER BY METRIC_MONTH ASC
    `;

    const result = await this.snowflakeService.execute<FoundationMaintainersMonthlyRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_maintainers_monthly', 'Fetched monthly maintainers', { row_count: result.rows.length });

    const monthlyData = result.rows.map((row) => row.ACTIVE_MAINTAINERS);
    const monthlyLabels = result.rows.map((row) => {
      const date = new Date(row.METRIC_MONTH);
      return date.toLocaleDateString('en-US', { month: 'short' });
    });

    return { monthlyData, monthlyLabels };
  }

  /**
   * Get maintainer contribution distribution by percentile band for a foundation
   * Queries FOUNDATION_MAINTAINERS_DISTRIBUTION table (all_repos, last_12_months)
   * @param foundationSlug - Foundation slug to filter by
   * @returns Distribution of contribution share across Top 10%, Next 40%, Bottom 50%
   */
  public async getFoundationMaintainersDistribution(foundationSlug: string): Promise<FoundationMaintainersDistributionResponse> {
    logger.debug(undefined, 'get_foundation_maintainers_distribution', 'Fetching maintainers distribution', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        PERCENTILE_BAND,
        MAINTAINER_COUNT,
        CONTRIBUTION_SHARE_PCT
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_MAINTAINERS_DISTRIBUTION
      WHERE FOUNDATION_SLUG = ?
        AND REPOSITORY_SCOPE = 'all_repos'
        AND TIME_RANGE_NAME = 'last_12_months'
      ORDER BY CASE PERCENTILE_BAND WHEN 'Top 10%' THEN 1 WHEN 'Next 40%' THEN 2 WHEN 'Bottom 50%' THEN 3 ELSE 4 END
    `;

    const result = await this.snowflakeService.execute<FoundationMaintainersDistributionRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_maintainers_distribution', 'Fetched maintainers distribution', { row_count: result.rows.length });

    const distribution = result.rows.map((row) => ({
      band: row.PERCENTILE_BAND,
      contributionSharePct: row.CONTRIBUTION_SHARE_PCT,
      maintainerCount: row.MAINTAINER_COUNT,
    }));

    return { distribution };
  }

  /**
   * Get quarterly event counts for a foundation (last 8 quarters)
   * Queries FOUNDATION_HEALTH_EVENTS_QUARTERLY table
   * @param foundationSlug - Foundation slug to filter by
   * @returns Quarterly event counts with quarter labels
   */
  public async getFoundationEventsQuarterly(foundationSlug: string): Promise<FoundationEventsQuarterlyResponse> {
    logger.debug(undefined, 'get_foundation_events_quarterly', 'Fetching quarterly events', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        QUARTER_START_DATE,
        EVENT_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_HEALTH_EVENTS_QUARTERLY
      WHERE FOUNDATION_SLUG = ?
        AND QUARTER_START_DATE >= DATEADD('quarter', -7, DATE_TRUNC('QUARTER', CURRENT_DATE()))
      ORDER BY QUARTER_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<FoundationEventsQuarterlyRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_events_quarterly', 'Fetched quarterly events', { row_count: result.rows.length });

    const quarterlyData = result.rows.map((row) => row.EVENT_COUNT);
    const quarterlyLabels = result.rows.map((row) => {
      const date = new Date(row.QUARTER_START_DATE);
      const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
      const year = date.getUTCFullYear().toString().slice(-2);
      return `Q${quarter} '${year}`;
    });

    return { quarterlyData, quarterlyLabels };
  }

  /**
   * Get event distribution by attendance size bucket for a foundation (last 12 months)
   * Queries FOUNDATION_HEALTH_EVENTS_ATTENDANCE_DISTRIBUTION table
   * @param foundationSlug - Foundation slug to filter by
   * @returns Distribution of events across Large, Medium, Small attendance buckets
   */
  public async getFoundationEventsAttendanceDistribution(foundationSlug: string): Promise<FoundationEventsAttendanceDistributionResponse> {
    logger.debug(undefined, 'get_foundation_events_attendance_distribution', 'Fetching events attendance distribution', { foundation_slug: foundationSlug });

    const query = `
      SELECT
        ATTENDANCE_SIZE_BUCKET,
        EVENT_COUNT_LAST_12_MONTHS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_HEALTH_EVENTS_ATTENDANCE_DISTRIBUTION
      WHERE FOUNDATION_SLUG = ?
      ORDER BY CASE ATTENDANCE_SIZE_BUCKET
        WHEN 'Large'  THEN 1
        WHEN 'Medium' THEN 2
        WHEN 'Small'  THEN 3
        ELSE 4
      END
    `;

    const result = await this.snowflakeService.execute<FoundationEventsAttendanceDistributionRow>(query, [foundationSlug]);

    logger.debug(undefined, 'get_foundation_events_attendance_distribution', 'Fetched events attendance distribution', { row_count: result.rows.length });

    const distribution = result.rows.map((row) => ({
      bucket: row.ATTENDANCE_SIZE_BUCKET,
      eventCount: row.EVENT_COUNT_LAST_12_MONTHS,
    }));

    return { distribution };
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_HEALTH_SCORE_DISTRIBUTION
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
   * Get per-project detail rows for a foundation from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_TOTAL_PROJECTS_DETAIL for the drill-down table
   * @param foundationSlug - Foundation slug to filter by (e.g., 'cncf', 'tlf')
   */
  public async getFoundationProjectsDetail(foundationSlug: string): Promise<FoundationProjectsDetailResponse> {
    logger.debug(undefined, 'get_foundation_projects_detail', 'Fetching project detail rows', { foundationSlug });

    const query = `
      SELECT
        PROJECT_NAME,
        PROJECT_SLUG,
        LIFECYCLE_STAGE,
        CONTRIBUTORS_90D_COUNT,
        COMMITS_90D_COUNT,
        MAINTAINERS_YTD_COUNT,
        STARS_YTD_COUNT,
        LAST_UPDATED_TS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_TOTAL_PROJECTS_DETAIL
      WHERE FOUNDATION_SLUG = ?
      ORDER BY PROJECT_NAME ASC
    `;

    try {
      const result = await this.snowflakeService.execute<FoundationProjectsDetailRow>(query, [foundationSlug]);

      const projects = result.rows
        .filter((row): row is typeof row & { LIFECYCLE_STAGE: string } => row.LIFECYCLE_STAGE != null)
        .map((row) => ({
          id: row.PROJECT_SLUG,
          projectName: row.PROJECT_NAME,
          projectSlug: row.PROJECT_SLUG,
          lifecycleStage: row.LIFECYCLE_STAGE as LifecycleStage,
          activeContributors: row.CONTRIBUTORS_90D_COUNT ?? 0,
          commitsLast90Days: row.COMMITS_90D_COUNT ?? 0,
          maintainers: row.MAINTAINERS_YTD_COUNT ?? 0,
          stars: row.STARS_YTD_COUNT ?? 0,
          lastUpdated: row.LAST_UPDATED_TS ? new Date(row.LAST_UPDATED_TS).toISOString().split('T')[0] : null,
        }));

      logger.debug(undefined, 'get_foundation_projects_detail', 'Fetched project detail rows', { count: projects.length });

      return { projects, totalCount: projects.length };
    } catch (error) {
      logger.warning(undefined, 'get_foundation_projects_detail', 'Failed to fetch project detail rows', {
        foundationSlug,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Get lifecycle stage distribution for a foundation from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_TOTAL_PROJECTS_LIFECYCLE_DISTRIBUTION
   * @param foundationSlug - Foundation slug to filter by (e.g., 'cncf', 'tlf')
   */
  public async getFoundationProjectsLifecycleDistribution(foundationSlug: string): Promise<FoundationProjectsLifecycleDistributionResponse> {
    logger.debug(undefined, 'get_foundation_projects_lifecycle_distribution', 'Fetching lifecycle distribution', { foundationSlug });

    const query = `
      SELECT
        LIFECYCLE_STAGE,
        PROJECT_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_TOTAL_PROJECTS_LIFECYCLE_DISTRIBUTION
      WHERE FOUNDATION_SLUG = ?
      ORDER BY
        CASE LIFECYCLE_STAGE
          WHEN 'Sandbox' THEN 1
          WHEN 'Incubating' THEN 2
          WHEN 'Graduated' THEN 3
          ELSE 4
        END ASC
    `;

    try {
      const result = await this.snowflakeService.execute<FoundationProjectsLifecycleDistributionRow>(query, [foundationSlug]);

      logger.debug(undefined, 'get_foundation_projects_lifecycle_distribution', 'Fetched lifecycle distribution', { stage_count: result.rows.length });

      return {
        distribution: result.rows
          .filter((row): row is typeof row & { LIFECYCLE_STAGE: string } => row.LIFECYCLE_STAGE != null)
          .map((row) => ({ stage: row.LIFECYCLE_STAGE, count: row.PROJECT_COUNT })),
      };
    } catch (error) {
      logger.warning(undefined, 'get_foundation_projects_lifecycle_distribution', 'Failed to fetch lifecycle distribution', {
        foundationSlug,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Get health metrics daily data from Snowflake
   * Queries PROJECT_HEALTH_METRICS_DAILY table with different aggregation based on entity type
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (aggregated by foundation) or 'project' (single project data)
   * @returns Daily health metrics data with current average health score
   */
  public async getHealthMetricsDaily(slug: string, entityType: 'foundation' | 'project'): Promise<HealthMetricsDailyResponse> {
    if (entityType === 'foundation') {
      // Foundation level: Aggregate health scores by date across all projects in the foundation
      const query = `
        SELECT
          FOUNDATION_SLUG,
          METRIC_DATE,
          AVG(HEALTH_SCORE) AS AVG_HEALTH_SCORE
        FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_HEALTH_METRICS_DAILY
        WHERE FOUNDATION_SLUG = ?
        GROUP BY FOUNDATION_SLUG, METRIC_DATE
        ORDER BY METRIC_DATE DESC
      `;

      const result = await this.snowflakeService.execute<HealthMetricsAggregatedRow>(query, [slug]);

      // Get current average health score from most recent date
      const currentAvgHealthScore = result.rows.length > 0 ? Math.round(result.rows[0].AVG_HEALTH_SCORE) : 0;

      return {
        data: result.rows,
        currentAvgHealthScore,
        totalDays: result.rows.length,
      };
    }

    // Project level: Return direct health score for the specific project
    const query = `
        SELECT
          PROJECT_ID,
          PROJECT_NAME,
          PROJECT_SLUG,
          FOUNDATION_ID,
          FOUNDATION_SLUG,
          METRIC_DATE,
          HEALTH_SCORE,
          HEALTH_SCORE_CATEGORY,
          SOFTWARE_VALUE,
          CM_STATUS,
          PARENT_ID,
          PARENT_SLUG,
          GRANDPARENT_ID,
          GRANDPARENTS_SLUG
        FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_HEALTH_METRICS_DAILY
        WHERE PROJECT_SLUG = ?
        ORDER BY METRIC_DATE DESC
      `;

    const result = await this.snowflakeService.execute<ProjectHealthMetricsDailyRow>(query, [slug]);

    // Get current health score from most recent date
    const currentAvgHealthScore = result.rows.length > 0 ? Math.round(result.rows[0].HEALTH_SCORE) : 0;

    return {
      data: result.rows,
      currentAvgHealthScore,
      totalDays: result.rows.length,
    };
  }

  /**
   * Get unique contributors daily data from Snowflake
   * Queries FOUNDATION_UNIQUE_CONTRIBUTORS_DAILY or PROJECT_UNIQUE_CONTRIBUTORS_DAILY table
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Daily unique contributors data with average contributors
   */
  public async getUniqueContributorsDaily(slug: string, entityType: 'foundation' | 'project'): Promise<UniqueContributorsDailyResponse> {
    // Query switching based on entity type
    const query =
      entityType === 'foundation'
        ? `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        ACTIVITY_DATE,
        DAILY_UNIQUE_CONTRIBUTORS,
        AVG_CONTRIBUTORS_LAST_12_MONTHS,
        TOTAL_DAYS_LAST_12_MONTHS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_UNIQUE_CONTRIBUTORS_DAILY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY ACTIVITY_DATE DESC
    `
        : `
      SELECT
        PROJECT_ID,
        PROJECT_NAME,
        PROJECT_SLUG,
        ACTIVITY_DATE,
        DAILY_UNIQUE_CONTRIBUTORS,
        AVG_CONTRIBUTORS_LAST_12_MONTHS,
        TOTAL_DAYS_LAST_12_MONTHS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_UNIQUE_CONTRIBUTORS_DAILY
      WHERE PROJECT_SLUG = ?
      ORDER BY ACTIVITY_DATE DESC
    `;

    const result =
      entityType === 'foundation'
        ? await this.snowflakeService.execute<FoundationUniqueContributorsDailyRow>(query, [slug])
        : await this.snowflakeService.execute<ProjectUniqueContributorsDailyRow>(query, [slug]);

    // Get average contributors from first row (same across all rows from SQL calculation)
    const avgContributors = result.rows.length > 0 ? Math.round(result.rows[0].AVG_CONTRIBUTORS_LAST_12_MONTHS) : 0;

    return {
      data: result.rows,
      avgContributors,
      totalDays: result.rows.length,
    };
  }

  /**
   * Get health events monthly data from Snowflake
   * Queries FOUNDATION_HEALTH_EVENTS_MONTHLY or PROJECT_HEALTH_EVENTS_MONTHLY table
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Monthly events data with total events count
   */
  public async getHealthEventsMonthly(slug: string, entityType: 'foundation' | 'project'): Promise<HealthEventsMonthlyResponse> {
    // Query switching based on entity type
    const query =
      entityType === 'foundation'
        ? `
      SELECT
        FOUNDATION_ID,
        FOUNDATION_NAME,
        FOUNDATION_SLUG,
        MONTH_START_DATE,
        EVENT_COUNT,
        TOTAL_EVENTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_HEALTH_EVENTS_MONTHLY
      WHERE FOUNDATION_SLUG = ?
      ORDER BY MONTH_START_DATE DESC
    `
        : `
      SELECT
        PROJECT_ID,
        PROJECT_NAME,
        PROJECT_SLUG,
        MONTH_START_DATE,
        EVENT_COUNT,
        TOTAL_EVENTS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_HEALTH_EVENTS_MONTHLY
      WHERE PROJECT_SLUG = ?
      ORDER BY MONTH_START_DATE DESC
    `;

    const result =
      entityType === 'foundation'
        ? await this.snowflakeService.execute<FoundationHealthEventsMonthlyRow>(query, [slug])
        : await this.snowflakeService.execute<ProjectHealthEventsMonthlyRow>(query, [slug]);

    // Get total events from first row (same across all rows from SQL calculation)
    const totalEvents = result.rows.length > 0 ? result.rows[0].TOTAL_EVENTS : 0;

    return {
      data: result.rows,
      totalEvents,
      totalMonths: result.rows.length,
    };
  }

  /**
   * Get code commits daily data from Snowflake
   * Queries FOUNDATION_CODE_COMMITS or PROJECT_CODE_COMMITS table
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Daily code commit data for trend visualization
   */
  public async getCodeCommitsDaily(slug: string, entityType: 'foundation' | 'project'): Promise<CodeCommitsDailyResponse> {
    // Query switching based on entity type
    const query =
      entityType === 'foundation'
        ? `
      SELECT
        ACTIVITY_DATE,
        DAILY_COMMIT_COUNT,
        TOTAL_COMMITS
      FROM ANALYTICS.PLATINUM_LFX_ONE.FOUNDATION_CODE_COMMITS
      WHERE FOUNDATION_SLUG = ?
      ORDER BY ACTIVITY_DATE ASC
    `
        : `
      SELECT
        ACTIVITY_DATE,
        DAILY_COMMIT_COUNT,
        TOTAL_COMMITS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PROJECT_CODE_COMMITS
      WHERE PROJECT_SLUG = ?
      ORDER BY ACTIVITY_DATE ASC
    `;

    const result =
      entityType === 'foundation'
        ? await this.snowflakeService.execute<FoundationCodeCommitsDailyRow>(query, [slug])
        : await this.snowflakeService.execute<ProjectCodeCommitsDailyRow>(query, [slug]);

    // Get total commits from first row (same across all rows from SQL window function)
    const totalCommits = result.rows.length > 0 ? result.rows[0].TOTAL_COMMITS : 0;

    return {
      data: result.rows.map((row) => ({
        ACTIVITY_DATE: row.ACTIVITY_DATE,
        DAILY_COMMIT_COUNT: row.DAILY_COMMIT_COUNT,
      })),
      totalCommits,
      totalDays: result.rows.length,
    };
  }

  // Marketing Analytics Queries (ANALYTICS.PLATINUM_LFX_ONE.* schema)
  // All marketing and dashboard views now use the unified ANALYTICS.PLATINUM_LFX_ONE.* schema.

  /**
   * Get web activities summary grouped by domain category
   * Queries ANALYTICS.PLATINUM_LFX_ONE.WEB_ACTIVITIES_SUMMARY and ANALYTICS.PLATINUM_LFX_ONE.WEB_ACTIVITIES_BY_PROJECT
   * @param foundationSlug - Foundation slug used to filter by PROJECT_SLUG
   */
  public async getWebActivitiesSummary(foundationSlug: string): Promise<WebActivitiesSummaryResponse> {
    logger.debug(undefined, 'get_web_activities_summary', 'Fetching web activities summary from Snowflake', { foundation_slug: foundationSlug });

    try {
      // Query 1: Total sessions & page views per domain classification
      const summaryQuery = `
        SELECT
          LF_SUB_DOMAIN_CLASSIFICATION,
          SUM(TOTAL_SESSIONS_LAST_30_DAYS) AS TOTAL_SESSIONS,
          SUM(TOTAL_PAGE_VIEWS_LAST_30_DAYS) AS TOTAL_PAGE_VIEWS
        FROM ANALYTICS.PLATINUM_LFX_ONE.WEB_ACTIVITIES_SUMMARY
        WHERE PROJECT_SLUG = ?
        GROUP BY LF_SUB_DOMAIN_CLASSIFICATION
        ORDER BY TOTAL_SESSIONS DESC
      `;

      // Query 2: Daily sessions for trend chart
      const dailyQuery = `
        SELECT
          ACTIVITY_DATE,
          SUM(DAILY_SESSIONS) AS DAILY_SESSIONS
        FROM ANALYTICS.PLATINUM_LFX_ONE.WEB_ACTIVITIES_BY_PROJECT
        WHERE PROJECT_SLUG = ?
          AND ACTIVITY_DATE >= DATEADD('DAY', -30, CURRENT_DATE())
        GROUP BY ACTIVITY_DATE
        ORDER BY ACTIVITY_DATE ASC
      `;

      const [summaryResult, dailyResult] = await Promise.all([
        this.snowflakeService.execute<{ LF_SUB_DOMAIN_CLASSIFICATION: string; TOTAL_SESSIONS: number; TOTAL_PAGE_VIEWS: number }>(summaryQuery, [
          foundationSlug,
        ]),
        this.snowflakeService.execute<{ ACTIVITY_DATE: string; DAILY_SESSIONS: number }>(dailyQuery, [foundationSlug]),
      ]);

      const domainGroups = summaryResult.rows.map((row) => ({
        domainGroup: row.LF_SUB_DOMAIN_CLASSIFICATION || 'Other',
        totalSessions: row.TOTAL_SESSIONS ?? 0,
        totalPageViews: row.TOTAL_PAGE_VIEWS ?? 0,
      }));

      const totalSessions = domainGroups.reduce((sum, g) => sum + g.totalSessions, 0);
      const totalPageViews = domainGroups.reduce((sum, g) => sum + g.totalPageViews, 0);

      const dailyData = dailyResult.rows.map((row) => row.DAILY_SESSIONS ?? 0);
      const dailyLabels = dailyResult.rows.map((row) => {
        const date = new Date(row.ACTIVITY_DATE);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });

      return { totalSessions, totalPageViews, domainGroups, dailyData, dailyLabels };
    } catch (error) {
      logger.warning(undefined, 'get_web_activities_summary', 'Failed to fetch web activities summary from Snowflake', {
        foundation_slug: foundationSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { totalSessions: 0, totalPageViews: 0, domainGroups: [], dailyData: [], dailyLabels: [] };
    }
  }

  /**
   * Get email click-through rate data from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.EMAIL_CTR_SUMMARY and ANALYTICS.PLATINUM_LFX_ONE.EMAIL_CTR_BY_MONTH
   * @param foundationName - Foundation name used to filter by PROJECT_NAME (e.g., 'The Linux Foundation')
   * @returns Email CTR response with monthly trend and change percentage
   */
  public async getEmailCtr(foundationName: string): Promise<EmailCtrResponse> {
    logger.debug(undefined, 'get_email_ctr', 'Fetching email CTR from Snowflake Platinum tables', { foundation_name: foundationName });

    try {
      // Query 1: KPI card — current CTR + MoM change from email_ctr_summary
      const summaryQuery = `
        SELECT
          PROJECT_NAME,
          CTR_LAST_COMPLETED_MONTH,
          CTR_MOM_CHANGE
        FROM ANALYTICS.PLATINUM_LFX_ONE.EMAIL_CTR_SUMMARY
        WHERE PROJECT_NAME = ?
      `;

      // Query 2: Monthly CTR trend (bar chart, last 6 months) from email_ctr_by_month
      const monthlyQuery = `
        SELECT
          PUBLISHED_MONTH,
          PUBLISHED_MONTH_DATE,
          MONTHLY_CTR,
          TOTAL_SENDS,
          TOTAL_OPENS
        FROM ANALYTICS.PLATINUM_LFX_ONE.EMAIL_CTR_BY_MONTH
        WHERE PROJECT_NAME = ?
          AND PUBLISHED_MONTH_DATE >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
        ORDER BY PUBLISHED_MONTH_DATE ASC
      `;

      // Query 3: CTR by campaign/project (horizontal bar) from email_ctr_summary — all projects
      const campaignQuery = `
        SELECT
          PROJECT_NAME,
          LF_SUB_DOMAIN_CLASSIFICATION,
          CTR_LAST_6_MONTHS AS AVG_CTR
        FROM ANALYTICS.PLATINUM_LFX_ONE.EMAIL_CTR_SUMMARY
        WHERE PROJECT_NAME = ?
        ORDER BY CTR_LAST_6_MONTHS DESC
      `;

      const [summaryResult, monthlyResult, campaignResult] = await Promise.all([
        this.snowflakeService.execute<{ PROJECT_NAME: string; CTR_LAST_COMPLETED_MONTH: number; CTR_MOM_CHANGE: number }>(summaryQuery, [foundationName]),
        this.snowflakeService.execute<{ PUBLISHED_MONTH: string; PUBLISHED_MONTH_DATE: string; MONTHLY_CTR: number; TOTAL_SENDS: number; TOTAL_OPENS: number }>(
          monthlyQuery,
          [foundationName]
        ),
        this.snowflakeService.execute<{ PROJECT_NAME: string; LF_SUB_DOMAIN_CLASSIFICATION: string; AVG_CTR: number }>(campaignQuery, [foundationName]),
      ]);

      if (summaryResult.rows.length === 0 && monthlyResult.rows.length === 0) {
        return { currentCtr: 0, changePercentage: 0, trend: 'up', monthlyData: [], monthlyLabels: [], campaignGroups: [], monthlySends: [], monthlyOpens: [] };
      }

      // Use summary row for KPI card values
      // Note: Snowflake values are already percentages (e.g., 2.32 = 2.32%), no conversion needed
      const summaryRow = summaryResult.rows[0];
      const currentCtr = summaryRow ? Math.round((summaryRow.CTR_LAST_COMPLETED_MONTH ?? 0) * 10) / 10 : 0;

      const monthlyData = monthlyResult.rows.map((row) => Math.round((row.MONTHLY_CTR ?? 0) * 10) / 10);

      // Compute change as current CTR vs 6-month average (more stable than MoM)
      let changePercentage = 0;
      if (monthlyData.length >= 2 && currentCtr > 0) {
        const avg = monthlyData.reduce((sum, v) => sum + v, 0) / monthlyData.length;
        if (avg > 0) {
          changePercentage = Math.round(((currentCtr - avg) / avg) * 1000) / 10;
        }
      }
      const monthlySends = monthlyResult.rows.map((row) => row.TOTAL_SENDS ?? 0);
      const monthlyOpens = monthlyResult.rows.map((row) => row.TOTAL_OPENS ?? 0);
      const monthlyLabels = monthlyResult.rows.map((row) => {
        const date = new Date(row.PUBLISHED_MONTH_DATE);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      });

      const campaignGroups = campaignResult.rows.map((row) => ({
        campaignName: row.LF_SUB_DOMAIN_CLASSIFICATION || row.PROJECT_NAME,
        classification: row.LF_SUB_DOMAIN_CLASSIFICATION,
        avgCtr: Math.round((row.AVG_CTR ?? 0) * 10) / 10,
      }));

      return {
        currentCtr,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        monthlyData,
        monthlyLabels,
        campaignGroups,
        monthlySends,
        monthlyOpens,
      };
    } catch (error) {
      logger.warning(undefined, 'get_email_ctr', 'Failed to fetch email CTR from Snowflake', {
        foundation_name: foundationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { currentCtr: 0, changePercentage: 0, trend: 'up', monthlyData: [], monthlyLabels: [], campaignGroups: [], monthlySends: [], monthlyOpens: [] };
    }
  }

  /**
   * Get paid social reach metrics from Snowflake Platinum tables
   * Queries ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_MONTH and ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_CHANNEL_MONTH
   * @param foundationName - Foundation name used to filter by FOUNDATION_NAME (e.g., 'The Linux Foundation')
   * @returns Social reach response with ROAS, impressions, spend, revenue, and monthly trends
   */
  public async getSocialReach(foundationName: string): Promise<SocialReachResponse> {
    logger.debug(undefined, 'get_social_reach', 'Fetching paid social reach from Snowflake', { foundation_name: foundationName });

    try {
      // Block 1: Total impressions, spend, revenue (last 6 months)
      const impressionsQuery = `
      SELECT SUM(IMPRESSIONS) AS TOTAL_IMPRESSIONS, SUM(SPEND) AS TOTAL_SPEND, SUM(FIRST_TOUCH_REVENUE) AS TOTAL_REVENUE
      FROM ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_MONTH
      WHERE CAMPAIGN_MONTH >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
        AND FOUNDATION_NAME = ?
    `;

      // Block 2: ROAS KPI — latest completed month
      const roasKpiQuery = `
      SELECT FIRST_TOUCH_ROAS AS ROAS, ROAS_MOM_PCT
      FROM ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_MONTH
      WHERE FOUNDATION_NAME = ?
        AND CAMPAIGN_MONTH < DATE_TRUNC('MONTH', CURRENT_DATE())
      QUALIFY ROW_NUMBER() OVER (ORDER BY CAMPAIGN_MONTH DESC) = 1
    `;

      // Block 3: Monthly ROAS trend (bar chart, last 6 months)
      const monthlyRoasQuery = `
      SELECT CAMPAIGN_MONTH, FIRST_TOUCH_ROAS AS ROAS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_MONTH
      WHERE CAMPAIGN_MONTH >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
        AND FOUNDATION_NAME = ?
      ORDER BY CAMPAIGN_MONTH
    `;

      // Block 4: Monthly impressions (bar chart, last 6 months)
      const monthlyImpressionsQuery = `
      SELECT CAMPAIGN_MONTH, IMPRESSIONS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_MONTH
      WHERE CAMPAIGN_MONTH >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
        AND FOUNDATION_NAME = ?
      ORDER BY CAMPAIGN_MONTH
    `;

      // Block 5: Impressions by channel (horizontal bar chart, last 6 months)
      const channelQuery = `
      SELECT CHANNEL, SUM(IMPRESSIONS) AS IMPRESSIONS
      FROM ANALYTICS.PLATINUM_LFX_ONE.PAID_SOCIAL_REACH_BY_PROJECT_CHANNEL_MONTH
      WHERE CAMPAIGN_MONTH >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
        AND FOUNDATION_NAME = ?
      GROUP BY CHANNEL
      ORDER BY IMPRESSIONS DESC
    `;

      const [impressionsResult, roasKpiResult, monthlyRoasResult, monthlyImpressionsResult, channelResult] = await Promise.all([
        this.snowflakeService.execute<{ TOTAL_IMPRESSIONS: number; TOTAL_SPEND: number; TOTAL_REVENUE: number }>(impressionsQuery, [foundationName]),
        this.snowflakeService.execute<{ ROAS: number; ROAS_MOM_PCT: number }>(roasKpiQuery, [foundationName]),
        this.snowflakeService.execute<{ CAMPAIGN_MONTH: string; ROAS: number }>(monthlyRoasQuery, [foundationName]),
        this.snowflakeService.execute<{ CAMPAIGN_MONTH: string; IMPRESSIONS: number }>(monthlyImpressionsQuery, [foundationName]),
        this.snowflakeService.execute<{ CHANNEL: string; IMPRESSIONS: number }>(channelQuery, [foundationName]),
      ]);

      const totalReach = impressionsResult.rows[0]?.TOTAL_IMPRESSIONS ?? 0;
      const totalSpend = impressionsResult.rows[0]?.TOTAL_SPEND ?? 0;
      const totalRevenue = impressionsResult.rows[0]?.TOTAL_REVENUE ?? 0;
      const roas = roasKpiResult.rows[0]?.ROAS ?? 0;
      const roasMomPct = roasKpiResult.rows[0]?.ROAS_MOM_PCT ?? 0;

      if (monthlyImpressionsResult.rows.length === 0) {
        return {
          totalReach,
          roas: Math.round(roas * 100) / 100,
          totalSpend,
          totalRevenue,
          changePercentage: Math.round(roasMomPct * 10) / 10,
          trend: roasMomPct >= 0 ? 'up' : 'down',
          monthlyData: [],
          monthlyLabels: [],
          monthlyRoas: [],
          channelGroups: [],
        };
      }

      const monthlyData = monthlyImpressionsResult.rows.map((row) => row.IMPRESSIONS ?? 0);
      const monthlyRoas = monthlyRoasResult.rows.map((row) => Math.round((row.ROAS ?? 0) * 100) / 100);
      const monthlyLabels = monthlyImpressionsResult.rows.map((row) => {
        const date = new Date(row.CAMPAIGN_MONTH);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      });

      const channelGroups = channelResult.rows.map((row) => ({
        channel: row.CHANNEL,
        totalImpressions: row.IMPRESSIONS,
      }));

      return {
        totalReach,
        roas: Math.round(roas * 100) / 100,
        totalSpend,
        totalRevenue,
        changePercentage: Math.round(roasMomPct * 10) / 10,
        trend: roasMomPct >= 0 ? 'up' : 'down',
        monthlyData,
        monthlyLabels,
        monthlyRoas,
        channelGroups,
      };
    } catch (error) {
      logger.warning(undefined, 'get_social_reach', 'Failed to fetch social reach data, returning defaults', {
        foundation_name: foundationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalReach: 0,
        roas: 0,
        totalSpend: 0,
        totalRevenue: 0,
        changePercentage: 0,
        trend: 'up',
        monthlyData: [],
        monthlyLabels: [],
        monthlyRoas: [],
        channelGroups: [],
      };
    }
  }

  /**
   * Get project UID by slug using NATS request-reply pattern
   * @private
   */
  public async getProjectSfidByUid(req: Request, projectUid: string): Promise<string | null> {
    const codec = this.natsService.getCodec();

    try {
      const lookupKey = `project.uid.${projectUid}`;
      const response = await this.natsService.request(NatsSubjects.LOOKUP_V1_MAPPING, codec.encode(lookupKey), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const sfid = codec.decode(response.data);

      if (!sfid || sfid.startsWith('error:')) {
        logger.warning(req, 'get_project_sfid_by_uid', 'Could not resolve project UUID to SFID', {
          project_uid: projectUid,
          response: sfid || '(empty)',
        });
        return null;
      }

      logger.debug(req, 'get_project_sfid_by_uid', 'Resolved project UUID to SFID', {
        project_uid: projectUid,
        sfid,
      });

      return sfid;
    } catch (error) {
      logger.warning(req, 'get_project_sfid_by_uid', 'NATS lookup failed for project SFID', {
        project_uid: projectUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  public async getProjectIdBySlug(req: Request, slug: string): Promise<ProjectSlugToIdResponse> {
    const codec = this.natsService.getCodec();

    try {
      const response = await this.natsService.request(NatsSubjects.PROJECT_SLUG_TO_UID, codec.encode(slug), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const uid = codec.decode(response.data);

      // Check if we got a valid project ID
      if (!uid || uid.trim() === '') {
        logger.debug(req, 'get_project_id_by_slug', 'Project slug not found via NATS', { slug });
        return {
          uid: '',
          slug,
          exists: false,
        };
      }

      return {
        uid: uid.trim(),
        slug,
        exists: true,
      };
    } catch (error) {
      logger.warning(req, 'get_project_id_by_slug', 'Failed to resolve project slug via NATS', {
        err: error,
        slug,
      });

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

  /**
   * Resolves a batch of project UIDs to display names using NATS.
   * Uses bounded parallelism (10 concurrent) to avoid overwhelming the projects-api.
   * UIDs that fail or return empty names are silently omitted from the result map.
   * @param req - Express request object
   * @param uids - Array of unique project UIDs to resolve
   * @returns Map of project UID → display name
   */
  public async getProjectNamesByUids(req: Request, uids: string[]): Promise<Map<string, string>> {
    if (uids.length === 0) return new Map();

    logger.debug(req, 'get_project_names_by_uids', 'Resolving project names via NATS', { uid_count: uids.length });

    const codec = this.natsService.getCodec();
    const CONCURRENCY = 10;
    const nameMap = new Map<string, string>();

    for (let i = 0; i < uids.length; i += CONCURRENCY) {
      const batch = uids.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((uid) =>
          this.natsService
            .request(NatsSubjects.PROJECT_GET_NAME, codec.encode(uid), { timeout: NATS_CONFIG.REQUEST_TIMEOUT })
            .then((r) => codec.decode(r.data).trim())
            .catch((err) => {
              logger.debug(req, 'get_project_names_by_uids', 'NATS lookup failed for uid', {
                uid,
                error: err instanceof Error ? err.message : String(err),
              });
              return '';
            })
        )
      );
      batch.forEach((uid, j) => {
        if (results[j]) nameMap.set(uid, results[j]);
      });
    }

    logger.debug(req, 'get_project_names_by_uids', 'Resolved project names', {
      requested: uids.length,
      resolved: nameMap.size,
    });

    return nameMap;
  }

  /**
   * Get social media metrics from Snowflake Platinum tables
   * Queries ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_OVERVIEW, ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_BREAKDOWN, and ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_FOLLOWER_TREND
   * @param foundationName - Foundation name used to filter by FOUNDATION_NAME (e.g., 'The Linux Foundation')
   * @returns Social media response with followers, platform breakdown, and trend data
   */
  public async getSocialMedia(foundationName: string): Promise<SocialMediaResponse> {
    logger.debug(undefined, 'get_social_media', 'Fetching social media data from Snowflake Platinum tables', { foundation_name: foundationName });

    try {
      // Query 1: KPI cards — total followers, platforms, growth (aggregated)
      // Use MAX for PLATFORMS_ACTIVE to avoid double-counting across sub-project rows
      const overviewQuery = `
      SELECT
        SUM(TOTAL_FOLLOWERS) AS TOTAL_FOLLOWERS,
        MAX(PLATFORMS_ACTIVE) AS PLATFORMS_ACTIVE,
        CASE
          WHEN SUM(PRIOR_TOTAL_FOLLOWERS) > 0
            THEN ROUND(
              (SUM(TOTAL_FOLLOWERS) - SUM(PRIOR_TOTAL_FOLLOWERS))
              / SUM(PRIOR_TOTAL_FOLLOWERS) * 100, 1
            )
        END AS FOLLOWER_GROWTH_PCT
      FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_OVERVIEW
      WHERE FOUNDATION_NAME = ?
    `;

      // Query 2: Platform breakdown table (aggregated per platform)
      const platformQuery = `
      SELECT
        PLATFORM_NAME,
        SUM(FOLLOWERS) AS FOLLOWERS,
        CASE
          WHEN SUM(IMPRESSIONS) > 0
            THEN ROUND(SUM(ENGAGEMENTS) / SUM(IMPRESSIONS) * 100, 1)
        END AS ENGAGEMENT_RATE_PCT,
        SUM(POSTS_30D) AS POSTS_30D,
        SUM(IMPRESSIONS) AS IMPRESSIONS
      FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_PLATFORM_BREAKDOWN
      WHERE FOUNDATION_NAME = ?
      GROUP BY PLATFORM_NAME
      ORDER BY FOLLOWERS DESC
    `;

      // Query 3: Follower growth trend (aggregated per month)
      const trendQuery = `
      SELECT
        SNAPSHOT_MONTH,
        SUM(TOTAL_FOLLOWERS) AS TOTAL_FOLLOWERS
      FROM ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_FOLLOWER_TREND
      WHERE FOUNDATION_NAME = ?
        AND SNAPSHOT_MONTH >= DATEADD('MONTH', -6, DATE_TRUNC('MONTH', CURRENT_DATE()))
      GROUP BY SNAPSHOT_MONTH
      ORDER BY SNAPSHOT_MONTH ASC
    `;

      const [overviewResult, platformResult, trendResult] = await Promise.all([
        this.snowflakeService.execute<{ TOTAL_FOLLOWERS: number; PLATFORMS_ACTIVE: number; FOLLOWER_GROWTH_PCT: number | null }>(overviewQuery, [
          foundationName,
        ]),
        this.snowflakeService.execute<{
          PLATFORM_NAME: string;
          FOLLOWERS: number;
          ENGAGEMENT_RATE_PCT: number | null;
          POSTS_30D: number;
          IMPRESSIONS: number;
        }>(platformQuery, [foundationName]),
        this.snowflakeService.execute<{ SNAPSHOT_MONTH: string; TOTAL_FOLLOWERS: number }>(trendQuery, [foundationName]),
      ]);

      if (overviewResult.rows.length === 0) {
        return { totalFollowers: 0, totalPlatforms: 0, changePercentage: 0, trend: 'up', platforms: [], monthlyData: [] };
      }

      const overview = overviewResult.rows[0];
      const totalFollowers = overview.TOTAL_FOLLOWERS ?? 0;
      const totalPlatforms = overview.PLATFORMS_ACTIVE ?? 0;
      const changePercentage = Math.round((overview.FOLLOWER_GROWTH_PCT ?? 0) * 10) / 10;

      const platforms = platformResult.rows.map((row) => ({
        platform: row.PLATFORM_NAME,
        followers: row.FOLLOWERS ?? 0,
        engagementRate: row.ENGAGEMENT_RATE_PCT ?? 0,
        postsLast30Days: row.POSTS_30D ?? 0,
        impressions: row.IMPRESSIONS ?? 0,
      }));

      const monthlyData = trendResult.rows.map((row) => {
        const date = new Date(row.SNAPSHOT_MONTH);
        return {
          month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          totalFollowers: row.TOTAL_FOLLOWERS ?? 0,
        };
      });

      return {
        totalFollowers,
        totalPlatforms,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        platforms,
        monthlyData,
      };
    } catch (error) {
      logger.warning(undefined, 'get_social_media', 'Failed to fetch social media data, returning defaults', {
        foundation_name: foundationName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalFollowers: 0,
        totalPlatforms: 0,
        changePercentage: 0,
        trend: 'up',
        platforms: [],
        monthlyData: [],
      };
    }
  }

  // North Star Metrics Queries (ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_* views)

  /**
   * Get member retention metrics from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_MEMBER_RETENTION
   */
  public async getMemberRetention(foundationSlug: string): Promise<MemberRetentionResponse> {
    logger.debug(undefined, 'get_member_retention', 'Fetching member retention from Snowflake', { foundation_slug: foundationSlug });

    try {
      const query = `
        SELECT
          MONTH_START_DATE,
          RENEWAL_RATE,
          NET_REVENUE_RETENTION,
          MOM_CHANGE_PERCENTAGE
        FROM ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_MEMBER_RETENTION
        WHERE FOUNDATION_SLUG = ?
        ORDER BY MONTH_START_DATE DESC
        LIMIT 12
      `;

      const result = await this.snowflakeService.execute<{
        MONTH_START_DATE: string;
        RENEWAL_RATE: number;
        NET_REVENUE_RETENTION: number;
        MOM_CHANGE_PERCENTAGE: number;
      }>(query, [foundationSlug]);

      if (result.rows.length === 0) {
        return {
          renewalRate: 0,
          netRevenueRetention: 0,
          changePercentage: 0,
          trend: 'up',
          target: 85,
          monthlyData: [],
        };
      }

      const latest = result.rows[0];
      const changePercentage = latest.MOM_CHANGE_PERCENTAGE ?? 0;

      const monthlyData: NorthStarMonthlyDataPoint[] = [...result.rows].reverse().map((row) => {
        const date = new Date(row.MONTH_START_DATE);
        return {
          month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          value: row.RENEWAL_RATE ?? 0,
        };
      });

      return {
        renewalRate: latest.RENEWAL_RATE ?? 0,
        netRevenueRetention: latest.NET_REVENUE_RETENTION ?? 0,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        target: 85,
        monthlyData,
      };
    } catch (error) {
      logger.warning(undefined, 'get_member_retention', 'Failed to fetch member retention from Snowflake', {
        foundation_slug: foundationSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        renewalRate: 0,
        netRevenueRetention: 0,
        changePercentage: 0,
        trend: 'up',
        target: 85,
        monthlyData: [],
      };
    }
  }

  /**
   * Get member acquisition metrics from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_MEMBER_ACQUISITION
   */
  public async getMemberAcquisition(foundationSlug: string): Promise<MemberAcquisitionResponse> {
    logger.debug(undefined, 'get_member_acquisition', 'Fetching member acquisition from Snowflake', { foundation_slug: foundationSlug });

    const defaultResponse: MemberAcquisitionResponse = {
      totalMembers: 0,
      totalMembersMonthlyData: [],
      totalMembersMonthlyLabels: [],
      newMembersThisQuarter: 0,
      newMemberRevenue: 0,
      changePercentage: 0,
      trend: 'up',
      quarterlyData: [],
    };

    try {
      const acquisitionQuery = `
        SELECT
          QUARTER_START_DATE,
          QUARTER_LABEL,
          NEW_MEMBERS,
          NEW_MEMBER_REVENUE,
          QOQ_CHANGE_PERCENTAGE
        FROM ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_MEMBER_ACQUISITION
        WHERE FOUNDATION_SLUG = ?
        ORDER BY QUARTER_START_DATE DESC
        LIMIT 8
      `;

      // Run both queries in parallel since they're independent
      const [totalMembersData, result] = await Promise.all([
        this.getFoundationTotalMembers(foundationSlug),
        this.snowflakeService.execute<{
          QUARTER_START_DATE: string;
          QUARTER_LABEL: string;
          NEW_MEMBERS: number;
          NEW_MEMBER_REVENUE: number;
          QOQ_CHANGE_PERCENTAGE: number;
        }>(acquisitionQuery, [foundationSlug]),
      ]);

      if (result.rows.length === 0) {
        return {
          ...defaultResponse,
          totalMembers: totalMembersData.totalMembers,
          totalMembersMonthlyData: totalMembersData.monthlyData,
          totalMembersMonthlyLabels: totalMembersData.monthlyLabels,
        };
      }

      const latest = result.rows[0];
      const changePercentage = latest.QOQ_CHANGE_PERCENTAGE ?? 0;

      const quarterlyData = [...result.rows].reverse().map((row) => ({
        quarter: row.QUARTER_LABEL ?? '',
        newMembers: row.NEW_MEMBERS ?? 0,
        revenue: row.NEW_MEMBER_REVENUE ?? 0,
      }));

      return {
        totalMembers: totalMembersData.totalMembers,
        totalMembersMonthlyData: totalMembersData.monthlyData,
        totalMembersMonthlyLabels: totalMembersData.monthlyLabels,
        newMembersThisQuarter: latest.NEW_MEMBERS ?? 0,
        newMemberRevenue: latest.NEW_MEMBER_REVENUE ?? 0,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        quarterlyData,
      };
    } catch (error) {
      logger.warning(undefined, 'get_member_acquisition', 'Failed to fetch member acquisition from Snowflake', {
        foundation_slug: foundationSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return defaultResponse;
    }
  }

  /**
   * Get engaged community size metrics from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_ENGAGED_COMMUNITY
   */
  public async getEngagedCommunity(foundationSlug: string): Promise<EngagedCommunitySizeResponse> {
    logger.debug(undefined, 'get_engaged_community', 'Fetching engaged community from Snowflake', { foundation_slug: foundationSlug });

    try {
      const query = `
        SELECT
          MONTH_START_DATE,
          NEWSLETTER_SUBSCRIBERS,
          COMMUNITY_MEMBERS,
          WORKING_GROUP_MEMBERS,
          CERTIFIED_INDIVIDUALS,
          TOTAL_ENGAGED_MEMBERS,
          MOM_CHANGE_PERCENTAGE
        FROM ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_ENGAGED_COMMUNITY
        WHERE FOUNDATION_SLUG = ?
        ORDER BY MONTH_START_DATE DESC
        LIMIT 12
      `;

      const result = await this.snowflakeService.execute<{
        MONTH_START_DATE: string;
        NEWSLETTER_SUBSCRIBERS: number;
        COMMUNITY_MEMBERS: number;
        WORKING_GROUP_MEMBERS: number;
        CERTIFIED_INDIVIDUALS: number;
        TOTAL_ENGAGED_MEMBERS: number;
        MOM_CHANGE_PERCENTAGE: number;
      }>(query, [foundationSlug]);

      if (result.rows.length === 0) {
        return {
          totalMembers: 0,
          changePercentage: 0,
          trend: 'up',
          breakdown: {
            newsletterSubscribers: 0,
            communityMembers: 0,
            workingGroupMembers: 0,
            certifiedIndividuals: 0,
          },
          monthlyData: [],
        };
      }

      const latest = result.rows[0];

      // Server-side recompute: exclude newsletter subscribers (unreliable data).
      // Sum only community + working group + certified for totals and MoM change.
      const sumSegments = (row: (typeof result.rows)[0]) => (row.COMMUNITY_MEMBERS ?? 0) + (row.WORKING_GROUP_MEMBERS ?? 0) + (row.CERTIFIED_INDIVIDUALS ?? 0);

      const currentTotal = sumSegments(latest);
      let changePercentage = 0;
      if (result.rows.length >= 2) {
        const previousTotal = sumSegments(result.rows[1]);
        if (previousTotal > 0) {
          changePercentage = Number((((currentTotal - previousTotal) / previousTotal) * 100).toFixed(2));
        }
      }

      const monthlyData: NorthStarMonthlyDataPoint[] = [...result.rows].reverse().map((row) => {
        const date = new Date(row.MONTH_START_DATE);
        return {
          month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          value: sumSegments(row),
        };
      });

      return {
        totalMembers: currentTotal,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        breakdown: {
          newsletterSubscribers: 0,
          communityMembers: latest.COMMUNITY_MEMBERS ?? 0,
          workingGroupMembers: latest.WORKING_GROUP_MEMBERS ?? 0,
          certifiedIndividuals: latest.CERTIFIED_INDIVIDUALS ?? 0,
        },
        monthlyData,
      };
    } catch (error) {
      logger.warning(undefined, 'get_engaged_community', 'Failed to fetch engaged community from Snowflake', {
        foundation_slug: foundationSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalMembers: 0,
        changePercentage: 0,
        trend: 'up',
        breakdown: {
          newsletterSubscribers: 0,
          communityMembers: 0,
          workingGroupMembers: 0,
          certifiedIndividuals: 0,
        },
        monthlyData: [],
      };
    }
  }

  /**
   * Get flywheel conversion rate metrics from Snowflake
   * Queries ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_FLYWHEEL_CONVERSION
   */
  public async getFlywheelConversion(foundationSlug: string): Promise<FlywheelConversionResponse> {
    logger.debug(undefined, 'get_flywheel_conversion', 'Fetching flywheel conversion from Snowflake', { foundation_slug: foundationSlug });

    try {
      const query = `
        SELECT
          MONTH_START_DATE,
          EVENT_ATTENDEES,
          CONVERTED_TO_NEWSLETTER,
          CONVERTED_TO_COMMUNITY,
          CONVERTED_TO_WORKING_GROUP,
          CONVERSION_RATE,
          MOM_CHANGE_PERCENTAGE
        FROM ANALYTICS.PLATINUM_LFX_ONE.NORTH_STAR_FLYWHEEL_CONVERSION
        WHERE FOUNDATION_SLUG = ?
        ORDER BY MONTH_START_DATE DESC
        LIMIT 12
      `;

      const result = await this.snowflakeService.execute<{
        MONTH_START_DATE: string;
        EVENT_ATTENDEES: number;
        CONVERTED_TO_NEWSLETTER: number;
        CONVERTED_TO_COMMUNITY: number;
        CONVERTED_TO_WORKING_GROUP: number;
        CONVERSION_RATE: number;
        MOM_CHANGE_PERCENTAGE: number;
      }>(query, [foundationSlug]);

      if (result.rows.length === 0) {
        return {
          conversionRate: 0,
          changePercentage: 0,
          trend: 'up',
          funnel: {
            eventAttendees: 0,
            convertedToNewsletter: 0,
            convertedToCommunity: 0,
            convertedToWorkingGroup: 0,
          },
          monthlyData: [],
        };
      }

      const latest = result.rows[0];
      const changePercentage = latest.MOM_CHANGE_PERCENTAGE ?? 0;

      const monthlyData: NorthStarMonthlyDataPoint[] = [...result.rows].reverse().map((row) => {
        const date = new Date(row.MONTH_START_DATE);
        return {
          month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          value: row.CONVERSION_RATE ?? 0,
        };
      });

      return {
        conversionRate: latest.CONVERSION_RATE ?? 0,
        changePercentage,
        trend: changePercentage >= 0 ? 'up' : 'down',
        funnel: {
          eventAttendees: latest.EVENT_ATTENDEES ?? 0,
          convertedToNewsletter: latest.CONVERTED_TO_NEWSLETTER ?? 0,
          convertedToCommunity: latest.CONVERTED_TO_COMMUNITY ?? 0,
          convertedToWorkingGroup: latest.CONVERTED_TO_WORKING_GROUP ?? 0,
        },
        monthlyData,
      };
    } catch (error) {
      logger.warning(undefined, 'get_flywheel_conversion', 'Failed to fetch flywheel conversion from Snowflake', {
        foundation_slug: foundationSlug,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        conversionRate: 0,
        changePercentage: 0,
        trend: 'up',
        funnel: {
          eventAttendees: 0,
          convertedToNewsletter: 0,
          convertedToCommunity: 0,
          convertedToWorkingGroup: 0,
        },
        monthlyData: [],
      };
    }
  }

  /**
   * Get participating organizations summary for a foundation from Snowflake
   * Queries ANALYTICS.PLATINUM tables for membership counts and engagement classification.
   * Note: ENGAGEMENT_SCORES_BY_CLASSIFICATION only provides last-12-month engagement
   * classification, so engagement breakdown is only included for YTD. Non-YTD ranges
   * return zeroed engagement to avoid mismatching period-scoped counts with stale breakdown.
   * @param foundationSlug - Foundation slug used to resolve Snowflake PROJECT_ID via project_slug
   * @param range - Reporting range (default 'YTD')
   * @returns Participating orgs summary with member counts and engagement breakdown
   */
  public async getParticipatingOrgsSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<ParticipatingOrgsSummaryResponse> {
    interface ParticipatingOrgsRow {
      PROJECT_ID: string;
      TOTAL_ACTIVE_ACCOUNTS: number;
      TOTAL_NEW_ACCOUNTS: number;
      HIGH_ENGAGEMENT: number;
      MED_ENGAGEMENT: number;
      LOW_ENGAGEMENT: number;
    }

    const VALID_RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange = VALID_RANGES.includes(range) ? range : 'YTD';
    const suffix = this.getRangeSuffix(effectiveRange);
    const includeEngagement = effectiveRange === 'YTD';

    const engagementJoin = includeEngagement
      ? `LEFT JOIN (
          SELECT
            esc.project_id,
            SUM(CASE WHEN esc.engagement_score_classification = 'Low' THEN esc.total_accounts ELSE 0 END) as LOW_ENGAGEMENT,
            SUM(CASE WHEN esc.engagement_score_classification = 'Medium' THEN esc.total_accounts ELSE 0 END) as MED_ENGAGEMENT,
            SUM(CASE WHEN esc.engagement_score_classification = 'High' THEN esc.total_accounts ELSE 0 END) as HIGH_ENGAGEMENT
          FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION esc
          INNER JOIN slug_resolve sr2 ON esc.project_id = sr2.project_id
          WHERE esc.is_member
          GROUP BY esc.project_id
        ) as e
        ON a.PROJECT_ID = e.PROJECT_ID`
      : '';

    const engagementSelect = includeEngagement
      ? `IFNULL(e.LOW_ENGAGEMENT, 0) as LOW_ENGAGEMENT,
        IFNULL(e.MED_ENGAGEMENT, 0) as MED_ENGAGEMENT,
        IFNULL(e.HIGH_ENGAGEMENT, 0) as HIGH_ENGAGEMENT`
      : `0 as LOW_ENGAGEMENT,
        0 as MED_ENGAGEMENT,
        0 as HIGH_ENGAGEMENT`;

    const query = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        a.PROJECT_ID,
        IFNULL(a.total_active_accounts${suffix}, 0) as TOTAL_ACTIVE_ACCOUNTS,
        IFNULL(a.total_new_accounts${suffix}, 0) as TOTAL_NEW_ACCOUNTS,
        ${engagementSelect}
      FROM ANALYTICS.PLATINUM.MEMBERSHIP_OVERALL_ACCOUNTS as a
      INNER JOIN slug_resolve sr ON a.PROJECT_ID = sr.project_id
      ${engagementJoin}
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<ParticipatingOrgsRow>(query, [foundationSlug]);

    if (!result.rows || result.rows.length === 0) {
      return {
        projectId: '',
        totalActiveMembers: 0,
        totalNewMembers: 0,
        highEngagement: 0,
        medEngagement: 0,
        lowEngagement: 0,
      };
    }

    const row = result.rows[0];
    return {
      projectId: row.PROJECT_ID ?? '',
      totalActiveMembers: row.TOTAL_ACTIVE_ACCOUNTS ?? 0,
      totalNewMembers: row.TOTAL_NEW_ACCOUNTS ?? 0,
      highEngagement: row.HIGH_ENGAGEMENT ?? 0,
      medEngagement: row.MED_ENGAGEMENT ?? 0,
      lowEngagement: row.LOW_ENGAGEMENT ?? 0,
    };
  }

  /**
   * Get NPS summary for a foundation from Snowflake
   * SQL aligned with lfx-pcc SurveyQueriesService.surveyResponseMetrics.
   * Resolves project_id from foundation slug via ENGAGEMENT_SCORES_BY_CLASSIFICATION CTE.
   * @param foundationSlug - Foundation slug used to resolve project_id
   * @param range - Reporting range (default 'YTD')
   * @returns NPS summary response with score, counts, and period label
   */
  public async getNpsSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<NpsSummaryResponse> {
    interface NpsSummaryRow {
      PROJECT_ID: string;
      NPS_SCORE: number;
      PROMOTERS: number;
      PASSIVES: number;
      DETRACTORS: number;
      NON_RESPONSES: number;
      LAST_UPDATED: string | null;
      CHANGE_NPS_SCORE: number;
    }

    const VALID_RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange = VALID_RANGES.includes(range) ? range : 'YTD';
    const suffix = this.getRangeSuffix(effectiveRange);

    const query = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        sr.project_id AS PROJECT_ID,
        IFNULL(sr.most_recent_nps_score${suffix}, 0) AS NPS_SCORE,
        IFNULL(sr.most_recent_count_promoters${suffix}, 0) AS PROMOTERS,
        IFNULL(sr.most_recent_count_passives${suffix}, 0) AS PASSIVES,
        IFNULL(sr.most_recent_count_detractors${suffix}, 0) AS DETRACTORS,
        IFNULL(sr.most_recent_count_non_responses${suffix}, 0) AS NON_RESPONSES,
        sr.last_updated AS LAST_UPDATED,
        IFNULL(sr.nps_score_most_recent_to_previous_change${suffix}, 0) AS CHANGE_NPS_SCORE
      FROM ANALYTICS.PLATINUM.SURVEY_RESPONSES sr
      INNER JOIN slug_resolve s ON sr.project_id = s.project_id
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<NpsSummaryRow>(query, [foundationSlug]);

    if (!result.rows || result.rows.length === 0) {
      return {
        projectId: '',
        npsScore: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        nonResponses: 0,
        responses: 0,
        lastUpdatedLabel: 'N/A',
      };
    }

    const row = result.rows[0];

    let lastUpdatedLabel = 'N/A';
    if (row.LAST_UPDATED) {
      const date = new Date(row.LAST_UPDATED);
      if (!isNaN(date.getTime())) {
        const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
        lastUpdatedLabel = `Q${quarter} ${date.getUTCFullYear()}`;
      } else {
        lastUpdatedLabel = row.LAST_UPDATED;
      }
    }

    return {
      projectId: row.PROJECT_ID ?? '',
      npsScore: row.NPS_SCORE,
      promoters: row.PROMOTERS,
      passives: row.PASSIVES,
      detractors: row.DETRACTORS,
      nonResponses: row.NON_RESPONSES,
      responses: row.PROMOTERS + row.PASSIVES + row.DETRACTORS + row.NON_RESPONSES,
      lastUpdatedLabel,
      changeNpsScore: row.CHANGE_NPS_SCORE,
    };
  }

  /**
   * Get consolidated membership churn per tier summary for a foundation from Snowflake.
   * SQL semantics aligned with lfx-pcc MembershipQueriesService:
   *  - Headline churn rate: project-level DIV0NULL(SUM(total_churned_accounts), SUM(membership_count))
   *  - Value lost / members lost: SUM across per-tier rows
   * Resolves project_id from foundation slug via ENGAGEMENT_SCORES_BY_CLASSIFICATION CTE.
   * @param foundationSlug - Foundation slug used to resolve project_id
   * @param range - Reporting range (default 'YTD')
   * @returns Consolidated churn summary with current period, optional previous year, and trend
   */
  public async getMembershipChurnPerTierSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<MembershipChurnPerTierSummaryResponse> {
    interface ChurnSummaryRow {
      PROJECT_ID: string;
      CURRENT_CHURN_RATE_PCT: number | null;
      CURRENT_VALUE_LOST: number | null;
      CURRENT_MEMBERS_LOST: number | null;
      PREVIOUS_CHURN_RATE_PCT: number | null;
      PREVIOUS_VALUE_LOST: number | null;
      PREVIOUS_MEMBERS_LOST: number | null;
    }

    const VALID_RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange = VALID_RANGES.includes(range) ? range : 'YTD';

    const currentYearOffsetMap: Record<string, number> = {
      COMPLETED_YEAR: 2,
      COMPLETED_YEAR_2: 3,
      COMPLETED_YEAR_3: 4,
      COMPLETED_YEAR_4: 5,
    };
    const currentOffset = currentYearOffsetMap[effectiveRange] ?? 1;
    const currentYearPredicate = `EXTRACT(YEAR FROM year_start) = EXTRACT(YEAR FROM CURRENT_DATE()) - ${currentOffset}`;

    const previousYearOffsetMap: Record<string, number | null> = {
      COMPLETED_YEAR: 3,
      COMPLETED_YEAR_2: 4,
      COMPLETED_YEAR_3: 5,
      COMPLETED_YEAR_4: null,
    };
    const previousOffset = effectiveRange in previousYearOffsetMap ? previousYearOffsetMap[effectiveRange] : 2;
    const previousYearPredicate = previousOffset !== null
      ? `EXTRACT(YEAR FROM year_start) = EXTRACT(YEAR FROM CURRENT_DATE()) - ${previousOffset}`
      : null;

    const comparisonAvailable = previousYearPredicate !== null;

    const previousTotalCte = comparisonAvailable
      ? `previous_total AS (
          SELECT
            DIV0NULL(SUM(total_churned_accounts), SUM(membership_count)) AS TOTAL_CHURN_RATE
          FROM ANALYTICS.PLATINUM.MEMBERSHIP_CHURN
          WHERE project_id = (SELECT project_id FROM slug_resolve LIMIT 1)
            AND year_start IS NOT NULL
            AND ${previousYearPredicate}
            AND membership_tier IS NOT NULL
            AND membership_tier != 'Associate Membership'
        ),
        previous_per_tier AS (
          SELECT
            IFNULL(SUM(membership_value_lost), 0) AS VALUE_LOST,
            IFNULL(SUM(total_churned_accounts), 0) AS MEMBERS_LOST
          FROM ANALYTICS.PLATINUM.MEMBERSHIP_CHURN
          WHERE project_id = (SELECT project_id FROM slug_resolve LIMIT 1)
            AND year_start IS NOT NULL
            AND ${previousYearPredicate}
            AND membership_tier IS NOT NULL
            AND membership_value_lost IS NOT NULL
        ),`
      : '';

    const previousSelectFields = comparisonAvailable
      ? `(SELECT ROUND(IFNULL(TOTAL_CHURN_RATE, 0) * 100, 1) FROM previous_total) AS PREVIOUS_CHURN_RATE_PCT,
         (SELECT VALUE_LOST FROM previous_per_tier) AS PREVIOUS_VALUE_LOST,
         (SELECT MEMBERS_LOST FROM previous_per_tier) AS PREVIOUS_MEMBERS_LOST`
      : `NULL AS PREVIOUS_CHURN_RATE_PCT,
         NULL AS PREVIOUS_VALUE_LOST,
         NULL AS PREVIOUS_MEMBERS_LOST`;

    const query = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      ),
      current_total AS (
        SELECT
          DIV0NULL(SUM(total_churned_accounts), SUM(membership_count)) AS TOTAL_CHURN_RATE
        FROM ANALYTICS.PLATINUM.MEMBERSHIP_CHURN
        WHERE project_id = (SELECT project_id FROM slug_resolve LIMIT 1)
          AND year_start IS NOT NULL
          AND ${currentYearPredicate}
          AND membership_tier IS NOT NULL
          AND membership_tier != 'Associate Membership'
      ),
      current_per_tier AS (
        SELECT
          IFNULL(SUM(membership_value_lost), 0) AS VALUE_LOST,
          IFNULL(SUM(total_churned_accounts), 0) AS MEMBERS_LOST
        FROM ANALYTICS.PLATINUM.MEMBERSHIP_CHURN
        WHERE project_id = (SELECT project_id FROM slug_resolve LIMIT 1)
          AND year_start IS NOT NULL
          AND ${currentYearPredicate}
          AND membership_tier IS NOT NULL
          AND membership_value_lost IS NOT NULL
      ),
      ${previousTotalCte}
      final AS (
        SELECT
          (SELECT project_id FROM slug_resolve LIMIT 1) AS PROJECT_ID,
          ROUND(IFNULL((SELECT TOTAL_CHURN_RATE FROM current_total), 0) * 100, 1) AS CURRENT_CHURN_RATE_PCT,
          (SELECT VALUE_LOST FROM current_per_tier) AS CURRENT_VALUE_LOST,
          (SELECT MEMBERS_LOST FROM current_per_tier) AS CURRENT_MEMBERS_LOST,
          ${previousSelectFields}
      )
      SELECT * FROM final
    `;

    const result = await this.snowflakeService.execute<ChurnSummaryRow>(query, [foundationSlug]);

    const zeroDefault: MembershipChurnPerTierSummaryResponse = {
      projectId: '',
      range: effectiveRange,
      comparisonAvailable,
      currentPeriod: { churnRatePct: 0, valueLost: 0, membersLost: 0 },
      previousYear: comparisonAvailable ? { churnRatePct: 0, valueLost: 0, membersLost: 0 } : null,
      trend: null,
    };

    if (!result.rows || result.rows.length === 0) {
      return zeroDefault;
    }

    const row = result.rows[0];
    if (!row.PROJECT_ID) {
      return zeroDefault;
    }

    const currentPeriod = {
      churnRatePct: row.CURRENT_CHURN_RATE_PCT ?? 0,
      valueLost: row.CURRENT_VALUE_LOST ?? 0,
      membersLost: row.CURRENT_MEMBERS_LOST ?? 0,
    };

    let previousYear = null;
    let trend = null;

    if (comparisonAvailable) {
      previousYear = {
        churnRatePct: row.PREVIOUS_CHURN_RATE_PCT ?? 0,
        valueLost: row.PREVIOUS_VALUE_LOST ?? 0,
        membersLost: row.PREVIOUS_MEMBERS_LOST ?? 0,
      };

      if (previousYear.membersLost > 0 && currentPeriod.membersLost > 0) {
        const multiplier = Math.round((currentPeriod.membersLost / previousYear.membersLost) * 10) / 10;
        if (isFinite(multiplier) && multiplier !== 1) {
          trend = {
            direction: (currentPeriod.membersLost > previousYear.membersLost ? 'up' : 'down') as 'up' | 'down',
            multiplier,
            basis: 'membersLost' as const,
          };
        }
      }
    }

    return {
      projectId: row.PROJECT_ID,
      range: effectiveRange,
      comparisonAvailable,
      currentPeriod,
      previousYear,
      trend,
    };
  }

  /**
   * Get outstanding balance summary for a foundation from Snowflake.
   * Two logical reads from ANALYTICS.PLATINUM.CHURN_RISK:
   *  1. Overview row (churn_risk IS NULL) → headline balance and total members at risk
   *  2. Breakdown rows (churn_risk IS NOT NULL) → per-risk-bucket overdue amounts
   * Resolves project_id from foundation slug via ENGAGEMENT_SCORES_BY_CLASSIFICATION CTE.
   * @param foundationSlug - Foundation slug used to resolve project_id
   * @returns Outstanding balance summary with risk breakdown
   */
  public async getOutstandingBalanceSummary(
    foundationSlug: string
  ): Promise<OutstandingBalanceSummaryResponse> {
    interface OverviewRow {
      PROJECT_ID: string;
      OUTSTANDING_BALANCE: number | null;
      MEMBERS_AT_RISK_OF_CHURN: number | null;
    }

    interface BreakdownRow {
      CHURN_RISK: string;
      OUTSTANDING_BALANCE: number | null;
      MEMBERS_AT_RISK_OF_CHURN: number | null;
    }

    const overviewQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        cr.project_id AS PROJECT_ID,
        IFNULL(cr.outstanding_balance, 0) AS OUTSTANDING_BALANCE,
        IFNULL(cr.members_at_risk_of_churn, 0) AS MEMBERS_AT_RISK_OF_CHURN
      FROM ANALYTICS.PLATINUM.CHURN_RISK cr
      INNER JOIN slug_resolve sr ON cr.project_id = sr.project_id
      WHERE cr.churn_risk IS NULL
      LIMIT 1
    `;

    const breakdownQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        cr.churn_risk AS CHURN_RISK,
        IFNULL(cr.outstanding_balance, 0) AS OUTSTANDING_BALANCE,
        IFNULL(cr.members_at_risk_of_churn, 0) AS MEMBERS_AT_RISK_OF_CHURN
      FROM ANALYTICS.PLATINUM.CHURN_RISK cr
      INNER JOIN slug_resolve sr ON cr.project_id = sr.project_id
      WHERE cr.churn_risk IS NOT NULL
    `;

    const [overviewResult, breakdownResult] = await Promise.all([
      this.snowflakeService.execute<OverviewRow>(overviewQuery, [foundationSlug]),
      this.snowflakeService.execute<BreakdownRow>(breakdownQuery, [foundationSlug]),
    ]);

    const overviewRow = overviewResult.rows?.[0];
    const resolvedProjectId = overviewRow?.PROJECT_ID ?? '';

    const defaultResponse: OutstandingBalanceSummaryResponse = {
      projectId: resolvedProjectId,
      totalOutstandingBalance: 0,
      totalMembersAtRisk: 0,
      primaryRiskLevel: null,
      primaryRiskAmount: 0,
      overdueBreakdown: {
        medium: { riskLevel: 'Medium', overdueRangeLabel: '60-89', outstandingBalance: 0, membersAtRisk: 0 },
        high: { riskLevel: 'High', overdueRangeLabel: '90+', outstandingBalance: 0, membersAtRisk: 0 },
      },
    };

    if (!overviewRow) {
      return defaultResponse;
    }

    const totalOutstandingBalance = overviewRow.OUTSTANDING_BALANCE ?? 0;
    const totalMembersAtRisk = overviewRow.MEMBERS_AT_RISK_OF_CHURN ?? 0;

    const mediumBucket = { ...defaultResponse.overdueBreakdown.medium };
    const highBucket = { ...defaultResponse.overdueBreakdown.high };

    if (breakdownResult.rows) {
      for (const row of breakdownResult.rows) {
        if (row.CHURN_RISK === 'Medium') {
          mediumBucket.outstandingBalance = row.OUTSTANDING_BALANCE ?? 0;
          mediumBucket.membersAtRisk = row.MEMBERS_AT_RISK_OF_CHURN ?? 0;
        } else if (row.CHURN_RISK === 'High') {
          highBucket.outstandingBalance = row.OUTSTANDING_BALANCE ?? 0;
          highBucket.membersAtRisk = row.MEMBERS_AT_RISK_OF_CHURN ?? 0;
        }
      }
    }

    let primaryRiskLevel: 'High' | 'Medium' | null = null;
    let primaryRiskAmount = 0;
    if (highBucket.outstandingBalance > 0) {
      primaryRiskLevel = 'High';
      primaryRiskAmount = highBucket.outstandingBalance;
    } else if (mediumBucket.outstandingBalance > 0) {
      primaryRiskLevel = 'Medium';
      primaryRiskAmount = mediumBucket.outstandingBalance;
    }

    return {
      projectId: resolvedProjectId,
      totalOutstandingBalance,
      totalMembersAtRisk,
      primaryRiskLevel,
      primaryRiskAmount,
      overdueBreakdown: {
        medium: mediumBucket,
        high: highBucket,
      },
    };
  }

  /**
   * Get events summary for a foundation from Snowflake
   * Three reads: overview (total events + change), sponsorship SUM, goal MAX.
   * Resolves project_id from foundation slug via ENGAGEMENT_SCORES_BY_CLASSIFICATION CTE.
   * @param foundationSlug - Foundation slug used to resolve project_id
   * @returns Events summary response with total events, change, sponsorship, and goal
   */
  public async getEventsSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<EventsSummaryResponse> {
    interface OverviewRow {
      PROJECT_ID: string;
      ALL_EVENTS: number;
      UPCOMING_EVENTS: number;
      PAST_EVENTS: number;
      EVENT_CHANGE: number;
      EVENT_COUNT_DIFF: number;
    }

    interface SponsorshipRow {
      SPONSORSHIP_REVENUE: number;
    }

    interface GoalRow {
      SPONSORSHIP_GOAL: number;
    }

    const VALID_RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange = VALID_RANGES.includes(range) ? range : 'YTD';
    const suffix = this.getRangeSuffix(effectiveRange);
    const goalSuffix = this.getRangeSuffix(effectiveRange, 'engagementScoresGoal');

    const comparisonMap = ProjectService.rangeSuffixMap['eventComparison'];
    const hasComparison = effectiveRange in comparisonMap;
    const comparisonSuffix = hasComparison ? comparisonMap[effectiveRange] : null;

    const upcomingCol = effectiveRange === 'YTD'
      ? `IFNULL(eo.UPCOMING_EVENTS${suffix}, 0)`
      : '0';

    const changeExpr = comparisonSuffix
      ? `CASE
          WHEN IFNULL(eo.EVENT_COUNT${comparisonSuffix}, 0) = 0 THEN 0
          ELSE (IFNULL(eo.EVENT_COUNT${suffix}, 0) - eo.EVENT_COUNT${comparisonSuffix})
               / NULLIF(eo.EVENT_COUNT${comparisonSuffix}, 0)
        END`
      : '0';

    const diffExpr = comparisonSuffix
      ? `IFNULL(eo.EVENT_COUNT${suffix}, 0) - IFNULL(eo.EVENT_COUNT${comparisonSuffix}, 0)`
      : '0';

    const overviewQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        eo.PROJECT_ID,
        IFNULL(eo.EVENT_COUNT${suffix}, 0) AS ALL_EVENTS,
        ${upcomingCol} AS UPCOMING_EVENTS,
        IFNULL(eo.PAST_EVENTS${suffix}, 0) AS PAST_EVENTS,
        ${changeExpr} AS EVENT_CHANGE,
        ${diffExpr} AS EVENT_COUNT_DIFF
      FROM ANALYTICS.PLATINUM.EVENT_OVERVIEW eo
      INNER JOIN slug_resolve sr ON eo.PROJECT_ID = sr.project_id
      LIMIT 1
    `;

    const sponsorshipQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        IFNULL(SUM(es.SPONSORSHIP_REVENUE${suffix}), 0) AS SPONSORSHIP_REVENUE
      FROM ANALYTICS.PLATINUM.EVENT_SPONSORSHIPS es
      INNER JOIN slug_resolve sr ON es.PROJECT_ID = sr.project_id
    `;

    const goalQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        IFNULL(MAX(eng.EVENT_SPONSORSHIPS${goalSuffix}_GOAL), 0) AS SPONSORSHIP_GOAL
      FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES eng
      INNER JOIN slug_resolve sr ON eng.PROJECT_ID = sr.project_id
      WHERE eng.IS_MEMBER = TRUE
    `;

    const [overviewResult, sponsorshipResult, goalResult] = await Promise.all([
      this.snowflakeService.execute<OverviewRow>(overviewQuery, [foundationSlug]),
      this.snowflakeService.execute<SponsorshipRow>(sponsorshipQuery, [foundationSlug]),
      this.snowflakeService.execute<GoalRow>(goalQuery, [foundationSlug]),
    ]);

    const overviewRow = overviewResult.rows?.[0];
    const sponsorshipRow = sponsorshipResult.rows?.[0];
    const goalRow = goalResult.rows?.[0];

    const resolvedProjectId = overviewRow?.PROJECT_ID ?? '';
    const totalEvents = overviewRow?.ALL_EVENTS ?? 0;
    const upcomingEvents = overviewRow?.UPCOMING_EVENTS ?? 0;
    const pastEvents = overviewRow?.PAST_EVENTS ?? 0;
    const eventChange = overviewRow?.EVENT_CHANGE ?? 0;
    const eventCountDiff = overviewRow?.EVENT_COUNT_DIFF ?? 0;
    const sponsorshipRevenue = sponsorshipRow?.SPONSORSHIP_REVENUE ?? 0;
    const sponsorshipGoal = goalRow?.SPONSORSHIP_GOAL ?? 0;
    const sponsorshipProgressPct = sponsorshipGoal > 0 ? (sponsorshipRevenue / sponsorshipGoal) * 100 : 0;

    return {
      projectId: resolvedProjectId,
      totalEvents,
      upcomingEvents,
      pastEvents,
      eventChange,
      eventCountDiff,
      sponsorshipRevenue,
      sponsorshipGoal,
      sponsorshipProgressPct,
    };
  }

  /**
   * Get Training & Certification summary for a foundation from Snowflake.
   * Two logical reads: ENROLLMENTS for enrollment values and COURSE_PURCHASES for revenue values.
   * Column selection is range-specific, reusing PCC TrainingQueriesService.trainingEnrollment semantics.
   * @param foundationSlug - Foundation slug used to resolve project_id via slug-resolve CTE
   * @param range - Reporting window (default 'YTD')
   * @returns Normalized response with both enrollment and revenue values
   */
  public async getTrainingCertificationSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<TrainingCertificationSummaryResponse> {
    interface EnrollmentRow {
      PROJECT_ID: string;
      INSTRUCTOR_LED: number;
      E_LEARNINGS: number;
      CERTIFICATION_EXAMS: number;
      EDX: number;
    }

    interface RevenueRow {
      PROJECT_ID: string;
      INSTRUCTOR_LED_REVENUE: number;
      E_LEARNINGS_NET_REVENUE: number;
      CERTIFICATION_EXAMS_NET_REVENUE: number;
    }

    const VALID_RANGES = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange = VALID_RANGES.includes(range) ? range : 'YTD';

    const { prefix, suffix } = this.getTrainingRangeColumns(effectiveRange);

    const enrollmentQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        e.project_id AS PROJECT_ID,
        IFNULL(e.instructor_led_${prefix}${suffix}, 0) AS INSTRUCTOR_LED,
        IFNULL(e.e_learnings_${prefix}${suffix}, 0) AS E_LEARNINGS,
        IFNULL(e.certification_exams_${prefix}${suffix}, 0) AS CERTIFICATION_EXAMS,
        IFNULL(e.edx_${prefix}${suffix}, 0) AS EDX
      FROM ANALYTICS.PLATINUM.ENROLLMENTS AS e
      INNER JOIN slug_resolve sr ON e.project_id = sr.project_id
      LIMIT 1
    `;

    const revenueQuery = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        c.project_id AS PROJECT_ID,
        IFNULL(c.INSTRUCTOR_LED_NET_REVENUE_${prefix}${suffix}, 0) AS INSTRUCTOR_LED_REVENUE,
        IFNULL(c.e_learning_net_revenue_${prefix}${suffix}, 0) AS E_LEARNINGS_NET_REVENUE,
        IFNULL(c.certification_exam_net_revenue_${prefix}${suffix}, 0) AS CERTIFICATION_EXAMS_NET_REVENUE
      FROM ANALYTICS.PLATINUM.COURSE_PURCHASES AS c
      INNER JOIN slug_resolve sr ON c.project_id = sr.project_id
      LIMIT 1
    `;

    const [enrollmentResult, revenueResult] = await Promise.all([
      this.snowflakeService.execute<EnrollmentRow>(enrollmentQuery, [foundationSlug]),
      this.snowflakeService.execute<RevenueRow>(revenueQuery, [foundationSlug]),
    ]);

    const enrollmentRow = enrollmentResult.rows?.[0];
    const revenueRow = revenueResult.rows?.[0];
    const resolvedProjectId = enrollmentRow?.PROJECT_ID ?? revenueRow?.PROJECT_ID ?? '';

    return {
      projectId: resolvedProjectId,
      range: effectiveRange as TrainingCertificationSummaryResponse['range'],
      enrollment: {
        instructorLed: enrollmentRow?.INSTRUCTOR_LED ?? 0,
        eLearning: enrollmentRow?.E_LEARNINGS ?? 0,
        certExams: enrollmentRow?.CERTIFICATION_EXAMS ?? 0,
        edx: enrollmentRow?.EDX ?? 0,
      },
      revenue: {
        instructorLed: revenueRow?.INSTRUCTOR_LED_REVENUE ?? 0,
        eLearning: revenueRow?.E_LEARNINGS_NET_REVENUE ?? 0,
        certExams: revenueRow?.CERTIFICATION_EXAMS_NET_REVENUE ?? 0,
      },
    };
  }

  /**
   * Get Code Contribution summary for a foundation from Snowflake.
   * One logical read from CODE_CONTRIBUTIONS with dynamic column interpolation.
   * Column selection is range-specific; all-time role counts are always included.
   * @param foundationSlug - Foundation slug used to resolve project_id via slug-resolve CTE
   * @param range - Reporting window (default 'YTD')
   * @returns Normalized response with contributor counts and role distribution
   */
  public async getCodeContributionSummary(
    foundationSlug: string,
    range: string = 'YTD'
  ): Promise<CodeContributionSummaryResponse> {
    interface CodeContributionRow {
      PROJECT_ID: string;
      TOTAL_CONTRIBUTORS: number;
      NEW_CONTRIBUTORS: number;
      TOTAL_CONTRIBUTORS_CHANGE: number;
      NEW_CONTRIBUTORS_CHANGE: number;
      COMMITTERS_ALL_TIME: number;
      MAINTAINERS_ALL_TIME: number;
      REVIEWERS_ALL_TIME: number;
    }

    const validRanges: CodeContributionRange[] = ['YTD', 'COMPLETED_YEAR', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR_3', 'COMPLETED_YEAR_4'];
    const effectiveRange: CodeContributionRange = validRanges.includes(range as CodeContributionRange)
      ? (range as CodeContributionRange)
      : 'YTD';
    const rangeSuffix = this.getRangeSuffix(effectiveRange);

    const query = `
      WITH slug_resolve AS (
        SELECT DISTINCT project_id
        FROM ANALYTICS.PLATINUM.ENGAGEMENT_SCORES_BY_CLASSIFICATION
        WHERE project_slug = ?
      )
      SELECT
        cc.project_id AS PROJECT_ID,
        IFNULL(cc.total_contributors${rangeSuffix}, 0) AS TOTAL_CONTRIBUTORS,
        IFNULL(cc.new_contributors${rangeSuffix}, 0) AS NEW_CONTRIBUTORS,
        IFNULL(cc.total_contributors${rangeSuffix}_change, 0) AS TOTAL_CONTRIBUTORS_CHANGE,
        IFNULL(cc.new_contributors${rangeSuffix}_change, 0) AS NEW_CONTRIBUTORS_CHANGE,
        IFNULL(cc.committers_all_time, 0) AS COMMITTERS_ALL_TIME,
        IFNULL(cc.maintainers_all_time, 0) AS MAINTAINERS_ALL_TIME,
        IFNULL(cc.reviewers_all_time, 0) AS REVIEWERS_ALL_TIME
      FROM ANALYTICS.PLATINUM.CODE_CONTRIBUTIONS cc
      INNER JOIN slug_resolve sr ON cc.project_id = sr.project_id
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<CodeContributionRow>(query, [foundationSlug]);
    const row = result.rows?.[0];

    return {
      dataAvailable: !!row,
      projectId: row?.PROJECT_ID ?? '',
      projectSlug: foundationSlug,
      range: effectiveRange,
      totalContributors: row?.TOTAL_CONTRIBUTORS ?? 0,
      totalContributorsChange: row?.TOTAL_CONTRIBUTORS_CHANGE ?? 0,
      newContributors: row?.NEW_CONTRIBUTORS ?? 0,
      newContributorsChange: row?.NEW_CONTRIBUTORS_CHANGE ?? 0,
      committers: row?.COMMITTERS_ALL_TIME ?? 0,
      maintainers: row?.MAINTAINERS_ALL_TIME ?? 0,
      reviewers: row?.REVIEWERS_ALL_TIME ?? 0,
    };
  }

  /**
   * Get all project UIDs under a foundation (foundation UID + child project UIDs).
   * Queries the query service for projects with parent_uid matching the foundation.
   * @param req - Express request object
   * @param foundationUid - The foundation UID to resolve children for
   * @returns Array of UIDs including the foundation itself and all child projects
   */
  public async getFoundationProjectUids(req: Request, foundationUid: string): Promise<string[]> {
    logger.debug(req, 'get_foundation_project_uids', 'Resolving child projects for foundation', { foundation_uid: foundationUid });
    const uids = [foundationUid];
    try {
      const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<{ uid: string }>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        v: '1',
        type: 'project',
        parent: `project:${foundationUid}`,
        page_size: 200,
      });
      for (const r of resources) {
        if (r.data?.uid) {
          uids.push(r.data.uid);
        }
      }
    } catch (error) {
      // If child lookup fails, just filter by foundation UID alone
      logger.warning(req, 'get_foundation_project_uids', 'Failed to resolve child projects, using foundation UID only', {
        foundation_uid: foundationUid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    logger.debug(req, 'get_foundation_project_uids', 'Resolved foundation project UIDs', { foundation_uid: foundationUid, count: uids.length });
    return uids;
  }

  private getRangeSuffix(range: string, convention: string = 'standard'): string {
    const map = ProjectService.rangeSuffixMap[convention];
    return map?.[range] ?? map?.['YTD'] ?? '_ytd';
  }

  private getTrainingRangeColumns(range: string): { prefix: string; suffix: string } {
    const full = this.getRangeSuffix(range, 'training');
    if (full === 'YTD') return { prefix: '', suffix: 'YTD' };
    const lastUnderscore = full.lastIndexOf('_');
    return { prefix: full.substring(0, lastUnderscore + 1), suffix: full.substring(lastUnderscore + 1) };
  }
}
