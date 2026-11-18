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
export async function requireOrgAnalyticsAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  return applyOrgAnalyticsGate(req, res, next, false);
}

/**
 * The same gate for the Overview involvement rows, which also admit the all employee view (epic #5845): they return
 * only aggregate counts, monthly series and foundation names, and their handlers still pass the payload through
 * `redactForEmployeeView`. Every other analytics route keeps refusing employee-view callers.
 */
export async function requireOrgAnalyticsAccessAllowingEmployeeView(req: Request, res: Response, next: NextFunction): Promise<void> {
  return applyOrgAnalyticsGate(req, res, next, true);
}

async function applyOrgAnalyticsGate(req: Request, _res: Response, next: NextFunction, allowEmployeeView: boolean): Promise<void> {
  try {
    const accountId = getStringQueryParam(req, 'accountId');
    if (accountId) {
      await assertOrgAnalyticsRead(req, accountId, 'require_org_analytics_access', { allowEmployeeView });
    }
    next();
  } catch (error) {
    next(error);
  }
}
