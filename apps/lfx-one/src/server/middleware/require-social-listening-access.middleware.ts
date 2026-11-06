// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { socialListeningAccessService } from '../services/social-listening-access.service';

/**
 * Social Listening admits the executive-dashboard audience plus members of opted-in groups of the
 * requested foundation (lfx-self-serve-ops#387). Group access is always scoped by `foundationSlug`;
 * see `SocialListeningAccessService`.
 */
export async function requireSocialListeningAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // Feed and count are POSTs carrying foundationSlug in the body; every other route sends it as a query param.
    const rawSlug = req.method === 'POST' ? req.body?.['foundationSlug'] : req.query['foundationSlug'];
    const requestedSlug = typeof rawSlug === 'string' ? rawSlug : '';
    const access = await socialListeningAccessService.getAccess(req, requestedSlug);

    if (access.canView) {
      next();
      return;
    }

    logger.warning(req, 'require_social_listening_access', 'User without Social Listening access attempted a Social Listening endpoint', {
      path: req.path,
      requested_slug: requestedSlug || undefined,
    });

    next(
      new AuthorizationError('Social Listening access required for this resource', {
        operation: 'require_social_listening_access',
        service: 'authorization',
        path: req.path,
        code: 'DASHBOARD_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
