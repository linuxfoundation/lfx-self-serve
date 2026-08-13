// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { parseOrgLensRoiMethod } from '../helpers/org-lens-roi-method.helper';
import { assertOrgLensRoiProjectSlug } from '../helpers/org-lens-roi-project-slug.helper';
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

  public async getInvestmentBreakdown(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_investment_breakdown';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      // Validated but not passed on: the breakdown genuinely cannot vary by method (its source table
      // has no MARKUP_METHOD column). Rejecting an unknown value anyway keeps the 400 uniform across
      // every ROI route rather than depending on which handler happens to use the parameter.
      parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const breakdown = await this.service.getInvestmentBreakdown(req, orgUid);
      logger.success(req, operation, startTime, { org_uid: orgUid, rows: breakdown.rows.length });
      this.send(res, breakdown);
    } catch (error) {
      return next(error);
    }
  }

  public async getProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_projects';
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid });
    try {
      assertOrgUid(orgUid, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const projects = await this.service.getProjects(req, orgUid, method);
      logger.success(req, operation, startTime, { org_uid: orgUid, method, rows: projects.rows.length });
      this.send(res, projects);
    } catch (error) {
      return next(error);
    }
  }

  public async getProjectDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_project_detail';
    const orgUid = req.params['orgUid'];
    const projectSlug = req.params['projectSlug'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid, project_slug: projectSlug });
    try {
      assertOrgUid(orgUid, operation);
      assertOrgLensRoiProjectSlug(projectSlug, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const detail = await this.service.getProjectDetail(req, orgUid, projectSlug, method);
      // 404, deliberately not an empty 200. A slug this organization has no ROI row for is either
      // another organization's project or none at all, and answering "no data" would let the
      // viewer read an absence of measurement into a project they cannot see.
      if (detail === null) throw new ResourceNotFoundError('ROI project', projectSlug, { operation });

      logger.success(req, operation, startTime, { org_uid: orgUid, project_slug: projectSlug, method, has_org_lens_project: detail.hasOrgLensProject });
      this.send(res, detail);
    } catch (error) {
      return next(error);
    }
  }

  public async getProjectAnnual(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_org_lens_roi_project_annual';
    const orgUid = req.params['orgUid'];
    const projectSlug = req.params['projectSlug'];
    const startTime = logger.startOperation(req, operation, { org_uid: orgUid, project_slug: projectSlug });
    try {
      assertOrgUid(orgUid, operation);
      assertOrgLensRoiProjectSlug(projectSlug, operation);
      const method = parseOrgLensRoiMethod(req.query['method'], operation);
      await assertOrgLensRead(req, orgUid, operation);

      const annual = await this.service.getProjectAnnual(req, orgUid, projectSlug, method);
      // Same distinction the read preserves: no rows for an existing project is a 200 with an empty
      // distribution; a project that is not this organization's is a 404.
      if (annual === null) throw new ResourceNotFoundError('ROI project', projectSlug, { operation });

      logger.success(req, operation, startTime, { org_uid: orgUid, project_slug: projectSlug, method, rows: annual.rows.length });
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
