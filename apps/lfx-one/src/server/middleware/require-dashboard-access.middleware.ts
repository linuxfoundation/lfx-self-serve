// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';

const ED: PersonaType = 'executive-director';

// Dashboard access admits the same callers as the client-side dashboardAccessGuard: EDs and LF Staff,
// via server-verified personas (never the spoofable cookie); ED scope is per-foundation, root writers bypass.
export async function requireDashboardAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await personaDetectionService.getPersonas(req);
    const isED = result.personas.includes(ED);

    if (!isED && !result.isLFStaff) {
      logger.warning(req, 'require_dashboard_access', 'User without dashboard access attempted an executive-dashboard endpoint', {
        path: req.path,
        personas: result.personas,
      });

      next(
        new AuthorizationError('Executive dashboard access required for this resource', {
          operation: 'require_dashboard_access',
          service: 'authorization',
          path: req.path,
          code: 'DASHBOARD_ACCESS_REQUIRED',
        })
      );
      return;
    }

    const requestedSlug = typeof req.query['foundationSlug'] === 'string' ? req.query['foundationSlug'] : '';

    // No slug on the request means there is nothing to scope against — the handler is responsible
    // for rejecting a missing required parameter, and unscoped dashboard endpoints stay allowed.
    if (!requestedSlug || result.isRootWriter || result.isLFStaff) {
      next();
      return;
    }

    // Upstream project slugs are verbatim — normalize case on both sides so mixed-case data can't 403 a scoped ED.
    const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug.toLowerCase());
    if (edSlugs.includes(requestedSlug.toLowerCase())) {
      next();
      return;
    }

    logger.warning(req, 'require_dashboard_access', 'ED requested a foundation outside their scope', {
      path: req.path,
      requested_slug: requestedSlug,
      scoped_slugs: edSlugs,
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
