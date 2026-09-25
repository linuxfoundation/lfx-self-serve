// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { INSIGHTS_TOKEN_ERROR_CODES, INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS, INSIGHTS_TOKEN_NAME_MAX_LENGTH } from '@lfx-one/shared/constants';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { InsightsTokensService } from '../services/insights-tokens.service';
import { logger } from '../services/logger.service';

/**
 * LFX Insights API tokens (IN-1233) under `/api/profile/insights-tokens`. List and eligibility are
 * readable while impersonating (they resolve to the impersonated user); create and revoke are mounted
 * with `blockDuringImpersonation` because a token is a live credential owned by the target.
 */
export class InsightsTokensController {
  private readonly insightsTokensService = new InsightsTokensService();

  /** GET /api/profile/insights-tokens */
  public async listTokens(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_insights_tokens');

    try {
      const tokens = await this.insightsTokensService.listTokens(req);
      logger.success(req, 'list_insights_tokens', startTime, { count: tokens.length });
      res.set('Cache-Control', 'no-store');
      res.json(tokens);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/profile/insights-tokens/eligibility — never errors; fails closed to `canCreate: false` (with `checkFailed` on upstream errors). */
  public async getEligibility(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_insights_token_eligibility');

    try {
      const eligibility = await this.insightsTokensService.getEligibility(req);
      logger.success(req, 'get_insights_token_eligibility', startTime, {
        can_create: eligibility.canCreate,
        check_failed: eligibility.checkFailed,
        org_count: eligibility.orgs.length,
      });
      res.set('Cache-Control', 'no-store');
      res.json(eligibility);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/insights-tokens — re-checks Key Contact eligibility server-side (the UI gate
   * is not trusted) before asking the PAT service to issue the token.
   */
  public async createToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_insights_token');
    const rawName: unknown = req.body?.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';

    if (!name || name.length > INSIGHTS_TOKEN_NAME_MAX_LENGTH || INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS.test(name)) {
      return next(
        ServiceValidationError.forField('name', `Token name must be 1-${INSIGHTS_TOKEN_NAME_MAX_LENGTH} characters with no control characters`, {
          operation: 'create_insights_token',
          service: 'insights_tokens_controller',
          path: req.path,
        })
      );
    }

    try {
      const eligibility = await this.insightsTokensService.getEligibility(req);
      if (eligibility.checkFailed) {
        return next(
          new MicroserviceError('Key Contact eligibility could not be verified', 503, 'SERVICE_UNAVAILABLE', {
            operation: 'create_insights_token',
            service: 'insights_tokens_controller',
            path: req.path,
            errorBody: { error: INSIGHTS_TOKEN_ERROR_CODES.ELIGIBILITY_UNAVAILABLE },
          })
        );
      }
      if (!eligibility.canCreate) {
        return next(
          new MicroserviceError('Only Key Contacts of a member organization can create Insights API tokens', 403, 'FORBIDDEN', {
            operation: 'create_insights_token',
            service: 'insights_tokens_controller',
            path: req.path,
            errorBody: { error: INSIGHTS_TOKEN_ERROR_CODES.NOT_KEY_CONTACT },
          })
        );
      }

      const created = await this.insightsTokensService.createToken(req, name);
      logger.success(req, 'create_insights_token', startTime, { token_uid: created.token.uid });
      res.set({
        ['Cache-Control']: 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/profile/insights-tokens/:uid — not gated on eligibility so ex-Key-Contacts can still revoke. */
  public async revokeToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'revoke_insights_token');
    const uid = req.params['uid'];

    if (typeof uid !== 'string' || !isUuid(uid)) {
      return next(
        ServiceValidationError.forField('uid', 'A valid token UID is required', {
          operation: 'revoke_insights_token',
          service: 'insights_tokens_controller',
          path: req.path,
        })
      );
    }

    try {
      await this.insightsTokensService.revokeToken(req, uid);
      logger.success(req, 'revoke_insights_token', startTime, { token_uid: uid });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
