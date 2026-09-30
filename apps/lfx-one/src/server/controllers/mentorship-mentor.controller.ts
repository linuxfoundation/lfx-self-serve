// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MentorshipMentorService } from '../services/mentorship-mentor.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class MentorshipMentorController {
  private readonly mentorService = new MentorshipMentorService();

  // GET /api/mentorship/mentor/programs
  public async getMentorPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_mentor_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_mentor_programs' });
      }

      const programs = await this.mentorService.getMentorPrograms(req);
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

      const program = await this.mentorService.getMentorProgram(req, programId);
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

      const profile = await this.mentorService.getMentorProfile(req);
      logger.success(req, 'get_mentorship_mentor_profile', startTime, { history_count: profile.history.length });
      res.json(profile);
    } catch (error) {
      next(error);
    }
  }
}
