// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AuthConfig, AuthDecision, AuthMiddlewareResult, RouteAuthConfig, TokenExtractionResult } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';

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

  // Meetings - Angular SSR route with optional authentication
  { pattern: '/meetings', type: 'ssr', auth: 'optional' },

  // Protected API routes - require authentication and token
  { pattern: '/api', type: 'api', auth: 'required', tokenRequired: true },

  // All other routes - Angular SSR routes with optional authentication
  { pattern: '/', type: 'ssr', auth: 'optional' },
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
  req.log.debug(
    {
      path: req.path,
      hasOidc: !!req.oidc,
      isAuthenticated: req.oidc?.isAuthenticated(),
      cookies: Object.keys(req.cookies || {}),
    },
    'Authentication check debug'
  );

  const authenticated = req.oidc?.isAuthenticated() ?? false;
  req.log.debug({ path: req.path, authenticated }, authenticated ? 'Authentication check successful' : 'Authentication check failed - not authenticated');

  return authenticated;
}

/**
 * Extracts bearer token from OIDC session if available
 */
async function extractBearerToken(req: Request): Promise<TokenExtractionResult> {
  try {
    req.log.debug(
      {
        path: req.path,
        hasOidc: !!req.oidc,
        isAuthenticated: req.oidc?.isAuthenticated(),
        hasAccessToken: !!req.oidc?.accessToken,
        isTokenExpired: req.oidc?.accessToken?.isExpired(),
        tokenValue: req.oidc?.accessToken?.access_token ? 'present' : 'missing',
      },
      'Bearer token extraction debug'
    );

    if (req.oidc?.isAuthenticated()) {
      // Check if token exists and is expired
      if (req.oidc.accessToken?.isExpired()) {
        try {
          // Attempt to refresh the token
          const refreshedToken = await req.oidc.accessToken.refresh();
          if (refreshedToken?.access_token) {
            req.bearerToken = refreshedToken.access_token;
            req.log.debug({ path: req.path }, 'Token refreshed successfully');
            return { success: true, needsLogout: false };
          }
        } catch (refreshError) {
          req.log.warn(
            {
              error: refreshError instanceof Error ? refreshError.message : refreshError,
              path: req.path,
            },
            'Token refresh failed - logging user out'
          );
          // Token refresh failed, user needs to re-authenticate
          return { success: false, needsLogout: true };
        }
      } else if (req.oidc.accessToken?.access_token) {
        // Token exists and is not expired
        const accessToken = req.oidc.accessToken.access_token;
        if (typeof accessToken === 'string') {
          req.bearerToken = accessToken;
          req.log.debug({ path: req.path }, 'Bearer token successfully extracted');
          return { success: true, needsLogout: false };
        }
      }
    }
  } catch (error) {
    req.log.warn(
      {
        error: error instanceof Error ? error.message : error,
        path: req.path,
      },
      'Failed to extract bearer token'
    );
  }

  req.log.debug({ path: req.path }, 'No bearer token extracted');
  return { success: false, needsLogout: false };
}

/**
 * Makes authentication decision based on route config and auth status
 */
