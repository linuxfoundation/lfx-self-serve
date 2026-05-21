// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensFoundationsService } from '../services/org-lens-foundations.service';

/** Salesforce account ID pattern (15 or 18 chars, starts with 001). */
const ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{12,15}$/;

/**
 * Controller for the Org Lens Foundations and Projects section.
 * Owns the HTTP boundary (validation, lifecycle logging, error
 * propagation) for the OrgLensFoundationsService.
 */
export class OrgLensFoundationsController {
  private readonly service: OrgLensFoundationsService;

  public constructor() {
    this.service = new OrgLensFoundationsService();
  }

  /**
   * GET /api/orgs/:accountId/lens/foundations-and-projects
   */
  public async getFoundationsAndProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_foundations_and_projects', {
      account_id: accountId,
    });

    try {
      if (!accountId || typeof accountId !== 'string') {
        throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', {
          operation: 'get_org_lens_foundations_and_projects',
        });
      }

      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', {
          operation: 'get_org_lens_foundations_and_projects',
        });
      }

      const response = await this.service.getFoundationsAndProjects(accountId);

      const projectCountTotal = response.rows.reduce((sum, row) => sum + row.projects.length, 0);

      logger.success(req, 'get_org_lens_foundations_and_projects', startTime, {
        account_id: accountId,
        row_count: response.rows.length,
        project_count_total: projectCountTotal,
      });

      // No PII or tokens in logs. account_id is already a Salesforce
      // opaque ID, safe.
      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
