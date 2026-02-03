// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APP_BASE_HREF } from '@angular/common';
import { REQUEST } from '@angular/core';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import { AuthContext, RuntimeConfig, User } from '@lfx-one/shared/interfaces';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { attemptSilentLogin, auth, ConfigParams } from 'express-openid-connect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { customErrorSerializer } from './helpers/error-serializer';
import { validateAndSanitizeUrl } from './helpers/url-validation';
import { authMiddleware } from './middleware/auth.middleware';
import { apiErrorHandler } from './middleware/error-handler.middleware';
import analyticsRouter from './routes/analytics.route';
import committeesRouter from './routes/committees.route';
import mailingListsRouter from './routes/mailing-lists.route';
import meetingsRouter from './routes/meetings.route';
import organizationsRouter from './routes/organizations.route';
import pastMeetingsRouter from './routes/past-meetings.route';
import profileRouter from './routes/profile.route';
import projectsRouter from './routes/projects.route';
import publicMeetingsRouter from './routes/public-meetings.route';
import searchRouter from './routes/search.route';
import surveysRouter from './routes/surveys.route';
import userRouter from './routes/user.route';
import votesRouter from './routes/votes.route';
import { serverLogger } from './server-logger';
import { logger } from './services/logger.service';
import { matchOrganizationNamesToAccounts } from './utils/organization-matcher';
import { fetchUserPersonaAndOrganizations } from './utils/persona-helper';

if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config();
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const angularApp = new AngularNodeAppEngine();
const app = express();

/**
 * Enable gzip/deflate compression for all responses.
 *
 * Configuration optimized for SSR:
 * - Compresses HTML, CSS, JS, JSON, and other text-based responses
 * - Uses level 6 (balanced compression/speed ratio)
 * - 1KB threshold to avoid compressing small responses
 * - Uses default filter for text-based content types
 */
