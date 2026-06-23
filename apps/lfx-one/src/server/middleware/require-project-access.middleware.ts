// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AccessCheckAccessType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, RequestHandler, Response } from 'express';

import { AuthorizationError } from '../errors';
import { logger } from '../services/logger.service';
import { AccessCheckService } from '../services/access-check.service';
import { ProjectService } from '../services/project.service';

/**
 * SLUG_PATTERN matches valid foundation/project slugs (lowercase alphanumeric and hyphens).
 * Must match the pattern enforced in analytics.controller.ts.
 */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Symbol used to cache slug→UID lookups on the request object.
 * Prevents redundant NATS calls when multiple requireProjectAccess middleware
 * instances are stacked on the same route (e.g. reader + writer checks).
 */
const PROJECT_UID_CACHE = Symbol('projectUidCache');

/**
 * Factory that returns an Express middleware enforcing an FGA relation on the
 * foundation identified by `foundationSlug` in the request query string.
 *
 * Gate logic (all fail-closed):
 * 1. Read `foundationSlug` from `req.query`; validate format.
 * 2. Resolve slug → project UID via NATS (result cached on `req` to amortise
 *    parallel analytics calls that all share the same slug).
 * 3. Check the FGA relation via `/access-check` on LFX_V2_SERVICE.
 * 4. Call `next()` on success; `next(AuthorizationError)` on any failure.
 *
 * Rollout flag: the enforcement is **disabled by default** until tuples are
 * confirmed across all foundations. Set the environment variable
 * `MARKETING_ACCESS_ENFORCEMENT=true` to activate.
 *
 * @param relation The FGA relation to enforce (e.g. 'marketing_dashboard_viewer').
 */
export function requireProjectAccess(relation: AccessCheckAccessType): RequestHandler {
  const accessCheckService = new AccessCheckService();
  const projectService = new ProjectService();

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Rollout gate — deploy dark; enable once tuples are confirmed.
    if (process.env['MARKETING_ACCESS_ENFORCEMENT'] !== 'true') {
      next();
      return;
    }

    const operation = `require_project_access_${relation}`;

    try {
      // Authorization denials are security-relevant audit events that warrant a
      // dedicated WARN log entry before apiErrorHandler processes the AuthorizationError.
      // This middleware is a security boundary, not a business-logic controller — the
      // no-pre-next-error-logging rule applies to controllers where apiErrorHandler is
      // the sole audit surface; here the denial itself is the auditable event.
      const foundationSlug = req.query['foundationSlug'];

      if (!foundationSlug || typeof foundationSlug !== 'string' || !SLUG_PATTERN.test(foundationSlug)) {
        logger.warning(req, operation, 'Missing or invalid foundationSlug — denying access', {
          path: req.path,
          relation,
          foundation_slug: typeof foundationSlug === 'string' ? foundationSlug : '[invalid type]',
        });
        next(
          new AuthorizationError('Insufficient permissions for this resource', {
            operation,
            service: 'authorization',
            path: req.path,
            code: 'MARKETING_ACCESS_REQUIRED',
          })
        );
        return;
      }

      // Resolve slug → UID; cache on req to avoid N+1 NATS calls.
      const cache = (req as Request & { [PROJECT_UID_CACHE]?: Record<string, string> })[PROJECT_UID_CACHE] ?? {};
      (req as Request & { [PROJECT_UID_CACHE]?: Record<string, string> })[PROJECT_UID_CACHE] = cache;

      let projectUid = cache[foundationSlug];

      if (!projectUid) {
        const natsResult = await projectService.getProjectIdBySlug(req, foundationSlug);

        if (!natsResult.exists || !natsResult.uid) {
          logger.warning(req, operation, 'Foundation slug could not be resolved — denying access', {
            path: req.path,
            relation,
            foundation_slug: foundationSlug,
          });
          next(
            new AuthorizationError('Insufficient permissions for this resource', {
              operation,
              service: 'authorization',
              path: req.path,
              code: 'MARKETING_ACCESS_REQUIRED',
            })
          );
          return;
        }

        projectUid = natsResult.uid;
        cache[foundationSlug] = projectUid;
      }

      const hasAccess = await accessCheckService.checkSingleAccess(req, {
        resource: 'project',
        id: projectUid,
        access: relation,
      });

      if (!hasAccess) {
        logger.warning(req, operation, 'FGA check did not grant marketing access (denied or upstream failure)', {
          path: req.path,
          relation,
          foundation_slug: foundationSlug,
          project_uid: projectUid,
        });
        next(
          new AuthorizationError('Insufficient permissions for this resource', {
            operation,
            service: 'authorization',
            path: req.path,
            code: 'MARKETING_ACCESS_REQUIRED',
          })
        );
        return;
      }

      next();
    } catch (error) {
      // Fail-closed: any unexpected error denies access rather than permitting it.
      logger.warning(req, operation, 'Marketing access check threw unexpectedly — denying access', {
        path: req.path,
        relation,
        err: error,
      });
      next(
        new AuthorizationError('Marketing access check failed', {
          operation,
          service: 'authorization',
          path: req.path,
          code: 'MARKETING_ACCESS_REQUIRED',
        })
      );
    }
  };
}
