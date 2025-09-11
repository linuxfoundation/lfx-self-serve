// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-pcc/shared/enums';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { AuthorizationError } from '../errors/authentication.error';
import { Logger } from '../helpers/logger';
import { validateUidParameter } from '../helpers/validation.helper';
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
  /**
   * GET /public/api/meetings/:id
   * Retrieves a single meeting by ID without requiring authentication
   */
  public async getMeetingById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const startTime = Logger.start(req, 'get_public_meeting_by_id', {
      meeting_uid: id,
    });

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'get_public_meeting_by_id', req, next, startTime)) {
        return;
      }

      // Get the meeting by ID using M2M token
      const meeting = await this.fetchMeetingWithM2M(req, id);
      const project = await this.projectService.getProjectById(req, meeting.project_uid, false);
      const registrants = await this.meetingService.getMeetingRegistrants(req, meeting.uid);
      const committeeMembers = registrants.filter((r) => r.type === 'committee').length ?? 0;
      meeting.individual_registrants_count = registrants.length - committeeMembers;
      meeting.committee_members_count = committeeMembers;

      if (!project) {
        throw new ResourceNotFoundError('Project', meeting.project_uid, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/projects/${meeting.project_uid}`,
        });
      }

      // Log the success
      Logger.success(req, 'get_public_meeting_by_id', startTime, {
        meeting_uid: id,
        project_uid: meeting.project_uid,
        title: meeting.title,
      });

      // Check if the meeting visibility is public and not restricted, if so, get join URL and return the meeting and project
      if (meeting.visibility === MeetingVisibility.PUBLIC && !meeting.restricted) {
        // Only get join URL if within allowed join time window
        if (this.isWithinJoinWindow(meeting)) {
          await this.handleJoinUrlForPublicMeeting(req, meeting, id);
        }
        res.json({ meeting, project: { name: project.name, slug: project.slug, logo_url: project.logo_url } });
        return;
      }

      // Check if the user has passed in a password, if so, check if it's correct
      const { password } = req.query;
      if (!this.validateMeetingPassword(password as string, meeting.password as string, 'get_public_meeting_by_id', req, next, startTime)) {
        return;
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

  public async postMeetingJoinUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { id } = req.params;
    const { password } = req.query;
    const email: string = req.oidc.user?.['email'] ?? req.body.email;
    const startTime = Logger.start(req, 'post_meeting_join_url', {
      meeting_uid: id,
    });

    try {
      // Check if the meeting UID is provided
      if (!this.validateMeetingId(id, 'post_meeting_join_url', req, next, startTime)) {
        return;
      }

      const meeting = await this.fetchMeetingWithM2M(req, id);

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
        const earlyJoinMinutes = meeting.early_join_time_minutes || 10;

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
   * Sets up M2M token for API calls
   */
  private async setupM2MToken(req: Request): Promise<string> {
    const m2mToken = await generateM2MToken(req);
    req.bearerToken = m2mToken;
    return m2mToken;
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
   */
  private async fetchMeetingWithM2M(req: Request, id: string) {
    await this.setupM2MToken(req);
    return await this.meetingService.getMeetingById(req, id, 'meeting', false);
  }

  /**
   * Handles join URL logic for public meetings
   */
  private async handleJoinUrlForPublicMeeting(req: Request, meeting: any, id: string): Promise<void> {
    try {
      const joinUrlData = await this.meetingService.getMeetingJoinUrl(req, id);
      meeting.join_url = joinUrlData.join_url;

      req.log.debug(
        Logger.sanitize({
          meeting_uid: id,
          has_join_url: !!joinUrlData.join_url,
        }),
        'Fetched join URL for public meeting'
      );
    } catch (error) {
      req.log.warn(
        {
          error: error instanceof Error ? error.message : error,
          meeting_uid: id,
          has_token: !!req.bearerToken,
        },
        'Failed to fetch join URL for public meeting, continuing without it'
      );
    }
  }

  /**
   * Checks if the current time is within the allowed join window for a meeting
   */
  private isWithinJoinWindow(meeting: any): boolean {
    if (!meeting?.start_time) {
      return false;
    }

    const now = new Date();
    const startTime = new Date(meeting.start_time);
    const earlyJoinMinutes = meeting.early_join_time_minutes || 10; // Default to 10 minutes
    const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);

    return now >= earliestJoinTime;
  }

  private async restrictedMeetingCheck(req: Request, next: NextFunction, email: string, id: string, startTime: number): Promise<void> {
    // Check that the user has access to the meeting by validating they were invited to the meeting
    if (!email) {
      // Log the error
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
      throw new AuthorizationError('The email address is not registered for this restricted meeting', {
        operation: 'post_meeting_join_url',
        service: 'public_meeting_controller',
        path: `/meetings/${id}`,
      });
    }
  }
}
