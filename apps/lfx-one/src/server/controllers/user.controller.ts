// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
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
    const startTime = Logger.start(req, 'get_pending_actions', {
      persona: req.query['persona'],
      project_uid: req.query['projectUid'],
    });

    try {
      // Extract user email from OIDC
      const userEmail = req.oidc?.user?.['email'];
      if (!userEmail) {
        Logger.error(req, 'get_pending_actions', startTime, new Error('User email not found in OIDC context'));

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
        Logger.error(req, 'get_pending_actions', startTime, new Error('Missing persona parameter'));

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
        Logger.error(req, 'get_pending_actions', startTime, new Error('Missing projectUid parameter'));

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
        Logger.error(req, 'get_pending_actions', startTime, new Error('Missing projectSlug parameter'));

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

      Logger.success(req, 'get_pending_actions', startTime, {
        persona,
        project_uid: projectUid,
        project_slug: projectSlug,
        action_count: pendingActions.length,
      });

      res.json(pendingActions);
    } catch (error) {
      Logger.error(req, 'get_pending_actions', startTime, error);
      next(error);
    }
  }
}
