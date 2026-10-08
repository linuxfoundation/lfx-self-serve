// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
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
