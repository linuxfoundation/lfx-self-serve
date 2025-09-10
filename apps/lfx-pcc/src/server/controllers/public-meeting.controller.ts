// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '@lfx-pcc/shared/enums';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ResourceNotFoundError } from '../errors';
import { Logger } from '../helpers/logger';
import { validateUidParameter } from '../helpers/validation.helper';
import { MeetingService } from '../services/meeting.service';
import { ProjectService } from '../services/project.service';
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
      if (
        !validateUidParameter(id, req, next, {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          logStartTime: startTime,
        })
      ) {
        return;
      }

      // TODO: Generate an M2M token

      // Get the meeting by ID using the existing meeting service
      const meeting = await this.meetingService.getMeetingById(req, id, 'meeting', false);
      const project = await this.projectService.getProjectById(req, meeting.project_uid, false);

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

      // Check if the meeting visibility is public, if so, get join URL and return the meeting and project
      if (meeting.visibility === MeetingVisibility.PUBLIC) {
        try {
          // Get the meeting join URL for public meetings
          req.log.debug(
            Logger.sanitize({
              meeting_uid: id,
              isAuthenticated: req.oidc?.isAuthenticated(),
              hasOidc: !!req.oidc,
              user: req.oidc?.user,
              accessToken: req.oidc?.accessToken ? 'present' : 'missing',
              cookies: Object.keys(req.cookies || {}),
              headers: {
                cookie: req.headers.cookie ? 'present' : 'missing',
              },
            }),
            'OIDC Authentication Debug - Getting join URL for public meeting'
          );
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
          // Log the error but don't fail the request - join URL is optional
          req.log.warn(
            {
              error: error instanceof Error ? error.message : error,
              meeting_uid: id,
              has_token: !!req.bearerToken,
            },
            'Failed to fetch join URL for public meeting, continuing without it'
          );
        }

        res.json({ meeting, project: { name: project.name, slug: project.slug, logo_url: project.logo_url } });
        return;
      }

      // Check if the user has passed in a password, if so, check if it's correct
      const { password } = req.query;
      if (!password || !validatePassword(password as string, meeting.password)) {
        throw new AuthenticationError('Invalid password', {
          operation: 'get_public_meeting_by_id',
          service: 'public_meeting_controller',
          path: `/meetings/${id}`,
        });
      }

      // Get the meeting join URL for password-protected meetings
      try {
        const joinUrlData = await this.meetingService.getMeetingJoinUrl(req, id);
        meeting.join_url = joinUrlData.join_url;

        req.log.debug(
          {
            meeting_uid: id,
            has_join_url: !!joinUrlData.join_url,
          },
          'Fetched join URL for password-protected meeting'
        );
      } catch (error) {
        // Log the error but don't fail the request - join URL is optional
        req.log.warn(
          {
            error: error instanceof Error ? error.message : error,
            meeting_uid: id,
          },
          'Failed to fetch join URL for password-protected meeting, continuing without it'
        );
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
}
