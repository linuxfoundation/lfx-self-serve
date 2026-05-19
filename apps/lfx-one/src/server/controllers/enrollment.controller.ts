// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { EnrollmentService } from '../services/enrollment.service';

export class EnrollmentController {
  private readonly enrollmentService = new EnrollmentService();

  public async getEnrollments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_individual_enrollments');

    try {
      const enrollments = await this.enrollmentService.getIndividualEnrollments(req);

      logger.success(req, 'get_individual_enrollments', startTime, { result_count: enrollments.length });

      res.json(enrollments);
    } catch (error) {
      next(error);
    }
  }
}
