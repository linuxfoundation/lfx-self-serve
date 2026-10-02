// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { readMentorshipLfxProfileFields } from '../helpers/mentorship-lfx-profile.helper';
import { parseTrimmedString } from '../helpers/mentorship-params.helper';
import { isMentorshipProgramReviewDecision, isMentorshipProgramStatus, MentorshipService } from '../services/mentorship.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const parseIntQuery = (val: unknown): number | undefined => {
  const raw = parseTrimmedString(val);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class MentorshipController {
  private readonly mentorshipService = new MentorshipService();

  // GET /api/mentorship/programs
  public async getPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_programs' });
      }

      const { search, status } = req.query;

      const rawStatus = parseTrimmedString(status);
      if (rawStatus !== undefined && !isMentorshipProgramStatus(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: open, pending-review, completed`, {
          operation: 'get_mentorship_programs',
        });
      }

      const programs = await this.mentorshipService.getPrograms(req, {
        search: parseTrimmedString(search),
        status: rawStatus,
        offset: parseIntQuery(req.query['offset']),
        limit: parseIntQuery(req.query['limit']),
      });

      logger.success(req, 'get_mentorship_programs', startTime, { result_count: programs.data.length });

      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/programs/:programId — id (default) or slug
  public async getProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_program' });
      }

      const programId = typeof req.params['programId'] === 'string' ? req.params['programId'].trim() : '';
      if (!programId) {
        throw ServiceValidationError.forField('programId', 'Program id or slug is required.', { operation: 'get_mentorship_program' });
      }

      const program = await this.mentorshipService.getProgram(req, programId);
      logger.success(req, 'get_mentorship_program', startTime, { programId });
      res.json(program);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/programs/name-available
  public async isProgramNameAvailable(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_name_available');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_name_available' });
      }

      const name = parseTrimmedString(req.query['name']) ?? '';
      if (!name) {
        throw ServiceValidationError.forField('name', 'Program name is required.', { operation: 'get_mentorship_name_available' });
      }

      const result = await this.mentorshipService.isProgramNameAvailable(req, name);
      logger.success(req, 'get_mentorship_name_available', startTime, { available: result.available });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/lf-projects
  public async getLfProjects(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_lf_projects');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_lf_projects' });
      }

      const projects = await this.mentorshipService.getLfProjects(req, {
        search: parseTrimmedString(req.query['search']),
        offset: parseIntQuery(req.query['offset']),
        limit: parseIntQuery(req.query['limit']),
      });

      logger.success(req, 'get_mentorship_lf_projects', startTime, { result_count: projects.data.length });
      res.json(projects);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/invitable-users
  public async getInvitableUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_invitable_users');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_invitable_users' });
      }

      const users = await this.mentorshipService.getInvitableUsers(req, {
        search: parseTrimmedString(req.query['search']),
        offset: parseIntQuery(req.query['offset']),
        limit: parseIntQuery(req.query['limit']),
      });

      logger.success(req, 'get_mentorship_invitable_users', startTime, { result_count: users.data.length });
      res.json(users);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/program-review/:programId
  public async getProgramReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_program_review');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_program_review' });
      }

      const programId = this.parseReviewProgramId(req, 'get_mentorship_program_review');
      const review = await this.mentorshipService.getProgramReview(req, programId);

      logger.success(req, 'get_mentorship_program_review', startTime, { programId, status: review.status });
      res.json(review);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/program-review/:programId/decision  { decision: 'approve' | 'reject' }
  public async submitProgramDecision(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'submit_mentorship_program_decision');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'submit_mentorship_program_decision' });
      }

      const programId = this.parseReviewProgramId(req, 'submit_mentorship_program_decision');
      const decision: unknown = req.body?.decision;
      if (!isMentorshipProgramReviewDecision(decision)) {
        throw ServiceValidationError.forField('decision', 'decision must be one of: approve, reject', { operation: 'submit_mentorship_program_decision' });
      }

      const review = await this.mentorshipService.submitProgramDecision(req, programId, decision);

      logger.success(req, 'submit_mentorship_program_decision', startTime, { programId, decision, status: review.status });
      res.json(review);
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/me/lfx-profile
  // Auth: logged-in user required (401 otherwise); refused while impersonating by the route. The
  // body is the name and logo the profile card shows after an Edit LFX Profile save, or empty after
  // a Connect, checked with the rules the browser applies (400 with per-field errors); any email or
  // link in it is ignored. Copies them, with the caller's verified primary email and connected
  // GitHub link, onto every mentor and mentee profile the caller holds; 204 whether or not there
  // were any.
  public async syncLfxProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'sync_mentorship_lfx_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'sync_mentorship_lfx_profile' });
      }

      const { fields, errors } = readMentorshipLfxProfileFields(req.body);
      if (Object.keys(errors).length > 0) {
        throw ServiceValidationError.fromFieldErrors(errors, 'Validation failed', { operation: 'sync_mentorship_lfx_profile' });
      }

      const syncedCount = await this.mentorshipService.syncLfxProfileFields(req, fields);
      logger.success(req, 'sync_mentorship_lfx_profile', startTime, { synced_count: syncedCount, field_count: Object.keys(fields).length });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/cii/:projectId
  public async getCiiBadge(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_cii_badge');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_cii_badge' });
      }

      const projectId = typeof req.params['projectId'] === 'string' ? req.params['projectId'] : '';
      const badge = await this.mentorshipService.getCiiBadge(req, projectId);

      logger.success(req, 'get_mentorship_cii_badge', startTime, { projectId: badge.projectId });

      res.json(badge);
    } catch (error) {
      next(error);
    }
  }

  /** Review links carry the program UUID: upstream checks access on `mentorship_program:<id>`, so a slug cannot work. */
  private parseReviewProgramId(req: Request, operation: string): string {
    const programId = parseTrimmedString(req.params['programId']);
    if (!programId || !isUuid(programId)) {
      throw ServiceValidationError.forField('programId', 'programId must be a program UUID', { operation });
    }
    return programId;
  }
}
