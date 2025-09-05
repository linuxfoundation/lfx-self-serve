// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';

/**
 * Selective authentication middleware - only /meeting routes are public
 * All other routes require authentication
 */
export async function protectedRoutesMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Allow /meetings routes to be accessed without authentication
  if (req.path.startsWith('/meetings') || req.path.startsWith('/public/api')) {
    next();
    return;
  }

  // If user is not authenticated, handle authentication
  if (!req.oidc?.isAuthenticated()) {
    req.log.debug('No authentication detected', {
      is_authenticated: req.oidc?.isAuthenticated(),
      path: req.path,
      method: req.method,
    });

    // For GET requests to non-API routes, redirect to login page
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      req.log.info('Redirecting unauthenticated user to login page');
      await res.oidc.login({ returnTo: req.originalUrl });
      return;
    }

    // For API routes, return authentication error
    if (req.path.startsWith('/api')) {
      const error = new AuthenticationError('Authentication required to access this resource', {
        operation: 'protected_routes_middleware',
        service: 'protected_routes_middleware',
        path: req.path,
      });
      next(error);
      return;
    }
  }

  // Refresh token if expired
  if (req.oidc?.isAuthenticated() && req.oidc.accessToken?.isExpired()) {
    req.log.info('Token expired, refreshing token');
    req.log.debug('Token expired, refreshing token', {
      is_authenticated: req.oidc?.isAuthenticated(),
      is_expired: req.oidc.accessToken?.isExpired(),
    });

    try {
      await req.oidc.accessToken.refresh();
    } catch {
      // If refresh token fails, redirect to login page
      if (!req.path.startsWith('/api')) {
        req.log.info('Redirecting unauthenticated user to login page');
        await res.oidc.login({ returnTo: req.originalUrl });
        return;
      }

      // For API routes, return authentication error
      const error = new AuthenticationError('Authentication required to access this resource', {
        operation: 'protected_routes_middleware',
        service: 'protected_routes_middleware',
        path: req.path,
      });
      next(error);
      return;
    }
  }

  next();
}
