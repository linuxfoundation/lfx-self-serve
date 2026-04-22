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

      // Optional `?limit=` clamps the response size so mobile / summary cards can request a
      // smaller payload. Absent = unbounded; when present it must be a positive integer. Any
      // present-but-non-string value (array from `?limit=1&limit=2`, object from `?limit[foo]=1`)
      // fails the Number conversion to NaN and hits the same error branch, so malformed input
      // can't silently defeat the cap.
      const limitQuery = req.query['limit'];
      let limit: number | undefined;
      if (limitQuery !== undefined) {
        const parsed = typeof limitQuery === 'string' ? Number(limitQuery) : NaN;
        if (!Number.isInteger(parsed) || parsed <= 0) {
          next(
            ServiceValidationError.forField('limit', 'limit query parameter must be a positive integer', {
              operation: 'get_pending_actions',
              service: 'user_controller',
              path: req.path,
            })
          );
          return;
        }
        limit = Math.min(parsed, 100);
      }

      // Get pending actions from service — persona is validated above for API-contract stability
      // but is no longer consumed by the aggregator (pending actions are persona-agnostic now).
      const pendingActions = await this.userService.getPendingActions(req, projectUid, userEmail, projectSlug, limit);

      logger.success(req, 'get_pending_actions', startTime, {
        persona,
        project_uid: projectUid,
        project_slug: projectSlug,
        action_count: pendingActions.length,
        ...(limit !== undefined && { limit }),
      });

      // Private, revalidate-every-time — server recomputes the response for the real
      // authenticated identity on every hit, so 304 (cache-reuse) only fires when the server
      // confirms the body is unchanged for this user. See getUserMeetings for full rationale.
      res.set('Cache-Control', 'private, no-cache');
      res.json(pendingActions);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/meetings - Get meetings for the authenticated user
   * Returns meetings the user is registered for, optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   */
  public async getUserMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_meetings', {
      project_uid: req.query['projectUid'],
      foundation_uid: req.query['foundation_uid'],
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

      // Get user's meetings from service
      const meetings = await this.userService.getUserMeetings(req, userEmail, projectUid, foundationUid);

      logger.success(req, 'get_user_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        meeting_count: meetings.length,
      });

      // Private, revalidate-every-time. Browser stores the body + ETag, but must check with the
      // server (If-None-Match) before serving. The server recomputes the response for the real
      // authenticated identity on every hit, so cross-user cache reads are impossible: different
      // users produce different bodies → different ETags → 200 with fresh data. 304 responses
      // skip the body entirely, which is where the bandwidth/parse savings come from.
      res.set('Cache-Control', 'private, no-cache');
      res.json(meetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/past-meetings - Get past meetings for the authenticated user
   * Returns past meetings the user was registered for, optionally filtered by project
   * @query projectUid - Optional project UID to filter meetings
   */
  public async getUserPastMeetings(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_past_meetings', {
      project_uid: req.query['projectUid'],
      foundation_uid: req.query['foundation_uid'],
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

      // Get user's past meetings from service
      const pastMeetings = await this.userService.getUserPastMeetings(req, userEmail, projectUid, foundationUid);

      logger.success(req, 'get_user_past_meetings', startTime, {
        project_uid: projectUid,
        foundation_uid: foundationUid,
        past_meeting_count: pastMeetings.length,
      });

      // Private, revalidate-every-time — see getUserMeetings for full rationale.
      res.set('Cache-Control', 'private, no-cache');
      res.json(pastMeetings);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/user/salesforce-id - Returns the current user's Salesforce ID
   * Proxies GET ${API_GW_AUDIENCE}/user-service/v1/me?basic=true and returns only
   * an object containing the profile ID in the shape `{ id: profile.ID }`.
   * The ID field is used by downstream operations such as visa letter and travel
   * fund applications.
   */
  public async getSalesforceId(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_salesforce_id', {});

    try {
      const profile = await this.userService.getApiGatewayProfile(req);

      if (!profile.ID) {
        throw new ServiceValidationError(
          [{ field: 'id', message: 'Salesforce ID not found for this user', code: 'SALESFORCE_ID_NOT_FOUND' }],
          'Salesforce ID not found'
        );
      }

      logger.success(req, 'get_salesforce_id', startTime, {});

      res.json({ id: profile.ID });
    } catch (error) {
      next(error);
    }
  }
}
