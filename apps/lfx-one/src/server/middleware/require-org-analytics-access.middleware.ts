// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { assertOrgAnalyticsRead } from '../helpers/org-analytics-access.helper';
import { getStringQueryParam } from '../helpers/validation.helper';

/**
 * Applies the org analytics read gate (`assertOrgAnalyticsRead`) to an `/api/analytics/*` row keyed
 * by the `accountId` query parameter, before the handler queries Snowflake.
 *
 * The id is read exactly as the handlers read it (`getStringQueryParam`), so the gate authorizes the
 * value the handler will use. A request without an `accountId` has nothing to scope against and no
 * organization to read; the handler rejects it.
 */
export async function requireOrgAnalyticsAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const accountId = getStringQueryParam(req, 'accountId');
    if (accountId) {
      await assertOrgAnalyticsRead(req, accountId, 'require_org_analytics_access');
    }
    next();
  } catch (error) {
    next(error);
  }
}
