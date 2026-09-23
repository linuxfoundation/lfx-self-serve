// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { API_GATEWAY_AUTH } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError } from '../errors';
import { isDocumentNavigation, normalizeApiGatewayReturnTo } from '../helpers/api-gateway-auth.helper';
import { apiGatewayAuthService } from '../services/api-gateway-auth.service';
import { logger } from '../services/logger.service';
import { isImpersonating } from '../utils/auth-helper';

export class ApiGatewayAuthController {
  public async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'api_gateway_auth_start');
    this.noStore(res);
    try {
      if (!this.canAuthorize(req, res, next)) return;
      if (!apiGatewayAuthService.isConfigured()) {
        next(new MicroserviceError('API Gateway authorization is not configured.', 503, 'API_GATEWAY_UNAVAILABLE'));
        return;
      }
      const returnTo = normalizeApiGatewayReturnTo(req.query['returnTo']);
      if ((await apiGatewayAuthService.loadToken(req)) === 'ready') {
        res.redirect(returnTo);
        return;
      }
      const url = await apiGatewayAuthService.getAuthorizationUrl(req, returnTo);
      logger.success(req, 'api_gateway_auth_start', startTime);
      res.redirect(url);
    } catch {
      next(new MicroserviceError('API Gateway authorization could not be started. Please try again.', 503, 'API_GATEWAY_UNAVAILABLE'));
    }
  }

  public async callback(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'api_gateway_auth_callback');
    this.noStore(res);
    if (!this.canAuthorize(req, res, next)) return;
    let returnTo = '/';
    try {
      const state = await apiGatewayAuthService.consumeAuthState(req, req.query['state']);
      if (!state) {
        this.failed(req, res, returnTo, 'invalid_state');
        return;
      }
      returnTo = normalizeApiGatewayReturnTo(state.returnTo);
      const error = req.query['error'];
      if (error !== undefined) {
        if (state.silent && typeof error === 'string' && ['consent_required', 'interaction_required', 'login_required'].includes(error)) {
          res.redirect(await apiGatewayAuthService.getAuthorizationUrl(req, returnTo, false));
          return;
        }
        this.failed(req, res, returnTo, 'authorization_failed');
        return;
      }
      const code = req.query['code'];
      if (typeof code !== 'string' || !code) {
        this.failed(req, res, returnTo, 'missing_code');
        return;
      }
      await apiGatewayAuthService.exchangeCode(req, code, state);
      logger.success(req, 'api_gateway_auth_callback', startTime);
      res.redirect(returnTo);
    } catch {
      this.failed(req, res, returnTo, 'authorization_failed');
    }
  }

  private canAuthorize(req: Request, res: Response, next: NextFunction): boolean {
    if (!req.oidc?.isAuthenticated() || !req.appSession) {
      next(new AuthenticationError('Sign in before authorizing API Gateway access.'));
      return false;
    }
    if (isImpersonating(req)) {
      next(new AuthorizationError('API Gateway authorization is unavailable while impersonating.', { code: 'IMPERSONATION_READ_ONLY' }));
      return false;
    }
    if (!isDocumentNavigation(req)) {
      res.status(403).json({
        code: 'API_GATEWAY_AUTH_REQUIRED',
        message: 'Open the authorization URL in a browser, then retry the operation. No request has been replayed.',
        authorize_url: API_GATEWAY_AUTH.START_PATH,
      });
      return false;
    }
    return true;
  }

  private failed(req: Request, res: Response, returnTo: string, reason: string): void {
    logger.warning(req, 'api_gateway_auth_callback', 'API Gateway authorization failed', { reason });
    const url = new URL(returnTo, process.env['PCC_BASE_URL'] || 'http://localhost:4000');
    url.searchParams.set(API_GATEWAY_AUTH.ERROR_PARAM, reason);
    res.redirect(`${url.pathname}${url.search}${url.hash}`);
  }

  private noStore(res: Response): void {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  }
}
