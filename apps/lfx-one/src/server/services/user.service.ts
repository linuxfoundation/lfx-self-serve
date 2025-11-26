// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_QUERY_PARAMS, NATS_CONFIG } from '@lfx-one/shared/constants';
import { MeetingVisibility, NatsSubjects } from '@lfx-one/shared/enums';
import {
  ActiveWeeksStreakResponse,
  ActiveWeeksStreakRow,
  Meeting,
  MeetingOccurrence,
  MeetingRegistrant,
  PendingActionItem,
  PersonaType,
  ProjectCountRow,
  ProjectItem,
  QueryServiceResponse,
  UserCodeCommitsResponse,
  UserCodeCommitsRow,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserMetadataUpdateResponse,
  UserProjectActivityRow,
  UserProjectsResponse,
  UserPullRequestsResponse,
  UserPullRequestsRow,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { serverLogger } from '../server';
import { generateM2MToken } from '../utils/m2m-token.util';
import { ApiClientService } from './api-client.service';
import { MeetingService } from './meeting.service';
import { NatsService } from './nats.service';
import { ProjectService } from './project.service';
import { SnowflakeService } from './snowflake.service';

/**
 * Service for handling user-related operations and user analytics
 */
export class UserService {
  private apiClientService: ApiClientService;
  private natsService: NatsService;
  private snowflakeService: SnowflakeService;
  private meetingService: MeetingService;
  private projectService: ProjectService;

  private readonly twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

  public constructor() {
    this.apiClientService = new ApiClientService();
    this.natsService = new NatsService();
    this.snowflakeService = new SnowflakeService();
    this.meetingService = new MeetingService();
    this.projectService = new ProjectService();
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
    const codec = this.natsService.getCodec();

    try {
      req.log.info({ userArgProvided: !!userArg }, 'Fetching user metadata via NATS');

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

      return userMetadata;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw error;
      }

      req.log.error({ err: error, userArgProvided: !!userArg }, 'Failed to fetch user metadata via NATS');

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
    try {
      // Validate required fields
      if (!updates.username) {
        throw new Error('Username is required');
      }

      if (!updates.token) {
        throw new Error('Authentication token is required');
      }

      // Log the update attempt
      req.log.info(
        {
          has_username: !!updates.username,
          has_metadata: !!updates.user_metadata,
          metadata_fields: updates.user_metadata ? Object.keys(updates.user_metadata) : [],
        },
        'Attempting to update user metadata'
      );

      // Send the request via NATS
      const response = await this.sendUserMetadataUpdate(updates);

      // Log the result
      if (response.success) {
        req.log.info(
          {
            username: updates.username,
            updated_fields: response.updated_fields,
          },
          'User metadata updated successfully'
        );
      } else {
        req.log.error(
          {
            username: updates.username,
            error: response.error,
            message: response.message,
          },
          'Failed to update user metadata'
        );
      }

      return response;
    } catch (error) {
      req.log.error(
        {
          username: updates.username,
          err: error,
        },
        'Error in user metadata update service'
      );

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
    serverLogger.info('Shutting down user service');
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
      FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM_LFX_ONE.ACTIVE_WEEKS_STREAK
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
   * Get user's projects with activity data for the last 30 days
   * @param page - Page number (1-indexed)
   * @param limit - Number of projects per page
   * @returns Paginated projects with activity data
   */
  public async getMyProjects(page: number, limit: number): Promise<UserProjectsResponse> {
    const offset = (page - 1) * limit;

    // First, get total count of unique projects
    const countQuery = `
      SELECT COUNT(DISTINCT PROJECT_ID) as TOTAL_PROJECTS
      FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY
      WHERE ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
    `;

    const countResult = await this.snowflakeService.execute<ProjectCountRow>(countQuery, []);
    const totalProjects = countResult.rows[0]?.TOTAL_PROJECTS || 0;

    // If no projects found, return empty response
    if (totalProjects === 0) {
      return {
        data: [],
        totalProjects: 0,
      };
    }

    // Get paginated projects with all their activity data
    // Use CTE to first get paginated project list, then join for activity data
    const query = `
      WITH PaginatedProjects AS (
        SELECT DISTINCT PROJECT_ID, PROJECT_NAME, PROJECT_SLUG
        FROM ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY
        WHERE ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
        ORDER BY PROJECT_NAME, PROJECT_ID
        LIMIT ? OFFSET ?
      )
      SELECT
        p.PROJECT_ID,
        p.PROJECT_NAME,
        p.PROJECT_SLUG,
        a.ACTIVITY_DATE,
        a.DAILY_TOTAL_ACTIVITIES,
        a.DAILY_CODE_ACTIVITIES,
        a.DAILY_NON_CODE_ACTIVITIES
      FROM PaginatedProjects p
      JOIN ANALYTICS_DEV.DEV_JEVANS_PLATINUM.PROJECT_CODE_ACTIVITY a
        ON p.PROJECT_ID = a.PROJECT_ID
      WHERE a.ACTIVITY_DATE >= DATEADD(DAY, -30, CURRENT_DATE())
      ORDER BY p.PROJECT_NAME, p.PROJECT_ID, a.ACTIVITY_DATE ASC
    `;

    const result = await this.snowflakeService.execute<UserProjectActivityRow>(query, [limit, offset]);

    // Group rows by PROJECT_ID and transform into ProjectItem[]
    const projectsMap = new Map<string, ProjectItem>();

    for (const row of result.rows) {
      if (!projectsMap.has(row.PROJECT_ID)) {
        // Initialize new project with placeholder values
        projectsMap.set(row.PROJECT_ID, {
          name: row.PROJECT_NAME,
          logo: undefined, // Component will show default icon
          role: 'Member', // Placeholder
          affiliations: [], // Placeholder
          codeActivities: [],
          nonCodeActivities: [],
          status: 'active', // Placeholder
        });
      }

      // Add daily activity values to arrays
      const project = projectsMap.get(row.PROJECT_ID)!;
      project.codeActivities.push(row.DAILY_CODE_ACTIVITIES);
      project.nonCodeActivities.push(row.DAILY_NON_CODE_ACTIVITIES);
    }

    // Convert map to array
    const projects = Array.from(projectsMap.values());

    return {
      data: projects,
      totalProjects,
    };
  }

  /**
   * Get all pending actions for a user based on persona
   * @param req - Express request object
   * @param persona - User persona type (board-member, maintainer, core-developer)
   * @param projectUid - Project UID for filtering
   * @param email - User email
   * @param projectSlug - Project slug for survey filtering
   * @returns Array of pending action items
   */
  public async getPendingActions(req: Request, persona: PersonaType, projectUid: string, email: string, projectSlug: string): Promise<PendingActionItem[]> {
    if (persona === 'board-member') {
      return this.getBoardMemberActions(req, email, projectSlug, projectUid);
    }
    // Future personas: maintainer, core-developer can be added here
    return [];
  }

  /**
   * Fetches all meetings for the current user filtered by project
   * Gets meetings the user has access to, then filters public meetings by registration status
   * @param req - Express request object
   * @param email - User's email address for registration check
   * @param projectUid - Project UID to filter meetings by
   * @returns Array of Meeting objects the user is registered for or has access to
   */
  public async getUserMeetings(req: Request, email: string, projectUid: string, query: Record<string, any>): Promise<Meeting[]> {
    try {
      // Step 1: Get all meetings the user has access to, filtered by project
      const meetings = await this.meetingService.getMeetings(req, query, 'meeting', false);

      req.log.info(
        {
          operation: 'get_user_meetings',
          project_uid: projectUid,
          total_accessible_meetings: meetings.length,
        },
        'Fetched all accessible meetings for user'
      );

      if (meetings.length === 0) {
        return [];
      }

      // Step 2: Separate public and private meetings
      const publicMeetings = meetings.filter((m) => m.visibility === MeetingVisibility.PUBLIC);
      const privateMeetings = meetings.filter((m) => m.visibility !== MeetingVisibility.PUBLIC);

      req.log.debug(
        {
          operation: 'get_user_meetings',
          public_meetings: publicMeetings.length,
          private_meetings: privateMeetings.length,
        },
        'Separated meetings by visibility'
      );

      // Step 3: For public meetings, check if user is registered using M2M token
      let filteredPublicMeetings: Meeting[] = [];

      if (publicMeetings.length > 0) {
        const m2mToken = await generateM2MToken(req);
        const baseUrl = process.env['LFX_V2_SERVICE'] || 'http://lfx-api.k8s.orb.local';

        // Check registration status for each public meeting in parallel
        const registrationChecks = await Promise.all(
          publicMeetings.map(async (meeting) => {
            try {
              const query = {
                v: 1,
                type: 'meeting_registrant',
                parent: `meeting:${meeting.uid}`,
                tags: `email:${email}`,
                ...DEFAULT_QUERY_PARAMS,
              };

              const response = await this.apiClientService.request<QueryServiceResponse<MeetingRegistrant>>(
                'GET',
                `${baseUrl}/query/resources`,
                m2mToken,
                query
              );

              // If resources array has items, user is registered
              const isRegistered = response.data.resources && response.data.resources.length > 0;

              req.log.debug(
                {
                  operation: 'get_user_meetings',
                  meeting_uid: meeting.uid,
                  is_registered: isRegistered,
                },
                'Checked user registration for public meeting'
              );

              return isRegistered ? meeting : null;
            } catch (error) {
              req.log.warn(
                {
                  operation: 'get_user_meetings',
                  meeting_uid: meeting.uid,
                  err: error,
                },
                'Failed to check registration for public meeting, excluding from results'
              );
              return null;
            }
          })
        );

        filteredPublicMeetings = registrationChecks.filter((m): m is Meeting => m !== null);
      }

      // Step 4: Combine private meetings (user has access = implicitly allowed) with filtered public meetings
      const result = [...privateMeetings, ...filteredPublicMeetings];

      req.log.info(
        {
          operation: 'get_user_meetings',
          private_meetings_count: privateMeetings.length,
          filtered_public_meetings_count: filteredPublicMeetings.length,
          total_result_count: result.length,
        },
        'User meetings retrieved successfully'
      );

      return result;
    } catch (error) {
      req.log.error(
        {
          operation: 'get_user_meetings',
          err: error,
          project_uid: projectUid,
        },
        'Failed to get user meetings'
      );
      throw error;
    }
  }

  /**
   * Get pending actions for board member persona
   * Fetches surveys from Snowflake and user-specific meetings from LFX microservice
   */
  private async getBoardMemberActions(req: Request, email: string, projectSlug: string, projectUid: string): Promise<PendingActionItem[]> {
    // Fetch surveys and user-specific meetings in parallel
    const [surveys, meetings] = await Promise.all([
      this.projectService.getPendingActionSurveys(email, projectSlug).catch((error) => {
        req.log.warn({ err: error }, 'Failed to fetch surveys for pending actions');
        return [];
      }),

      this.getUserMeetings(req, email, projectUid, { tags_all: [`project_uid:${projectUid}`, 'meeting_type:Board'] }).catch((error) => {
        req.log.warn({ err: error }, 'Failed to fetch user meetings for pending actions');
        return [];
      }),
    ]);

    // Transform meetings to actions (within 2 weeks)
    const meetingActions = this.transformMeetingsToActions(meetings);

    return [...surveys, ...meetingActions];
  }

  /**
   * Transform meetings within 2 weeks to pending action items
   */
  private transformMeetingsToActions(meetings: Meeting[]): PendingActionItem[] {
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + this.twoWeeksMs);
    const actions: PendingActionItem[] = [];

    for (const meeting of meetings) {
      if (meeting.occurrences && meeting.occurrences.length > 0) {
        // Filter active occurrences (not cancelled)
        const activeOccurrences = meeting.occurrences.filter((occ) => !occ.is_cancelled);

        for (const occurrence of activeOccurrences) {
          const startTime = new Date(occurrence.start_time);
          if (startTime >= now && startTime <= twoWeeksFromNow) {
            actions.push(this.createMeetingAction(meeting, occurrence));
          }
        }
      } else {
        const startTime = new Date(meeting.start_time);
        if (startTime >= now && startTime <= twoWeeksFromNow) {
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

    const buttonLink = meeting.password ? `/meetings/${meeting.uid}?password=${meeting.password}` : `/meetings/${meeting.uid}`;

    return {
      type: 'Review Minutes',
      badge: dateStr,
      text: `Review ${title} Agenda and Materials`,
      icon: 'fa-light fa-calendar-check',
      color: 'amber',
      buttonText: 'Review Agenda',
      buttonLink,
    };
  }

  /**
   * Send user metadata update request via NATS
   * @private
   */
  private async sendUserMetadataUpdate(request: UserMetadataUpdateRequest): Promise<UserMetadataUpdateResponse> {
    const codec = this.natsService.getCodec();

    try {
      serverLogger.info({ username: request.username }, 'Sending user metadata update request via NATS');

      const requestPayload = JSON.stringify(request);
      const response = await this.natsService.request(NatsSubjects.USER_METADATA_UPDATE, codec.encode(requestPayload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseData = codec.decode(response.data);
      const parsedResponse: UserMetadataUpdateResponse = JSON.parse(responseData);

      // Check if the response indicates success
      if (!parsedResponse.success) {
        serverLogger.error(
          {
            username: request.username,
            error: parsedResponse.error,
            message: parsedResponse.message,
          },
          'User metadata update failed via NATS'
        );
        return parsedResponse;
      }

      serverLogger.info(
        {
          username: request.username,
          updated_fields: parsedResponse.updated_fields,
        },
        'Successfully updated user metadata via NATS'
      );

      return parsedResponse;
    } catch (error) {
      serverLogger.error(
        {
          err: error,
          username: request.username,
        },
        'Failed to update user metadata via NATS'
      );

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
