// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { parseMentorshipTaskCreateRequest, parseMentorshipTaskUpdate } from '../helpers/mentorship-task.helper';
import { logger } from '../services/logger.service';
import { MentorshipTaskService } from '../services/mentorship-task.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

/** Task writes for the admin and mentor program details; upstream authorizes each by the caller's role on the program. */
export class MentorshipTaskController {
  private readonly taskService = new MentorshipTaskService();

  // POST /api/mentorship/tasks  { applicationIds, name, description, dueDate?, requiresFileSubmission? } -> { created, failed }
  // Auth: logged-in user required (401 otherwise). The body is validated with the task dialog's rules (400). With one
  // application upstream's status passes through; with several, the ones not created are listed in `failed`. Only ids
  // and counts are logged, never the task's text.
  public async createTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'create_mentorship_tasks';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const request = parseMentorshipTaskCreateRequest(req.body, operation);
      const result = await this.taskService.createTasks(req, request);

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

  // PATCH /api/mentorship/tasks/:taskId
  // Auth: logged-in user required (401 otherwise). The id must be a UUID and the body is validated (400) before any upstream
  // call. Returns the updated task so the page patches its row without reading the list again. Upstream checks the caller
  // mentors or manages the program and is not the assignee; its 403, 404 and 400 pass through. Only the task id and the
  // names of the fields changed are logged, never the task's text.
  public async updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_mentorship_task';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const taskId = typeof req.params['taskId'] === 'string' ? req.params['taskId'].trim() : '';
      if (!isUuid(taskId)) {
        throw ServiceValidationError.forField('taskId', 'taskId must be a UUID.', { operation });
      }
      const update = parseMentorshipTaskUpdate(req.body, operation);
      const task = await this.taskService.updateTask(req, taskId, update);

      logger.success(req, operation, startTime, { taskId, fields: Object.keys(update) });
      res.json(task);
    } catch (error) {
      next(error);
    }
  }
}
