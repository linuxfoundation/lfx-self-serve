// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensFoundationsService } from '../services/org-lens-foundations.service';
import { OrgSfidResolver } from '../services/org-sfid-resolver.service';

/** HTTP boundary for the OrgLensFoundationsService — validation, lifecycle logging, error propagation. */
export class OrgLensFoundationsController {
  private readonly service: OrgLensFoundationsService;
  private readonly orgSfidResolver: OrgSfidResolver;

  public constructor() {
    this.service = new OrgLensFoundationsService();
    this.orgSfidResolver = new OrgSfidResolver();
  }

  /** GET /api/orgs/:orgUid/lens/foundations-and-projects */
  public async getFoundationsAndProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_foundations_and_projects', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_foundations_and_projects');

      const sfid = (await this.orgSfidResolver.resolveSfid(req, orgUid)) ?? '';
      const response = await this.service.getFoundationsAndProjects(sfid);

      const projectCountTotal = response.rows.reduce((sum, row) => sum + row.projects.length, 0);

      logger.success(req, 'get_org_lens_foundations_and_projects', startTime, {
        org_uid: orgUid,
        row_count: response.rows.length,
        project_count_total: projectCountTotal,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
