// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { ImpersonationService } from '../services/impersonation.service';
import { decodeJwtPayload } from '../utils/auth-helper';

export class ImpersonationController {
  private readonly impersonationService: ImpersonationService = new ImpersonationService();

  public async startImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'start_impersonation', {
      target_user: req.body?.targetUser,
    });

    try {
      if (req.appSession?.['impersonationToken']) {
        next(
          new MicroserviceError('Already impersonating a user. Stop the current session first.', 409, 'ALREADY_IMPERSONATING', {
            operation: 'start_impersonation',
            service: 'impersonation',
          })
        );
        return;
      }

      const targetUser = req.body?.targetUser;
      if (!targetUser || typeof targetUser !== 'string' || targetUser.trim() === '') {
        next(
          ServiceValidationError.forField('targetUser', 'targetUser is required and must be a non-empty string', {
            operation: 'start_impersonation',
            service: 'impersonation',
          })
        );
        return;
      }

      const realToken = req.oidc?.accessToken?.access_token || '';
      const tokenPayload = decodeJwtPayload(realToken);
      if (!tokenPayload || tokenPayload['http://lfx.dev/claims/can_impersonate'] !== true) {
        next(new AuthorizationError('Insufficient permissions to impersonate users', { operation: 'start_impersonation', service: 'impersonation' }));
        return;
      }

      const tokenResponse = await this.impersonationService.exchangeToken(req, targetUser.trim());
      const targetClaims = decodeJwtPayload(tokenResponse.access_token);

      if (!targetClaims) {
        throw new Error('Failed to decode target user claims from CTE response');
      }

      const profile = await this.impersonationService.fetchTargetUserProfile(req, targetClaims['sub']);
      this.impersonationService.startImpersonation(req, tokenResponse, targetClaims, profile);

      logger.success(req, 'start_impersonation', startTime, {
        target_sub: targetClaims['sub'],
      });

      res.json({
        impersonating: true,
        targetUser: {
          sub: targetClaims['sub'] || '',
          email: targetClaims['http://lfx.dev/claims/email'] || '',
          username: targetClaims['http://lfx.dev/claims/username'] || '',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  public async stopImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'stop_impersonation');

    try {
      this.impersonationService.stopImpersonation(req);

      logger.success(req, 'stop_impersonation', startTime);

      res.json({ impersonating: false });
    } catch (error) {
      next(error);
    }
  }

  public async getImpersonationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_impersonation_status');

    try {
      const status = this.impersonationService.getImpersonationStatus(req);

      logger.success(req, 'get_impersonation_status', startTime, {
        impersonating: status.impersonating,
      });

      res.json(status);
    } catch (error) {
      next(error);
    }
  }
}
