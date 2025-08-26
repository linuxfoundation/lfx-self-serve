// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APP_BASE_HREF } from '@angular/common';
import { REQUEST } from '@angular/core';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import { AuthContext, User } from '@lfx-pcc/shared/interfaces';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { auth, ConfigParams } from 'express-openid-connect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import pinoHttp from 'pino-http';
import pinoPretty from 'pino-pretty';

import { extractBearerToken } from './middleware/auth-token.middleware';
import { apiErrorHandler } from './middleware/error-handler.middleware';
import { tokenRefreshMiddleware } from './middleware/token-refresh.middleware';
import committeesRouter from './routes/committees';
import meetingsRouter from './routes/meetings';
import permissionsRouter from './routes/permissions';
import projectsRouter from './routes/projects';

if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config();
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const angularApp = new AngularNodeAppEngine();
const app = express();

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
      paths: ['access_token', 'refresh_token', 'authorization', 'cookie', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
    paths: ['access_token', 'refresh_token', 'authorization', 'cookie', 'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
  authRequired: true,
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
};

app.use(auth(authConfig));

app.use(tokenRefreshMiddleware);

// Apply bearer token middleware to all API routes
app.use('/api', extractBearerToken);

// Mount API routes before Angular SSR
app.use('/api/projects', projectsRouter);
app.use('/api/projects', permissionsRouter);
app.use('/api/committees', committeesRouter);
app.use('/api/meetings', meetingsRouter);

// Add API error handler middleware
app.use('/api/*', apiErrorHandler);

/**
 * Handle all other requests by rendering the Angular application.
 * Require authentication for all non-API routes.
 */
app.use('/**', (req: Request, res: Response, next: NextFunction) => {
  const auth: AuthContext = {
    authenticated: false,
    user: null,
  };

  if (req.oidc?.isAuthenticated()) {
    auth.authenticated = true;
    auth.user = req.oidc?.user as User;
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
          stack: process.env['NODE_ENV'] !== 'production' ? error.stack : undefined,
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
