// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { personaDetectionService } from '../utils/persona-helper';
import { logger } from '../services/logger.service';

const ED: PersonaType = 'executive-director';

// ED authorization must come from server-verified persona detection, not the
// PERSONA_COOKIE_KEY cookie — that cookie is unsigned plain JSON and is
// client-spoofable. getPersonas() is cached per username/email so the cost is
// amortized across requests.
//
// Holding the ED persona is necessary but not sufficient: the persona is scoped to specific
// foundations, so a caller who is an ED for foundation A must not be able to read foundation B
// by passing B's slug. When the request names a foundation, it is checked against the slugs the
// caller actually holds the persona for. Root writers and LF staff bypass the scope check —
// they are already trusted across foundations elsewhere in the app.
export async function requireExecutiveDirector(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 'none' — this middleware never reads isMarketingAuditor/isCampaignManager, so skip both
    // ROOT-relation FGA checks getPersonas() would otherwise compute unconditionally.
    const result = await personaDetectionService.getPersonas(req, undefined, 'none');
    const isED = result.personas.includes(ED);

    if (!isED) {
      logger.warning(req, 'require_executive_director', 'Non-ED user attempted ED-only endpoint', {
        path: req.path,
        personas: result.personas,
      });

      next(
        new AuthorizationError('Executive Director access required for this resource', {
          operation: 'require_executive_director',
          service: 'authorization',
          path: req.path,
          code: 'EXECUTIVE_DIRECTOR_REQUIRED',
        })
      );
      return;
    }

    // Callers name the foundation/project differently (`foundationSlug` on most ED-only routes,
    // `project` on Campaigns) — reject requests that supply both with different values, since
    // the middleware can only authorize one scope while the handler may read the other.
    const foundationSlugParam = req.query['foundationSlug'];
    const projectParam = req.query['project'];
    const foundationSlug = typeof foundationSlugParam === 'string' && foundationSlugParam.length > 0 ? foundationSlugParam : '';
    const project = typeof projectParam === 'string' && projectParam.length > 0 ? projectParam : '';

    if (foundationSlug && project && foundationSlug !== project) {
      logger.warning(req, 'require_executive_director', 'Conflicting scope parameters in request', {
        path: req.path,
        foundationSlug,
        project,
      });
      next(
        new AuthorizationError('Executive Director access required for this resource', {
          operation: 'require_executive_director',
          service: 'authorization',
          path: req.path,
          code: 'EXECUTIVE_DIRECTOR_REQUIRED',
        })
      );
      return;
    }

    const requestedSlug = foundationSlug || project;

    // No slug on the request means there is nothing to scope against — the handler is responsible
    // for rejecting a missing required parameter, and unscoped ED endpoints stay allowed.
    if (!requestedSlug || result.isRootWriter || result.isLFStaff) {
      next();
      return;
    }

    const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug);
    if (edSlugs.includes(requestedSlug)) {
      next();
      return;
    }

    logger.warning(req, 'require_executive_director', 'ED requested a foundation outside their scope', {
      path: req.path,
      requested_slug: requestedSlug,
      scoped_slugs: edSlugs,
    });

    next(
      new AuthorizationError('Executive Director access required for this resource', {
        operation: 'require_executive_director',
        service: 'authorization',
        path: req.path,
        code: 'EXECUTIVE_DIRECTOR_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
