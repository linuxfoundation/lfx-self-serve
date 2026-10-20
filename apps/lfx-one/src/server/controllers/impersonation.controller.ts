// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IMPERSONATION_ALREADY_TARGET_CODE, IMPERSONATION_ALREADY_TARGET_MESSAGE, VALID_PERSONAS } from '@lfx-one/shared/constants';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { ImpersonationService } from '../services/impersonation.service';
import { decodeJwtPayload } from '../utils/auth-helper';
import { resolveImpersonatorToken } from '../utils/impersonator-token';

export class ImpersonationController {
  private readonly impersonationService: ImpersonationService = new ImpersonationService();

  public async startImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'start_impersonation', {
      target_user: req.body?.targetUser,
    });

    try {
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

      // Switching users mid-impersonation: req.bearerToken is the current target's token here, so the exchange
      // must be seeded with the impersonator's own token, never chaining one target's token into another.
      const subjectToken = await resolveImpersonatorToken(req, 'start_impersonation');

      const tokenResponse = await this.impersonationService.exchangeToken(req, targetUser.trim(), subjectToken);
      const targetClaims = decodeJwtPayload(tokenResponse.access_token);

      if (!targetClaims) {
        throw new Error('Failed to decode target user claims from CTE response');
      }

      const currentTargetSub = req.appSession?.['impersonationUser']?.sub;
      if (req.appSession?.['impersonationToken'] && currentTargetSub && currentTargetSub === targetClaims['sub']) {
        next(
          new MicroserviceError(IMPERSONATION_ALREADY_TARGET_MESSAGE, 409, IMPERSONATION_ALREADY_TARGET_CODE, {
            operation: 'start_impersonation',
            service: 'impersonation',
          })
        );
        return;
      }

      const profile = await this.impersonationService.fetchTargetUserProfile(req, targetClaims['sub']);
      this.impersonationService.startImpersonation(req, res, tokenResponse, targetClaims, profile, personaContext);

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
