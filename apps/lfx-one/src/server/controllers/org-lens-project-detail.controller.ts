// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensProjectDetailService } from '../services/org-lens-project-detail.service';

/** HTTP boundary for the Org Lens · Project Detail endpoint — validation, lifecycle logging, error propagation. */
export class OrgLensProjectDetailController {
  private readonly service: OrgLensProjectDetailService;

  public constructor() {
    this.service = new OrgLensProjectDetailService();
  }

  /** GET /api/orgs/:orgUid/lens/projects/:projectSlug */
  public getProjectDetail(req: Request, res: Response, next: NextFunction): void {
    const orgUid = req.params['orgUid'];
    const projectSlug = req.params['projectSlug'];
    const rawOrgName = typeof req.query['orgName'] === 'string' ? req.query['orgName'].trim() : '';
    const orgName = rawOrgName || 'Your Organization';

    const startTime = logger.startOperation(req, 'get_org_lens_project_detail', {
      org_uid: orgUid,
      project_slug: projectSlug,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_project_detail');
      this.assertProjectSlug(projectSlug, 'get_org_lens_project_detail');

      const response = this.service.getProjectDetail(orgUid, orgName, projectSlug);

      if (response === null) {
        logger.success(req, 'get_org_lens_project_detail', startTime, {
          org_uid: orgUid,
          project_slug: projectSlug,
          found: false,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).json({ message: 'Project not found' });
        return;
      }

      logger.success(req, 'get_org_lens_project_detail', startTime, {
        org_uid: orgUid,
        project_slug: projectSlug,
        found: true,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // FOUNDATION_ID_PATTERN is the general SSR path-param validator (`[A-Za-z0-9-]{1,64}`); it also
  // covers the project slug shape, so it is reused here for the slug-keyed detail route.
  private assertProjectSlug(projectSlug: string | undefined, operation: string): asserts projectSlug is string {
    if (!projectSlug || typeof projectSlug !== 'string') {
      throw ServiceValidationError.forField('projectSlug', 'projectSlug path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(projectSlug)) {
      throw ServiceValidationError.forField('projectSlug', 'Invalid projectSlug format', { operation });
    }
  }
}
