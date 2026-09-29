// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseTrimmedString } from '../helpers/mentorship-params.helper';
import { logger } from '../services/logger.service';
import { MentorshipMenteeService } from '../services/mentorship-mentee.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class MentorshipMenteeController {
  private readonly menteeService = new MentorshipMenteeService();

  // GET /api/mentorship/mentee/has-profile
  public async hasMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'has_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'has_mentorship_mentee_profile' });
      }

      const result = await this.menteeService.hasMenteeProfile(req);
      logger.success(req, 'has_mentorship_mentee_profile', startTime, { hasProfile: result.hasProfile });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/applications?withTasks=true|false
  // Auth: logged-in user required (401 otherwise). Upstream scopes the read to the caller's token.
  public async getMenteeApplications(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_applications');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_applications' });
      }

      const rawWithTasks = req.query['withTasks'];
      if (rawWithTasks !== undefined && rawWithTasks !== 'true' && rawWithTasks !== 'false') {
        throw ServiceValidationError.forField('withTasks', 'withTasks must be true or false', { operation: 'get_mentorship_mentee_applications' });
      }
      const withTasks = rawWithTasks === 'true';
      const applications = await this.menteeService.getMenteeApplications(req, withTasks);
      logger.success(req, 'get_mentorship_mentee_applications', startTime, { count: applications.data.length, withTasks });
      res.json(applications);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentee/applications/:applicationId/withdraw  (no body) -> 204
  // Auth: logged-in user required (401 otherwise). Upstream only lets the applicant withdraw
  // (403 otherwise) and only a pending application (409 otherwise); both pass through.
  public async withdrawMenteeApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'withdraw_mentorship_mentee_application');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'withdraw_mentorship_mentee_application' });
      }

      // Upstream checks access on `mentorship_application:<id>`, so only a UUID can match.
      const applicationId = parseTrimmedString(req.params['applicationId']);
      if (!applicationId || !isUuid(applicationId)) {
        throw ServiceValidationError.forField('applicationId', 'applicationId must be an application UUID', {
          operation: 'withdraw_mentorship_mentee_application',
        });
      }

      await this.menteeService.withdrawMenteeApplication(req, applicationId);
      logger.success(req, 'withdraw_mentorship_mentee_application', startTime, { applicationId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/profile
  // Auth: logged-in user required (401 otherwise). Upstream scopes the read to the caller's token.
  public async getMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_profile' });
      }

      const profile = await this.menteeService.getMenteeProfile(req);
      logger.success(req, 'get_mentorship_mentee_profile', startTime, { history_count: profile.history.length });
      res.json(profile);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/apply-target?programId=&programTermId=
  public async getMenteeApplyTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_apply_target');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_apply_target' });
      }

      const programId = parseTrimmedString(req.query['programId']);
      const programTermId = parseTrimmedString(req.query['programTermId']);
      if (!programId) {
        throw ServiceValidationError.forField('programId', 'programId is required', { operation: 'get_mentorship_mentee_apply_target' });
      }
      if (!programTermId) {
        throw ServiceValidationError.forField('programTermId', 'programTermId is required', { operation: 'get_mentorship_mentee_apply_target' });
      }

      const target = await this.menteeService.getMenteeApplyTarget(req, programId, programTermId);
      logger.success(req, 'get_mentorship_mentee_apply_target', startTime, { programId, programTermId });
      res.json(target);
    } catch (error) {
      next(error);
    }
  }
}
