// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ProjectService } from '../services/project.service';

const projectService = new ProjectService();

/**
 * Rewrites a uid-shaped `?project=` to that project's canonical slug, before authorization runs.
 *
 * The marketing-access guard and the campaign-service brief index both key a project by its slug,
 * so without this a request naming a project by uid was refused by the guard (`project_not_found`)
 * even for a caller who manages that project, and would have matched no brief had it got through
 * (#4507). Resolving first gives the same authorization and the same answer whichever identifier
 * names the project.
 *
 * The uid is resolved over NATS (`getProjectSlugByUid`), not by reading the project with the
 * caller's token: that read needs `viewer`, which a `campaign_manager` grant does not imply, and
 * would leave such a caller refused by uid while admitted by slug. The lookup authorizes nothing by
 * itself; the guard that follows still decides on the resolved slug.
 *
 * A uid that names no project is left as it is: the guard then refuses it exactly as it refuses an
 * unknown slug. A slug, a missing value or a repeated parameter passes through untouched for the
 * guard and the handler to judge. A lookup that fails is the request's error.
 */
export async function canonicalizeProjectQuery(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const project = req.query['project'];
  if (typeof project !== 'string' || !isUuid(project)) {
    next();
    return;
  }

  try {
    const slug = await projectService.getProjectSlugByUid(req, project);
    if (slug) {
      req.query['project'] = slug;
    }
    next();
  } catch (error) {
    next(error);
  }
}
