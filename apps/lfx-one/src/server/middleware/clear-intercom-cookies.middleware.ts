// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Expires every `intercom-` cookie on logout. Intercom keeps the messenger session in its own
 * first-party cookies, which outlive the app session: `Intercom('shutdown')` in the browser does not
 * remove all of them, and only runs on pages that booted the widget (the invite landing and
 * impersonated sessions never do). Intercom's guidance for shared devices is to delete the
 * `intercom-` prefixed cookies during logout: https://developers.intercom.com/installing-intercom/web/methods
 *
 * The widget sets these cookies from the browser, on the host or a parent domain of its choosing, so
 * each one is cleared host-only and on every parent domain of the app's host; the browser ignores the
 * variants that match no stored cookie.
 */
export function clearIntercomCookies(baseURL: string): RequestHandler {
  const labels = new URL(baseURL).hostname.split('.');
  const domains = labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));

  return (req: Request, res: Response, next: NextFunction): void => {
    for (const pair of req.headers.cookie?.split(';') ?? []) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) continue;
      const name = pair.slice(0, eqIndex).trim();
      if (name.startsWith('intercom-')) {
        res.clearCookie(name);
        for (const domain of domains) {
          res.clearCookie(name, { domain });
        }
      }
    }
    next();
  };
}
