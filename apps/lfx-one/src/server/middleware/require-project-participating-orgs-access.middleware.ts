// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PROJECT_PARTICIPATING_ORGS_SLUG_PATTERN, PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';

import type { ProjectSlugToIdResponse } from '@lfx-one/shared/interfaces';

const OPERATION = 'require_project_participating_orgs_access';

const accessCheckService = new AccessCheckService();
const projectService = new ProjectService();

/**
 * Gate for every `/api/projects/:slug/participating-orgs*` route, in order:
 * 1. the slug format (400);
 * 2. slug → v2 project uid (unknown or `not_found` reply → 404; a NATS timeout or other lookup error → 503).
 *    `getProjectIdBySlug` reports NATS no-responders (`503`) as "not found", so only that outage answers 404;
 * 3. strict FGA `project#viewer` (false → 403; authorizer failure → 503, never a silent denial).
 *
 * The data reads stay keyed by slug: the warehouse tables carry Salesforce project ids, not v2 uids, so
 * the slug is the one key both sides share (one slug, one project, on both).
 */
export async function requireProjectParticipatingOrgsAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const slug = req.params['slug'];
    if (typeof slug !== 'string' || !PROJECT_PARTICIPATING_ORGS_SLUG_PATTERN.test(slug)) {
      throw ServiceValidationError.forField('slug', 'Invalid project slug format', { operation: OPERATION });
    }

    const unavailable = (path: string, error: unknown): MicroserviceError =>
      new MicroserviceError(PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE, 503, 'ACCESS_CHECK_UNAVAILABLE', {
        operation: OPERATION,
        service: 'LFX_V2_SERVICE',
        path,
        clientMessage: PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE,
        originalError: error instanceof Error ? error : undefined,
      });

    let project: ProjectSlugToIdResponse;
    try {
      project = await projectService.getProjectIdBySlug(req, slug);
    } catch (error) {
      logger.warning(req, OPERATION, 'Project slug lookup failed; cannot verify project access', { slug, err: error });
      throw unavailable('/project-slug-to-uid', error);
    }
    if (!project.exists) {
      throw new MicroserviceError('Project not found', 404, 'NOT_FOUND', { operation: OPERATION });
    }

    let hasAccess: boolean;
    try {
      hasAccess = await accessCheckService.checkSingleAccessStrict(req, { resource: 'project', id: project.uid, access: 'viewer' });
    } catch (error) {
      logger.warning(req, OPERATION, 'Access-check lookup failed; cannot verify project viewer access', { slug, project_uid: project.uid, err: error });
      throw unavailable('/access-check', error);
    }
    if (!hasAccess) {
      logger.warning(req, OPERATION, 'Project viewer access denied', { slug, project_uid: project.uid });
      throw new MicroserviceError('You do not have access to this project.', 403, 'FORBIDDEN', {
        operation: OPERATION,
        service: 'LFX_V2_SERVICE',
        path: '/access-check',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
