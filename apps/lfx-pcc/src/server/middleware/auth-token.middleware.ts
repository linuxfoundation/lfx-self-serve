// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

export function extractBearerToken(req: Request, _res: Response, next: NextFunction): void {
  try {
    // For API routes, check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      req.bearerToken = authHeader.substring(7);
      return next();
    }

    // Fall back to OIDC session if available
    if (req.oidc?.isAuthenticated()) {
      const accessToken = req.oidc.accessToken?.access_token;
      if (accessToken && typeof accessToken === 'string') {
        req.bearerToken = accessToken;
        return next();
      }
    }

    // Check if this is an internal SSR request (from Angular during rendering)
    const userAgent = req.get('User-Agent');
    const isInternalRequest = !userAgent || userAgent.includes('LFX-PCC-Server');

    if (isInternalRequest) {
      // For SSR requests, we'll need to handle authentication differently
      // For now, let's see if we can use a fallback token or skip auth
      throw new Error('SSR request without authentication context');
    }

    // If neither Authorization header nor OIDC session, error
    throw new Error('Bearer token not available');
  } catch (error) {
    next(error);
  }
}
