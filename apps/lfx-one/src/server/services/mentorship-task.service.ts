// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MentorshipApplicantTask,
  MentorshipTaskCreateRequest,
  MentorshipTaskCreateResponse,
  MentorshipTaskUpdate,
  MentorshipUpstreamTask,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MENTORSHIP_TASK_FILE_TRANSFER_TIMEOUT_MS, MENTORSHIP_TASKS_PATH } from '../constants';
import { proxyMentorshipRequest } from '../helpers/mentorship-api.helper';
import { mapMentorshipProgramTask } from '../helpers/mentorship-program-application.helper';
import { buildMentorshipUpstreamTaskUpdate, createMentorshipMenteeTasks } from '../helpers/mentorship-task.helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Task writes shared by the admin and mentor program details. Upstream decides who may make each one, a program admin
 * or an active mentor of the program, so the BFF has no route per role. The task's text is never logged.
 */
export class MentorshipTaskService {
  private readonly microserviceProxy = new MicroserviceProxyService();

  /**
   * Gives accepted mentees a task: the caller's local user id owns and authors each task. With one application its
   * failure propagates, so upstream's status reaches the browser; with several, each failure is listed in `failed`.
   */
  public async createTasks(req: Request, request: MentorshipTaskCreateRequest): Promise<MentorshipTaskCreateResponse> {
    return createMentorshipMenteeTasks(this.microserviceProxy, req, request, 'create_mentorship_tasks');
  }

  /**
   * Edits one task and returns it as the row reads it, so the page patches the row in place instead of reading the list
   * again. Upstream checks the caller mentors or manages the task's program and is not its assignee (403), answers 404 for
   * an unknown task and 400 for a submitted task that requires a file with none uploaded; its status passes through. Only
   * the task id and the names of the fields sent are logged, never the task's text.
   */
  public async updateTask(req: Request, taskId: string, update: MentorshipTaskUpdate): Promise<MentorshipApplicantTask> {
    logger.debug(req, 'mentorship_update_task', 'Updating task', { taskId, fields: Object.keys(update) });

    const task = await proxyMentorshipRequest<MentorshipUpstreamTask>(
      this.microserviceProxy,
      req,
      `${MENTORSHIP_TASKS_PATH}/${encodeURIComponent(taskId)}`,
      'PATCH',
      undefined,
      buildMentorshipUpstreamTaskUpdate(update)
    );
    return mapMentorshipProgramTask(task);
  }

  /**
   * Opens a task's submission file as a stream, for its assignee or a reviewer (a mentor or program admin of its program).
   * Upstream decides who may read it (403), and answers 404 when the task has no file and 503 when object storage is not
   * configured; each passes through. A single byte `range` is forwarded, so a resumed download gets a 206. There is no
   * provisioning retry: only a provisioned user can be a task's assignee or reviewer, and a stream cannot be re-sent.
   * The bytes are asked for uncompressed, so upstream's length and byte ranges describe what reaches the browser.
   */
  public openTaskFile(req: Request, taskId: string, range?: string): Promise<globalThis.Response> {
    logger.debug(req, 'mentorship_open_task_file', 'Opening task file download', { taskId, ranged: !!range });
    return this.microserviceProxy.proxyStreamRequest(
      req,
      'LFX_V2_SERVICE',
      `${MENTORSHIP_TASKS_PATH}/${encodeURIComponent(taskId)}/file-download`,
      'GET',
      undefined,
      range ? { 'Accept-Encoding': 'identity', Range: range } : { 'Accept-Encoding': 'identity' },
      { timeoutMs: MENTORSHIP_TASK_FILE_TRANSFER_TIMEOUT_MS }
    );
  }
}
