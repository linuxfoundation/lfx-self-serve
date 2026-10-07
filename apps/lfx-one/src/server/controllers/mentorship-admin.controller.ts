// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MENTORSHIP_ADMIN_DECISION_STATUSES,
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_MANAGEMENT_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH,
  MENTORSHIP_ADMIN_MENTOR_INVITE_LFID_MAX_LENGTH,
  MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS,
  MENTORSHIP_ADMIN_MENTEE_TABS,
  MENTORSHIP_ADMIN_MENTEES_MAX_LIMIT,
  MENTORSHIP_ADMIN_MENTEES_PAGE_SIZE,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_ADMIN_MENTOR_UPDATE_STATUSES,
  MENTORSHIP_ATTENDANCE_TYPES,
  MENTORSHIP_ENROLL_LOGO_MIME_TYPES,
  MENTORSHIP_PROGRAM_PAGE_SIZE,
  MENTORSHIP_PROGRAM_STATUSES,
  MENTORSHIP_PROGRAMS_MAX_LIMIT,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminMenteeStatusFilter,
  MentorshipAdminMenteeTab,
  MentorshipAdminMentorInviteRequest,
  MentorshipAdminMentorStatus,
  MentorshipAdminMentorStatusUpdate,
  MentorshipAttendanceType,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, MicroserviceError, ServiceValidationError } from '../errors';
