// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG, ROOT_PROJECT_SLUG } from '@lfx-one/shared/constants';
import { NatsSubjects, PollStatus } from '@lfx-one/shared/enums';
import {
  ActiveWeeksStreakResponse,
  ActiveWeeksStreakRow,
  ApiGatewayUserProfile,
  Meeting,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeeting,
  PastMeetingParticipant,
  PendingActionItem,
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
  Vote,
} from '@lfx-one/shared/interfaces';
import { getCurrentOrNextOccurrence, hasMeetingEnded, parseToInt } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MicroserviceError, ResourceNotFoundError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
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

    // Convert map to array; ROOT is an administrative pseudo-project used only for persona
    // detection and must never surface in user-facing project lists.
    const projects = Array.from(projectsMap.values()).filter((p) => p.slug !== ROOT_PROJECT_SLUG);

    return {
      data: projects,
      totalProjects: projects.length,
    };
  }

  /**
   * Get all pending actions for the authenticated user across every persona. A pending action
   * is a pending action regardless of which dashboard the user is viewing — the board-only
   * scoping in the earlier implementation was an MVP artifact, not a principled design choice.
   * @param req - Express request object
   * @param projectUid - Project UID for filtering
   * @param email - User email
   * @param projectSlug - Project slug for survey filtering
   * @param limit - Optional cap on the response size (aggregator still runs in full;
   *   this just shrinks the payload for callers that only need a top-N view)
   * @returns Array of pending action items
   */
  public async getPendingActions(req: Request, projectUid: string, email: string, projectSlug: string, limit?: number): Promise<PendingActionItem[]> {
    const actions = await this.getUserPendingActions(req, email, projectSlug, projectUid);
    return limit && limit > 0 && actions.length > limit ? actions.slice(0, limit) : actions;
  }

  /**
   * Fetches meetings for the current user, optionally filtered by project.
   * Uses the query service's `filter_grants=direct` parameter: the query service performs
   * an FGA `lfx.access_check.read_tuples` lookup server-side using the user's bearer token,
   * extracts the user's direct tuple `object_ref` values, and injects a `terms` filter on
   * `object_ref` into OpenSearch. Past meetings are dropped client-side because
   * `last_end_time` is indexed as an epoch integer, not an ISO date, so the query
   * service's `date_from` range filter compares strings lexically and drops valid rows.
   * @param req - Express request object
   * @param projectUid - Optional project UID to filter meetings by
   * @param foundationUid - Optional foundation UID to filter meetings by (OR across child projects)
   * @returns Array of Meeting objects the user has some direct FGA grant on
   */
  public async getUserMeetings(req: Request, projectUid?: string, foundationUid?: string): Promise<Meeting[]> {
    // .catch — a foundation lookup failure degrades to an empty scope (caught by the empty-set
    // guard below), preventing a NATS/upstream blip from 500'ing the Me lens.
    const foundationProjectUids = foundationUid
      ? await this.projectService
          .getFoundationProjectUids(req, foundationUid)
          .then((uids) => new Set(uids))
          .catch((error) => {
            logger.warning(req, 'get_user_meetings', 'Foundation project lookup failed, treating as empty scope', { err: error });
            return new Set<string>();
          })
      : undefined;

    logger.debug(req, 'get_user_meetings', 'Fetching user meetings via filter_grants=direct', {
      has_project_filter: !!projectUid,
      has_foundation_filter: !!foundationUid,
    });

    // Foundation filter requested but resolved to zero child projects: return empty rather than
    // let buildProjectScopeFilters return `{}` and collapse to unfiltered (global) scope.
    if (foundationUid && foundationProjectUids !== undefined && foundationProjectUids.size === 0) {
      logger.debug(req, 'get_user_meetings', 'Foundation scope resolved to empty set, returning empty meeting list', {
        foundation_uid: foundationUid,
      });
      return [];
    }

    const projectFilterParams = this.buildProjectScopeFilters(projectUid, foundationProjectUids);

    // failOnPartial: true — completeness matters for membership correctness. Outer .catch is a
    // defensive guard so upstream failures don't 500 the Me lens; returning [] is graceful.
    const meetings = await fetchAllQueryResources<Meeting>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<Meeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'v1_meeting',
          filter_grants: 'direct',
          page_size: 500,
          ...projectFilterParams,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    ).catch((error) => {
      logger.warning(req, 'get_user_meetings', 'Query service fetch failed, returning empty meeting list', {
        err: error,
      });
      return [] as Meeting[];
    });

    logger.debug(req, 'get_user_meetings', 'Fetched meetings from query service', { count: meetings.length });

    // Enrich each meeting with the current user's RSVP (null when no response). Reuses the same
    // query-service pattern that powers `getUserPendingActions` → `transformMissingRsvpsToActions`.
    // Wrapped in try/catch so an RSVP-lookup failure degrades gracefully: meetings still return,
    // `my_rsvp` stays undefined per row, the dashboard doesn't 500, and the Pending RSVP filter
    // chip just shows the unfiltered list.
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req) ?? '';

    if ((email || username) && meetings.length > 0) {
      try {
        const [userRsvps, activeRegistrantIds] = await Promise.all([
          this.fetchAllUserRsvps(req, email, username),
          this.fetchUserActiveRegistrantIds(req, email, username),
        ]);

        // Strongest-response-wins (accepted/declined beats maybe beats nothing) — same logic as
        // `transformMissingRsvpsToActions`. Drop RSVPs whose `registrant_id` isn't in the active
        // set; otherwise stale RSVPs from removed registrations would falsely mark meetings as
        // "responded".
        const rsvpByMeeting = new Map<string, MeetingRsvp>();
        for (const rsvp of userRsvps) {
          if (!rsvp.meeting_id) continue;
          if (!rsvp.registrant_id || !activeRegistrantIds.has(rsvp.registrant_id)) continue;
          const existing = rsvpByMeeting.get(rsvp.meeting_id);
          if (!existing || (existing.response_type === 'maybe' && rsvp.response_type !== 'maybe')) {
            rsvpByMeeting.set(rsvp.meeting_id, rsvp);
          }
        }

        for (const meeting of meetings) {
          if (meeting.id) {
            meeting.my_rsvp = rsvpByMeeting.get(meeting.id) ?? null;
          }
        }
      } catch (error) {
        logger.warning(req, 'get_user_meetings', 'RSVP enrichment failed, continuing without my_rsvp', {
          err: error,
        });
      }
    }

    // Drop past meetings; recurring meetings survive if any occurrence is still active.
    const upcomingMeetings = meetings.filter((meeting) => {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        return meeting.occurrences.some((occurrence) => occurrence.status !== 'cancel' && !hasMeetingEnded(meeting, occurrence));
      }
      return !hasMeetingEnded(meeting);
    });

    // Sort by the next active occurrence so recurring meetings — whose meeting.start_time is the
    // series start (often in the past) — are ordered by when the user will actually attend next.
    // Query service sort enum doesn't cover occurrence semantics, so sort client-side.
    const sortedMeetings = [...upcomingMeetings].sort((a, b) => {
      const occurrenceA = getCurrentOrNextOccurrence(a);
      const occurrenceB = getCurrentOrNextOccurrence(b);
      const timeA = occurrenceA ? new Date(occurrenceA.start_time).getTime() : new Date(a.start_time).getTime();
      const timeB = occurrenceB ? new Date(occurrenceB.start_time).getTime() : new Date(b.start_time).getTime();
      return timeA - timeB;
    });

    const enriched = await this.meetingService.getMeetingProjectName(req, sortedMeetings);

    // Every result has a direct host or participant FGA tuple, so the user is invited by definition.
    const invited = enriched.map((m) => ({ ...m, invited: true }));

    return this.accessCheckService.addAccessToResources(req, invited, 'v1_meeting', 'organizer');
  }

  /**
   * Fetches past meetings for the current user, optionally filtered by project.
   * Uses the query service's `filter_grants=direct` parameter to let the query service perform
   * an FGA `lfx.access_check.read_tuples` lookup server-side using the user's bearer token and
   * inject a `terms` filter on `object_ref` into OpenSearch. Runs the participant scan in
   * parallel with the meeting fetch — participant data is used only for `user_attended`
   * enrichment (FGA tuples don't carry attendance).
   * @param req - Express request object
   * @param email - User's email address for participant lookup (attendance enrichment)
   * @param projectUid - Optional project UID to filter meetings by
   * @param foundationUid - Optional foundation UID to filter meetings by (OR across child projects)
   * @returns Array of PastMeeting objects the user has some direct FGA grant on
   */
  public async getUserPastMeetings(req: Request, email: string, projectUid?: string, foundationUid?: string): Promise<PastMeeting[]> {
    logger.debug(req, 'get_user_past_meetings', 'Fetching user past meetings via filter_grants=direct', {
      has_project_filter: !!projectUid,
      has_foundation_filter: !!foundationUid,
    });

    const normalizedEmail = email.toLowerCase();
    const username = await getUsernameFromAuth(req);

    const filtersOr: string[] = [];
    if (normalizedEmail) filtersOr.push(`email:${normalizedEmail}`);
    if (username) filtersOr.push(`username:${stripAuthPrefix(username)}`);

    // Participant scan sources `is_attended` for `user_attended` enrichment — FGA tuples don't
    // carry attendance, so this lookup is independent of the meeting fetch. failOnPartial: true
    // surfaces truncated sets; outer .catch degrades gracefully so a failure here drops attendance
    // data without 500'ing the Me lens.
    // `loaded` distinguishes "scan succeeded, user wasn't a participant" (loaded:true → attended:false is correct)
    // from "couldn't determine attendance" (loaded:false → attended:undefined so UI can show 'unknown').
    const participantQuery: Promise<{ participants: PastMeetingParticipant[]; loaded: boolean }> =
      filtersOr.length > 0
        ? fetchAllQueryResources<PastMeetingParticipant>(
            req,
            (pageToken) =>
              this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
                type: 'v1_past_meeting_participant',
                filters_or: filtersOr,
                page_size: 500,
                ...(pageToken && { page_token: pageToken }),
              }),
            { failOnPartial: true }
          )
            .then((participants) => ({ participants, loaded: true }))
            .catch((error) => {
              logger.warning(req, 'get_user_past_meetings', 'Participant query failed, continuing without attendance enrichment', {
                stage: 'participant_query',
                err: error,
              });
              return { participants: [] as PastMeetingParticipant[], loaded: false };
            })
        : Promise.resolve({ participants: [] as PastMeetingParticipant[], loaded: false });

    // .catch — same degrade-to-empty-scope pattern as getUserMeetings.
    const foundationQuery = foundationUid
      ? this.projectService
          .getFoundationProjectUids(req, foundationUid)
          .then((uids) => new Set(uids))
          .catch((error) => {
            logger.warning(req, 'get_user_past_meetings', 'Foundation project lookup failed, treating as empty scope', { err: error });
            return new Set<string>();
          })
      : Promise.resolve(undefined);

    // Past-meeting query depends on foundation UIDs to build `filters_or`, but it does NOT block
    // the participant scan — the scan runs concurrently with the foundation lookup + meeting fetch.
    const pastMeetingsQuery = foundationQuery.then((resolvedFoundationUids) => {
      // Foundation filter requested but resolved to zero child projects: short-circuit before the
      // helper collapses to unfiltered (global) scope.
      if (foundationUid && resolvedFoundationUids !== undefined && resolvedFoundationUids.size === 0) {
        return [] as PastMeeting[];
      }
      const projectFilterParams = this.buildProjectScopeFilters(projectUid, resolvedFoundationUids);

      return fetchAllQueryResources<PastMeeting>(
        req,
        (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeeting>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            type: 'v1_past_meeting',
            filter_grants: 'direct',
            page_size: 500,
            ...projectFilterParams,
            ...(pageToken && { page_token: pageToken }),
          }),
        { failOnPartial: true }
      ).catch((error) => {
        logger.warning(req, 'get_user_past_meetings', 'Past meeting query failed, returning empty list', {
          err: error,
        });
        return [] as PastMeeting[];
      });
    });

    const [{ participants, loaded: attendanceLoaded }, pastMeetings] = await Promise.all([participantQuery, pastMeetingsQuery]);

    // Drop any row missing meeting_and_occurrence_id — the meeting-service indexer populates it
    // for every v1_past_meeting, so a missing value signals a data-quality issue. Using the raw
    // `id` (past-meeting UUID) as a fallback would silently misroute downstream lookups that
    // expect the composite occurrence key.
    const indexable = pastMeetings.filter((m): m is PastMeeting & { meeting_and_occurrence_id: string } => !!m.meeting_and_occurrence_id);
    const droppedCount = pastMeetings.length - indexable.length;
    if (droppedCount > 0) {
      logger.warning(req, 'get_user_past_meetings', 'Dropped past meeting rows missing meeting_and_occurrence_id', {
        dropped: droppedCount,
        total: pastMeetings.length,
      });
    }

    // Normalize id to the composite meeting_and_occurrence_id so downstream callers
    // (e.g. getPastMeetingParticipants(req, meeting.id)) receive the expected key.
    const normalizedMeetings = indexable.map((m) => ({
      ...m,
      id: m.meeting_and_occurrence_id,
    }));

    logger.debug(req, 'get_user_past_meetings', 'Fetched past meetings from query service', {
      count: normalizedMeetings.length,
      participant_matches: participants.length,
    });

    if (normalizedMeetings.length === 0) {
      return [];
    }

    // Fold attendance from participant records. OR-combine across records — a user with multiple
    // participant rows for the same occurrence (re-joins, duplicate legacy data) is attended if
    // ANY record has is_attended=true. When the participant scan failed (or was skipped because
    // we have no user identity), leave user_attended undefined so the UI can distinguish "didn't
    // attend" from "attendance unknown".
    if (attendanceLoaded) {
      const userAttendedByOccurrenceId = new Map<string, boolean>();
      for (const p of participants) {
        if (!p.meeting_and_occurrence_id) continue;
        const prior = userAttendedByOccurrenceId.get(p.meeting_and_occurrence_id) ?? false;
        userAttendedByOccurrenceId.set(p.meeting_and_occurrence_id, prior || !!p.is_attended);
      }
      for (const meeting of normalizedMeetings) {
        meeting.user_attended = userAttendedByOccurrenceId.get(meeting.id) ?? false;
      }
    }

    // Sort by scheduled_start_time descending (most recent first)
    normalizedMeetings.sort((a, b) => new Date(b.scheduled_start_time ?? b.start_time).getTime() - new Date(a.scheduled_start_time ?? a.start_time).getTime());

    const enriched = await this.meetingService.getMeetingProjectName(req, normalizedMeetings);

    return this.accessCheckService.addAccessToResources(req, enriched, 'v1_past_meeting', 'organizer');
  }

  /**
   * Gets all unique past meeting occurrence IDs (meeting_and_occurrence_id) the user participated in.
   * Checks both email and username to find all participation records. Uses the user's bearer token;
   * the query service enforces ACL via the `viewer` relation on `v1_past_meeting`, which
   * `host`/`invitee`/`attendee` relations grant transitively.
   * @param req - Express request object
   * @returns Array of unique meeting_and_occurrence_id strings
   */
  public async getPastMeetingOccurrenceIds(req: Request): Promise<string[]> {
    const email = getEffectiveEmail(req) ?? undefined;
    const username = await getUsernameFromAuth(req);

    if (!email && !username) {
      return [];
    }

    const occurrenceIds = new Set<string>();

    if (email) {
      const emailParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          v: '1',
          type: 'v1_past_meeting_participant',
          tags: `email:${email}`,
          ...(pageToken && { page_token: pageToken }),
        })
      ).catch(() => []);
      emailParticipants.forEach((p) => p.meeting_and_occurrence_id && occurrenceIds.add(p.meeting_and_occurrence_id));
    }

    if (username) {
      const plainUsername = stripAuthPrefix(username);
      const usernameParticipants = await fetchAllQueryResources<PastMeetingParticipant>(req, (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<PastMeetingParticipant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          v: '1',
          type: 'v1_past_meeting_participant',
          tags: `username:${plainUsername}`,
          ...(pageToken && { page_token: pageToken }),
        })
      ).catch(() => []);
      usernameParticipants.forEach((p) => p.meeting_and_occurrence_id && occurrenceIds.add(p.meeting_and_occurrence_id));
    }

    return [...occurrenceIds];
  }

  /**
   * Gets all unique meeting IDs the user is registered for by querying registrant records.
   * Checks both email and username (fallback) to find all registrations. Uses the user's
   * bearer token — the query service enforces ACL (registrant records require `viewer` on
   * the parent meeting, which `host`/`participant` relations grant transitively).
   * @param req - Express request object
   * @param email - Optional user email address; if omitted, only username lookup is performed
   * @returns Set of meeting IDs the user is registered for
   */
  public async getUserRegisteredMeetingIds(req: Request, email?: string): Promise<Set<string>> {
    const normalizedEmail = email?.toLowerCase() ?? '';
    const username = await getUsernameFromAuth(req);

    const filtersOr: string[] = [];
    if (normalizedEmail) filtersOr.push(`email:${normalizedEmail}`);
    if (username) filtersOr.push(`username:${stripAuthPrefix(username)}`);

    if (filtersOr.length === 0) {
      return new Set();
    }

    // Match on data.email OR data.username in a single round trip. Using `filters_or` (field-level)
    // rather than `tags` keeps this resilient to indexer tag-synthesis changes.
    // failOnPartial: true surfaces truncated membership sets as errors; the outer .catch is kept
    // as a defensive guard so upstream failures don't 500 the Me lens dashboard, and logs at
    // warning level since returning an empty meeting ID set is graceful degradation.
    const registrants = await fetchAllQueryResources<MeetingRegistrant>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'v1_meeting_registrant',
          parent: '',
          filters_or: filtersOr,
          page_size: 500,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    ).catch((error) => {
      logger.warning(req, 'get_user_registered_meeting_ids', 'Registrant query failed, returning empty meeting ID set', {
        stage: 'registrant_query',
        err: error,
      });
      return [] as MeetingRegistrant[];
    });

    const meetingIds = new Set<string>();
    for (const r of registrants) meetingIds.add(r.meeting_id);

    logger.debug(req, 'get_user_registered_meeting_ids', 'Collected unique meeting IDs', {
      total_unique_meeting_ids: meetingIds.size,
    });

    return meetingIds;
  }

  /**
   * Fetches the current user's profile from the API Gateway (/user-service/v1/me).
   * Returns the Salesforce-backed user profile including the Salesforce record ID (ID field).
   * Used by downstream operations that require the user's Salesforce ID (e.g. visa and travel fund submissions).
   */
  public async getApiGatewayProfile(req: Request): Promise<ApiGatewayUserProfile> {
    if (!req.apiGatewayToken) {
      throw new MicroserviceError('API Gateway token not available — check API_GW_AUDIENCE env var and auth logs', 503, 'API_GATEWAY_UNAVAILABLE', {
        operation: 'get_api_gateway_profile',
        service: 'user_service',
      });
    }

    const apiGwAudience = process.env['API_GW_AUDIENCE'];

    if (!apiGwAudience) {
      throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
        operation: 'get_api_gateway_profile',
        service: 'user_service',
      });
    }

    logger.debug(req, 'get_api_gateway_profile', 'Calling API Gateway /user-service/v1/me');

    const apiGwBaseUrl = `${apiGwAudience.replace(/\/+$/, '')}/user-service`;
    const targetUrl = `${apiGwBaseUrl}/v1/me?basic=true`;

    const upstream = await fetch(targetUrl, {
      headers: { Authorization: `Bearer ${req.apiGatewayToken}` },
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      throw new MicroserviceError(`API Gateway returned ${upstream.status}`, upstream.status, 'API_GATEWAY_ERROR', {
        operation: 'get_api_gateway_profile',
        service: 'user_service',
      });
    }

    const rawBody = await upstream.text().catch(() => '');
    let profile: ApiGatewayUserProfile;

    try {
      profile = JSON.parse(rawBody) as ApiGatewayUserProfile;
    } catch {
      throw new MicroserviceError('API Gateway returned invalid JSON', 502, 'API_GATEWAY_INVALID_RESPONSE', {
        operation: 'get_api_gateway_profile',
        service: 'user_service',
        errorBody: rawBody.slice(0, 500),
      });
    }

    logger.debug(req, 'get_api_gateway_profile', 'API Gateway profile received', { salesforce_id: Boolean(profile.ID) });

    return profile;
  }

  /**
   * Builds query-service scoping params for a project or foundation. Exact `project_uid` match
   * when a single project is targeted, OR'd list across child project UIDs for a foundation.
   * Returns an empty object when neither is provided (global scope).
   */
  private buildProjectScopeFilters(projectUid?: string, foundationProjectUids?: Set<string>): Record<string, unknown> {
    if (projectUid) {
      return { filters: [`project_uid:${projectUid}`] };
    }
    if (foundationProjectUids && foundationProjectUids.size > 0) {
      return { filters_or: [...foundationProjectUids].map((uid) => `project_uid:${uid}`) };
    }
    return {};
  }

  /**
   * Aggregate pending actions for the current user within a project scope. Sources run in parallel
   * with per-source `.catch(() => [])` so one flaky source can't wipe the list:
   *   - Non-responded surveys (Snowflake)
   *   - Upcoming meetings within the next two weeks (Review Agenda action)
   *   - Active votes the user hasn't cast (Cast Vote action)
   *   - Missing or "maybe" RSVPs for meetings in the 2-week window (Set RSVP action)
   * No meeting-type filter — a working-group meeting next week is as much a pending action as
   * a board meeting.
   */
  private async getUserPendingActions(req: Request, email: string, projectSlug: string, projectUid: string): Promise<PendingActionItem[]> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;

    // Phase 1: surveys, meetings, and pending votes are independent — issue them in parallel.
    const [surveys, meetings, pendingVotes] = await Promise.all([
      this.projectService.getPendingActionSurveys(email, projectSlug).catch((error) => {
        logger.warning(req, 'get_user_pending_actions', 'Failed to fetch surveys for pending actions', { err: error });
        return [];
      }),

      this.getUserMeetings(req, projectUid).catch((error) => {
        logger.warning(req, 'get_user_pending_actions', 'Failed to fetch user meetings for pending actions', { err: error });
        return [] as Meeting[];
      }),

      this.fetchPendingVotes(req, email, username, projectUid).catch((error) => {
        logger.warning(req, 'get_user_pending_actions', 'Failed to fetch pending votes', { err: error });
        return [] as Vote[];
      }),
    ]);

    const inWindowMeetings = this.filterMeetingsInWindow(meetings);
    const meetingActions = this.transformMeetingsToActions(inWindowMeetings);
    const voteActions = this.transformVotesToActions(pendingVotes);

    // Phase 2: RSVP + registrant lookups are only meaningful when there are in-window meetings
    // to evaluate. Skip them otherwise — avoids two full paginated per-user scans per request
    // for users with no upcoming meetings in the window.
    //
    // Fail closed on the RSVP prerequisites: if either lookup errors, we can't distinguish
    // "user hasn't RSVPed" from "we don't know", and a transient failure must not turn every
    // in-window meeting into a bogus Set RSVP nag. Suppress the whole source on error.
    let rsvpActions: PendingActionItem[] = [];
    if (inWindowMeetings.length > 0) {
      try {
        const [userRsvps, activeRegistrantIds] = await Promise.all([
          this.fetchAllUserRsvps(req, email, username),
          this.fetchUserActiveRegistrantIds(req, email, username),
        ]);
        rsvpActions = this.transformMissingRsvpsToActions(inWindowMeetings, userRsvps, activeRegistrantIds);
      } catch (error) {
        logger.warning(req, 'get_user_pending_actions', 'RSVP prerequisite lookup failed, suppressing Set RSVP actions', { err: error });
      }
    }

    // Order by actionability: someone is waiting on RSVPs and votes have closing windows, so
    // those go first. Surveys are time-bounded by their cutoff. Review Agenda is informational
    // (read-before-meeting) and goes last — with the 5-item display cap, plentiful meetings
    // shouldn't crowd out the rows the user actually has to respond to.
    return [...rsvpActions, ...voteActions, ...surveys, ...meetingActions];
  }

  /**
   * Queries the `vote_response` index for this user's participation rows and returns the polls
   * they've been invited to but haven't submitted yet. `vote_response` is the real upstream
   * indexed type (`lfx.index.vote_response` from `lfx-v2-voting-service`) — the earlier
   * `individual_vote` type was fabricated in the shared interface and the query returned zero
   * rows in practice.
   *
   * ITX creates a `vote_response` record per invitee on poll initiation and stamps
   * `vote_status='submitted'` once the user actually casts. "Pending" is therefore:
   *   - `vote_status !== 'submitted'`  (not cast yet)
   *   - `!voter_removed`               (active invitation)
   *   - scoped to the current project
   * Then fetch the Vote details and keep only those still `active` with an `end_time` in the
   * future.
   */
  private async fetchPendingVotes(req: Request, email: string, username: string | null, projectUid: string): Promise<Vote[]> {
    const normalizedEmail = email ? email.trim().toLowerCase() : '';
    const orClauses: string[] = [];
    if (normalizedEmail) orClauses.push(`user_email:${normalizedEmail}`);
    if (username) orClauses.push(`username:${username}`);
    if (orClauses.length === 0) return [];

    interface VoteResponseRow {
      vote_uid?: string;
      vote_id?: string;
      poll_id?: string;
      project_uid?: string;
      vote_status?: string;
      voter_removed?: boolean;
    }

    // failOnPartial: completeness matters — a truncated response can silently miss a pending
    // invitation. The caller already catches and degrades, so fail closed here.
    const responses = await fetchAllQueryResources<VoteResponseRow>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<VoteResponseRow>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote_response',
          filters_or: orClauses,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    // `vote_uid` is the v2 parent poll UID (what `/votes/{uid}` expects); `poll_id` is the v1
    // fallback per the upstream indexer contract. Neither is the individual-response id.
    const pendingVoteUids = Array.from(
      new Set(
        responses
          .filter((r) => r.vote_status !== 'submitted' && !r.voter_removed && r.project_uid === projectUid)
          .map((r) => r.vote_uid ?? r.poll_id)
          .filter((uid): uid is string => !!uid)
      )
    );
    if (pendingVoteUids.length === 0) return [];

    const now = Date.now();
    const votes = await Promise.all(
      pendingVoteUids.map((uid) =>
        this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${uid}`, 'GET').catch((error) => {
          logger.warning(req, 'fetch_pending_votes', 'Failed to fetch vote details, skipping', {
            vote_uid: uid,
            err: error,
          });
          return null;
        })
      )
    );

    return votes.filter((v): v is Vote => v !== null && v.status === PollStatus.ACTIVE && !!v.end_time && new Date(v.end_time).getTime() > now);
  }

  /**
   * Fetch every `v1_meeting_rsvp` row for the current user. We don't try to narrow by
   * meeting_id on the server because `tags_or` isn't used elsewhere in this repo and the
   * query service may silently ignore it — filtering meeting-side in code is both reliable
   * and cheap at the typical per-user RSVP cardinality (dozens to low hundreds, paginated).
   */
  private async fetchAllUserRsvps(req: Request, email: string, username: string | null): Promise<MeetingRsvp[]> {
    const orClauses: string[] = [];
    if (email) orClauses.push(`email:${email.toLowerCase()}`);
    if (username) orClauses.push(`username:${username}`);
    if (orClauses.length === 0) return [];

    // failOnPartial: a truncated page set could silently miss an accepted RSVP and cause a
    // bogus Set RSVP action. Caller fails closed on any throw and suppresses the whole source.
    return fetchAllQueryResources<MeetingRsvp>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRsvp>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'v1_meeting_rsvp',
          filters_or: orClauses,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
  }

  /**
   * Fetch the UIDs of every currently-active registrant record for the current user. RSVP rows
   * persist from removed registrations, so we use the same guard as
   * `MeetingService.getMeetingRsvps`: keep only those RSVPs whose `registrant_id` matches an
   * active registrant. Otherwise an old accepted/declined RSVP from a removed registration
   * would incorrectly suppress a Set RSVP action for the user's current registration.
   */
  private async fetchUserActiveRegistrantIds(req: Request, email: string, username: string | null): Promise<Set<string>> {
    const orClauses: string[] = [];
    if (email) orClauses.push(`email:${email.toLowerCase()}`);
    if (username) orClauses.push(`username:${username}`);
    if (orClauses.length === 0) return new Set();

    // failOnPartial: a missing registrant UID here means an RSVP-guard lookup would wrongly
    // reject a still-active registrant's RSVP, which then fires a duplicate Set RSVP nag.
    const registrants = await fetchAllQueryResources<MeetingRegistrant>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'v1_meeting_registrant',
          filters_or: orClauses,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    return new Set(registrants.map((r) => r.uid).filter((uid): uid is string => !!uid));
  }

  /**
   * Narrow the meeting list to those with at least one active occurrence (or a single-occurrence
   * meeting) whose start falls inside the 2-week window and hasn't ended yet (with buffer).
   * Mirrors the filter inside `transformMeetingsToActions` so both derived sources (Review Agenda
   * actions and Set RSVP actions) operate on the exact same set of meetings.
   */
  private filterMeetingsInWindow(meetings: Meeting[]): Meeting[] {
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + this.twoWeeksMs);
    return meetings.filter((meeting) => {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        return meeting.occurrences.some((occ) => {
          if (occ.status === 'cancel') return false;
          const startTime = new Date(occ.start_time);
          const durationMinutes = parseToInt(occ.duration) ?? parseToInt(meeting.duration) ?? 0;
          const endWithBuffer = new Date(startTime.getTime() + (durationMinutes + this.bufferMinutes) * 60 * 1000);
          return now < endWithBuffer && startTime <= twoWeeksFromNow;
        });
      }
      const startTime = new Date(meeting.start_time);
      const durationMinutes = parseToInt(meeting.duration) ?? 0;
      const endWithBuffer = new Date(startTime.getTime() + (durationMinutes + this.bufferMinutes) * 60 * 1000);
      return now < endWithBuffer && startTime <= twoWeeksFromNow;
    });
  }

  /**
   * For each in-window meeting, emit a "Set RSVP" action when the user has no RSVP recorded or
   * the recorded RSVP is "maybe". Per-occurrence RSVPs count as a response for the series — a
   * user who has RSVPed any occurrence won't be nagged for a fresh top-level response.
   *
   * Before trusting an RSVP, require its `registrant_id` to be in the user's active registrant
   * set so historical RSVPs from removed registrations can't suppress a needed Set RSVP action
   * for the user's current registration.
   */
  private transformMissingRsvpsToActions(meetings: Meeting[], rsvps: MeetingRsvp[], activeRegistrantIds: Set<string>): PendingActionItem[] {
    if (meetings.length === 0) return [];

    const inWindowMeetingIds = new Set(meetings.map((m) => m.id).filter((id): id is string => !!id));

    // Keep the strongest signal per meeting: accepted/declined beats maybe beats nothing.
    const responseByMeeting = new Map<string, MeetingRsvp>();
    for (const rsvp of rsvps) {
      if (!rsvp.meeting_id || !inWindowMeetingIds.has(rsvp.meeting_id)) continue;
      if (!rsvp.registrant_id || !activeRegistrantIds.has(rsvp.registrant_id)) continue;
      const existing = responseByMeeting.get(rsvp.meeting_id);
      if (!existing || (existing.response_type === 'maybe' && rsvp.response_type !== 'maybe')) {
        responseByMeeting.set(rsvp.meeting_id, rsvp);
      }
    }

    const actions: PendingActionItem[] = [];
    for (const meeting of meetings) {
      if (!meeting.id) continue;
      const rsvp = responseByMeeting.get(meeting.id);
      if (rsvp && rsvp.response_type !== 'maybe') continue;
      actions.push(this.createRsvpAction(meeting));
    }
    return actions;
  }

  /**
   * Build a "Cast Vote" pending action per active vote. Links to the votes drawer on the
   * My Activity page where casting actually happens — there's no standalone vote-detail route.
   */
  private transformVotesToActions(votes: Vote[]): PendingActionItem[] {
    return votes.map((vote) => {
      const endDate = new Date(vote.end_time);
      const badge = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const formattedEnd = endDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      return {
        type: 'Cast Vote',
        badge,
        text: `Cast your vote on ${vote.name}`,
        icon: 'fa-regular fa-check-to-slot',
        severity: 'warn',
        buttonText: 'Cast Vote',
        buttonLink: '/my-activity',
        date: `Closes ${formattedEnd}`,
      };
    });
  }

  /**
   * Build a "Set RSVP" pending action for a single meeting. Links to the meeting detail page
   * where the RSVP UI lives; reuses the meeting password query param like `createMeetingAction`.
   *
   * For recurring series, `meeting.start_time` is the series start (often long past), so use
   * the current-or-next occurrence's start time for the badge and formatted date. Falls back
   * to `meeting.start_time` for single-occurrence meetings.
   */
  private createRsvpAction(meeting: Meeting): PendingActionItem {
    const nextOccurrence = getCurrentOrNextOccurrence(meeting);
    const startTime = new Date(nextOccurrence?.start_time ?? meeting.start_time);
    const badge = startTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
      type: 'Set RSVP',
      badge,
      text: `RSVP to ${meeting.title}`,
      icon: 'fa-regular fa-calendar-check',
      severity: 'warn',
      buttonText: 'Set RSVP',
      buttonLink,
      date: formattedDate,
    };
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
