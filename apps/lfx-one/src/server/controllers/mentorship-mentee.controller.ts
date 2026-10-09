// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MENTORSHIP_MENTEE_TASK_FILE_NAME_HEADER, MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_CONTENT_TYPE } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplyIds } from '@lfx-one/shared/interfaces';
import { hasMentorshipTaskFileExtension, isMentorshipMenteeUpdatableTaskStatus, isUuid, sanitizeMentorshipTaskFileName } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, MicroserviceError, ServiceValidationError } from '../errors';
import { parseMentorshipMenteeRegisterRequest } from '../helpers/mentorship-mentee-register.helper';
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

  // POST /api/mentorship/mentee/profile  (register form body) -> 204
  // Auth: logged-in user required (401 otherwise). The body is validated with the rules the form
  // uses (400 with per-field errors). An existing profile is refused with a 409 rather than
  // replaced; upstream's 403 and 422 pass through.
  public async registerMenteeProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'register_mentorship_mentee_profile');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'register_mentorship_mentee_profile' });
      }

      const request = parseMentorshipMenteeRegisterRequest(req.body);
      await this.menteeService.registerMenteeProfile(req, request);
      logger.success(req, 'register_mentorship_mentee_profile', startTime, { has_demographics: request.demographics !== undefined });
      res.status(204).send();
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

  // PATCH /api/mentorship/mentee/tasks/:taskId  { status: 'in_progress' | 'submitted' } -> 204
  // Auth: logged-in user required (401 otherwise). A mentee can only start a task or submit one; the
  // reviewer statuses are refused here. Any other body key, notably `file`, is ignored and never
  // forwarded: the file goes through its own route, and upstream checks a required one against the one stored.
  // A submit after the task's due date (end of that UTC day) is refused with a 400 `TASK_PAST_DUE`.
  // Upstream's 400 (a required file is missing), 403 (not the assignee), 404 and 409 (not a legal
  // move from the task's status) pass through.
  public async updateMenteeTaskStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_mentorship_mentee_task_status');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_mentorship_mentee_task_status' });
      }

      // Upstream checks access on `mentorship_task:<id>`, so only a UUID can match.
      const taskId = parseTrimmedString(req.params['taskId']);
      if (!taskId || !isUuid(taskId)) {
        throw ServiceValidationError.forField('taskId', 'taskId must be a valid UUID', { operation: 'update_mentorship_mentee_task_status' });
      }

      const status = req.body?.status;
      if (!isMentorshipMenteeUpdatableTaskStatus(status)) {
        throw ServiceValidationError.forField('status', 'status must be one of: in_progress, submitted', {
          operation: 'update_mentorship_mentee_task_status',
        });
      }

      await this.menteeService.updateMenteeTaskStatus(req, taskId, status);
      logger.success(req, 'update_mentorship_mentee_task_status', startTime, { taskId, status });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  // POST /api/mentorship/mentee/tasks/:taskId/file  raw file bytes (application/octet-stream) -> 201
  // Auth: logged-in user required (401 otherwise). The route's raw parser reads only `application/octet-stream`, so any
  // other type is a 415, and over 20 MB is a 413 before this runs. The file name comes URI-encoded in the `X-File-Name`
  // header, never the URL, which the request logger writes on every line: a missing or undecodable one is a 400, and one
  // not ending in .pdf, .doc, .docx or .txt a 415. Path separators, quotes and control characters are replaced rather
  // than refused, since upstream cleans the name anyway; upstream also decides the type from the bytes. A change after
  // the due date is a 400 `TASK_PAST_DUE`. Only the task id and the size are logged, never the file name or the bytes.
  public async uploadMenteeTaskFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'upload_mentorship_mentee_task_file';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const taskId = this.requireTaskId(req, operation);
      // `express.raw` skips a body whose type is not the one it reads, so a wrong type arrives here with no bytes.
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_CONTENT_TYPE) {
        throw this.unsupportedTaskFile(req, operation);
      }
      const fileName = this.readTaskFileName(req, operation);
      if (!hasMentorshipTaskFileExtension(fileName)) {
        throw this.unsupportedTaskFile(req, operation);
      }
      const file: unknown = req.body;
      if (!Buffer.isBuffer(file) || file.byteLength === 0) {
        throw ServiceValidationError.forField('file', 'file must not be empty.', { operation });
      }

      const result = await this.menteeService.uploadMenteeTaskFile(req, taskId, fileName, file);
      logger.success(req, operation, startTime, { taskId, sizeBytes: file.byteLength });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/mentorship/mentee/tasks/:taskId/file -> 204
  // Auth: logged-in user required (401 otherwise). Upstream allows it only while the task is not started or in progress;
  // its 403, 404 and 409 pass through. A change after the due date is a 400 `TASK_PAST_DUE`.
  public async deleteMenteeTaskFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'delete_mentorship_mentee_task_file';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const taskId = this.requireTaskId(req, operation);
      await this.menteeService.deleteMenteeTaskFile(req, taskId);
      logger.success(req, operation, startTime, { taskId });
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

  /** The task id from the path. Upstream checks access on `mentorship_task:<id>`, so only a UUID can match. */
  private requireTaskId(req: Request, operation: string): string {
    const taskId = parseTrimmedString(req.params['taskId']);
    if (!taskId || !isUuid(taskId)) {
      throw ServiceValidationError.forField('taskId', 'taskId must be a valid UUID', { operation });
    }
    return taskId;
  }

  /** The task file's name from its URI-encoded header, made safe for the multipart part header. Missing, undecodable or blank is a 400. */
  private readTaskFileName(req: Request, operation: string): string {
    const raw = req.headers[MENTORSHIP_MENTEE_TASK_FILE_NAME_HEADER.toLowerCase()];
    let decoded = '';
    try {
      decoded = typeof raw === 'string' ? decodeURIComponent(raw) : '';
    } catch {
      decoded = '';
    }
    const fileName = sanitizeMentorshipTaskFileName(decoded);
    if (!fileName) {
      throw ServiceValidationError.forField('fileName', `The ${MENTORSHIP_MENTEE_TASK_FILE_NAME_HEADER} header must carry the URI-encoded file name`, {
        operation,
      });
    }
    return fileName;
  }

  /** A 415 for a task file the BFF already knows upstream would refuse, in upstream's own wording. */
  private unsupportedTaskFile(req: Request, operation: string): MicroserviceError {
    return new MicroserviceError('File must be PDF, DOC, DOCX or plain text', 415, 'UNSUPPORTED_MEDIA_TYPE', {
      operation,
      service: 'mentorship_mentee_controller',
      path: req.path,
    });
  }
}
