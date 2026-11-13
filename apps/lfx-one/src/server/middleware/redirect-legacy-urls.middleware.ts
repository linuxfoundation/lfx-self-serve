// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { companyLensRedirectTarget, legacyDocsRedirectTarget } from '@lfx-one/shared/utils/org-lens-url.utils';
import { NextFunction, Request, Response } from 'express';

/**
 * Answers a full page load of a pre-rename address with a 301 to the same address under its new name (#5064):
 *
 * - Company Lens: `/org`, `/org/not-found`, `/org/{slug|SFID}/{page}`, the legacy `/org/{page}` → `/company/…`.
 * - User docs: `/docs/organization/…` → `/docs/company/…` (three pages were also renamed).
 *
 * The query string travels verbatim; the fragment is re-applied by the browser, which keeps a redirected URL's
 * fragment when the `Location` carries none. GET and HEAD only: those are the page loads. `/api/…` and every
 * other path are untouched, since only paths starting with the exact old segments match.
 */
export function redirectLegacyUrls(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }
  const target = companyLensRedirectTarget(req.originalUrl) ?? legacyDocsRedirectTarget(req.originalUrl);
  if (!target) {
    return next();
  }
  // Not cached: during a rollback or a mixed-version deploy a cached 301 would keep sending a browser to `/company`
  // on a replica that does not route it. The redirect is cheap to recompute, so correctness beats caching here.
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(301, target);
}
