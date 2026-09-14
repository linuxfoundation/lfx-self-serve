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
  // No entry for the CLA Group agreement page, which since #2364 is also the corporate CLA
  // preview: it is server-rendered by the catch-all below, like every other lens page. The
  // preview is defined by a browser-only value — the choice the picker left on the history entry —
  // so the server emits the skeleton and the browser fills the preview in on hydration. That is
  // what the agreement view already did, because the page fetches nothing off-browser.
  //
  // A `RenderMode.Client` entry here is NOT a substitute. Declared that way, a direct visit to a
  // group address lands on `/` — `orgLensEnabledGuard`'s fail-closed redirect, which is reached
  // because `org-lens-enabled` resolves to nothing in the client shell. The reserved-word segment
  // this page replaced was client-rendered and did work, so the entry looks safe by analogy and
  // then breaks exactly the pasted, shared and returned-to URLs the group address exists for.
  //
  // Catch-all — the global 404 renders here in place (no /not-found redirect). The Express SSR
  // handler rewrites this to HTTP 404 when NotFoundComponent sets the render-context flag.
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
