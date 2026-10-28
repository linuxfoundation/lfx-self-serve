// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { BaseApiError } from '../errors';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';

const projectService = new ProjectService();

/** Upstream answers that mean "this uid names no project the caller can see", not a failure. */
const UNRESOLVABLE_PROJECT_STATUSES = new Set([403, 404]);

/**
 * Rewrites a uid-shaped `?project=` to that project's canonical slug, before authorization runs.
 *
 * The marketing-access guard and the campaign-service brief index both key a project by its slug,
 * so without this a request naming a project by uid was refused by the guard (`project_not_found`)
 * even for a caller who manages that project, and would have matched no brief had it got through
 * (#4507). Resolving first gives the same authorization and the same answer whichever identifier
 * names the project.
 *
 * A uid that names no project the caller can read is left as it is: the guard then refuses it exactly
 * as it refuses an unknown slug. A slug, a missing value or a repeated parameter passes through
 * untouched for the guard and the handler to judge. Any other lookup failure is the request's error.
 */
export async function canonicalizeProjectQuery(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const project = req.query['project'];
  if (typeof project !== 'string' || !isUuid(project)) {
    next();
    return;
  }

  try {
    const { slug } = await projectService.getProjectById(req, project, false);
    if (typeof slug === 'string' && slug !== '') {
      req.query['project'] = slug;
    }
    next();
  } catch (error) {
    if (error instanceof BaseApiError && UNRESOLVABLE_PROJECT_STATUSES.has(error.statusCode)) {
      logger.debug(req, 'canonicalize_project_query', 'Project uid did not resolve to a project; leaving it for the guard', {
        status: error.statusCode,
      });
      next();
      return;
    }
    next(error);
  }
}
