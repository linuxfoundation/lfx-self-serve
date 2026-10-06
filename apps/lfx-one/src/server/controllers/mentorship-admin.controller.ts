// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_ADMIN_DECISION_STATUSES,
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTEE_TABS,
  MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_ATTENDANCE_TYPES,
  MENTORSHIP_MENTEE_STATUSES,
  MENTORSHIP_PROGRAM_PAGE_SIZE,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_PROGRAMS_MAX_LIMIT,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminMenteeTab,
  MentorshipAdminMentorStatus,
  MentorshipAttendanceType,
  MentorshipMenteeStatus,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseMentorshipApplicationNote } from '../helpers/mentorship-application-note.helper';
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

      // The search text stays out of this metadata; the request URL is logged as on every route.
      logger.success(req, 'get_mentorship_admin_programs', startTime, { status: rawStatus, offset, limit, result_count: programs.data.length });

      res.json(programs);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/programs/:programId — the program's UUID; the gateway denies a slug on management routes
  public async getProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_mentorship_admin_program');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_mentorship_admin_program' });
      }

      const programId = this.requireUuidParam(req, 'programId', 'get_mentorship_admin_program');
      const page = await this.mentorshipAdminService.getProgramPage(req, programId);
      logger.success(req, 'get_mentorship_admin_program', startTime, { programId });
      res.json(page);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/programs/:programId/mentees?type=current|past&status&termId&search&offset&limit
  public async getProgramMentees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_program_mentees';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);

      const rawType = parseTrimmedString(getStrictStringQueryParam(req, 'type', operation));
      if (rawType === undefined || !(MENTORSHIP_ADMIN_MENTEE_TABS as readonly string[]).includes(rawType)) {
        throw ServiceValidationError.forField('type', `type is required and must be one of: ${MENTORSHIP_ADMIN_MENTEE_TABS.join(', ')}`, { operation });
      }

      const rawStatus = parseTrimmedString(getStrictStringQueryParam(req, 'status', operation));
      if (rawStatus !== undefined && !(MENTORSHIP_MENTEE_STATUSES as readonly string[]).includes(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: ${MENTORSHIP_MENTEE_STATUSES.join(', ')}`, { operation });
      }

      const termId = parseTrimmedString(getStrictStringQueryParam(req, 'termId', operation));
      if (termId !== undefined && !isUuid(termId)) {
        throw ServiceValidationError.forField('termId', 'termId must be a UUID.', { operation });
      }

      // The service escapes the search for upstream; the text stays out of every log line.
      const search = parseTrimmedString(getStrictStringQueryParam(req, 'search', operation));
      const { offset, limit } = parseMentorshipAdminPaging(req.query, {
        defaultLimit: MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
        maxLimit: MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT,
        operation,
      });

      const type = rawType as MentorshipAdminMenteeTab;
      const status = rawStatus as MentorshipMenteeStatus | undefined;
      const mentees = await this.mentorshipAdminService.getProgramMentees(req, programId, { type, status, termId, search, offset, limit });

      logger.success(req, operation, startTime, { programId, type, status, offset, limit, result_count: mentees.data.length, total: mentees.total });
      res.json(mentees);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/programs/:programId/mentors?status&search&offset&limit
  public async getProgramMentors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_program_mentors';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);

      const rawStatus = parseTrimmedString(getStrictStringQueryParam(req, 'status', operation));
      if (rawStatus !== undefined && !(MENTORSHIP_ADMIN_MENTOR_STATUSES as readonly string[]).includes(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: ${MENTORSHIP_ADMIN_MENTOR_STATUSES.join(', ')}`, { operation });
      }

      // The service escapes the search for upstream; the text stays out of every log line.
      const search = parseTrimmedString(getStrictStringQueryParam(req, 'search', operation));
      const { offset, limit } = parseMentorshipAdminPaging(req.query, {
        defaultLimit: MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
        maxLimit: MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
        operation,
      });

      const status = rawStatus as MentorshipAdminMentorStatus | undefined;
      const mentors = await this.mentorshipAdminService.getProgramMentors(req, programId, { status, search, offset, limit });

      logger.success(req, operation, startTime, { programId, status, offset, limit, result_count: mentors.data.length, total: mentors.total });
      res.json(mentors);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/programs/:programId/terms?offset&limit
  public async getProgramTerms(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_program_terms';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const { offset, limit } = parseMentorshipAdminPaging(req.query, {
        defaultLimit: MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
        maxLimit: MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
        operation,
      });

      const terms = await this.mentorshipAdminService.getProgramTerms(req, programId, { offset, limit });

      logger.success(req, operation, startTime, { programId, offset, limit, result_count: terms.data.length, total: terms.total });
      res.json(terms);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/mentorship/admin/applications/:applicationId/tasks
  public async getApplicationTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_application_tasks';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const applicationId = this.requireUuidParam(req, 'applicationId', operation);
      const tasks = await this.mentorshipAdminService.getApplicationTasks(req, applicationId);

      logger.success(req, operation, startTime, { applicationId, result_count: tasks.length });
      res.json(tasks);
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/admin/applications/:applicationId/status — body { status, attendanceType? }
  public async updateApplicationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_application_status';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const applicationId = this.requireUuidParam(req, 'applicationId', operation);
      const body = this.parseStatusUpdate(req.body, operation);
      await this.mentorshipAdminService.updateApplicationStatus(req, applicationId, body);

      logger.success(req, operation, startTime, { applicationId, status: body.status });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // PUT /api/mentorship/admin/applications/:applicationId/note — body { note } -> 204. A note blank once trimmed clears it;
  // one over MENTORSHIP_MENTEE_NOTE_MAX characters is a 400. The note is never logged, only its length.
  public async updateApplicationNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_application_note';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const applicationId = this.requireUuidParam(req, 'applicationId', operation);
      const note = parseMentorshipApplicationNote(req.body, operation);

      await this.mentorshipAdminService.updateApplicationNote(req, applicationId, note);

      logger.success(req, operation, startTime, { applicationId, noteLength: note.length });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/applications/:applicationId/withdraw
  public async withdrawApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'withdraw_mentorship_admin_application';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const applicationId = this.requireUuidParam(req, 'applicationId', operation);
      await this.mentorshipAdminService.withdrawApplication(req, applicationId);

      logger.success(req, operation, startTime, { applicationId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/programs/:programId/terms/:termId/decline-pending
  public async declinePendingForTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'decline_mentorship_admin_pending_for_term';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const termId = this.requireUuidParam(req, 'termId', operation);
      const result = await this.mentorshipAdminService.declinePendingForTerm(req, programId, termId);

      logger.success(req, operation, startTime, { programId, termId, declinedCount: result.declinedCount });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** `status` must be one the admin can set; an accept also needs an `attendanceType`. */
  private parseStatusUpdate(body: unknown, operation: string): MentorshipAdminApplicationStatusUpdate {
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const statuses: readonly string[] = MENTORSHIP_ADMIN_DECISION_STATUSES;
    if (typeof raw['status'] !== 'string' || !statuses.includes(raw['status'])) {
      throw ServiceValidationError.forField('status', `status must be one of: ${statuses.join(', ')}`, { operation });
    }
    const status = raw['status'] as MentorshipAdminApplicationStatusUpdate['status'];
    if (status !== 'accepted') {
      return { status };
    }

    const attendanceType = raw['attendanceType'];
    if (typeof attendanceType !== 'string' || !(MENTORSHIP_ATTENDANCE_TYPES as readonly string[]).includes(attendanceType)) {
      throw ServiceValidationError.forField(
        'attendanceType',
        `attendanceType is required to accept and must be one of: ${MENTORSHIP_ATTENDANCE_TYPES.join(', ')}`,
        {
          operation,
        }
      );
    }
    return { status, attendanceType: attendanceType as MentorshipAttendanceType };
  }

  private requireUuidParam(req: Request, name: 'programId' | 'applicationId' | 'termId', operation: string): string {
    const value = typeof req.params[name] === 'string' ? req.params[name].trim() : '';
    if (!isUuid(value)) {
      throw ServiceValidationError.forField(name, `${name} must be a UUID.`, { operation });
    }
    return value;
  }
}
