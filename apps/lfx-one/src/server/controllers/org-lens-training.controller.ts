// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensTrainingService } from '../services/org-lens-training.service';

/** HTTP boundary for OrgLensTrainingService — validation, lifecycle logging, error propagation. */
export class OrgLensTrainingController {
  private readonly service: OrgLensTrainingService;

  public constructor() {
    this.service = new OrgLensTrainingService();
  }

  /** GET /api/orgs/:orgUid/lens/training/stats */
  public async getTrainingStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_training_stats', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_training_stats');

      // Spec 002: orgUid is the canonical org account id (SFID); pass it straight to Snowflake.
      const response = await this.service.getTrainingStats(orgUid);

      logger.success(req, 'get_org_lens_training_stats', startTime, {
        org_uid: orgUid,
        certified_employees: response.certifiedEmployees,
        certifications_earned: response.certificationsEarned,
        employees_in_training: response.employeesInTraining,
        training_courses_enrolled: response.trainingCoursesEnrolled,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
