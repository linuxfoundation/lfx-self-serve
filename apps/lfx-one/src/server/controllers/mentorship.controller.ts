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

      // Reject unknown status values eagerly — matches crowdfunding's status validation on update.
      const rawStatus = parseTrimmedString(status);
      if (rawStatus !== undefined && !isMentorshipProgramStatus(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: open, pending-review, completed`, {
          operation: 'get_mentorship_programs',
        });
      }

      const programs = await this.mentorshipService.getPrograms(req, {
        search: parseTrimmedString(search),
        status: rawStatus,
      });

      logger.success(req, 'get_mentorship_programs', startTime, { result_count: programs.data.length });

      res.json(programs);
    } catch (error) {
      next(error);
    }
  }
}
