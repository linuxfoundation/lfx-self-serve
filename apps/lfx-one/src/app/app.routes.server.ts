// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The docs portal not-found page must serve HTTP 404 so search engines
  // and Intercom ingest treat unresolved `/docs/<missing>` URLs correctly
  // (FR-007, FR-014). The article resolver redirects miss-URLs to this
  // path; Angular SSR matches this entry and emits the 404 status.
  {
    path: 'docs/not-found',
    renderMode: RenderMode.Server,
    status: 404,
  },
  // Branded 404 page — responds with HTTP 404 so crawlers, caches, and monitoring tools
  // treat unrecognized URLs correctly instead of indexing/caching a soft 404 (HTTP 200).
  {
    path: 'not-found',
    renderMode: RenderMode.Server,
    status: 404,
  },
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
