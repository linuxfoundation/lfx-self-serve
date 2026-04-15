// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  ActiveWeeksStreakResponse,
  ActiveWeeksStreakRow,
  Meeting,
  MeetingOccurrence,
  MeetingRegistrant,
  PastMeeting,
  PastMeetingParticipant,
  PendingActionItem,
  PersonaType,
  ProjectItem,
  QueryServiceResponse,
  UserCodeCommitsResponse,
  UserCodeCommitsRow,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserMetadataUpdateResponse,
  UserProjectContributionRow,
  UserProjectsResponse,
  UserPullRequestsResponse,
  UserPullRequestsRow,
} from '@lfx-one/shared/interfaces';
import { parseToInt } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MeetingService } from './meeting.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling user-related operations and user analytics
 */
export class UserService {
  private natsService: NatsService;
  private snowflakeService: SnowflakeService;
  private meetingService: MeetingService;
  private projectService: ProjectService;
  private microserviceProxy: MicroserviceProxyService;
  private accessCheckService: AccessCheckService;

  private readonly twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  private readonly bufferMinutes = 40;

  public constructor() {
    this.natsService = new NatsService();
    this.snowflakeService = SnowflakeService.getInstance();
    this.meetingService = new MeetingService();
    this.projectService = new ProjectService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.accessCheckService = new AccessCheckService();
  }

