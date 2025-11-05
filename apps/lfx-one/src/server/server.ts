// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APP_BASE_HREF } from '@angular/common';
import { REQUEST } from '@angular/core';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import { AuthContext, User } from '@lfx-one/shared/interfaces';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { auth, ConfigParams } from 'express-openid-connect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pinoHttp from 'pino-http';
import pinoPretty from 'pino-pretty';

import { validateAndSanitizeUrl } from './helpers/url-validation';
import { authMiddleware } from './middleware/auth.middleware';
import { apiErrorHandler } from './middleware/error-handler.middleware';
import analyticsRouter from './routes/analytics.route';
import committeesRouter from './routes/committees.route';
import meetingsRouter from './routes/meetings.route';
import organizationsRouter from './routes/organizations.route';
import pastMeetingsRouter from './routes/past-meetings.route';
import profileRouter from './routes/profile.route';
import projectsRouter from './routes/projects.route';
import publicMeetingsRouter from './routes/public-meetings.route';
import searchRouter from './routes/search.route';

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

/**
 * Base Pino logger instance for server-level operations.
 *
 * Used for:
 * - Server startup/shutdown messages
 * - Direct logging from server code outside request context
 * - Operations that don't have access to req.log
 * - Can be imported by other modules for consistent logging
 */
// Create pretty stream conditionally for development
const prettyStream =
  process.env['NODE_ENV'] !== 'production'
    ? pinoPretty({
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      })
    : process.stdout;

const serverLogger = pino(
  {
    level: process.env['LOG_LEVEL'] || 'info',
    redact: {
      paths:
        process.env['NODE_ENV'] !== 'production'
          ? ['req.headers.*', 'res.headers.*', 'access_token', 'refresh_token', 'authorization', 'cookie']
          : ['access_token', 'refresh_token', 'authorization', 'cookie', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      remove: true,
    },
    formatters: {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream
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
    index: 'index.html',
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
  autoLogging: {
    ignore: (req: Request) => {
      return req.url === '/health' || req.url === '/api/health';
    },
  },
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

app.use('/login', (req: Request, res: Response) => {
  if (req.oidc?.isAuthenticated()) {
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
app.use('/api/meetings', meetingsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/past-meetings', pastMeetingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/search', searchRouter);
app.use('/api/analytics', analyticsRouter);

// Add API error handler middleware
app.use('/api/*', apiErrorHandler);

/**
 * Handle all other requests by rendering the Angular application.
 * Require authentication for all non-API routes.
 */
app.use('/**', async (req: Request, res: Response, next: NextFunction) => {
  const auth: AuthContext = {
    authenticated: false,
    user: null,
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
      req.log.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          path: req.path,
        },
        'Failed to fetch user info, using basic user data'
      );

      res.oidc.logout();
      return;
    }
  }

  angularApp
    .handle(req, {
      auth,
      providers: [
        { provide: APP_BASE_HREF, useValue: process.env['PCC_BASE_URL'] },
        { provide: REQUEST, useValue: req },
        { provide: 'RESPONSE', useValue: res },
      ],
    })
    .then((response) => {
      if (response) {
        return writeResponseToNodeResponse(response, res);
      }

      return next();
    })
    .catch((error) => {
      req.log.error(
        {
          error: error.message,
          code: error.code,
          url: req.url,
          method: req.method,
          user_agent: req.get('User-Agent'),
        },
        'Error rendering Angular application'
      );

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
    serverLogger.info(
      {
        port,
        url: `http://localhost:${port}`,
        node_env: process.env['NODE_ENV'] || 'development',
        pm2: process.env['PM2'] === 'true',
      },
      'Node Express server started'
    );
  });
}

/**
 * Export server logger for use in other modules that need logging
 * outside of the HTTP request context (e.g., startup scripts, utilities).
 */
export { serverLogger };

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
