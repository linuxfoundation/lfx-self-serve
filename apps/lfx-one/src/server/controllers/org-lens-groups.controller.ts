// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensGroupsService } from '../services/org-lens-groups.service';

/** HTTP boundary for the Org Lens Groups endpoint (LFXV2-2014). */
export class OrgLensGroupsController {
  private readonly service: OrgLensGroupsService;

  public constructor() {
    this.service = new OrgLensGroupsService();
  }

  public async getGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_groups';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      // Runs before the service, so the gate is cleared before any stored value is read. The
      // qualification it returns decides whether this caller may be served the org-shared entry.
      const qualification = await assertOrgLensRead(req, orgUid, operation);

      const response = await this.service.getGroups(req, orgUid, qualification);
      logger.success(req, operation, startTime, { org_uid: orgUid, total_groups: response.total_groups, total_seats: response.total_seats });
      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      return next(error);
    }
  }
}
