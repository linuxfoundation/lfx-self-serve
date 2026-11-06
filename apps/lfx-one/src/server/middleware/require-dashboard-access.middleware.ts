// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EXECUTIVE_DIRECTOR_PERSONA } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { getDashboardAccessReason } from '../helpers/dashboard-access.helper';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';

// Dashboard access admits the same callers as the client-side dashboardAccessGuard: EDs and LF Staff,
// via server-verified personas (never the spoofable cookie); see getDashboardAccessReason for the
// per-foundation ED and root-writer scoping.
export async function requireDashboardAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);
    const rawSlug = req.method === 'POST' ? req.body?.['foundationSlug'] : req.query['foundationSlug'];
    const requestedSlug = typeof rawSlug === 'string' ? rawSlug.toLowerCase() : '';

    if ((await getDashboardAccessReason(req, result, requestedSlug)) !== 'none') {
      next();
      return;
    }

    logger.warning(req, 'require_dashboard_access', 'User without dashboard access attempted an executive-dashboard endpoint', {
      path: req.path,
      personas: result.personas,
      requested_slug: requestedSlug || undefined,
      scoped_slugs: (result.personaProjects?.[EXECUTIVE_DIRECTOR_PERSONA] ?? []).map((project) => project.projectSlug),
    });

    next(
      new AuthorizationError('Executive dashboard access required for this resource', {
        operation: 'require_dashboard_access',
        service: 'authorization',
        path: req.path,
        code: 'DASHBOARD_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
