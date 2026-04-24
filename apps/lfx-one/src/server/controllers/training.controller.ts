// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';
import { TrainingService } from '../services/training.service';
import { getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';

export class TrainingController {
  private readonly trainingService = new TrainingService();

  /**
   * GET /api/training/certifications
   * Get certifications for the authenticated user, optionally filtered by productType
   */
  public async getCertifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_certifications');

    try {
      const rawUsername = await getUsernameFromAuth(req);

      if (!rawUsername) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_certifications',
        });
      }

      const username = stripAuthPrefix(rawUsername);
      const productType = req.query['productType'] ? String(req.query['productType']) : undefined;
      const certifications = await this.trainingService.getCertifications(req, username, productType);

      logger.success(req, 'get_certifications', startTime, {
        result_count: certifications.length,
        product_type: productType,
      });

      res.json(certifications);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/training/certifications/unified
   * Get unified certification view (joined enrollments + certificates) for the authenticated user
   */
  public async getUnifiedCertifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_unified_certifications');

    try {
      const rawUsername = await getUsernameFromAuth(req);

      if (!rawUsername) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_unified_certifications',
        });
      }

      const username = stripAuthPrefix(rawUsername);
      const certifications = await this.trainingService.getUnifiedCertifications(req, username);

      logger.success(req, 'get_unified_certifications', startTime, {
        result_count: certifications.length,
      });

      res.json(certifications);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/training/enrollments
   * Get ongoing training enrollments for the authenticated user
   */
  public async getEnrollments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_enrollments');

    try {
      const rawUsername = await getUsernameFromAuth(req);

      if (!rawUsername) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_enrollments',
        });
      }

      const username = stripAuthPrefix(rawUsername);
      const enrollments = await this.trainingService.getEnrollments(req, username);

      logger.success(req, 'get_enrollments', startTime, {
        result_count: enrollments.length,
      });

      res.json(enrollments);
    } catch (error) {
      next(error);
    }
  }
}