function makeAuthDecision(result: AuthMiddlewareResult, req: Request): AuthDecision {
  const { route, authenticated, hasToken, needsLogout } = result;

  // If user needs logout due to failed token refresh
  if (needsLogout) {
    req.log.info(
      {
        path: req.path,
        routeType: route.type,
        method: req.method,
      },
      'Token refresh failed - determining response based on request type'
    );

    // For API routes or non-GET requests, return 401 instead of logout redirect
    // This prevents breaking XHR/Fetch clients that can't handle HTML redirects
    if (route.type === 'api' || req.method !== 'GET') {
      req.log.info(
        {
          path: req.path,
          routeType: route.type,
          method: req.method,
        },
        'API route or non-GET request - returning 401 instead of logout redirect'
      );
      return {
        action: 'error',
        errorType: 'authentication',
        statusCode: 401,
      };
    }

    // For SSR GET requests, proceed with logout redirect
    req.log.info(
      {
        path: req.path,
        routeType: route.type,
        method: req.method,
      },
      'SSR GET request - proceeding with logout redirect'
    );
    return { action: 'logout' };
  }

  // Public routes - always allow
  if (route.auth === 'public') {
    req.log.debug(
      {
        path: req.path,
        routeType: route.type,
        authLevel: route.auth,
      },
      'Public route - allowing access'
    );
    return { action: 'allow' };
  }

  // Optional auth routes - always allow but may have enhanced features
  if (route.auth === 'optional') {
    req.log.debug(
      {
        path: req.path,
        routeType: route.type,
        authLevel: route.auth,
        authenticated,
        hasToken,
      },
      'Optional auth route - allowing access'
    );
    return { action: 'allow' };
  }

  // Required auth routes
  if (route.auth === 'required') {
    if (!authenticated) {
      // SSR routes - redirect to login
      if (route.type === 'ssr' && req.method === 'GET') {
        req.log.info(
          {
            path: req.path,
            routeType: route.type,
            method: req.method,
          },
          'SSR route requires authentication - redirecting to login'
        );
        return {
          action: 'redirect',
          redirectUrl: `/login?returnTo=${encodeURIComponent(req.originalUrl)}`,
        };
      }

      // Non-GET SSR routes - return 401 error
      if (route.type === 'ssr' && req.method !== 'GET') {
        req.log.warn(
          {
            path: req.path,
            routeType: route.type,
            method: req.method,
          },
          'SSR route requires authentication for non-GET request - returning 401'
        );
        return {
          action: 'error',
          errorType: 'authentication',
          statusCode: 401,
        };
      }

      // API routes - return 401 error
      if (route.type === 'api') {
        req.log.warn(
          {
            path: req.path,
            routeType: route.type,
            method: req.method,
          },
          'API route requires authentication - returning 401'
        );
        return {
          action: 'error',
          errorType: 'authentication',
          statusCode: 401,
        };
      }
    }

    // Token validation for API routes
    if (route.tokenRequired && !hasToken) {
      req.log.warn(
        {
          path: req.path,
          authenticated,
          hasToken,
        },
        'API route requires bearer token - returning 401'
      );
      return {
        action: 'error',
        errorType: 'authentication',
        statusCode: 401,
      };
    }
  }

  req.log.debug(
    {
      path: req.path,
      routeType: route.type,
      authLevel: route.auth,
      authenticated,
      hasToken,
    },
    'Authentication check passed - allowing access'
  );

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
      req.log.info(
        {
          path: req.path,
          originalUrl: req.originalUrl,
        },
        'Logging user out due to token refresh failure'
      );
      res.oidc.logout();
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
    const startTime = Date.now();

    try {
      // 1. Route classification
      const routeConfig = classifyRoute(req.path, config);

      req.log.debug(
        {
          path: req.path,
          method: req.method,
          routeType: routeConfig.type,
          authLevel: routeConfig.auth,
          tokenRequired: routeConfig.tokenRequired,
        },
        'Starting authentication check'
      );

      // 2. Authentication status check
      const authenticated = checkAuthentication(req);

      // 3. Token extraction (if needed)
      let hasToken = false;
      let needsLogout = false;
      if (routeConfig.tokenRequired || routeConfig.auth === 'optional') {
        const tokenResult = await extractBearerToken(req);
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

      const duration = Date.now() - startTime;
      req.log.debug(
        {
          path: req.path,
          decision: decision.action,
          authenticated,
          hasToken,
          duration,
        },
        'Authentication check completed'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      req.log.error(
        {
          error: error instanceof Error ? error.message : error,
          path: req.path,
          method: req.method,
          duration,
        },
        'Error in authentication middleware'
      );
      next(error);
    }
  };
}

/**
 * Default authentication middleware instance
 */
export const authMiddleware = createAuthMiddleware();
