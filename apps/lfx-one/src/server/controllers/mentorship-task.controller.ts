// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { MENTORSHIP_TASK_FILE_DOWNLOAD_HEADERS, MENTORSHIP_TASK_FILE_ENCODED_BYTE_HEADERS, MENTORSHIP_TASK_FILE_RANGE_PATTERN } from '../constants';
import { AuthenticationError, ServiceValidationError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
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

  // GET /api/mentorship/tasks/:taskId/file -> the task's submission file, as an attachment (200, or 206 for a byte range)
  // Auth: logged-in user required (401 otherwise). Open while impersonating, since it is a read. Upstream lets the task's
  // assignee and its reviewers read it; its 403, 404, 416 and 503 pass through. The bytes are streamed, never buffered,
  // with upstream's type, length, name, caching and range headers. Only the task id and the status are logged.
  public async downloadTaskFile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'download_mentorship_task_file';
    const startTime = logger.startOperation(req, operation);

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation });
      }

      const taskId = typeof req.params['taskId'] === 'string' ? req.params['taskId'].trim() : '';
      if (!isUuid(taskId)) {
        throw ServiceValidationError.forField('taskId', 'taskId must be a UUID.', { operation });
      }
      const rangeHeader = req.headers.range;
      const range = typeof rangeHeader === 'string' && MENTORSHIP_TASK_FILE_RANGE_PATTERN.test(rangeHeader) ? rangeHeader : undefined;
      const upstream = await this.taskService.openTaskFile(req, taskId, range);
      // Read the first chunk before anything is set or piped: pipeline() destroys `res` when its source fails, so a body that
      // fails before its first byte has to reach the error handler here, while the response is still whole.
      const chunks = Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>)[Symbol.asyncIterator]();
      const first = await chunks.next();

      res.status(upstream.status);
      // `fetch` decodes a compressed body but keeps the compressed length and ranges, and copying the length would make Node
      // cut the file short (see gw-proxy.controller.ts). The service asks for identity, so these are only dropped if upstream
      // compresses anyway.
      const encoding = (upstream.headers.get('content-encoding') ?? '').trim().toLowerCase();
      const decodedBody = encoding !== '' && encoding !== 'identity';
      for (const name of MENTORSHIP_TASK_FILE_DOWNLOAD_HEADERS) {
        const value = upstream.headers.get(name);
        if (value && !(decodedBody && MENTORSHIP_TASK_FILE_ENCODED_BYTE_HEADERS.includes(name))) res.setHeader(name, value);
      }
      // Always an attachment, so the file is never rendered on this origin; upstream's own value is kept only when it is one.
      if (!/^attachment\b/i.test(String(res.getHeader('content-disposition') ?? ''))) {
        res.setHeader('Content-Disposition', contentDispositionAttachment('submission'));
      }
      // `no-transform` keeps the app-wide compression middleware off the file, so the length, range and ETag passed on above
      // describe the bytes that are sent.
      const cacheControl = String(res.getHeader('cache-control') ?? '') || 'private, no-store';
      res.setHeader('Cache-Control', /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(cacheControl) ? cacheControl : `${cacheControl}, no-transform`);
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // pipeline() propagates stream errors to the catch block instead of hanging.
      await pipeline(Readable.from(this.resumeChunks(first, chunks), { objectMode: false }), res);
      logger.success(req, operation, startTime, { taskId, status: upstream.status });
    } catch (error) {
      // Headers already committed, so the error handler cannot answer; the stream can only be ended.
      if (res.headersSent) {
        logger.error(req, operation, startTime, error, { stage: 'streaming' });
        if (!res.writableEnded) res.end();
        return;
      }
      // Nothing was sent yet, so drop any file headers already set; the error handler's JSON must not arrive as the attachment.
      for (const name of [...MENTORSHIP_TASK_FILE_DOWNLOAD_HEADERS, 'x-content-type-options']) res.removeHeader(name);
      next(error);
    }
  }

  /**
   * The upstream body again from the start: the chunk already read, then the rest as it arrives. Returning the iterator on the
   * way out destroys the upstream stream too, so a browser that disconnects mid-download does not leave it open.
   */
  private async *resumeChunks(first: IteratorResult<Uint8Array>, rest: AsyncIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
    try {
      if (first.done) return;
      yield first.value;
      for (let next = await rest.next(); !next.done; next = await rest.next()) {
        yield next.value;
      }
    } finally {
      await rest.return?.();
    }
  }
}