import { parseMentorshipAdminTaskUpdate } from '../helpers/mentorship-admin-task.helper';
import { parseMentorshipAdminTermInput } from '../helpers/mentorship-admin-term.helper';
import { parseMentorshipApplicationNote } from '../helpers/mentorship-application-note.helper';
import { parseMentorshipEnrollCreateRequest, parseMentorshipEnrollUpdateRequest } from '../helpers/mentorship-enroll.helper';
import { parseMentorshipMentorTaskCreateRequest } from '../helpers/mentorship-mentor-task.helper';
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

  // GET /api/mentorship/admin/programs/:programId/enroll-template — the details the enroll wizard copies from an existing program
  public async getEnrollTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_enroll_template';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const template = await this.mentorshipAdminService.getEnrollTemplate(req, programId);

      logger.success(req, operation, startTime, { programId, count: template.prerequisites.length });
      res.json(template);
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

      const type = rawType as MentorshipAdminMenteeTab;
      const statusFilters = MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS[type];
      const rawStatus = parseTrimmedString(getStrictStringQueryParam(req, 'status', operation));
      if (rawStatus !== undefined && !(statusFilters as readonly string[]).includes(rawStatus)) {
        throw ServiceValidationError.forField('status', `status must be one of: ${statusFilters.join(', ')}`, { operation });
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

      const status = rawStatus as MentorshipAdminMenteeStatusFilter | undefined;
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

  // POST /api/mentorship/admin/programs/:programId/mentor-candidates — body { search } -> 200 { data }
  public async getMentorCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_mentorship_admin_mentor_candidates';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);

      const search = this.parseMentorCandidatesSearch(req.body, operation);

      const candidates = await this.mentorshipAdminService.getMentorCandidates(req, programId, search);

      logger.success(req, operation, startTime, { programId, result_count: candidates.data.length });
      res.json(candidates);
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

  // POST /api/mentorship/admin/tasks  { applicationIds, name, description, dueDate?, requiresFileSubmission? } -> { created, failed }
  // Auth: logged-in user required (401 otherwise). The body is validated with the task dialog's rules (400), the same
  // as the mentor route. With one application upstream's status passes through; with several, the ones not created
  // are listed in `failed`. Only ids and counts are logged, never the task's text.
  public async createTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'create_mentorship_admin_tasks';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const request = parseMentorshipMentorTaskCreateRequest(req.body, operation);
      const result = await this.mentorshipAdminService.createTasks(req, request);

      logger.success(req, operation, startTime, {
        application_count: request.applicationIds.length,
        created_count: result.created.length,
        failed_count: result.failed.length,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/admin/tasks/:taskId
  // Auth: logged-in user required (401 otherwise). The id must be a UUID and the body is validated (400) before any upstream
  // call. Returns the updated task so the page patches its row without reading the list again. Upstream checks the caller
  // mentors or manages the program and is not the assignee; its 403, 404 and 400 pass through. Only the task id and the
  // names of the fields changed are logged, never the task's text.
  public async updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_task';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const taskId = this.requireUuidParam(req, 'taskId', operation);
      const update = parseMentorshipAdminTaskUpdate(req.body, operation);
      const task = await this.mentorshipAdminService.updateTask(req, taskId, update);

      logger.success(req, operation, startTime, { taskId, fields: Object.keys(update) });
      res.json(task);
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

  // POST /api/mentorship/admin/programs/:programId/mentors — body { lfid } -> 204
  public async inviteProgramMentor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'invite_mentorship_admin_program_mentor';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const body = this.parseMentorInvite(req.body, operation);
      const memberId = await this.mentorshipAdminService.inviteProgramMentor(req, programId, body);

      logger.success(req, operation, startTime, { programId, memberId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/admin/programs/:programId/mentors/:memberId — body { status } -> 204
  public async updateProgramMentor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_program_mentor';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const memberId = this.requireUuidParam(req, 'memberId', operation);
      const body = this.parseMentorStatusUpdate(req.body, operation);
      await this.mentorshipAdminService.updateProgramMentor(req, programId, memberId, body);

      logger.success(req, operation, startTime, { programId, memberId, status: body.status });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/programs — body MentorshipEnrollCreateRequest -> 201 + { id, slug, status }
  public async createProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'create_mentorship_admin_program';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const body = parseMentorshipEnrollCreateRequest(req.body, operation);
      const program = await this.mentorshipAdminService.createProgram(req, body);

      logger.success(req, operation, startTime, { programId: program.id, status: program.status });
      res.status(201).json(program);
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/admin/programs/:programId — the edit wizard's program fields; terms and the logo have their own routes
  public async updateProgram(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_program';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const body = parseMentorshipEnrollUpdateRequest(req.body, operation);
      const program = await this.mentorshipAdminService.updateProgram(req, programId, body);

      logger.success(req, operation, startTime, { programId: program.id, status: program.status });
      res.json(program);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/programs/:programId/logo — raw PNG or JPEG bytes -> 201 + { logoUrl }
  public async uploadProgramLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'upload_mentorship_program_logo';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);

      // `express.raw` skips a body whose type is not on the list, so a wrong type arrives here with no bytes and must be told apart from an empty file.
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!(MENTORSHIP_ENROLL_LOGO_MIME_TYPES as readonly string[]).includes(contentType)) {
        throw new MicroserviceError('Logo must be a PNG or JPEG image', 415, 'UNSUPPORTED_MEDIA_TYPE', {
          operation,
          service: 'mentorship_admin_controller',
          path: req.path,
        });
      }
      const logo: unknown = req.body;
      if (!Buffer.isBuffer(logo) || logo.byteLength === 0) {
        throw ServiceValidationError.forField('logo', 'logo must not be empty.', { operation });
      }

      const result = await this.mentorshipAdminService.uploadProgramLogo(req, programId, logo, contentType);

      logger.success(req, operation, startTime, { programId, sizeBytes: logo.byteLength, contentType });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/programs/:programId/terms — body MentorshipAdminTermInput -> 201 + the term row
  public async createTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'create_mentorship_admin_term';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const input = parseMentorshipAdminTermInput(req.body, operation);
      const term = await this.mentorshipAdminService.createTerm(req, programId, input);

      logger.success(req, operation, startTime, { programId, termId: term.id });
      res.status(201).json(term);
    } catch (error) {
      next(error);
    }
  }

  // PATCH /api/mentorship/admin/programs/:programId/terms/:termId — body MentorshipAdminTermInput -> 200 + the term row
  public async updateTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_admin_term';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const termId = this.requireUuidParam(req, 'termId', operation);
      const input = parseMentorshipAdminTermInput(req.body, operation);
      const term = await this.mentorshipAdminService.updateTerm(req, programId, termId, input);

      logger.success(req, operation, startTime, { programId, termId });
      res.json(term);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/admin/programs/:programId/terms/:termId/close -> 204
  public async closeTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.runTermAction(req, res, next, 'close_mentorship_admin_term', (programId, termId) =>
      this.mentorshipAdminService.closeTerm(req, programId, termId)
    );
  }

  // POST /api/mentorship/admin/programs/:programId/terms/:termId/reopen -> 204
  public async reopenTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.runTermAction(req, res, next, 'reopen_mentorship_admin_term', (programId, termId) =>
      this.mentorshipAdminService.reopenTerm(req, programId, termId)
    );
  }

  // DELETE /api/mentorship/admin/programs/:programId/terms/:termId -> 204
  public async deleteTerm(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.runTermAction(req, res, next, 'delete_mentorship_admin_term', (programId, termId) =>
      this.mentorshipAdminService.deleteTerm(req, programId, termId)
    );
  }

  /** The shared shape of close, re-open and delete: authenticate, check both ids, write, answer 204. */
  private async runTermAction(
    req: Request,
    res: Response,
    next: NextFunction,
    operation: string,
    action: (programId: string, termId: string) => Promise<void>
  ): Promise<void> {
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const programId = this.requireUuidParam(req, 'programId', operation);
      const termId = this.requireUuidParam(req, 'termId', operation);
      await action(programId, termId);

      logger.success(req, operation, startTime, { programId, termId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * The search comes in the body so it never reaches the logged request URL, and never goes into a log line here.
   * Upstream refuses a search under the minimum with a 400; refusing it here saves the round trip. Length is counted in
   * code points, as upstream counts runes, so an emoji is one character, not two UTF-16 units.
   */
  private parseMentorCandidatesSearch(body: unknown, operation: string): string {
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const search = typeof raw['search'] === 'string' ? raw['search'].trim() : '';
    const length = Array.from(search).length;
    if (length < MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH || length > MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH) {
      throw ServiceValidationError.forField(
        'search',
        `search must be ${MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH} to ${MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MAX_SEARCH_LENGTH} characters.`,
        { operation }
      );
    }
    return search;
  }

  /** `lfid` must be a non-blank string; only the LFID is forwarded, never an email or a user id. */
  private parseMentorInvite(body: unknown, operation: string): MentorshipAdminMentorInviteRequest {
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const lfid = typeof raw['lfid'] === 'string' ? raw['lfid'].trim() : '';
    if (!lfid || lfid.length > MENTORSHIP_ADMIN_MENTOR_INVITE_LFID_MAX_LENGTH) {
      throw ServiceValidationError.forField('lfid', `lfid must be 1 to ${MENTORSHIP_ADMIN_MENTOR_INVITE_LFID_MAX_LENGTH} characters.`, { operation });
    }
    return { lfid };
  }

  /** `status` must be one the admin can set on a mentor. */
  private parseMentorStatusUpdate(body: unknown, operation: string): MentorshipAdminMentorStatusUpdate {
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const statuses: readonly string[] = MENTORSHIP_ADMIN_MENTOR_UPDATE_STATUSES;
    if (typeof raw['status'] !== 'string' || !statuses.includes(raw['status'])) {
      throw ServiceValidationError.forField('status', `status must be one of: ${statuses.join(', ')}`, { operation });
    }
    return { status: raw['status'] as MentorshipAdminMentorStatusUpdate['status'] };
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

  private requireUuidParam(req: Request, name: 'programId' | 'applicationId' | 'termId' | 'memberId' | 'taskId', operation: string): string {
    const value = typeof req.params[name] === 'string' ? req.params[name].trim() : '';
    if (!isUuid(value)) {
      throw ServiceValidationError.forField(name, `${name} must be a UUID.`, { operation });
    }
    return value;
  }
}
