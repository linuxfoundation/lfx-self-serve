// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { UserService } from '../services/user.service';
import { getEffectiveEmail } from '../utils/auth-helper';

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
      // Extract user email from auth context (impersonation-aware)
      const userEmail = getEffectiveEmail(req);
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
   * GET /api/user/meetings - Get meetings for the authenticated user
   * Returns meetings the user is registered for, optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   * @query limit - Optional limit on number of meetings to return
   */
  public async getUserMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_meetings', {
      project_uid: req.query['projectUid'],
      foundation_uid: req.query['foundation_uid'],
      limit: req.query['limit'],
    });

    try {
      const projectUid = req.query['projectUid'] as string | undefined;
      const foundationUid = req.query['foundation_uid'] as string | undefined;

      // Extract user email from auth context (impersonation-aware, already lowercased)
      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_user_meetings',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract and validate optional limit parameter
      const limitParam = req.query['limit'] as string | undefined;
      let limit: number | undefined;
      if (limitParam !== undefined) {
        const parsedLimit = parseInt(limitParam, 10);
        if (isNaN(parsedLimit) || parsedLimit <= 0) {
          const validationError = ServiceValidationError.forField('limit', 'limit must be a positive integer', {
            operation: 'get_user_meetings',
            service: 'user_controller',
            path: req.path,
          });

          next(validationError);
          return;
        }
        limit = parsedLimit;
      }

      // Get user's meetings from service
      const meetings = await this.userService.getUserMeetings(req, userEmail, projectUid, limit, foundationUid);

      logger.success(req, 'get_user_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        meeting_count: meetings.length,
        limit,
      });

      res.json(meetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/past-meetings - Get past meetings for the authenticated user
   * Returns past meetings the user was registered for, optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   * @query limit - Optional limit on number of past meetings to return
   */
  public async getUserPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_past_meetings', {
      project_uid: req.query['projectUid'],
      foundation_uid: req.query['foundation_uid'],
      limit: req.query['limit'],
    });

    try {
      const projectUid = req.query['projectUid'] as string | undefined;
      const foundationUid = req.query['foundation_uid'] as string | undefined;

      // Extract user email from auth context (impersonation-aware, already lowercased)
      const userEmail = getEffectiveEmail(req);
      if (!userEmail) {
        const validationError = ServiceValidationError.forField('email', 'User email not found in authentication context', {
          operation: 'get_user_past_meetings',
          service: 'user_controller',
          path: req.path,
        });

        next(validationError);
        return;
      }

      // Extract and validate optional limit parameter
      const limitParam = req.query['limit'] as string | undefined;
      let limit: number | undefined;
      if (limitParam !== undefined) {
        const parsedLimit = parseInt(limitParam, 10);
        if (isNaN(parsedLimit) || parsedLimit <= 0) {
          const validationError = ServiceValidationError.forField('limit', 'limit must be a positive integer', {
            operation: 'get_user_past_meetings',
            service: 'user_controller',
            path: req.path,
          });

          next(validationError);
          return;
        }
        limit = parsedLimit;
      }

      // Get user's past meetings from service
      const pastMeetings = await this.userService.getUserPastMeetings(req, userEmail, projectUid, limit, foundationUid);

      logger.success(req, 'get_user_past_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        past_meeting_count: pastMeetings.length,
        limit,
      });

      res.json(pastMeetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/salesforce-id - Proxy test for the API Gateway token
   * TODO: TEMPORARY — calls UserService.getApiGatewayProfile() which proxies
   * GET ${API_GW_AUDIENCE}/user-service/v1/me?basic=true and returns the raw
   * response to verify the token works end-to-end.
   */
  public async getSalesforceId(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_salesforce_id', {});

    try {
      const { status, body } = await this.userService.getApiGatewayProfile(req);

      logger.success(req, 'get_salesforce_id', startTime, { upstream_status: status });

      res.status(status).json(body);
    } catch (error) {
      next(error);
    }
  }
}
