// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid, Meeting } from '@lfx-one/shared';
import { MeetingVisibility, QueryServiceMeetingType } from '@lfx-one/shared/enums';
import { CreateMeetingRegistrantRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { AuthorizationError } from '../errors/authentication.error';
import { Logger } from '../helpers/logger';
import { addInvitedStatusToMeeting } from '../helpers/meeting.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { AccessCheckService } from '../services/access-check.service';
import { MeetingService } from '../services/meeting.service';
import { ProjectService } from '../services/project.service';
import { generateM2MToken } from '../utils/m2m-token.util';
import { validatePassword } from '../utils/security.util';

/**
 * Controller for handling public meeting HTTP requests (no authentication required)
 */
export class PublicMeetingController {
  private meetingService: MeetingService = new MeetingService();
  private projectService: ProjectService = new ProjectService();
  private accessCheckService: AccessCheckService = new AccessCheckService();
  /**
   * GET /public/api/meetings/:id
   * Retrieves a single meeting by ID without requiring authentication
   */
  // TODO(v1-migration): Remove V1 detection and handling once all meetings are migrated to V2
  public async getMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    let v1 = false; // Default to v2 meetings

    // Validate the meeting ID is a UUID -- if not, set v1 to true
    if (!isUuid(id)) {
      v1 = true;
    }

    const startTime = Logger.start(req, 'get_public_meeting_by_id', {
      meeting_uid: id,
      v1,
    });

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'get_public_meeting_by_id', req, next, startTime)) {
        return;
      }

      // Save the user's original token before setting M2M token
      const originalToken = req.bearerToken;

      // Generate M2M token once for all operations
      const m2mToken = await this.setupM2MToken(req);

      // Get the meeting by ID using M2M token
      Logger.start(req, 'get_public_meeting_by_id_fetch_meeting', { meeting_uid: id });
      let meeting = await this.fetchMeetingWithM2M(req, id, v1 ? 'v1_meeting' : 'meeting', m2mToken);
      if (!meeting) {
        // Log the error
        Logger.error(req, 'get_public_meeting_by_id_fetch_meeting', startTime, new Error('Meeting not found'));

        // Throw a resource not found error
        throw new ResourceNotFoundError('Meeting', id, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/meetings/${id}`,
        });
      }
      Logger.success(req, 'get_public_meeting_by_id_fetch_meeting', startTime, { meeting_uid: id });

      // Fetch the project
      Logger.start(req, 'get_public_meeting_by_id_fetch_project', { meeting_uid: id, project_uid: meeting.project_uid });
      const project = await this.projectService.getProjectById(req, meeting.project_uid, false);
      if (!project) {
        // Log the error
        Logger.error(req, 'get_public_meeting_by_id_fetch_project', startTime, new Error('Project not found'));

        // Throw a resource not found error
        throw new ResourceNotFoundError('Project', meeting.project_uid, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/projects/${meeting.project_uid}`,
        });
      }
      Logger.success(req, 'get_public_meeting_by_id_fetch_project', startTime, { meeting_uid: id, project_uid: project.uid });

      // Fetch the registrants
      Logger.start(req, 'get_public_meeting_by_id_fetch_registrants', { meeting_uid: id, project_uid: meeting.project_uid });
      const registrants = v1 ? [] : await this.meetingService.getMeetingRegistrants(req, meeting.uid);
      Logger.success(req, 'get_public_meeting_by_id_fetch_registrants', startTime, { meeting_uid: id, registrant_count: registrants.length });
      const committeeMembers = registrants.filter((r) => r.type === 'committee').length ?? 0;
      meeting.individual_registrants_count = (registrants?.length ?? 0) - (committeeMembers ?? 0);
      meeting.committee_members_count = committeeMembers ?? 0;

      // Check if authenticated user is invited to the meeting
      if (req.oidc?.isAuthenticated()) {
        const userEmail = (req.oidc.user?.['email'] as string) || '';
        meeting = await addInvitedStatusToMeeting(req, meeting, userEmail, m2mToken);
      } else {
        meeting.invited = false;
      }

      // Log the success
      Logger.success(req, 'get_public_meeting_by_id', startTime, { meeting_uid: id, project_uid: meeting.project_uid, title: meeting.title });

      // Check if the meeting visibility is public and not restricted, if so, get join URL and return the meeting and project
      if (meeting.visibility === MeetingVisibility.PUBLIC && !meeting.restricted) {
        // Only get join URL if within allowed join time window
        if (this.isWithinJoinWindow(meeting)) {
          // Only get join URL if not a legacy meeting
          if (!v1) {
            await this.handleJoinUrlForPublicMeeting(req, meeting, id);
          }
        } else {
          // Delete join URL if not within allowed join time window for legacy meetings
          if (v1) {
            delete meeting.join_url;
          }
        }
        res.json({ meeting, project: { name: project.name, slug: project.slug, logo_url: project.logo_url } });
        return;
      }

      // Delete join URL if not within allowed join time window for legacy meetings
      if (v1) {
        delete meeting.join_url;
      }

      // Check if the user has passed in a password, if so, check if it's correct
      const { password } = req.query;
      if (!this.validateMeetingPassword(password as string, meeting.password as string, 'get_public_meeting_by_id', req, next, startTime)) {
        return;
      }

      // Check if user is authenticated and add organizer field
      if (req.oidc?.isAuthenticated()) {
        // Restore user's original token before organizer check
        if (originalToken !== undefined) {
          req.bearerToken = originalToken;
        }

        Logger.start(req, 'get_public_meeting_by_id_check_organizer', { meeting_uid: id });
        try {
          meeting = await this.accessCheckService.addAccessToResource(req, meeting, 'meeting', 'organizer');
          Logger.success(req, 'get_public_meeting_by_id_check_organizer', startTime, {
            meeting_uid: id,
            is_organizer: meeting.organizer,
          });
        } catch (error) {
          // If organizer check fails, log but continue with organizer = false
          req.log.warn(
            {
              err: error,
              meeting_uid: id,
            },
            'Failed to check organizer status, continuing with organizer = false'
          );
          meeting.organizer = false;
        }
      } else {
        // User is not authenticated, set organizer to false
        meeting.organizer = false;
      }

      // Send the meeting and project data to the client
      res.json({ meeting, project: { name: project.name, slug: project.slug, logo_url: project.logo_url } });
    } catch (error) {
      // Log the error
      Logger.error(req, 'get_public_meeting_by_id', startTime, error, {
        meeting_uid: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  // TODO(v1-migration): Remove V1 detection and handling once all meetings are migrated to V2
  public async postMeetingJoinUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const { password } = req.query;
    const email: string = req.body.email ?? req.oidc.user?.['email'] ?? '';
    const startTime = Logger.start(req, 'post_meeting_join_url', {
      meeting_uid: id,
    });
    const v1 = !isUuid(id);

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'post_meeting_join_url', req, next, startTime)) {
        return;
      }

      const meeting = await this.fetchMeetingWithM2M(req, id, v1 ? 'v1_meeting' : 'meeting');

      if (!meeting) {
        throw new ResourceNotFoundError('Meeting', id, {
          operation: 'post_meeting_join_url',
          service: 'public_meeting_controller',
          path: `/meetings/${id}`,
        });
      }

      // Check if the user has passed in a password, if so, check if it's correct
      if (!this.validateMeetingPassword(password as string, meeting.password as string, 'post_meeting_join_url', req, next, startTime)) {
        return;
      }

      // Check if the meeting is within the allowed join time window
      if (!this.isWithinJoinWindow(meeting)) {
        const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;

        Logger.error(req, 'post_meeting_join_url', startTime, new Error('Meeting join not available yet'));

        const validationError = ServiceValidationError.forField('timing', `You can join the meeting up to ${earlyJoinMinutes} minutes before the start time`, {
          operation: 'post_meeting_join_url',
          service: 'public_meeting_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Check that the user has access to the meeting by validating they were invited to the meeting
      // Restricted meetings require an email to be provided
      if (meeting.restricted) {
        await this.restrictedMeetingCheck(req, next, email, id, startTime);
      }

      if (v1) {
        // If the meeting is v1, return the join URL
        res.json({ join_url: meeting.join_url });
        return;
      }

      const joinUrlData = await this.meetingService.getMeetingJoinUrl(req, id);

      // Log the success
      Logger.success(req, 'post_meeting_join_url', startTime, {
        meeting_uid: id,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      res.json(joinUrlData);
    } catch (error) {
      // Log the error
      Logger.error(req, 'post_meeting_join_url', startTime, error, {
        meeting_uid: id,
      });

      // Send the error to the next middleware
      next(error);
    }
  }

  /**
   * POST /public/api/meetings/register
   * Registers a user to a public, non-restricted meeting
   */
  public async registerForPublicMeeting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const registrantData: CreateMeetingRegistrantRequest = req.body;
    const meetingId = registrantData.meeting_uid;

    const startTime = Logger.start(req, 'register_for_public_meeting', {
      meeting_uid: meetingId,
    });

    try {
      // Validate the meeting ID is provided
      if (!meetingId) {
        const validationError = ServiceValidationError.forField('meeting_uid', 'Meeting ID is required', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        Logger.error(req, 'register_for_public_meeting', startTime, validationError);
        return next(validationError);
      }

      // Validate required fields
      if (!registrantData.email || !registrantData.first_name || !registrantData.last_name) {
        const validationError = ServiceValidationError.fromFieldErrors(
          {
            email: !registrantData.email ? 'Email is required' : [],
            first_name: !registrantData.first_name ? 'First name is required' : [],
            last_name: !registrantData.last_name ? 'Last name is required' : [],
          },
          'Registration data validation failed',
          {
            operation: 'register_for_public_meeting',
            service: 'public_meeting_controller',
            path: req.path,
          }
        );

        Logger.error(req, 'register_for_public_meeting', startTime, validationError);
        return next(validationError);
      }

      // Generate M2M token
      const m2mToken = await this.setupM2MToken(req);

      // Fetch the meeting to validate it's public and non-restricted
      const meeting = await this.meetingService.getMeetingById(req, meetingId, 'meeting', false);

      if (!meeting) {
        throw new ResourceNotFoundError('Meeting', meetingId, {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: `/meetings/${meetingId}`,
        });
      }

      // Validate the meeting is public
      if (meeting.visibility !== MeetingVisibility.PUBLIC) {
        const authError = new AuthorizationError('Registration is not allowed for non-public meetings', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        Logger.error(req, 'register_for_public_meeting', startTime, authError, {
          meeting_uid: meetingId,
          visibility: meeting.visibility,
        });

        return next(authError);
      }

      // Validate the meeting is not restricted
      if (meeting.restricted) {
        const authError = new AuthorizationError('Registration is not allowed for restricted meetings', {
          operation: 'register_for_public_meeting',
          service: 'public_meeting_controller',
          path: req.path,
        });

        Logger.error(req, 'register_for_public_meeting', startTime, authError, {
          meeting_uid: meetingId,
          restricted: meeting.restricted,
        });

        return next(authError);
      }

      // Add the registrant using M2M token
      const newRegistrant = await this.meetingService.addMeetingRegistrantWithM2M(req, registrantData, m2mToken);

      Logger.success(req, 'register_for_public_meeting', startTime, {
        meeting_uid: meetingId,
        registrant_uid: newRegistrant.uid,
      });

      res.status(201).json(newRegistrant);
    } catch (error) {
      Logger.error(req, 'register_for_public_meeting', startTime, error, {
        meeting_uid: meetingId,
      });

      next(error);
    }
  }

  /**
   * Sets up M2M token for API calls
   */
  private async setupM2MToken(req: Request): Promise<string> {
    const startTime = Logger.start(req, 'setup_m2m_token');

    try {
      const m2mToken = await generateM2MToken(req);
      req.bearerToken = m2mToken;

      Logger.success(req, 'setup_m2m_token', startTime, {
        has_token: !!m2mToken,
      });

      return m2mToken;
    } catch (error) {
      Logger.error(req, 'setup_m2m_token', startTime, error);
      throw error;
    }
  }

  /**
   * Validates meeting ID parameter
   */
  private validateMeetingId(id: string, operation: string, req: Request, next: NextFunction, startTime: number): boolean {
    return validateUidParameter(id, req, next, {
      operation,
      service: 'public_meeting_controller',
      logStartTime: startTime,
    });
  }

  /**
   * Validates meeting password
   */
  private validateMeetingPassword(password: string, meetingPassword: string, operation: string, req: Request, next: NextFunction, startTime: number): boolean {
    if (!password || !validatePassword(password, meetingPassword)) {
      Logger.error(req, operation, startTime, new Error('Invalid password parameter'));

      const validationError = ServiceValidationError.forField('password', 'Invalid password', {
        operation,
        service: 'public_meeting_controller',
        path: req.path,
      });

      next(validationError);
      return false;
    }
    return true;
  }

  /**
   * Fetches meeting with M2M token setup
   * @param req - Express request object
   * @param id - Meeting ID
   * @param meetingType - Type of meeting query
   * @param m2mToken - Optional pre-generated M2M token (will be generated if not provided)
   */
  private async fetchMeetingWithM2M(req: Request, id: string, meetingType: QueryServiceMeetingType = 'meeting', m2mToken?: string) {
    const startTime = Logger.start(req, 'fetch_meeting_with_m2m', {
      meeting_id: id,
    });

    try {
      // Use provided token or generate a new one
      if (m2mToken) {
        req.bearerToken = m2mToken;
      } else {
        await this.setupM2MToken(req);
      }
      const meeting = await this.meetingService.getMeetingById(req, id, meetingType, false);

      Logger.success(req, 'fetch_meeting_with_m2m', startTime, {
        meeting_id: id,
        meeting_uid: meeting.uid,
      });

      return meeting;
    } catch (error) {
      Logger.error(req, 'fetch_meeting_with_m2m', startTime, error, {
        meeting_id: id,
      });
      throw error;
    }
  }

  /**
   * Handles join URL logic for public meetings
   */
  private async handleJoinUrlForPublicMeeting(req: Request, meeting: any, id: string): Promise<void> {
    const startTime = Logger.start(req, 'handle_join_url_for_public_meeting', {
      meeting_uid: id,
    });

    try {
      const joinUrlData = await this.meetingService.getMeetingJoinUrl(req, id);
      meeting.join_url = joinUrlData.join_url;

      Logger.success(req, 'handle_join_url_for_public_meeting', startTime, {
        meeting_uid: id,
        has_join_url: !!joinUrlData.join_url,
      });
    } catch (error) {
      Logger.warning(req, 'handle_join_url_for_public_meeting', 'Failed to fetch join URL, continuing without it', {
        meeting_uid: id,
        has_token: !!req.bearerToken,
        err: error,
      });
    }
  }

  /**
   * Checks if the current time is within the allowed join window for a meeting
   */
  private isWithinJoinWindow(meeting: Meeting): boolean {
    if (!meeting?.start_time) {
      return false;
    }

    const now = new Date();
    const startTime = new Date(meeting.start_time);
    const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;
    const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);

    return now >= earliestJoinTime;
  }

  private async restrictedMeetingCheck(req: Request, next: NextFunction, email: string, id: string, startTime: number): Promise<void> {
    const helperStartTime = Logger.start(req, 'restricted_meeting_check', {
      meeting_id: id,
      has_email: !!email,
    });

    // Check that the user has access to the meeting by validating they were invited to the meeting
    if (!email) {
      // Log the error
      Logger.error(req, 'restricted_meeting_check', helperStartTime, new Error('Missing email parameter'));
      Logger.error(req, 'post_meeting_join_url', startTime, new Error('Missing email parameter'));

      // Create a validation error
      const validationError = ServiceValidationError.forField('email', 'Email is required', {
        operation: 'post_meeting_join_url',
        service: 'public_meeting_controller',
        path: req.path,
      });

      next(validationError);
      return;
    }

    // Query the meeting registrants filtered by the user's email to validate if the user was invited to the meeting
    const registrants = await this.meetingService.getMeetingRegistrantsByEmail(req, id, email);
    if (registrants.resources.length === 0) {
      const authError = new AuthorizationError('The email address is not registered for this restricted meeting', {
        operation: 'post_meeting_join_url',
        service: 'public_meeting_controller',
        path: `/meetings/${id}`,
      });
      Logger.error(req, 'restricted_meeting_check', helperStartTime, authError, {
        email,
        meeting_id: id,
      });
      throw authError;
    }

    Logger.success(req, 'restricted_meeting_check', helperStartTime, {
      meeting_id: id,
      email,
      registrant_count: registrants.resources.length,
    });
  }
}
