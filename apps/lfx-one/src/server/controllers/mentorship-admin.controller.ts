// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_PROGRAM_PAGE_SIZE, MENTORSHIP_PROGRAM_STATUSES, MENTORSHIP_PROGRAMS_MAX_LIMIT } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseMentorshipAdminPaging, parseTrimmedString } from '../helpers/mentorship-params.helper';
import { getStrictStringQueryParam } from '../helpers/strict-query-param.helper';
import { isMentorshipProgramStatus, MentorshipAdminService } from '../services/mentorship-admin.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

export class MentorshipAdminController {
  private readonly mentorshipAdminService = new MentorshipAdminService();

  // GET /api/mentorship/admin/programs
  public async getPrograms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_admin_programs');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_admin_programs' });
      }

      // A repeated `search` or `status` is a 400, not silently dropped; a blank one means no filter.
      const search = parseTrimmedString(getStrictStringQueryParam(req, 'search', 'get_mentorship_admin_programs'));
      const rawStatus = parseTrimmedString(getStrictStringQueryParam(req, 'status', 'get_mentorship_admin_programs'));
      if (rawStatus !== undefined && !isMentorshipProgramStatus(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: ${MENTORSHIP_PROGRAM_STATUSES.join(', ')}`, {
          operation: 'get_mentorship_admin_programs',
        });
      }

      const { offset, limit } = parseMentorshipAdminPaging(req.query, {
        defaultLimit: MENTORSHIP_PROGRAM_PAGE_SIZE,
        maxLimit: MENTORSHIP_PROGRAMS_MAX_LIMIT,
        operation: 'get_mentorship_admin_programs',
      });

      const programs = await this.mentorshipAdminService.getPrograms(req, { search, status: rawStatus, offset, limit });

      // The search text is left out of the log: it is user input.
      logger.success(req, 'get_mentorship_admin_programs', startTime, { status: rawStatus, offset, limit, result_count: programs.data.length });

      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/programs/:programId — id (default) or slug
  public async getProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_admin_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_admin_program' });
      }

      const programId = typeof req.params['programId'] === 'string' ? req.params['programId'].trim() : '';
      if (!programId) {
        throw ServiceValidationError.forField('programId', 'Program id or slug is required.', { operation: 'get_mentorship_admin_program' });
      }

      const program = await this.mentorshipAdminService.getProgram(req, programId);
      logger.success(req, 'get_mentorship_admin_program', startTime, { programId });
      res.json(program);
    } catch (error) {
      next(error);
    }
  }
}