// Use require to avoid TypeScript type conflicts with @types/compression
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression');
app.use(
  compression({
    level: 6, // Balanced compression level (1=fastest, 9=best compression)
    threshold: 1024, // Only compress responses larger than 1KB
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

/**
 * Serve static files from /browser
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false, // Let Angular SSR handle the index route
  })
);

// Add health endpoint before logger middleware
app.get('/health', (_req: Request, res: Response) => {
  res.send('OK');
});

/**
 * HTTP request/response logging middleware using Pino.
 *
 * Provides:
 * - Automatic HTTP request/response logging
 * - Request-scoped logger accessible via req.log in route handlers
 * - Request correlation and timing
 * - Consistent configuration with serverLogger
 *
 * Usage in routes: req.log.info({...}, 'message')
 */
const httpLogger = pinoHttp({
  logger: serverLogger, // Use the same base logger for consistency
  serializers: {
    err: customErrorSerializer,
    error: customErrorSerializer,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Disable automatic request/response logging - our LoggerService handles operation logging
  autoLogging: false,
  redact: {
    paths:
      process.env['NODE_ENV'] !== 'production'
        ? ['req.headers.*', 'res.headers.*', 'access_token', 'refresh_token', 'authorization', 'cookie']
        : ['access_token', 'refresh_token', 'authorization', 'cookie', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    remove: true,
  },
  level: process.env['LOG_LEVEL'] || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => ({
      pid: bindings['pid'],
      hostname: bindings['hostname'],
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Add HTTP logger middleware after health endpoint to avoid logging health check
app.use(httpLogger);

const authConfig: ConfigParams = {
  authRequired: false, // Disable global auth requirement to handle it in selective middleware
  auth0Logout: true,
  baseURL: process.env['PCC_BASE_URL'] || 'http://localhost:4000',
  clientID: process.env['PCC_AUTH0_CLIENT_ID'] || '1234',
  issuerBaseURL: process.env['PCC_AUTH0_ISSUER_BASE_URL'] || 'https://example.com',
  secret: process.env['PCC_AUTH0_SECRET'] || 'sufficiently-long-string',
  authorizationParams: {
    response_type: 'code',
    audience: process.env['PCC_AUTH0_AUDIENCE'] || 'https://example.com',
    scope: 'openid email profile access:api offline_access',
  },
  clientSecret: process.env['PCC_AUTH0_CLIENT_SECRET'] || 'bar',
  routes: {
    login: false,
  },
};

app.use(auth(authConfig));

// Silent login attempt for meeting join pages only
// If user has SSO session elsewhere, they'll be authenticated automatically
// If not, they proceed as unauthenticated (route is optional auth)
app.use('/meetings/', attemptSilentLogin());

app.use('/login', (req: Request, res: Response) => {
  if (req.oidc?.isAuthenticated() && !req.oidc?.accessToken?.isExpired()) {
    const returnTo = req.query['returnTo'] as string;
    const validatedReturnTo = validateAndSanitizeUrl(returnTo, [process.env['PCC_BASE_URL'] as string]);
    if (validatedReturnTo) {
      res.redirect(validatedReturnTo);
    } else {
      res.redirect('/');
    }
  } else {
    const returnTo = req.query['returnTo'] as string;
    const validatedReturnTo = validateAndSanitizeUrl(returnTo, [process.env['PCC_BASE_URL'] as string]);
    if (validatedReturnTo) {
      res.oidc.login({ returnTo: validatedReturnTo });
    } else {
      res.oidc.login({ returnTo: '/' });
    }
  }
});

// Apply authentication middleware to all routes
app.use(authMiddleware);

// Mount API routes after authentication middleware
// Public API routes
app.use('/public/api/meetings', publicMeetingsRouter);

// Protected API routes
app.use('/api/projects', projectsRouter);
app.use('/api/committees', committeesRouter);
app.use('/api/mailing-lists', mailingListsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/past-meetings', pastMeetingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/search', searchRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/user', userRouter);
app.use('/api/votes', votesRouter);
app.use('/api/surveys', surveysRouter);

// Add API error handler middleware
app.use('/api/*', apiErrorHandler);

/**
 * Handle all other requests by rendering the Angular application.
 * Require authentication for all non-API routes.
 */
app.use('/**', async (req: Request, res: Response, next: NextFunction) => {
  const ssrStartTime = Date.now(); // Capture start time for duration tracking
  const auth: AuthContext = {
    authenticated: false,
    user: null,
    persona: null,
    organizations: [],
  };

  if (req.oidc?.isAuthenticated() && !req.oidc?.accessToken?.isExpired()) {
    auth.authenticated = true;
    try {
      // Fetch user info from OIDC
      auth.user = req.oidc?.user as User;

      if (!auth.user?.name) {
        auth.user = await req.oidc.fetchUserInfo();
      }
    } catch (error) {
      // If userinfo fetch fails, fall back to basic user info from token
      logger.warning(req, 'ssr_user_info', 'Failed to fetch user info, using basic user data', {
        err: error,
        path: req.path,
      });

      res.oidc.logout();
      return;
    }

    // Fetch user persona and organizations based on committee membership (non-critical, don't block SSR)
    // Note: fetchUserPersonaAndOrganizations handles errors internally and returns defaults on failure
    const personaResult = await fetchUserPersonaAndOrganizations(req);
    auth.persona = personaResult.persona;

    // Match organization names to predefined accounts
    auth.organizations = matchOrganizationNamesToAccounts(personaResult.organizationNames);
  }

  // Build runtime config from environment variables
  const runtimeConfig: RuntimeConfig = {
    launchDarklyClientId: process.env['LD_CLIENT_ID'] || '',
    dataDogRumClientId: process.env['DD_RUM_CLIENT_ID'] || '',
    dataDogRumApplicationId: process.env['DD_RUM_APPLICATION_ID'] || '',
  };

  angularApp
    .handle(req, {
      auth,
      runtimeConfig,
      providers: [
        { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
        { provide: REQUEST, useValue: req },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }

      return next();
    })
    .catch((error) => {
      logger.error(req, 'ssr_render', ssrStartTime, error, {
        error_message: error.message,
        code: error.code,
        url: req.url,
        method: req.method,
        user_agent: req.get('User-Agent'),
      });

      if (error.code === 'NOT_FOUND') {
        res.status(404).send('Not Found');
      } else if (error.code === 'UNAUTHORIZED') {
        res.status(401).send('Unauthorized');
      } else {
        res.status(500).send('Internal Server Error');
      }
    });
});

// Global error handler for all routes (must be last)
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    next(error);
    return;
  }

  // Use the same error handler logic for all routes
  apiErrorHandler(error, req, res, next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
export function startServer() {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    logger.debug(undefined, 'server_startup', 'Node Express server started', {
      port,
      url: `http://localhost:${port}`,
      node_env: process.env['NODE_ENV'] || 'development',
      pm2: process.env['PM2'] === 'true',
    });
  });
}

const metaUrl = import.meta.url;
const isMain = isMainModule(metaUrl);
const isPM2 = process.env['PM2'] === 'true';

if (isMain || isPM2) {
  startServer();
}

/**
 * The request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
