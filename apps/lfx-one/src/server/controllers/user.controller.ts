// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { UserService } from '../services/user.service';

/**
 * Controller for handling user-related HTTP requests
 */
export class UserController {
  private userService: UserService = new UserService();

  /**
   * GET /api/user/pending-actions - Get all pending actions for the authenticated user
   */
  public async getPendingActions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_pending_actions', {
      persona: req.query['persona'],
      project_uid: req.query['projectUid'],
    });

    try {
      // Extract user email from OIDC
      const userEmail = req.oidc?.user?.['email'];
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_pending_actions',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract and validate persona
      const persona = req.query['persona'] as PersonaType | undefined;
      if (!persona) {
        const validationError = ServiceValidationError.forField('persona', 'persona query parameter is required', {
          operation: 'get_pending_actions',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract and validate projectUid
      const projectUid = req.query['projectUid'] as string | undefined;
      if (!projectUid) {
        const validationError = ServiceValidationError.forField('projectUid', 'projectUid query parameter is required', {
          operation: 'get_pending_actions',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract and validate projectSlug (needed for Snowflake surveys query)
      const projectSlug = req.query['projectSlug'] as string | undefined;
      if (!projectSlug) {
        const validationError = ServiceValidationError.forField('projectSlug', 'projectSlug query parameter is required', {
          operation: 'get_pending_actions',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get pending actions from service
      const pendingActions = await this.userService.getPendingActions(req, persona, projectUid, userEmail, projectSlug);

      logger.success(req, 'get_pending_actions', startTime, {
        persona,
        project_uid: projectUid,
        project_slug: projectSlug,
        action_count: pendingActions.length,
      });

      res.json(pendingActions);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/meetings - Get all meetings for the authenticated user
   * Returns meetings the user is registered for or has access to, filtered by project
   * TODO: DEMO - Revisit this after the demo as this is not an efficient way of getting current users meetings
   * @query projectUid - Required project UID to filter meetings
   */
  public async getUserMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_meetings', {
      project_uid: req.query['projectUid'],
    });

    try {
      // Extract and validate projectUid
      const projectUid = req.query['projectUid'] as string | undefined;
      if (!projectUid) {
        const validationError = ServiceValidationError.forField('projectUid', 'projectUid query parameter is required', {
          operation: 'get_user_meetings',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract user email from OIDC
      const userEmail = req.oidc?.user?.['email'];
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_user_meetings',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Get user's meetings from service
      const query = { tags_all: `project_uid:${projectUid}` };
      const meetings = await this.userService.getUserMeetings(req, userEmail, projectUid, query);

      logger.success(req, 'get_user_meetings', startTime, {
        project_uid: projectUid,
        meeting_count: meetings.length,
      });

      res.json(meetings);
    } catch (error) {
      next(error);
    }
  }
}
