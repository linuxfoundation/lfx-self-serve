// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { APP_BASE_HREF } from '@angular/common';
import { REQUEST } from '@angular/core';
import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import { AuthContext, RuntimeConfig, User } from '@lfx-one/shared/interfaces';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { attemptSilentLogin, auth, ConfigParams } from 'express-openid-connect';
import { Server as HttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pinoHttp from 'pino-http';

import { ProfileController } from './controllers/profile.controller';
import { customErrorSerializer } from './helpers/error-serializer';
import { validateAndSanitizeUrl } from './helpers/url-validation';
import { authMiddleware } from './middleware/auth.middleware';
import { apiErrorHandler } from './middleware/error-handler.middleware';
import { apiRateLimiter, authRateLimiter, publicApiRateLimiter } from './middleware/rate-limit.middleware';
import analyticsRouter from './routes/analytics.route';
import inviteRouter from './routes/invite.route';
import badgesRouter from './routes/badges.route';
import changelogRouter from './routes/changelog.route';
import committeesRouter from './routes/committees.route';
import copilotRouter from './routes/copilot.route';
import documentsRouter from './routes/documents.route';
import eventsRouter from './routes/events.route';
import impersonationRouter from './routes/impersonation.route';
import mailingListsRouter from './routes/mailing-lists.route';
import meetingsRouter from './routes/meetings.route';
import navigationRouter from './routes/navigation.route';
import newslettersRouter from './routes/newsletters.route';
import organizationsRouter from './routes/organizations.route';
import orgsRouter from './routes/orgs.route';
import pastMeetingsRouter from './routes/past-meetings.route';
import personaRouter from './routes/persona.route';
import profileRouter from './routes/profile.route';
import projectsRouter from './routes/projects.route';
import publicCommitteesRouter from './routes/public-committees.route';
import publicMeetingsRouter from './routes/public-meetings.route';
import publicProjectsRouter from './routes/public-projects.route';
import rewardsRouter from './routes/rewards.route';
import searchRouter from './routes/search.route';
import sitemapRouter from './routes/sitemap.route';
import surveysRouter from './routes/surveys.route';
import trainingRouter from './routes/training.route';
import enrollmentRouter from './routes/enrollment.route';
import transactionRouter from './routes/transaction.route';
import userRouter from './routes/user.route';
import votesRouter from './routes/votes.route';
import { reqSerializer, resSerializer, serverLogger } from './server-logger';
import { logger } from './services/logger.service';
import { NatsService } from './services/nats.service';
import { SnowflakeService } from './services/snowflake.service';
import { clearImpersonationSession, decodeJwtPayload } from './utils/auth-helper';
import { isShuttingDown, markShuttingDown, runShutdownHooks } from './utils/shutdown';
import { resolvePersonaForSsr } from './utils/persona-helper';

if (process.env['NODE_ENV'] !== 'production') {
  dotenv.config();
}

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const angularApp = new AngularNodeAppEngine();
const app = express();

// Trust first proxy so req.ip resolves from X-Forwarded-For.
app.set('trust proxy', 1);

// require() avoids TS type conflicts with @types/compression.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require('compression');
app.use(
  compression({
    level: 6,
    threshold: 1024,
  })
);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Liveness and readiness endpoints registered before the static handler,
// logger, auth, and rate-limit middleware so:
//   - probes are served directly with no filesystem lookup (no I/O overhead
//     on frequent Kubernetes probe traffic)
//   - probe traffic is not request-logged
//   - endpoints are always reachable unauthenticated
// auth.middleware.ts lists /livez and /readyz as public.
app.get('/livez', (_req: Request, res: Response) => {
  res.send('OK');
});

// Readiness endpoint for Kubernetes (LFXV2-1640).
// Signals that this pod can accept HTTP traffic: Express is listening and the
// Angular SSR engine loaded successfully (constructed at module load above —
// a load failure crashes the process before reaching this point).
// Intentionally does NOT probe NATS / Snowflake / microservice-proxy: those
// clients are lazy-initialized and report not-connected at startup even
// though many SSR pages render fine without them. Per-feature dependency
// failures are handled at the route level, not by pulling the whole pod out
// of the Service endpoints list.
app.get('/readyz', (_req: Request, res: Response) => {
  if (isShuttingDown()) {
    res.status(503).json({ status: 'shutting_down' });
    return;
  }
  res.status(200).json({ status: 'ready' });
});

// Public docs sitemap (LFXV2-2001) — served from a dedicated route so:
//   - the build script can regenerate dist-docs/sitemap.xml without touching the Angular browser bundle
//   - crawlers get a deterministic Content-Type and Cache-Control without going through Angular SSR
//   - it sits BEFORE the express.static() catch-all so the static handler never claims this path
// Auth middleware classifies /sitemap.xml as public (see auth.middleware.ts), so even though this
// handler is registered before authMiddleware below, the public classification is the source of truth
// for any code path that does fall through.
app.use(sitemapRouter);

app.get(
  '**',
  express.static(browserDistFolder, {
    index: false,
    setHeaders: (res, filePath) => {
      if (/-[A-Z0-9]{8,}\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/i.test(filePath)) {
        // Angular emits content-hashed filenames (outputHashing: "all") — safe to
        // cache permanently; the hash changes whenever content changes.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (/\.(html|js|css)$/i.test(filePath)) {
        // Non-hashed HTML, JS, and CSS (e.g. index.html, main.js in dev builds where
        // outputHashing is not "all") must revalidate on every request — stale entry
        // bundles reference old chunk hashes and cause "Importing a module script failed".
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
    },
  })
);

const httpLogger = pinoHttp({
  logger: serverLogger,
  serializers: {
    err: customErrorSerializer,
    error: customErrorSerializer,
    req: reqSerializer,
    res: resSerializer,
  },
  // LoggerService handles operation logging.
  autoLogging: false,
});

app.use(httpLogger);

const authConfig: ConfigParams = {
  // Global auth disabled; selective middleware handles it.
  authRequired: false,
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

// Meeting join pages are optional-auth; silent login picks up any existing SSO session.
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

app.use(authMiddleware);

app.use('/public/api/', publicApiRateLimiter);
app.use('/api/', apiRateLimiter);
app.use('/login', authRateLimiter);

app.use('/public/api/meetings', publicMeetingsRouter);
app.use('/public/api/committees', publicCommitteesRouter);
app.use('/public/api/projects', publicProjectsRouter);

app.use('/api/projects', projectsRouter);
app.use('/api/committees', committeesRouter);
app.use('/api/mailing-lists', mailingListsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/organizations', organizationsRouter);
app.use('/api/orgs', orgsRouter);
app.use('/api/past-meetings', pastMeetingsRouter);
app.use('/api/profile', profileRouter);
app.use('/api/search', searchRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/user', userRouter);
app.use('/api/user', personaRouter);
app.use('/api/nav', navigationRouter);
app.use('/api/votes', votesRouter);
app.use('/api/surveys', surveysRouter);
app.use('/api/copilot', copilotRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/badges', badgesRouter);
app.use('/api/impersonate', impersonationRouter);
app.use('/api/training', trainingRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/enrollments', enrollmentRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/changelog', changelogRouter);
app.use('/api/projects/:projectUid/newsletters', newslettersRouter);
app.use('/api/invite', inviteRouter);

app.use('/api/*', apiErrorHandler);

// Profile auth callback registered in Auth0 Profile Client.
const profileCallbackController = new ProfileController();
app.get('/passwordless/callback', authRateLimiter, (req, res) => profileCallbackController.handleProfileAuthCallback(req, res));

// GitHub/LinkedIn OAuth redirect target.
app.get('/social/callback', authRateLimiter, (req, res) => profileCallbackController.handleSocialCallback(req, res));

app.use('/**', async (req: Request, res: Response, next: NextFunction) => {
  const ssrStartTime = Date.now();
  const auth: AuthContext = {
    authenticated: false,
    user: null,
    persona: null,
    organizations: [],
  };

  if (req.oidc?.isAuthenticated() && !req.oidc?.accessToken?.isExpired()) {
    auth.authenticated = true;
    try {
      auth.user = req.oidc?.user as User;

      if (!auth.user?.name) {
        auth.user = await req.oidc.fetchUserInfo();
      }
    } catch (error) {
      logger.warning(req, 'ssr_user_info', 'Failed to fetch user info, using basic user data', {
        err: error,
        path: req.path,
      });

      res.oidc.logout();
      return;
    }
  }

  if (auth.authenticated) {
    const personaResult = await resolvePersonaForSsr(req, res);
    auth.persona = personaResult.persona;
    auth.personas = personaResult.personas;
    auth.organizations = personaResult.organizations ?? [];
    auth.projects = personaResult.projects;
    auth.personaProjects = personaResult.personaProjects;
  }

  if (req.oidc?.accessToken?.access_token) {
    try {
      const payload = decodeJwtPayload(req.oidc.accessToken.access_token);
      if (payload) {
        auth.canImpersonate = payload['http://lfx.dev/claims/can_impersonate'] === true;
      }
    } catch {
      /* canImpersonate stays false */
    }
  }

  if (req.appSession?.['impersonationToken'] && req.appSession?.['impersonationUser']) {
    const impersonationExpiresAt = req.appSession['impersonationExpiresAt'];
    if (impersonationExpiresAt && Date.now() < impersonationExpiresAt) {
      try {
        const targetClaims = decodeJwtPayload(req.appSession['impersonationToken']);
        if (!targetClaims) throw new Error('Invalid token format');

        const impersonationUser = req.appSession['impersonationUser'];
        if (!auth.user) throw new Error('No authenticated user for impersonation override');
        Object.assign(auth.user, {
          sub: targetClaims.sub,
          email: targetClaims['http://lfx.dev/claims/email'] || '',
          username: targetClaims['http://lfx.dev/claims/username'] || '',
          'https://sso.linuxfoundation.org/claims/username': targetClaims['http://lfx.dev/claims/username'] || '',
          name: impersonationUser?.name || targetClaims['http://lfx.dev/claims/username'] || '',
          nickname: targetClaims['http://lfx.dev/claims/username'] || '',
          picture: impersonationUser?.picture || auth.user?.picture || '',
        });
        auth.impersonating = true;
        auth.impersonator = req.appSession['impersonator'];
      } catch {
        clearImpersonationSession(req);
      }
    }
  }

  const runtimeConfig: RuntimeConfig = {
    launchDarklyClientId: process.env['LD_CLIENT_ID'] || '',
    dataDogRumClientId: process.env['DD_RUM_CLIENT_ID'] || '',
    dataDogRumApplicationId: process.env['DD_RUM_APPLICATION_ID'] || '',
    allowedTracingUrls: [process.env['LFX_V2_SERVICE'], process.env['PCC_BASE_URL']].filter(Boolean) as string[],
    intercomAppId: process.env['INTERCOM_APP_ID'] || '',
  };

  logger.debug(req, 'intercom_ssr_context', 'Intercom SSR inputs resolved', {
    has_app_id: !!runtimeConfig.intercomAppId,
    has_intercom_jwt: !!auth.user?.['http://lfx.dev/claims/intercom'],
    has_user_id: !!(auth.user?.['https://sso.linuxfoundation.org/claims/username'] || auth.user?.sub),
    authenticated: auth.authenticated,
    impersonating: !!auth.impersonating,
  });

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

// Global error handler — must be last.
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  apiErrorHandler(error, req, res, next);
});

let httpServer: HttpServer | undefined;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown()) return;
  markShuttingDown(); // flip /readyz to 503 synchronously before anything async runs

  const startTime = logger.startOperation(undefined, 'graceful_shutdown', { signal });

  // Mandatory LB drain window: after readyz flips to 503, the load balancer
  // continues routing requests until its next probe fires (readyz periodSeconds: 10s).
  // Wait 1.5× that interval before closing the HTTP listener so no new requests
  // land on an already-closed server. SSE shutdown hooks run concurrently so
  // clients are notified and can reconnect within this window.
  //
  // Hooks are best-effort: if they exceed the LB drain window we log a warning
  // and proceed — we never wait beyond LB_DRAIN_MS for hooks. `await lbDrain`
  // after the race guarantees the full 15s always elapses (no-op when lbDrain
  // already resolved via the race) while placing a hard ceiling on how long
  // hooks can delay the HTTP drain.
  const LB_DRAIN_MS = 15_000; // 1.5 × readyz periodSeconds (10s)
  const lbDrain = new Promise<void>((resolve) => setTimeout(resolve, LB_DRAIN_MS));
  let hooksCompleted = false;
  const hooksStartTime = Date.now();
  const hooks = runShutdownHooks()
    .then(() => {
      hooksCompleted = true;
    })
    .catch((err: unknown) => {
      logger.error(undefined, 'shutdown_hooks_error', hooksStartTime, err as Error, {});
    });
  await Promise.race([hooks, lbDrain]);
  if (!hooksCompleted) {
    logger.warning(undefined, 'shutdown_hooks_slow', 'Shutdown hooks exceeded LB drain window', { budget_ms: LB_DRAIN_MS });
  }
  await lbDrain; // hard ceiling: never wait beyond LB_DRAIN_MS for hooks

  if (!httpServer) {
    logger.success(undefined, 'graceful_shutdown', startTime, { reason: 'no_http_server' });
    process.exit(0);
    return;
  }

  // Stop accepting new connections and drain in-flight requests (25s window).
  await new Promise<void>((resolve) => {
    const drainTimeout = setTimeout(() => {
      httpServer!.closeAllConnections();
      resolve();
    }, 25_000);

    httpServer!.closeIdleConnections();
    httpServer!.close(() => {
      clearTimeout(drainTimeout);
      resolve();
    });
  });

  logger.info(undefined, 'shutdown_http_drained', 'HTTP server drained', {});

  // Drain NATS and Snowflake *after* HTTP is fully closed. This ordering ensures any
  // in-flight HTTP request that issues a NATS request/reply can complete before the
  // connection is torn down — draining NATS before HTTP would break those requests.
  // Each drain is race'd against a 15s budget so a hung drain cannot exceed PM2's kill_timeout.
  // SnowflakeService.shutdownIfInitialized() skips pool creation for pods that never used Snowflake.
  const SERVICE_DRAIN_BUDGET_MS = 15_000;
  const raceDrain = (name: string, p: Promise<void>): Promise<void> => {
    let completed = false;
    const tracked = p.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      }
    );
    return Promise.race([
      tracked,
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!completed) {
            logger.warning(undefined, 'shutdown_drain_timeout', `${name} drain budget exceeded`, { budget_ms: SERVICE_DRAIN_BUDGET_MS });
          }
          resolve();
        }, SERVICE_DRAIN_BUDGET_MS)
      ),
    ]);
  };

  await Promise.allSettled([
    raceDrain(
      'nats',
      // shutdownAll() uses Promise.allSettled — always resolves regardless of individual
      // drain outcomes. Per-connection failures are already logged at ERROR inside
      // NatsService.shutdown(). Log "complete" here (not "drained") to avoid implying
      // all drains succeeded when some may have been swallowed.
      NatsService.shutdownAll().then(() => {
        logger.info(undefined, 'shutdown_nats_complete', 'NATS shutdown complete', {});
      })
    ),
    raceDrain(
      'snowflake',
      // shutdown() has an internal try/catch that logs pool drain errors and resolves.
      // Per-drain failures are already logged at ERROR inside SnowflakeService.shutdown().
      // Log "complete" here (not "drained") for the same reason as NATS above.
      // Keep the rejection handler: unlike shutdownAll(), shutdownIfInitialized() can
      // reject if pre-pool code throws before the internal try/catch.
      SnowflakeService.shutdownIfInitialized().then(
        () => {
          logger.info(undefined, 'shutdown_snowflake_complete', 'Snowflake shutdown complete', {});
        },
        (err) => {
          logger.warning(undefined, 'shutdown_snowflake_failed', 'Snowflake shutdown failed', { err });
        }
      )
    ),
  ]);

  logger.success(undefined, 'graceful_shutdown', startTime, {});
  process.exit(0);
}

export function startServer() {
  const port = process.env['PORT'] || 4000;
  httpServer = app.listen(port, () => {
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
  const handleSignal = (sig: string): void => {
    gracefulShutdown(sig).catch((err) => {
      logger.error(undefined, 'shutdown_fatal', Date.now(), err, { signal: sig });
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGINT', () => handleSignal('SIGINT'));
}

export const reqHandler = createNodeRequestHandler(app);
