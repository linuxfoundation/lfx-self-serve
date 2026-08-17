// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';

const ED: PersonaType = 'executive-director';

// Mirrors PersonaService.canViewExecutiveDashboards() (ED OR LF Staff) for the
// LF-Staff-eligible marketing/ED-dashboard analytics routes. ED callers stay
// scoped to their own foundations; LF Staff and root writers bypass scoping.
export async function requireExecutiveDashboardAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);
    const isED = result.personas.includes(ED);

    if (!isED && !result.isLFStaff) {
      logger.warning(req, 'require_executive_dashboard_access', 'Non-ED, non-LF-Staff user attempted ED-dashboard endpoint', {
        path: req.path,
        personas: result.personas,
      });

      next(
        new AuthorizationError('Executive Director or LF Staff access required for this resource', {
          operation: 'require_executive_dashboard_access',
          service: 'authorization',
          path: req.path,
          code: 'EXECUTIVE_DASHBOARD_ACCESS_REQUIRED',
        })
      );
      return;
    }

    const requestedSlug = typeof req.query['foundationSlug'] === 'string' ? req.query['foundationSlug'] : '';

    if (!requestedSlug || result.isRootWriter || result.isLFStaff) {
      next();
      return;
    }

    const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug);
    if (edSlugs.includes(requestedSlug)) {
      next();
      return;
    }

    logger.warning(req, 'require_executive_dashboard_access', 'ED requested a foundation outside their scope', {
      path: req.path,
      requested_slug: requestedSlug,
      scoped_slugs: edSlugs,
    });

    next(
      new AuthorizationError('Executive Director or LF Staff access required for this resource', {
        operation: 'require_executive_dashboard_access',
        service: 'authorization',
        path: req.path,
        code: 'EXECUTIVE_DASHBOARD_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
