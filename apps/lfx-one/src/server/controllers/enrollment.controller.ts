// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { validateRequiredParameter } from '../helpers/validation.helper';
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

  public async updateAutoRenew(req: Request, res: Response, next: NextFunction): Promise<void> {
    const membershipId = req.params['id'];
    const startTime = logger.startOperation(req, 'update_individual_enrollment_auto_renew', { membershipId });

    if (
      !validateRequiredParameter(membershipId, 'id', req, next, {
        operation: 'update_individual_enrollment_auto_renew',
      })
    ) {
      return;
    }

    const autorenew = (req.body as { autorenew?: unknown } | null | undefined)?.autorenew;

    if (typeof autorenew !== 'boolean') {
      next(
        ServiceValidationError.forField('autorenew', 'autorenew must be a boolean', {
          operation: 'update_individual_enrollment_auto_renew',
          service: 'enrollment_controller',
          path: req.path,
        })
      );
      return;
    }

    try {
      await this.enrollmentService.updateAutoRenew(req, membershipId, autorenew);

      logger.success(req, 'update_individual_enrollment_auto_renew', startTime, { membershipId, autorenew });

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
}
