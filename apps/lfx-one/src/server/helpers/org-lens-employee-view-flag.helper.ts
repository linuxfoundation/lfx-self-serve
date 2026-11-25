// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { isImpersonating } from '../utils/auth-helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from './server-feature-flag.helper';

/**
 * Whether the Company Lens all employee view (epic #5845) is open for THIS request. Every place that opens the
 * view asks here, so the rollout has one definition:
 *
 * - `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` on: open for every caller (the full release).
 * - `LFX_ORG_LENS_EMPLOYEE_VIEW_IMPERSONATION_ONLY` on: open only while an LF staff member is impersonating the caller, so
 *   staff can check the view in production as an employee would see it while no real employee reaches it. Starting an
 *   impersonation session already requires the `can_impersonate` claim, so no separate staff check is needed here.
 * - Neither: closed, a complete no-op.
 *
 * Read per request on purpose: the impersonation state belongs to the request, never to the process.
 */
export function isOrgLensEmployeeViewEnabled(req: Request): boolean {
  if (isServerFeatureEnabled(ServerFeatureFlag.OrgLensEmployeeView)) {
    return true;
  }
  return isServerFeatureEnabled(ServerFeatureFlag.OrgLensEmployeeViewImpersonationOnly) && isImpersonating(req);
}
