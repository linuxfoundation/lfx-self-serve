// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { M2MTokenResponse, PersonaType, VALID_PERSONAS } from '@lfx-one/shared/interfaces';
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

      const personaContextRaw = req.body?.personaContext;
      if (personaContextRaw !== undefined && personaContextRaw !== null && !VALID_PERSONAS.has(personaContextRaw)) {
        next(
          ServiceValidationError.forField('personaContext', 'personaContext must be a valid persona type', {
            operation: 'start_impersonation',
            service: 'impersonation',
          })
        );
        return;
      }
      const personaContext = (personaContextRaw ?? undefined) as PersonaType | undefined;

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

      // Attempt a CF-scoped CTE so the impersonated session can access the target user's
      // Crowdfunding data. The admin's CF token is used as the subject_token so the auth
      // service can extract the CF audience from it. Best-effort: if the exchange fails
      // (e.g. admin has no CF token, or auth service rejects it), impersonation still
      // starts and CF sections fall back to empty state.
      let cfTokenResponse: M2MTokenResponse | undefined;
      if (req.crowdfundingToken) {
        try {
          cfTokenResponse = await this.impersonationService.exchangeToken(req, targetUser.trim(), req.crowdfundingToken);
          logger.debug(req, 'start_impersonation', 'CF CTE exchange succeeded for target user');
        } catch (cfErr) {
          logger.warning(req, 'start_impersonation', 'CF CTE exchange failed — CF will show empty state during impersonation', {
            error: cfErr instanceof Error ? cfErr.message : String(cfErr),
          });
        }
      }

      const profile = await this.impersonationService.fetchTargetUserProfile(req, targetClaims['sub']);
      this.impersonationService.startImpersonation(req, res, tokenResponse, targetClaims, profile, personaContext, cfTokenResponse);

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
      this.impersonationService.stopImpersonation(req, res);

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
