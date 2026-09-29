// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipMenteeApplyIds } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseMentorshipMenteeProfileUpdate } from '../helpers/mentorship-mentee-profile-update.helper';
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

  // PATCH /api/mentorship/mentee/profile  { introduction?, skillSet?, demographics?, socioeconomics? } -> 200 { profile, demographics? }
  // Auth: logged-in user required (401 otherwise); refused while impersonating (403, route middleware).
  // The body is validated strictly here because upstream ignores unknown fields and validates nothing (400).
  // Upstream's 404 (no mentee profile) and 409 (more than one) pass through.
  public async updateMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_mentorship_mentee_profile' });
      }

      const request = parseMentorshipMenteeProfileUpdate(req.body, 'update_mentorship_mentee_profile');
      const result = await this.menteeService.updateMenteeProfile(req, request);
      // Group names only: the values are personal data.
      logger.success(req, 'update_mentorship_mentee_profile', startTime, { changed_groups: Object.keys(request) });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/apply-target?programId=&programTermId=
  // Auth: logged-in user required (401 otherwise). Upstream's 404 (term not in the program, or the
  // program not visible) passes through.
  public async getMenteeApplyTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_apply_target');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_apply_target' });
      }

      const { programId, programTermId } = this.parseApplyIds(req.query['programId'], req.query['programTermId'], 'get_mentorship_mentee_apply_target');
      const target = await this.menteeService.getMenteeApplyTarget(req, programId, programTermId);
      logger.success(req, 'get_mentorship_mentee_apply_target', startTime, { programId, programTermId });
      res.json(target);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentee/apply  { programId, programTermId } -> 204
  // Auth: logged-in user required (401 otherwise). Upstream's 422 (term not taking applications),
  // 409 (already applied to the term) and 404 (term not in the program) pass through.
  public async applyToMenteeTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'apply_to_mentorship_mentee_term');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'apply_to_mentorship_mentee_term' });
      }

      const { programId, programTermId } = this.parseApplyIds(req.body?.programId, req.body?.programTermId, 'apply_to_mentorship_mentee_term');
      await this.menteeService.applyToMenteeTerm(req, programId, programTermId);
      logger.success(req, 'apply_to_mentorship_mentee_term', startTime, { programId, programTermId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * The program and term ids of an apply request. Upstream checks access on `mentorship_program:<id>`
   * and looks the term up by id, so only UUIDs can match; anything else is refused here.
   */
  private parseApplyIds(rawProgramId: unknown, rawProgramTermId: unknown, operation: string): MentorshipMenteeApplyIds {
    const programId = parseTrimmedString(rawProgramId);
    const programTermId = parseTrimmedString(rawProgramTermId);
    if (!programId || !isUuid(programId)) {
      throw ServiceValidationError.forField('programId', 'programId must be a program UUID', { operation });
    }
    if (!programTermId || !isUuid(programTermId)) {
      throw ServiceValidationError.forField('programTermId', 'programTermId must be a program term UUID', { operation });
    }
    return { programId, programTermId };
  }
}
