// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { OrgClaService } from '../services/org-cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class OrgClasController {
  private readonly orgClaService = new OrgClaService();

  // GET /api/orgs/:orgUid/lens/cla-groups
  public async listClaGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_org_cla_groups');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'list_org_cla_groups' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'list_org_cla_groups');

      const result = await this.orgClaService.listClaGroups(req, orgUid);

      logger.success(req, 'list_org_cla_groups', startTime, { org_uid: orgUid, cla_group_count: result.claGroups.length });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
