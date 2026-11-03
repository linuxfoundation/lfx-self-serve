// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  IMPERSONATION_ALREADY_TARGET_CODE,
  IMPERSONATION_ALREADY_TARGET_MESSAGE,
  IMPERSONATION_SEARCH_LIMIT,
  IMPERSONATION_SEARCH_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { ImpersonationSuggestion } from '@lfx-one/shared/interfaces';
import { excludeUserSearchIdentities } from '@lfx-one/shared/utils';
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
      this.impersonationService.startImpersonation(req, res, tokenResponse, targetClaims, profile);

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

  /**
   * POST /api/impersonate/users/search  { q }
   * People the impersonation picker can offer, from an auth-service search of every user with an LFID. The search is the
   * signed-in admin's own action, so it runs with their real token (`resolveImpersonatorToken`), never the current
   * target's: the same call serves picking the first user and switching to another. Requires `can_impersonate`, and
   * leaves out the admin and the current target, since picking either is pointless. The text is read from the body, not
   * the URL, and is never logged: the request-log URL, browser analytics and traces would all record a query string.
   */
  public async searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'search_impersonation_users', {
      has_query: typeof req.body?.q === 'string' && req.body.q.trim() !== '',
    });

    try {
      const query = req.body?.q;
      if (typeof query !== 'string' || query.trim() === '') {
        next(
          ServiceValidationError.forField('q', 'q is required and must be a non-empty string', {
            operation: 'search_impersonation_users',
            service: 'impersonation',
          })
        );
        return;
      }

      const text = query.trim();
      if (text.length > IMPERSONATION_SEARCH_MAX_LENGTH) {
        next(
          ServiceValidationError.forField('q', `q must be at most ${IMPERSONATION_SEARCH_MAX_LENGTH} characters`, {
            operation: 'search_impersonation_users',
            service: 'impersonation',
          })
        );
        return;
      }

      const subjectToken = await resolveImpersonatorToken(req, 'search_impersonation_users');
      const users = await this.impersonationService.searchUsers(req, text, subjectToken, IMPERSONATION_SEARCH_LIMIT);

      // A person without a username (blank counts) cannot be impersonated by selection, so they are not offered.
      const suggestions = users
        .filter((user) => !!user.username?.trim())
        .map(
          (user): ImpersonationSuggestion => ({
            targetUser: user.username.trim(),
            username: user.username.trim(),
            email: user.email ?? '',
            name: user.name || undefined,
          })
        );

      const adminClaims = decodeJwtPayload(subjectToken);
      const currentTarget = req.appSession?.['impersonationUser'];
      const results = excludeUserSearchIdentities(suggestions, [
        { username: adminClaims?.['http://lfx.dev/claims/username'], email: adminClaims?.['http://lfx.dev/claims/email'] },
        { username: currentTarget?.username, email: currentTarget?.email },
      ]);

      logger.success(req, 'search_impersonation_users', startTime, { result_count: results.length });

      res.json({ results });
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
