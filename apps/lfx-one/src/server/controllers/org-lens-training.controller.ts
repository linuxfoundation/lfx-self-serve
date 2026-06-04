// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  DEFAULT_ORG_CERTIFICATIONS_PAGE_SIZE,
  DEFAULT_ORG_CERTIFICATIONS_SORT_FIELD,
  DEFAULT_ORG_CERTIFICATIONS_SORT_ORDER,
  MAX_ORG_CERTIFICATIONS_PAGE_SIZE,
  VALID_ORG_CERTIFICATION_SORT_FIELDS,
  VALID_ORG_TRAINING_LEVEL_VALUES,
} from '@lfx-one/shared/constants';
import type { GetOrgCertificationsOptions, OrgCertEmployeeStatus } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
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

  /** GET /api/orgs/:orgUid/lens/training/certifications */
  public async getOrgCertifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_certifications', { org_uid: orgUid });

    try {
      assertOrgUid(orgUid, 'get_org_certifications');

      const rawPageSize = Number(req.query['pageSize'] ?? DEFAULT_ORG_CERTIFICATIONS_PAGE_SIZE);
      const rawOffset = Number(req.query['offset'] ?? 0);
      const rawSortField = getStringQueryParam(req, 'sortField');
      const rawSortOrder = String(req.query['sortOrder'] ?? DEFAULT_ORG_CERTIFICATIONS_SORT_ORDER).toUpperCase();
      const rawLevel = getStringQueryParam(req, 'level');

      const pageSize =
        Number.isFinite(rawPageSize) && rawPageSize > 0 && rawPageSize <= MAX_ORG_CERTIFICATIONS_PAGE_SIZE ? rawPageSize : DEFAULT_ORG_CERTIFICATIONS_PAGE_SIZE;
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
      const sortField = rawSortField && VALID_ORG_CERTIFICATION_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_ORG_CERTIFICATIONS_SORT_FIELD;
      const sortOrder = rawSortOrder === 'ASC' ? 'ASC' : 'DESC';
      const level = rawLevel && VALID_ORG_TRAINING_LEVEL_VALUES.has(rawLevel.toUpperCase()) ? rawLevel.toUpperCase() : null;

      const options: GetOrgCertificationsOptions = {
        searchQuery: getStringQueryParam(req, 'searchQuery'),
        level,
        pageSize,
        offset,
        sortField,
        sortOrder,
      };

      // Spec 002: orgUid is the canonical org account id (SFID); pass it straight to the service.
      const response = await this.service.getOrgCertifications(req, orgUid, options);

      logger.success(req, 'get_org_certifications', startTime, {
        org_uid: orgUid,
        result_count: response.data.length,
        total: response.total,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/training/certifications/:courseId/employees */
  public async getCertificationEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const courseId = req.params['courseId'];
    const startTime = logger.startOperation(req, 'get_certification_employees', { org_uid: orgUid, course_id: courseId });

    try {
      assertOrgUid(orgUid, 'get_certification_employees');

      if (!courseId || typeof courseId !== 'string') {
        throw ServiceValidationError.forField('courseId', 'courseId path parameter is required', { operation: 'get_certification_employees' });
      }

      const rawStatus = getStringQueryParam(req, 'status');
      if (rawStatus !== 'certified' && rawStatus !== 'in-progress') {
        throw ServiceValidationError.forField('status', 'status query parameter must be "certified" or "in-progress"', {
          operation: 'get_certification_employees',
        });
      }
      const status: OrgCertEmployeeStatus = rawStatus;

      const searchQuery = getStringQueryParam(req, 'searchQuery');

      // Spec 002: orgUid is the canonical org account id (SFID); pass it straight to the service.
      const response = await this.service.getCertificationEmployees(req, orgUid, courseId, status, searchQuery ?? undefined);

      logger.success(req, 'get_certification_employees', startTime, {
        org_uid: orgUid,
        course_id: courseId,
        status,
        count: response.total,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
