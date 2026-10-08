// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: vi.fn(async () => 'test-user'),
}));

const { MentorshipTaskController } = await import('./mentorship-task.controller');
const { MentorshipTaskService } = await import('../services/mentorship-task.service');
const { AuthenticationError } = await import('../errors');
const { getUsernameFromAuth } = await import('../utils/auth-helper');
const { logger } = await import('../services/logger.service');

describe('MentorshipTaskController', () => {
  const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  let controller: InstanceType<typeof MentorshipTaskController>;
  let next: NextFunction;

  const buildReq = (params: Record<string, unknown> = {}): Request => ({ params, query: {} }) as unknown as Request;
  const writeRes = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() }) as unknown as Response;
  const statusCodes = () => vi.mocked(next).mock.calls.map(([error]) => (error as { statusCode?: number }).statusCode);

  beforeEach(() => {
    controller = new MentorshipTaskController();
    next = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('createTasks', () => {
    const taskReq = (body: unknown): Request => ({ ...buildReq(), body }) as Request;
    const validBody = { applicationIds: [APPLICATION_ID], name: ' Read the guide ', description: 'private-task-text', dueDate: '2030-01-31' };

    it('passes the validated request on and answers with the created and failed ids', async () => {
      const write = vi.spyOn(MentorshipTaskService.prototype, 'createTasks').mockResolvedValue({ created: [APPLICATION_ID], failed: [] });
      const out = writeRes();

      await controller.createTasks(taskReq({ ...validBody, requiresFileSubmission: true }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), {
        applicationIds: [APPLICATION_ID],
        name: 'Read the guide',
        description: 'private-task-text',
        dueDate: '2030-01-31',
        requiresFileSubmission: true,
      });
      expect(out.json).toHaveBeenCalledWith({ created: [APPLICATION_ID], failed: [] });
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      ['no body', undefined],
      ['no applications', { ...validBody, applicationIds: [] }],
      ['an application id that is not a UUID', { ...validBody, applicationIds: ['12'] }],
      ['a blank name', { ...validBody, name: '   ' }],
      ['no description', { ...validBody, description: undefined }],
      ['a due date that is not a calendar date', { ...validBody, dueDate: '2030-02-31' }],
      ['a file requirement that is not a boolean', { ...validBody, requiresFileSubmission: 'yes' }],
    ])('rejects %s with a 400 and no upstream call', async (_label, body) => {
      const write = vi.spyOn(MentorshipTaskService.prototype, 'createTasks');

      await controller.createTasks(taskReq(body), writeRes(), next);

      expect(statusCodes()).toEqual([400]);
      expect(write).not.toHaveBeenCalled();
    });

    it.each([403, 404, 409])('passes an upstream %i on to next', async (statusCode) => {
      vi.spyOn(MentorshipTaskService.prototype, 'createTasks').mockRejectedValue(Object.assign(new Error('upstream'), { statusCode }));

      await controller.createTasks(taskReq(validBody), writeRes(), next);

      expect(statusCodes()).toEqual([statusCode]);
    });

    it('logs the application count and the outcome counts, never the task text', async () => {
      vi.spyOn(MentorshipTaskService.prototype, 'createTasks').mockResolvedValue({ created: [APPLICATION_ID], failed: [] });

      await controller.createTasks(taskReq(validBody), writeRes(), next);

      const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
      expect(logged).toContain('"application_count":1');
      expect(logged).toContain('"created_count":1');
      expect(logged).toContain('"failed_count":0');
      expect(logged).not.toContain('private-task-text');
      expect(logged).not.toContain('Read the guide');
    });
  });

  describe('updateTask', () => {
    const TASK_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
    const taskReq = (body: unknown, taskId: unknown = TASK_ID): Request => ({ ...buildReq({ taskId }), body }) as Request;
    const updated = { id: TASK_ID, status: 'completed' } as never;

    it('passes the validated body on and answers with the updated task', async () => {
      const write = vi.spyOn(MentorshipTaskService.prototype, 'updateTask').mockResolvedValue(updated);
      const out = writeRes();

      await controller.updateTask(taskReq({ name: ' Read ', status: 'completed', extra: 1 }), out, next);

      expect(write).toHaveBeenCalledWith(expect.anything(), TASK_ID, { name: 'Read', status: 'completed' });
      expect(out.json).toHaveBeenCalledWith(updated);
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      ['a task id that is not a UUID', { status: 'completed' }, '12'],
      ['a task id that is repeated', { status: 'completed' }, [TASK_ID, TASK_ID]],
      ['no body', undefined, TASK_ID],
      ['an empty body', {}, TASK_ID],
      ['a blank name', { name: ' ' }, TASK_ID],
      ['a status upstream spells', { status: 'in_progress' }, TASK_ID],
      ['a due date that is not a calendar date', { dueDate: '2030-02-31' }, TASK_ID],
    ])('rejects %s with a 400 and no upstream call', async (_label, body, taskId) => {
      const write = vi.spyOn(MentorshipTaskService.prototype, 'updateTask');

      await controller.updateTask(taskReq(body, taskId), writeRes(), next);

      expect(statusCodes()).toEqual([400]);
      expect(write).not.toHaveBeenCalled();
    });

    it.each([400, 403, 404, 409])('passes an upstream %i on to next', async (statusCode) => {
      vi.spyOn(MentorshipTaskService.prototype, 'updateTask').mockRejectedValue(Object.assign(new Error('upstream'), { statusCode }));

      await controller.updateTask(taskReq({ status: 'completed' }), writeRes(), next);

      expect(statusCodes()).toEqual([statusCode]);
    });

    it('logs the task id and the field names, never the task text', async () => {
      vi.spyOn(MentorshipTaskService.prototype, 'updateTask').mockResolvedValue(updated);

      await controller.updateTask(taskReq({ name: 'private-task-name', description: 'private-task-text', status: 'completed' }), writeRes(), next);

      const logged = JSON.stringify([...vi.mocked(logger.startOperation).mock.calls, ...vi.mocked(logger.success).mock.calls].map((call) => call.slice(1)));
      expect(logged).toContain(TASK_ID);
      expect(logged).toContain('"fields":["name","description","status"]');
      expect(logged).not.toContain('private-task-name');
      expect(logged).not.toContain('private-task-text');
    });
  });

  describe('downloadTaskFile', () => {
    const TASK_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
    const fileReq = (headers: Record<string, string> = {}, taskId: unknown = TASK_ID): Request => ({ ...buildReq({ taskId }), headers }) as Request;

    /** A writable stand-in for the Express response, so the controller's pipeline really streams into it. */
    const streamRes = () => {
      const chunks: Buffer[] = [];
      const headers = new Map<string, string>();
      const out = new Writable({
        write(chunk, _encoding, callback) {
          out.headersSent = true;
          chunks.push(Buffer.from(chunk));
          callback();
        },
      }) as Writable & {
        headersSent: boolean;
        status: ReturnType<typeof vi.fn>;
        setHeader: (name: string, value: string) => void;
        getHeader: (name: string) => string | undefined;
        removeHeader: (name: string) => void;
      };
      out.headersSent = false;
      out.status = vi.fn(() => out);
      out.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
      out.getHeader = (name) => headers.get(name.toLowerCase());
      out.removeHeader = (name) => headers.delete(name.toLowerCase());
      return { out, res: out as unknown as Response, headers, body: () => Buffer.concat(chunks).toString() };
    };

    it('streams the upstream body with its file headers, and logs only the task id and status', async () => {
      const open = vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
        new Response('file-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': '10',
            'Content-Disposition': 'attachment; filename="report.pdf"',
            'Cache-Control': 'private, max-age=0',
            ETag: '"abc"',
            'Last-Modified': 'Tue, 06 Oct 2026 10:00:00 GMT',
            'Accept-Ranges': 'bytes',
            'X-Internal-Trace': 'internal-only',
          },
        })
      );
      const { out, res, headers, body } = streamRes();

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(open).toHaveBeenCalledWith(expect.anything(), TASK_ID, undefined);
      expect(out.status).toHaveBeenCalledWith(200);
      expect(Object.fromEntries(headers)).toEqual({
        'content-type': 'application/pdf',
        'content-length': '10',
        'content-disposition': 'attachment; filename="report.pdf"',
        'cache-control': 'private, max-age=0',
        etag: '"abc"',
        'last-modified': 'Tue, 06 Oct 2026 10:00:00 GMT',
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
      });
      expect(body()).toBe('file-bytes');
      expect(out.writableFinished).toBe(true);
      expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'download_mentorship_task_file', 0, { taskId: TASK_ID, status: 200 });
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards a single byte range and passes the 206 and its Content-Range through', async () => {
      const open = vi
        .spyOn(MentorshipTaskService.prototype, 'openTaskFile')
        .mockResolvedValue(new Response('le-by', { status: 206, headers: { 'Content-Range': 'bytes 2-6/10', 'Content-Length': '5' } }));
      const { out, res, headers, body } = streamRes();

      await controller.downloadTaskFile(fileReq({ range: 'bytes=2-6' }), res, next);

      expect(open).toHaveBeenCalledWith(expect.anything(), TASK_ID, 'bytes=2-6');
      expect(out.status).toHaveBeenCalledWith(206);
      expect(headers.get('content-range')).toBe('bytes 2-6/10');
      expect(headers.get('content-length')).toBe('5');
      expect(body()).toBe('le-by');
    });

    it.each(['bytes=0-', 'bytes=-500', 'bytes=0-1023'])('forwards the range %s', async (range) => {
      const open = vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(new Response('x', { status: 206 }));

      await controller.downloadTaskFile(fileReq({ range }), streamRes().res, next);

      expect(open).toHaveBeenCalledWith(expect.anything(), TASK_ID, range);
    });

    it.each(['bytes=0-1,5-6', 'items=0-1', 'bytes=a-b', 'bytes=0-1\r\nX-Injected: 1', 'bytes=1234567890123456-', 'bytes=-'])(
      'drops the range %j and asks for the whole file',
      async (range) => {
        const open = vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(new Response('x', { status: 200 }));

        await controller.downloadTaskFile(fileReq({ range }), streamRes().res, next);

        expect(open).toHaveBeenCalledWith(expect.anything(), TASK_ID, undefined);
      }
    );

    it('adds an attachment disposition and no-store caching when upstream sends neither', async () => {
      vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
        new Response('x', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );
      const { res, headers } = streamRes();

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(headers.get('content-disposition')).toBe(`attachment; filename="submission"; filename*=UTF-8''submission`);
      expect(headers.get('cache-control')).toBe('private, no-store');
      expect(headers.get('x-content-type-options')).toBe('nosniff');
    });

    it.each(['inline; filename="report.pdf"', 'inline', 'form-data; name="file"; filename="report.pdf"', 'attachmentish; filename="report.pdf"'])(
      'replaces the upstream disposition %j with an attachment',
      async (disposition) => {
        vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
          new Response('x', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition } })
        );
        const { res, headers } = streamRes();

        await controller.downloadTaskFile(fileReq(), res, next);

        expect(headers.get('content-disposition')).toBe(`attachment; filename="submission"; filename*=UTF-8''submission`);
        expect(next).not.toHaveBeenCalled();
      }
    );

    it.each(['ATTACHMENT; filename="report.pdf"', 'Attachment', 'attachment;filename="report.pdf"'])(
      'keeps the upstream attachment disposition %j in any case',
      async (disposition) => {
        vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
          new Response('x', { status: 200, headers: { 'Content-Disposition': disposition } })
        );
        const { res, headers } = streamRes();

        await controller.downloadTaskFile(fileReq(), res, next);

        expect(headers.get('content-disposition')).toBe(disposition);
      }
    );

    it('drops the upstream length and ranges, and keeps the other file headers, when upstream compresses the body', async () => {
      vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
        new Response('file-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Length': '4',
            'Content-Range': 'bytes 0-3/4',
            'Accept-Ranges': 'bytes',
            'Content-Encoding': 'gzip',
            'Content-Disposition': 'attachment; filename="report.pdf"',
            ETag: '"abc"',
          },
        })
      );
      const { res, headers, body } = streamRes();

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(headers.has('content-length')).toBe(false);
      expect(headers.has('content-range')).toBe(false);
      expect(headers.has('accept-ranges')).toBe(false);
      expect(headers.has('content-encoding')).toBe(false);
      expect(headers.get('content-type')).toBe('application/pdf');
      expect(headers.get('content-disposition')).toBe('attachment; filename="report.pdf"');
      expect(headers.get('etag')).toBe('"abc"');
      expect(body()).toBe('file-bytes');
    });

    it.each([
      ['a task id that is not a UUID', '12'],
      ['a task id that is repeated', [TASK_ID, TASK_ID]],
      ['a blank task id', '   '],
    ])('rejects %s with a 400 and no upstream call', async (_label, taskId) => {
      const open = vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile');
      const { out, res } = streamRes();

      await controller.downloadTaskFile(fileReq({}, taskId), res, next);

      expect(statusCodes()).toEqual([400]);
      expect(open).not.toHaveBeenCalled();
      expect(out.status).not.toHaveBeenCalled();
    });

    it.each([403, 404, 416, 503])('passes an upstream %i on to next before anything is sent', async (statusCode) => {
      vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockRejectedValue(Object.assign(new Error('upstream'), { statusCode }));
      const { out, res, headers } = streamRes();

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(statusCodes()).toEqual([statusCode]);
      expect(out.status).not.toHaveBeenCalled();
      expect(headers.size).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs and ends the response, without calling next, when the stream fails after the headers are sent', async () => {
      const streamError = new Error('upstream connection reset');
      const failingBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('part'));
        },
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          controller.error(streamError);
        },
      });
      vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(new Response(failingBody, { status: 200 }));
      const { out, res, body } = streamRes();
      const end = vi.spyOn(out, 'end');

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(body()).toBe('part');
      expect(next).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'download_mentorship_task_file', 0, streamError, { stage: 'streaming' });
      expect(end).toHaveBeenCalled();
      expect(logger.success).not.toHaveBeenCalled();
    });

    it('drops the file headers before handing a failure to next when the stream fails before its first byte', async () => {
      const streamError = new Error('upstream connection reset');
      const failingBody = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(streamError);
        },
      });
      vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile').mockResolvedValue(
        new Response(failingBody, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="a.pdf"' } })
      );
      const { res, headers } = streamRes();

      await controller.downloadTaskFile(fileReq(), res, next);

      expect(next).toHaveBeenCalledWith(streamError);
      expect(headers.size).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('passes an AuthenticationError to next without opening the file when no user is signed in', async () => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const open = vi.spyOn(MentorshipTaskService.prototype, 'openTaskFile');

      await controller.downloadTaskFile(fileReq(), streamRes().res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe('with no signed-in user', () => {
    it.each([
      ['createTasks', {}],
      ['updateTask', { taskId: APPLICATION_ID }],
    ] as const)('%s passes an AuthenticationError to next without calling upstream', async (method, params) => {
      vi.mocked(getUsernameFromAuth).mockResolvedValueOnce(null as unknown as string);
      const write = vi.spyOn(MentorshipTaskService.prototype, method);

      await controller[method]({ ...buildReq(params), body: {} } as Request, writeRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
      expect(write).not.toHaveBeenCalled();
    });
  });
});