  /**
   * Fetch user information by username or email using NATS request-reply pattern
   * The userArg is either a username or a sub (subject) or a user's token
   * @param req - Express request object for logging
   * @param userArg - Username, sub, or token
   * @returns UserMetadataUpdateResponse object with success, data, and error
   * @throws ResourceNotFoundError if user not found
   */
  public async getUserInfo(req: Request, userArg: string): Promise<UserMetadataUpdateResponse> {
    const startTime = logger.startOperation(req, 'get_user_info', { user_arg_provided: !!userArg });
    const codec = this.natsService.getCodec();

    try {
      const response = await this.natsService.request(NatsSubjects.USER_METADATA_READ, codec.encode(userArg), { timeout: NATS_CONFIG.REQUEST_TIMEOUT });

      const responseText = codec.decode(response.data);

      const userMetadata: UserMetadataUpdateResponse = JSON.parse(responseText);

      if (!userMetadata || typeof userMetadata !== 'object') {
        throw new ResourceNotFoundError('User', undefined, {
          operation: 'get_user_info',
          service: 'user_service',
          path: '/nats/user-metadata-read',
        });
      }

      logger.success(req, 'get_user_info', startTime, { user_arg_provided: !!userArg });

      return userMetadata;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        throw new ResourceNotFoundError('User', undefined, {
          operation: 'get_user_info',
          service: 'user_service',
          path: '/nats/user-metadata-read',
        });
      }

      throw error;
    }
  }

  /**
   * Update user metadata through NATS
   * @param req - Express request object
   * @param updates - The user metadata updates
   * @returns Promise with the update response
   */
  public async updateUserMetadata(req: Request, updates: UserMetadataUpdateRequest): Promise<UserMetadataUpdateResponse> {
    const startTime = logger.startOperation(req, 'update_user_metadata', {
      has_username: !!updates.username,
      has_metadata: !!updates.user_metadata,
      metadata_fields: updates.user_metadata ? Object.keys(updates.user_metadata) : [],
    });

    try {
      // Validate required fields
      if (!updates.username) {
        throw new Error('Username is required');
      }

      // Send the request via NATS
      const response = await this.sendUserMetadataUpdate(req, updates);

      // Log the result
      if (response.success) {
        logger.success(req, 'update_user_metadata', startTime, {
          username: updates.username,
          updated_fields: response.updated_fields,
        });
      } else {
        logger.warning(req, 'update_user_metadata', 'Update failed from NATS service', {
          username: updates.username,
          error: response.error,
          message: response.message,
        });
      }

      return response;
    } catch (error) {
      logger.error(req, 'update_user_metadata', startTime, error, {
        username: updates.username,
      });

      // Return error response
      return {
        success: false,
        username: updates.username,
        error: 'Service error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * Validate user metadata before update
   * @param metadata - The user metadata to validate
   * @returns true if valid, throws error if invalid
   */
  public validateUserMetadata(metadata: UserMetadata): boolean {
    // Validate t-shirt size if provided
    if (metadata?.t_shirt_size) {
      const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
      if (!validSizes.includes(metadata.t_shirt_size.toUpperCase())) {
        throw new Error(`Invalid t-shirt size. Must be one of: ${validSizes.join(', ')}`);
      }
    }

    // Validate phone number format if provided
    if (metadata?.phone_number) {
      // Basic phone number validation (can be enhanced based on requirements)
      const phoneRegex = /^[+]?[\d\s-().]+$/;
      if (!phoneRegex.test(metadata.phone_number)) {
        throw new Error('Invalid phone number format');
      }
    }

    // Validate postal code if provided
    if (metadata?.postal_code) {
      // Basic postal code validation (alphanumeric with spaces and hyphens)
      const postalRegex = /^[A-Za-z0-9\s-]+$/;
      if (!postalRegex.test(metadata.postal_code)) {
        throw new Error('Invalid postal code format');
      }
    }

    // Validate picture URL if provided
    if (metadata?.picture) {
      try {
        new URL(metadata.picture);
      } catch {
        throw new Error('Invalid picture URL format');
      }
    }

    // Validate country if provided (basic length check)
    if (metadata?.country && metadata.country.length > 100) {
      throw new Error('Country name is too long');
    }

    // Validate state/province if provided (basic length check)
    if (metadata?.state_province && metadata.state_province.length > 100) {
      throw new Error('State/Province name is too long');
    }

    // Validate city if provided (basic length check)
    if (metadata?.city && metadata.city.length > 100) {
      throw new Error('City name is too long');
    }

    // Validate address if provided (basic length check)
    if (metadata?.address && metadata.address.length > 500) {
      throw new Error('Address is too long');
    }

    // Validate organization if provided (basic length check)
    if (metadata?.organization && metadata.organization.length > 200) {
      throw new Error('Organization name is too long');
    }

    // Validate job title if provided (basic length check)
    if (metadata?.job_title && metadata.job_title.length > 200) {
      throw new Error('Job title is too long');
    }

    return true;
  }

  /**
   * Shutdown the service and clean up resources
   */
  public async shutdown(): Promise<void> {
    logger.debug(undefined, 'user_service_shutdown', 'Shutting down user service', {});
    await this.natsService.shutdown();
  }

  /**
   * Get active weeks streak data for a user
   * @param userEmail - User's email address
   * @returns Active weeks streak data with current streak calculation
   */
  public async getActiveWeeksStreak(userEmail: string): Promise<ActiveWeeksStreakResponse> {
    const query = `
      SELECT WEEKS_AGO, IS_ACTIVE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ACTIVE_WEEKS_STREAK
      WHERE EMAIL = ?
      ORDER BY WEEKS_AGO ASC
      LIMIT 52
    `;

    const result = await this.snowflakeService.execute<ActiveWeeksStreakRow>(query, [userEmail]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Active weeks streak data', userEmail, {
        operation: 'get_active_weeks_streak',
      });
    }

    // Calculate current streak (consecutive weeks of activity from week 0)
    // Data is ordered by WEEKS_AGO ASC, so index 0 is week 0 (current week)
    let currentStreak = 0;

    for (const row of result.rows) {
      if (row.IS_ACTIVE === 1) {
        currentStreak++;
      } else {
        break; // Stop at first inactive week
      }
    }

    return {
      data: result.rows,
      currentStreak,
      totalWeeks: result.rows.length,
    };
  }

  /**
   * Get pull requests merged activity data for a user
   * @param userEmail - User's email address
   * @returns Pull requests merged data for last 30 days
   */
  public async getPullRequestsMerged(userEmail: string): Promise<UserPullRequestsResponse> {
    // Use window function to calculate total in SQL for accuracy
    // Filter for last 30 days of data
    const query = `
      SELECT
        ACTIVITY_DATE,
        DAILY_COUNT,
        SUM(DAILY_COUNT) OVER () as TOTAL_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.USER_PULL_REQUESTS
      WHERE EMAIL = ?
        AND ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
      ORDER BY ACTIVITY_DATE ASC
    `;

    const result = await this.snowflakeService.execute<UserPullRequestsRow>(query, [userEmail]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Pull requests data', userEmail, {
        operation: 'get_pull_requests_merged',
      });
    }

    // Get total from SQL calculation (same value on all rows from window function)
    const totalPullRequests = result.rows[0].TOTAL_COUNT;

    return {
      data: result.rows,
      totalPullRequests,
      totalDays: result.rows.length,
    };
  }

  /**
   * Get code commits activity data for a user
   * @param userEmail - User's email address
   * @returns Code commits data for last 30 days
   */
  public async getCodeCommits(userEmail: string): Promise<UserCodeCommitsResponse> {
    // Use window function to calculate total in SQL for accuracy
    // Filter for last 30 days of data
    const query = `
      SELECT
        ACTIVITY_DATE,
        DAILY_COUNT,
        SUM(DAILY_COUNT) OVER () as TOTAL_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.USER_CODE_COMMITS
      WHERE EMAIL = ?
        AND ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
      ORDER BY ACTIVITY_DATE ASC
    `;

    const result = await this.snowflakeService.execute<UserCodeCommitsRow>(query, [userEmail]);

    if (result.rows.length === 0) {
      throw new ResourceNotFoundError('Code commits data', userEmail, {
        operation: 'get_code_commits',
      });
    }

    // Get total from SQL calculation (same value on all rows from window function)
    const totalCommits = result.rows[0].TOTAL_COUNT;

    return {
      data: result.rows,
      totalCommits,
      totalDays: result.rows.length,
    };
  }

  /**
   * Get user's projects with activity data
   * Queries USER_PROJECT_CONTRIBUTIONS_DAILY table filtered by LF username
   * @param lfUsername - Linux Foundation username from OIDC
   * @returns All projects with activity data for the user
   */
  public async getMyProjects(lfUsername: string): Promise<UserProjectsResponse> {
    // Get all projects with their activity data
    // Aggregates affiliations per project and sums activities by date
    const query = `
      WITH UserProjects AS (
        SELECT PROJECT_ID, PROJECT_NAME, PROJECT_SLUG, PROJECT_LOGO,
               MAX(IS_MAINTAINER) AS IS_MAINTAINER
        FROM ANALYTICS.PLATINUM_LFX_ONE.USER_PROJECT_CONTRIBUTIONS_DAILY
        WHERE SUB = ?
        GROUP BY PROJECT_ID, PROJECT_NAME, PROJECT_SLUG, PROJECT_LOGO
        ORDER BY PROJECT_NAME, PROJECT_ID
      ),
      ProjectAffiliations AS (
        SELECT PROJECT_ID, LISTAGG(DISTINCT AFFILIATION, ', ') WITHIN GROUP (ORDER BY AFFILIATION) AS AFFILIATIONS
        FROM ANALYTICS.PLATINUM_LFX_ONE.USER_PROJECT_CONTRIBUTIONS_DAILY
        WHERE SUB = ?
          AND AFFILIATION IS NOT NULL
          AND AFFILIATION != ''
        GROUP BY PROJECT_ID
      ),
      DailyActivities AS (
        SELECT PROJECT_ID, ACTIVITY_DATE,
               SUM(DAILY_CODE_ACTIVITIES) AS DAILY_CODE_ACTIVITIES,
               SUM(DAILY_NON_CODE_ACTIVITIES) AS DAILY_NON_CODE_ACTIVITIES
        FROM ANALYTICS.PLATINUM_LFX_ONE.USER_PROJECT_CONTRIBUTIONS_DAILY
        WHERE SUB = ?
        GROUP BY PROJECT_ID, ACTIVITY_DATE
      )
      SELECT
        p.PROJECT_ID,
        p.PROJECT_NAME,
        p.PROJECT_SLUG,
        p.PROJECT_LOGO,
        p.IS_MAINTAINER,
        COALESCE(pa.AFFILIATIONS, '') AS AFFILIATION,
        a.ACTIVITY_DATE,
        a.DAILY_CODE_ACTIVITIES,
        a.DAILY_NON_CODE_ACTIVITIES
      FROM UserProjects p
      LEFT JOIN ProjectAffiliations pa ON p.PROJECT_ID = pa.PROJECT_ID
      LEFT JOIN DailyActivities a ON p.PROJECT_ID = a.PROJECT_ID
      ORDER BY p.PROJECT_NAME, p.PROJECT_ID, a.ACTIVITY_DATE ASC
    `;

    const result = await this.snowflakeService.execute<UserProjectContributionRow>(query, [lfUsername, lfUsername, lfUsername]);

    // Group rows by PROJECT_ID and transform into ProjectItem[]
    const projectsMap = new Map<string, ProjectItem>();

    for (const row of result.rows) {
      if (!projectsMap.has(row.PROJECT_ID)) {
        // Parse affiliations from comma-separated string
        const affiliations = row.AFFILIATION ? row.AFFILIATION.split(', ').filter((a) => a.trim()) : [];

        // Initialize new project
        projectsMap.set(row.PROJECT_ID, {
          name: row.PROJECT_NAME,
          slug: row.PROJECT_SLUG,
          logo: row.PROJECT_LOGO || undefined,
          role: row.IS_MAINTAINER ? 'Maintainer' : 'Contributor',
          affiliations,
          codeActivities: [],
          nonCodeActivities: [],
        });
      }

      // Add daily activity values to arrays (if there's activity data)
      if (row.ACTIVITY_DATE) {
        const project = projectsMap.get(row.PROJECT_ID)!;
        project.codeActivities.push(row.DAILY_CODE_ACTIVITIES || 0);
        project.nonCodeActivities.push(row.DAILY_NON_CODE_ACTIVITIES || 0);
      }
    }

    // Convert map to array
    const projects = Array.from(projectsMap.values());

    return {
      data: projects,
      totalProjects: projects.length,
    };
  }

  /**
   * Get all pending actions for a user based on persona
   * @param req - Express request object
   * @param persona - User persona type (board-member, maintainer, contributor)
   * @param projectUid - Project UID for filtering
   * @param email - User email
   * @param projectSlug - Project slug for survey filtering
   * @returns Array of pending action items
   */
  public async getPendingActions(req: Request, persona: PersonaType, projectUid: string, email: string, projectSlug: string): Promise<PendingActionItem[]> {
    if (persona === 'board-member') {
      return this.getBoardMemberActions(req, email, projectSlug, projectUid);
    }
    // Future personas: maintainer, contributor can be added here
    return [];
  }

  /**
   * Fetches meetings for the current user, optionally filtered by project
   * Uses a reverse-query approach: first gets all registrant records for the user,
   * then fetches only those meetings by ID — avoids the N+1 query problem.
   * @param req - Express request object
   * @param email - User's email address for registrant lookup
   * @param projectUid - Optional project UID to filter meetings by
   * @param limit - Optional limit on number of meetings to return
   * @returns Array of Meeting objects the user is registered for
   */
  public async getUserMeetings(req: Request, email: string, projectUid?: string, limit?: number, foundationUid?: string): Promise<Meeting[]> {
    const meetingIds = await this.getUserRegisteredMeetingIds(req, email);

    logger.debug(req, 'get_user_meetings', 'Found registered meeting IDs for user', { meeting_count: meetingIds.size });

    if (meetingIds.size === 0) {
      return [];
    }

    let foundationProjectUids: Set<string> | undefined;
    if (foundationUid) {
      const uids = await this.projectService.getFoundationProjectUids(req, foundationUid);
      foundationProjectUids = new Set(uids);
    }

    const meetings = await this.fetchByIdFilterAndLimit<Meeting>(
      req,
      meetingIds,
      '/itx/meetings',
      'get_user_meetings',
      projectUid,
      undefined,
      foundationProjectUids
    );

    // Sort by start_time ascending (soonest first) before applying limit
    // so the limit returns the most relevant upcoming meetings
    meetings.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    const limited = limit !== undefined && limit > 0 ? meetings.slice(0, limit) : meetings;

    return this.accessCheckService.addAccessToResources(req, limited, 'v1_meeting', 'organizer');
  }

  /**
   * Fetches past meetings for the current user, optionally filtered by project
   * Queries v1_past_meeting_participant by email to find composite meeting IDs,
   * then fetches each past meeting via ITX endpoint.
   * @param req - Express request object
   * @param email - User's email address for participant lookup
   * @param projectUid - Optional project UID to filter meetings by
   * @param limit - Optional limit on number of past meetings to return
   * @returns Array of PastMeeting objects the user participated in
   */
  public async getUserPastMeetings(req: Request, email: string, projectUid?: string, limit?: number, foundationUid?: string): Promise<PastMeeting[]> {
    // Step 1: Get all past meeting participant records for this user via query service
    // Uses fetchAllQueryResources to auto-paginate through all pages and dual email+username
    // lookup for complete coverage (same pattern as getPastMeetingOccurrenceIds)
    logger.debug(req, 'get_user_past_meetings', 'Starting past meeting lookup for user', {
      has_project_filter: !!projectUid,
      has_foundation_filter: !!foundationUid,
      limit,
    });

    const normalizedEmail = email.toLowerCase();
    const username = await getUsernameFromAuth(req);

    // M2M token required: participant queries search across all participants in the index
    const m2mToken = await generateM2MToken(req);
    const headers = { Authorization: `Bearer ${m2mToken}` };
    const pastMeetingIds = new Set<string>();

    // Query by email
    const emailParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        {
          type: 'v1_past_meeting_participant',
          tags: `email:${normalizedEmail}`,
          page_size: 100,
          ...(pageToken && { page_token: pageToken }),
        },
        undefined,
        headers
      )
    ).catch((error) => {
      logger.warning(req, 'get_user_past_meetings', 'Email participant query failed, returning partial results', {
        err: error,
      });
      return [];
    });
    emailParticipants.forEach((p) => p.meeting_and_occurrence_id && pastMeetingIds.add(p.meeting_and_occurrence_id));

    // Also query by username for complete coverage
    if (username) {
      const plainUsername = stripAuthPrefix(username);
      const usernameParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'v1_past_meeting_participant',
            tags: `username:${plainUsername}`,
            page_size: 100,
            ...(pageToken && { page_token: pageToken }),
          },
          undefined,
          headers
        )
      ).catch((error) => {
        logger.warning(req, 'get_user_past_meetings', 'Username participant query failed, returning partial results', {
          err: error,
        });
        return [];
      });
      usernameParticipants.forEach((p) => p.meeting_and_occurrence_id && pastMeetingIds.add(p.meeting_and_occurrence_id));
    }

    logger.debug(req, 'get_user_past_meetings', 'Found past meeting participant IDs', {
      total_ids: pastMeetingIds.size,
      email_matches: emailParticipants.length,
    });

    if (pastMeetingIds.size === 0) {
      return [];
    }

    let foundationProjectUids: Set<string> | undefined;
    if (foundationUid) {
      const uids = await this.projectService.getFoundationProjectUids(req, foundationUid);
      foundationProjectUids = new Set(uids);
    }

    // Step 2: Fetch each past meeting and filter (limit applied after sorting)
    const pastMeetings = await this.fetchByIdFilterAndLimit<PastMeeting>(
      req,
      pastMeetingIds,
      '/itx/past_meetings',
      'get_user_past_meetings',
      projectUid,
      undefined,
      foundationProjectUids
    );

    // Sort by scheduled_start_time descending (most recent first) before applying limit
    // so the limit returns the most recent meetings rather than an arbitrary subset
    pastMeetings.sort((a, b) => new Date(b.scheduled_start_time).getTime() - new Date(a.scheduled_start_time).getTime());

    const limited = limit !== undefined && limit > 0 ? pastMeetings.slice(0, limit) : pastMeetings;

    return this.accessCheckService.addAccessToResources(req, limited, 'v1_past_meeting', 'organizer');
  }

  /**
   * Gets all unique past meeting occurrence IDs (meeting_and_occurrence_id) the user participated in.
   * Checks both email and username to find all participations.
   * M2M token required: participant queries search across all participants in the index,
   * which requires application-level credentials (user tokens lack cross-participant read access)
   * @param req - Express request object
   * @returns Array of unique meeting_and_occurrence_id strings
   */
  public async getPastMeetingOccurrenceIds(req: Request): Promise<string[]> {
    const email = getEffectiveEmail(req) ?? undefined;
    const username = await getUsernameFromAuth(req);

    if (!email && !username) {
      return [];
    }

    const m2mToken = await generateM2MToken(req);
    const headers = { Authorization: `Bearer ${m2mToken}` };
    const occurrenceIds = new Set<string>();

    if (email) {
      const emailParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          { v: '1', type: 'v1_past_meeting_participant', tags: `email:${email}`, ...(pageToken && { page_token: pageToken }) },
          undefined,
          headers
        )
      ).catch(() => []);
      emailParticipants.forEach((p) => p.meeting_and_occurrence_id && occurrenceIds.add(p.meeting_and_occurrence_id));
    }

    if (username) {
      const plainUsername = stripAuthPrefix(username);
      const usernameParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          { v: '1', type: 'v1_past_meeting_participant', tags: `username:${plainUsername}`, ...(pageToken && { page_token: pageToken }) },
          undefined,
          headers
        )
      ).catch(() => []);
      usernameParticipants.forEach((p) => p.meeting_and_occurrence_id && occurrenceIds.add(p.meeting_and_occurrence_id));
    }

    return [...occurrenceIds];
  }

  /**
   * Gets all unique meeting IDs the user is registered for by querying registrant records
   * Checks both email and username (fallback) to find all registrations.
   * M2M token required: registrant queries search across all registrants in the index,
   * which requires application-level credentials (user tokens lack cross-registrant read access)
   * @param req - Express request object
   * @param email - Optional user email address; if omitted, only username lookup is performed
   * @returns Set of meeting IDs the user is registered for
   */
  public async getUserRegisteredMeetingIds(req: Request, email?: string): Promise<Set<string>> {
    const normalizedEmail = email?.toLowerCase() ?? '';

    const m2mToken = await generateM2MToken(req);
    const headers = { Authorization: `Bearer ${m2mToken}` };

    const meetingIds = new Set<string>();

    // Query registrants by email (only if email is available)
    if (normalizedEmail) {
      logger.debug(req, 'get_user_registered_meeting_ids', 'Fetching registrants by email', { email: normalizedEmail });

      const emailRegistrants = await fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'v1_meeting_registrant',
            parent: '',
            tags: `email:${normalizedEmail}`,
            page_size: 100,
            ...(pageToken && { page_token: pageToken }),
          },
          undefined,
          headers
        )
      );

      for (const r of emailRegistrants) {
        meetingIds.add(r.meeting_id);
      }
    }

    // Also try username-based lookup (fallback for cases where email doesn't match)
    const username = await getUsernameFromAuth(req);
    if (username) {
      const plainUsername = stripAuthPrefix(username);

      logger.debug(req, 'get_user_registered_meeting_ids', 'Fetching registrants by username', { username: plainUsername });

      const usernameRegistrants = await fetchAllQueryResources<MeetingRegistrant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'v1_meeting_registrant',
            parent: '',
            tags: `username:${plainUsername}`,
            page_size: 100,
            ...(pageToken && { page_token: pageToken }),
          },
          undefined,
          headers
        )
      );

      for (const r of usernameRegistrants) {
        meetingIds.add(r.meeting_id);
      }
    }

    logger.debug(req, 'get_user_registered_meeting_ids', 'Collected unique meeting IDs', {
      total_unique_meeting_ids: meetingIds.size,
    });

    return meetingIds;
  }

  /**
   * Fetches resources by ID in parallel, filters by project, and applies limit.
   * Shared by getUserMeetings and getUserPastMeetings.
   */
  private async fetchByIdFilterAndLimit<T extends { id: string; project_uid?: string }>(
    req: Request,
    ids: string[] | Set<string>,
    endpoint: string,
    operation: string,
    projectUid?: string,
    limit?: number,
    projectUids?: Set<string>
  ): Promise<T[]> {
    const results: T[] = [];

    const fetches = Array.from(ids).map(async (id) => {
      try {
        const resource = await this.microserviceProxy.proxyRequest<T>(req, 'LFX_V2_SERVICE', `${endpoint}/${id}`, 'GET');
        resource.id = resource.id || id;
        return resource;
      } catch (error) {
        logger.warning(req, operation, 'Skipping resource — upstream fetch failed', {
          resource_id: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    });

    for (const result of await Promise.all(fetches)) {
      if (result !== null) {
        results.push(result);
      }
    }

    let filtered = results;
    if (projectUid) {
      filtered = filtered.filter((r) => r.project_uid === projectUid);
    } else if (projectUids && projectUids.size > 0) {
      filtered = filtered.filter((r) => r.project_uid !== undefined && projectUids.has(r.project_uid));
    }

    logger.debug(req, operation, 'Filtered results', {
      total_fetched: results.length,
      filtered: filtered.length,
      project_uid: projectUid ?? 'all',
      foundation_filter: projectUids ? projectUids.size : 0,
    });

    if (limit !== undefined && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

    return filtered;
  }

  /**
   * Get pending actions for board member persona
   * Fetches surveys from Snowflake and user-specific meetings from LFX microservice
   */
  private async getBoardMemberActions(req: Request, email: string, projectSlug: string, projectUid: string): Promise<PendingActionItem[]> {
    // Fetch surveys and user-specific meetings in parallel
    const [surveys, meetings] = await Promise.all([
      this.projectService.getPendingActionSurveys(email, projectSlug).catch((error) => {
        logger.warning(req, 'get_board_member_actions', 'Failed to fetch surveys for pending actions', { err: error });
        return [];
      }),

      this.getUserMeetings(req, email, projectUid).catch((error) => {
        logger.warning(req, 'get_board_member_actions', 'Failed to fetch user meetings for pending actions', { err: error });
        return [];
      }),
    ]);

    // Filter to board meetings only, then transform to actions (within 2 weeks)
    const boardMeetings = meetings.filter((m) => m.meeting_type?.toLowerCase() === 'board');
    const meetingActions = this.transformMeetingsToActions(boardMeetings);

    return [...surveys, ...meetingActions];
  }

  /**
   * Transform meetings within 2 weeks to pending action items
   * Only includes meetings that haven't ended yet (accounting for duration + buffer)
   */
  private transformMeetingsToActions(meetings: Meeting[]): PendingActionItem[] {
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + this.twoWeeksMs);
    const actions: PendingActionItem[] = [];

    for (const meeting of meetings) {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        // Filter active occurrences (not cancelled)
        const activeOccurrences = meeting.occurrences.filter((occ) => occ.status !== 'cancel');

        for (const occurrence of activeOccurrences) {
          const startTime = new Date(occurrence.start_time);
          // Parse duration handling both string and number types (v1 meetings return strings)
          const durationMinutes = parseToInt(occurrence.duration) ?? parseToInt(meeting.duration) ?? 0;
          // Calculate meeting end time + buffer
          const meetingEndWithBuffer = new Date(startTime.getTime() + (durationMinutes + this.bufferMinutes) * 60 * 1000);

          // Only include if meeting hasn't ended (with buffer) and is within 2 weeks
          if (now < meetingEndWithBuffer && startTime <= twoWeeksFromNow) {
            actions.push(this.createMeetingAction(meeting, occurrence));
          }
        }
      } else {
        const startTime = new Date(meeting.start_time);
        // Parse duration handling both string and number types (v1 meetings return strings)
        const durationMinutes = parseToInt(meeting.duration) ?? 0;
        // Calculate meeting end time + buffer
        const meetingEndWithBuffer = new Date(startTime.getTime() + (durationMinutes + this.bufferMinutes) * 60 * 1000);

        // Only include if meeting hasn't ended (with buffer) and is within 2 weeks
        if (now < meetingEndWithBuffer && startTime <= twoWeeksFromNow) {
          actions.push(this.createMeetingAction(meeting));
        }
      }
    }

    return actions;
  }

  /**
   * Create a PendingActionItem from a meeting
   */
  private createMeetingAction(meeting: Meeting, occurrence?: MeetingOccurrence): PendingActionItem {
    const startTime = occurrence ? new Date(occurrence.start_time) : new Date(meeting.start_time);
    const title = occurrence?.title || meeting.title;

    const dateStr = startTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    // Format date with time for display below title
    const formattedDate = startTime.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

    const params = new URLSearchParams();
    if (meeting.password) params.set('password', meeting.password);
    const queryString = params.toString();
    const buttonLink = queryString ? `/meetings/${meeting.id}?${queryString}` : `/meetings/${meeting.id}`;

    return {
      type: 'Review Agenda',
      badge: dateStr,
      text: `Review ${title} Agenda and Materials`,
      icon: 'fa-light fa-calendar-check',
      severity: 'warn',
      buttonText: 'Review Agenda',
      buttonLink,
      date: formattedDate,
    };
  }

  /**
   * Send user metadata update request via NATS
   * @private
   */
  private async sendUserMetadataUpdate(req: Request, request: UserMetadataUpdateRequest): Promise<UserMetadataUpdateResponse> {
    const codec = this.natsService.getCodec();
    const startTime = logger.startOperation(req, 'send_user_metadata_update', { username: request.username });

    try {
      logger.debug(req, 'send_user_metadata_update', 'Sending user metadata update request via NATS', {
        username: request.username,
      });

      const requestPayload = JSON.stringify(request);
      const response = await this.natsService.request(NatsSubjects.USER_METADATA_UPDATE, codec.encode(requestPayload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseData = codec.decode(response.data);
      const parsedResponse: UserMetadataUpdateResponse = JSON.parse(responseData);

      // Check if the response indicates success
      if (!parsedResponse.success) {
        logger.warning(req, 'send_user_metadata_update', 'User metadata update failed via NATS', {
          username: request.username,
          error: parsedResponse.error,
          message: parsedResponse.message,
        });
        return parsedResponse;
      }

      logger.success(req, 'send_user_metadata_update', startTime, {
        username: request.username,
        updated_fields: parsedResponse.updated_fields,
      });

      return parsedResponse;
    } catch (error) {
      logger.error(req, 'send_user_metadata_update', startTime, error, {
        username: request.username,
      });

      // If it's a timeout or no responder error, return appropriate response
      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          username: request.username,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the authentication service. Please try again later.',
        };
      }

      // For other errors, return a generic error response
      return {
        success: false,
        username: request.username,
        error: 'Internal server error',
        message: 'An unexpected error occurred while updating user metadata.',
      };
    }
  }
}
