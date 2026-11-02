// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { isImpersonating } from '../utils/auth-helper';
import { personaDetectionService } from '../utils/persona-helper';

/**
 * ROI Metrics is open only to LF staff, in every environment. Mounted on each ROI route after the `/lens` read gate and
 * before the handler.
 *
 * Staff means `lf-staff#member` alone, the same check the Org Lens events gate uses. The wider
 * `ORG_WIDE_READ_TEAM_IDS` list also admits global auditors and org admins, who are not LF staff. A session acting
 * as another user is never staff here, whoever the target is.
 */
export async function requireOrgLensRoiAudience(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!isImpersonating(req) && (await personaDetectionService.checkLFStaff(req))) {
      next();
      return;
    }

    logger.warning(req, 'require_org_lens_roi_audience', 'Non-staff caller requested ROI Metrics', { path: req.path });
    next(new AuthorizationError('LF staff access required for this resource', { operation: 'require_org_lens_roi_audience', code: 'FORBIDDEN' }));
  } catch (error) {
    next(error);
  }
}
