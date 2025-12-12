// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AuthConfig, AuthDecision, AuthMiddlewareResult, RouteAuthConfig, TokenExtractionResult } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';

// OIDC middleware already provides req.oidc with authentication context

/**
 * Default route configuration for the application
 * Ordered by specificity - more specific patterns should come first
 */
const DEFAULT_ROUTE_CONFIG: RouteAuthConfig[] = [
  // Health check - completely public
  { pattern: '/health', type: 'api', auth: 'public' },

  // Public API routes - optional authentication with token benefits
  { pattern: '/public/api', type: 'api', auth: 'optional', tokenRequired: false },

  // Public meeting join - no authentication required
  { pattern: '/meetings/', type: 'ssr', auth: 'optional' },

  // Protected API routes - require authentication and token
  { pattern: '/api', type: 'api', auth: 'required', tokenRequired: true },

  // All other routes - Angular SSR routes requiring authentication
  { pattern: '/', type: 'ssr', auth: 'required' },
];

/**
 * Default configuration for authentication middleware
 */
const DEFAULT_CONFIG: AuthConfig = {
  routes: DEFAULT_ROUTE_CONFIG,
  defaultAuth: 'required',
  defaultType: 'ssr',
};

/**
 * Classifies a route based on the request path and route configuration
 */
function classifyRoute(path: string, config: AuthConfig): RouteAuthConfig {
  for (const routeConfig of config.routes) {
    if (typeof routeConfig.pattern === 'string') {
      if (path.startsWith(routeConfig.pattern)) {
        return routeConfig;
      }
    } else if (routeConfig.pattern.test(path)) {
      return routeConfig;
    }
  }

  // Default fallback
  return {
    pattern: '/',
    type: config.defaultType,
    auth: config.defaultAuth,
  };
}

/**
 * Checks authentication status from OIDC session
 */
function checkAuthentication(req: Request): boolean {
  logger.debug(req, 'auth_check', 'Authentication check debug', {
    path: req.path,
    hasOidc: !!req.oidc,
    isAuthenticated: req.oidc?.isAuthenticated(),
    cookies: Object.keys(req.cookies || {}),
  });

  const authenticated = req.oidc?.isAuthenticated() ?? false;
  const message = authenticated ? 'Authentication check successful' : 'Authentication check failed - not authenticated';
  logger.debug(req, 'auth_check', message, { path: req.path, authenticated });

  return authenticated;
}

/**
 * Extracts bearer token from OIDC session if available
 * @param req - Express request object
 * @param attemptRefresh - Whether to attempt token refresh if expired (default: true)
 */
async function extractBearerToken(req: Request, attemptRefresh: boolean = true): Promise<TokenExtractionResult> {
  const startTime = logger.startOperation(req, 'token_extraction', {
    path: req.path,
    hasOidc: !!req.oidc,
    isAuthenticated: req.oidc?.isAuthenticated(),
    hasAccessToken: !!req.oidc?.accessToken,
    isTokenExpired: req.oidc?.accessToken?.isExpired(),
    tokenValue: req.oidc?.accessToken?.access_token ? 'present' : 'missing',
    attemptRefresh,
  });

  try {
    if (req.oidc?.isAuthenticated()) {
      // Check if token exists and is expired
      if (req.oidc.accessToken?.isExpired()) {
        // For optional routes, don't attempt refresh - just skip token extraction
        if (!attemptRefresh) {
          logger.success(req, 'token_extraction', startTime, {
            path: req.path,
            token_extracted: false,
            reason: 'skipped_refresh_optional_route',
          });
          return { success: false, needsLogout: false };
        }

        try {
          // Attempt to refresh the token
          const refreshedToken = await req.oidc.accessToken.refresh();
          if (refreshedToken?.access_token) {
            req.bearerToken = refreshedToken.access_token;
            logger.success(req, 'token_refresh', startTime, { path: req.path });
            return { success: true, needsLogout: false };
          }
        } catch (refreshError) {
          logger.error(req, 'token_extraction', startTime, refreshError, {
            path: req.path,
            failure_reason: 'token_refresh_failed',
          });
          // Token refresh failed, user needs to re-authenticate
          return { success: false, needsLogout: true };
        }
      } else if (req.oidc.accessToken?.access_token) {
        // Token exists and is not expired
        const accessToken = req.oidc.accessToken.access_token;
        if (typeof accessToken === 'string') {
          req.bearerToken = accessToken;
          logger.success(req, 'token_extraction', startTime, { path: req.path });
          return { success: true, needsLogout: false };
        }
      }
    }
  } catch (error) {
    logger.error(req, 'token_extraction', startTime, error, {
      path: req.path,
      failure_reason: 'extraction_error',
    });
    return { success: false, needsLogout: false };
  }

  logger.success(req, 'token_extraction', startTime, {
    path: req.path,
    token_extracted: false,
    reason: 'not_authenticated',
  });
  return { success: false, needsLogout: false };
}

