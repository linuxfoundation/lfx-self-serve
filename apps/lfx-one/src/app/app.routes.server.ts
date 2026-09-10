// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // The docs portal not-found page must serve HTTP 404 so search engines
  // and Intercom ingest treat unresolved `/docs/<missing>` URLs correctly
  // (FR-007, FR-014). This entry keeps `/docs/not-found` reachable on a
  // direct visit and emits the 404 status. Missing `/docs/<slug>` URLs no
  // longer redirect here — they render the not-found view in place and get
  // their 404 via the catch-all `**` route plus `renderContext.notFound`.
  {
    path: 'docs/not-found',
    renderMode: RenderMode.Server,
    status: 404,
  },
  // The corporate CLA preview is defined entirely by a browser-only value: the choice the picker
  // left on the history entry. The server cannot read it, so it cannot render this page — it would
  // emit the skeleton, and the browser would then hydrate the preview over it, which is a
  // structural mismatch rather than a slower first paint. Nothing here is deep-linked or indexed:
  // the route is reached from the picker, and an address arriving without a choice leaves for the
  // list.
  {
    path: 'org/easycla/new',
    renderMode: RenderMode.Client,
  },
  // Catch-all — the global 404 renders here in place (no /not-found redirect). The Express SSR
  // handler rewrites this to HTTP 404 when NotFoundComponent sets the render-context flag.
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
