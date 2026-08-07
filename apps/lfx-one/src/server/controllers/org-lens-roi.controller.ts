// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { parseOrgLensRoiMethod } from '../helpers/org-lens-roi-method.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensRoiService } from '../services/org-lens-roi.service';

// `assertOrgLensRead` must run before any cache or Snowflake access in every handler.
// Feature flags are browser-only and gate none of these endpoints.
export class OrgLensRoiController {
  private readonly service: OrgLensRoiService;

  public constructor() {
    this.service = new OrgLensRoiService();
  }

  public async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_summary';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const summary = await this.service.getSummary(req, orgUid, method);
      logger.success(req, operation, startTime, { org_uid: orgUid, method, has_data: summary.hasData });
      this.send(res, summary);
    } catch (error) {
      return next(error);
    }
  }

  public async getCoverage(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_coverage';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const coverage = await this.service.getCoverage(req, orgUid, method);
      logger.success(req, operation, startTime, { org_uid: orgUid, coverage_reason: coverage.coverageReason });
      this.send(res, coverage);
    } catch (error) {
      return next(error);
    }
  }

  public async getAnnual(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_annual';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const annual = await this.service.getAnnual(req, orgUid, method);
      logger.success(req, operation, startTime, { org_uid: orgUid, method, rows: annual.rows.length });
      this.send(res, annual);
    } catch (error) {
      return next(error);
    }
  }

  private send(res: Response, body: unknown): void {
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  }
}