/**
 * Makes authentication decision based on route config and auth status
 */
function makeAuthDecision(result: AuthMiddlewareResult, req: Request): AuthDecision {
  const { route, authenticated, hasToken, needsLogout } = result;

  // Public routes - always allow (check first to short-circuit)
  if (route.auth === 'public') {
    logger.debug(req, 'auth_decision', 'Public route - allowing access', {
      path: req.path,
      routeType: route.type,
      authLevel: route.auth,
    });
    return { action: 'allow' };
  }

  // Optional auth routes - always allow but may have enhanced features
  // Check this BEFORE needsLogout to ensure optional routes aren't blocked
  // when token refresh fails (the token is optional, so failure is acceptable)
  if (route.auth === 'optional') {
    // For optional routes where token is not required, don't fail on token refresh issues
    if (!route.tokenRequired && needsLogout) {
      logger.debug(req, 'auth_decision', 'Optional auth route with tokenRequired=false - ignoring token refresh failure', {
        path: req.path,
        routeType: route.type,
        authLevel: route.auth,
        tokenRequired: route.tokenRequired,
      });
    }

    logger.debug(req, 'auth_decision', 'Optional auth route - allowing access', {
      path: req.path,
      routeType: route.type,
      authLevel: route.auth,
      authenticated,
      hasToken,
    });
    return { action: 'allow' };
  }

  // If user needs logout due to failed token refresh (only for required auth routes now)
  if (needsLogout) {
    logger.warning(req, 'auth_token_refresh_failure', 'Token refresh failed - user needs logout', {
      path: req.path,
      routeType: route.type,
      method: req.method,
    });

    // For API routes or non-GET requests, return 401 instead of logout redirect
    // This prevents breaking XHR/Fetch clients that can't handle HTML redirects
    if (route.type === 'api' || req.method !== 'GET') {
      logger.debug(req, 'auth_decision_401', 'Returning 401 for API route or non-GET request', {
        path: req.path,
        routeType: route.type,
        method: req.method,
      });
      return {
        action: 'error',
        errorType: 'authentication',
        statusCode: 401,
      };
    }

    // For SSR GET requests, proceed with logout redirect
    logger.debug(req, 'auth_decision_logout', 'Proceeding with logout redirect for SSR GET request', {
      path: req.path,
      routeType: route.type,
      method: req.method,
    });
    return { action: 'logout' };
  }

  // Required auth routes
  if (route.auth === 'required') {
    if (!authenticated) {
      // SSR routes - redirect to login
      if (route.type === 'ssr' && req.method === 'GET') {
        logger.debug(req, 'auth_decision_redirect_login', 'Redirecting to login for unauthenticated SSR GET request', {
          path: req.path,
          routeType: route.type,
          method: req.method,
        });
        return {
          action: 'redirect',
          redirectUrl: `/login?returnTo=${encodeURIComponent(req.originalUrl)}`,
        };
      }

      // Non-GET SSR routes - return 401 error
      if (route.type === 'ssr' && req.method !== 'GET') {
        logger.warning(req, 'auth_check', 'SSR route requires authentication for non-GET request - returning 401', {
          path: req.path,
          routeType: route.type,
          method: req.method,
        });
        return {
          action: 'error',
          errorType: 'authentication',
          statusCode: 401,
        };
      }

      // API routes - return 401 error
      if (route.type === 'api') {
        logger.warning(req, 'auth_check', 'API route requires authentication - returning 401', {
          path: req.path,
          routeType: route.type,
          method: req.method,
        });
        return {
          action: 'error',
          errorType: 'authentication',
          statusCode: 401,
        };
      }
    }

    // Token validation for API routes
    if (route.tokenRequired && !hasToken) {
      logger.warning(req, 'auth_check', 'API route requires bearer token - returning 401', {
        path: req.path,
        authenticated,
        hasToken,
      });
      return {
        action: 'error',
        errorType: 'authentication',
        statusCode: 401,
      };
    }
  }

  logger.debug(req, 'auth_decision', 'Authentication check passed - allowing access', {
    path: req.path,
    routeType: route.type,
    authLevel: route.auth,
    authenticated,
    hasToken,
  });

  return { action: 'allow' };
}

