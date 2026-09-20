// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { isMentorshipProgramStatus, MentorshipService } from '../services/mentorship.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const parseTrimmedString = (val: unknown): string | undefined => {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

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

  // GET /api/mentorship/mentor/programs
  public async getMentorPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_programs' });
      }

      const programs = await this.mentorshipService.getMentorPrograms(req);
      logger.success(req, 'get_mentorship_mentor_programs', startTime, { result_count: programs.data.length });
      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/programs/:programId — id (default) or slug
  public async getMentorProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_program' });
      }

      const programId = typeof req.params['programId'] === 'string' ? req.params['programId'].trim() : '';
      if (!programId) {
        throw ServiceValidationError.forField('programId', 'Program id or slug is required.', { operation: 'get_mentorship_mentor_program' });
      }

      const program = await this.mentorshipService.getMentorProgram(req, programId);
      logger.success(req, 'get_mentorship_mentor_program', startTime, { programId });
      res.json(program);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentor/profile
  public async getMentorProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_profile' });
      }

      const profile = await this.mentorshipService.getMentorProfile(req);
      logger.success(req, 'get_mentorship_mentor_profile', startTime, { history_count: profile.history.length });
      res.json(profile);
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

  // ---------------------------------------------------------------------------
  // Mentee endpoints
  // ---------------------------------------------------------------------------

  // GET /api/mentorship/mentee/has-profile
  public async hasMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'has_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'has_mentorship_mentee_profile' });
      }

      const result = await this.mentorshipService.hasMenteeProfile(req);
      logger.success(req, 'has_mentorship_mentee_profile', startTime, { hasProfile: result.hasProfile });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/overview
  public async getMenteeOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_overview');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_overview' });
      }

      const rawPhase = parseTrimmedString(req.query['phase']);
      const phase = rawPhase === 'empty' || rawPhase === 'applicant' || rawPhase === 'accepted' ? rawPhase : undefined;
      const overview = await this.mentorshipService.getMenteeOverview(req, phase);
      logger.success(req, 'get_mentorship_mentee_overview', startTime, { phase: overview.phase });
      res.json(overview);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/tasks
  public async getMenteeTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_tasks');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_tasks' });
      }

      const tasks = await this.mentorshipService.getMenteeTasks(req);
      logger.success(req, 'get_mentorship_mentee_tasks', startTime, { count: tasks.data.length });
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/mentee/profile
  public async getMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentee_profile' });
      }

      const profile = await this.mentorshipService.getMenteeProfile(req);
      logger.success(req, 'get_mentorship_mentee_profile', startTime);
      res.json(profile);
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
}
