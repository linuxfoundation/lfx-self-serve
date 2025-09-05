// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

export function extractBearerToken(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.oidc?.isAuthenticated() && !req.oidc.accessToken?.isExpired()) {
      const accessToken = req.oidc.accessToken?.access_token;
      if (accessToken && typeof accessToken === 'string') {
        req.bearerToken = accessToken;
        req.log.debug({ has_token: true, token_source: 'oidc' }, 'Bearer token extracted from OIDC session');
        return next();
      }
    }

    // Check if this is an internal SSR request (from Angular during rendering)
    const userAgent = req.get('User-Agent');
    const isInternalRequest = !userAgent || userAgent.includes('LFX-PCC-Server');

    if (isInternalRequest) {
      req.log.warn(
        {
          user_agent: userAgent,
          url: req.url,
          method: req.method,
        },
        'SSR request without authentication context'
      );
      throw new Error('SSR request without authentication context');
    }

    req.log.warn(
      {
        is_oidc_authenticated: req.oidc?.isAuthenticated(),
        url: req.url,
        method: req.method,
      },
      'Bearer token not available'
    );

    // If neither Authorization header nor OIDC session, error
    throw new Error('Bearer token not available');
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        url: req.url,
        method: req.method,
      },
      'Error extracting bearer token'
    );
    next(error);
  }
}