/**
 * Executes the authentication decision
 */
async function executeAuthDecision(decision: AuthDecision, req: Request, res: Response, next: NextFunction): Promise<void> {
  switch (decision.action) {
    case 'allow':
      next();
      break;

    case 'redirect':
      if (decision.redirectUrl) {
        // Use OIDC login method which handles the redirect properly
        res.oidc.login({ returnTo: req.originalUrl });
      } else {
        res.redirect('/');
      }
      break;

    case 'logout':
      // Log user out due to token refresh failure
      logger.debug(req, 'auth_logout_execution', 'Executing logout due to token refresh failure', {
        path: req.path,
        originalUrl: req.originalUrl,
      });
      // Redirect to home page after logout to avoid redirect loops
      res.oidc.logout({ returnTo: '/' });
      break;

    case 'error': {
      const error = new AuthenticationError(
        decision.errorType === 'authorization' ? 'Insufficient permissions to access this resource' : 'Authentication required to access this resource',
        {
          operation: 'auth_middleware',
          service: 'authentication',
          path: req.path,
        }
      );
      next(error);
      break;
    }
  }
}

/**
 *  authentication middleware that handles all authentication scenarios
 * for both SSR routes and API endpoints
 */
export function createAuthMiddleware(config: AuthConfig = DEFAULT_CONFIG) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = logger.startOperation(req, 'auth_middleware', {
      path: req.path,
      method: req.method,
    });

    try {
      // 1. Route classification
      const routeConfig = classifyRoute(req.path, config);

      logger.debug(req, 'auth_middleware', 'Starting authentication check', {
        path: req.path,
        method: req.method,
        routeType: routeConfig.type,
        authLevel: routeConfig.auth,
        tokenRequired: routeConfig.tokenRequired,
      });

      // 2. Authentication status check
      const authenticated = checkAuthentication(req);

      // 3. Token extraction (if needed)
      let hasToken = false;
      let needsLogout = false;
      if (routeConfig.tokenRequired || routeConfig.auth === 'optional') {
        // For optional routes, don't attempt token refresh to avoid redirect loops
        // when refresh token is invalid - just use existing valid token or none
        const attemptRefresh = routeConfig.auth !== 'optional';
        const tokenResult = await extractBearerToken(req, attemptRefresh);
        hasToken = tokenResult.success;
        needsLogout = tokenResult.needsLogout;
      }

      // 4. Authentication context is already available in req.oidc

      // 5. Build result for decision making
      const result: AuthMiddlewareResult = {
        route: routeConfig,
        authenticated,
        hasToken,
        needsLogout,
      };

      // 6. Make authentication decision
      const decision = makeAuthDecision(result, req);

      // 7. Execute decision
      await executeAuthDecision(decision, req, res, next);

      logger.success(req, 'auth_middleware', startTime, {
        path: req.path,
        decision: decision.action,
        authenticated,
        hasToken,
      });
    } catch (error) {
      logger.error(req, 'auth_middleware', startTime, error, {
        path: req.path,
        method: req.method,
      });
      next(error);
    }
  };
}

/**
 * Default authentication middleware instance
 */
export const authMiddleware = createAuthMiddleware();
