// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BROWSER_ASSET_MISS_LOG_INTERVAL_MS, BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH } from '@lfx-one/shared/constants';
import express, { Router } from 'express';

import { logger } from '../services/logger.service';

/** Serve browser files and terminate Angular bundle misses before OIDC or SSR can claim them. */
export function createBrowserAssetsMiddleware(browserDistFolder: string): Router {
  const router = Router();
  // The app mounts one instance: a single constant-memory gate, not one per filename or IP.
  let nextMissLogAt = -Infinity;

  router.use(
    express.static(browserDistFolder, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/-[A-Z0-9]{8,}\.(js|css|woff2?|ttf|otf|png|jpg|jpeg|svg|ico|webp)$/i.test(filePath)) {
          // Content-hashed assets are immutable; preserve the existing successful-response policy.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return;
        }
        if (/\.(html|js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
          return;
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
      },
    })
  );

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    // Match the same decoded pathname express.static uses, without inspecting query strings.
    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      next();
      return;
    }

    // Angular emits hashed JS/CSS at the browser root. Never claim nested API or page paths.
    if (!/^\/[a-z0-9._-]+-[a-z0-9]{8,}\.(?:js|css)$/i.test(path)) {
      next();
      return;
    }

    // Only record generated bundle names, never arbitrary user-supplied filename prefixes.
    // This narrower logging allowlist does not change the existing 404/auth boundary above.
    if (/^\/(?:main|chunk|styles|polyfills)-[a-z0-9]{8,}\.(?:js|css)$/i.test(path)) {
      const now = performance.now();
      if (now >= nextMissLogAt) {
        // Consume the window before logging so a broken logger cannot cause a retry flood.
        nextMissLogAt = now + BROWSER_ASSET_MISS_LOG_INTERVAL_MS;
        try {
          // Mounted before pino-http: never pass req or read req.log here.
          // Anonymous requests can manufacture misses: keep the sampled signal visible at INFO,
          // not on-call WARN. Consumers should filter by operation, not treat log level as impact.
          logger.info(undefined, 'browser_asset_miss', 'Browser bundle unavailable', {
            asset_path: path.slice(0, BROWSER_ASSET_MISS_LOG_PATH_MAX_LENGTH),
            version: process.env['APP_VERSION'] || 'development',
            status_code: 404,
            method: req.method,
          });
        } catch {
          // Best-effort telemetry must never prevent the non-cacheable 404.
        }
      }
    }

    // A rollout/stale-tab miss must not become an SSO redirect or a cacheable negative response.
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text').send('Not found');
  });

  return router;
}
