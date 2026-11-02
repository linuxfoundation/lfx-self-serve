// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express, { Router } from 'express';

/** Serve browser files and terminate Angular bundle misses before OIDC or SSR can claim them. */
export function createBrowserAssetsMiddleware(browserDistFolder: string): Router {
  const router = Router();

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

    // A rollout/stale-tab miss must not become an SSO redirect or a cacheable negative response.
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text').send('Not found');
  });

  return router;
}
