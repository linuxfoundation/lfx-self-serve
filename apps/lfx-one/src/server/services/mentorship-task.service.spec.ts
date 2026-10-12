// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MentorshipTaskService } = await import('./mentorship-task.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { logger } = await import('./logger.service');
const { MicroserviceError } = await import('../errors');

const ME_PATH = '/mentorship/v1/me';
const CALLER_USER_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const buildReq = (): Request => ({ path: '/api/mentorship/tasks' }) as Request;

function upstreamError(status: number, body: unknown) {
  return MicroserviceError.fromMicroserviceResponse(status, 'Upstream error', body, 'LFX_V2_SERVICE', ME_PATH);
}

describe('MentorshipTaskService.createTasks', () => {
  const FIRST_ID = '5d1c8e2f-3a4b-4c6d-8e9f-0a1b2c3d4e5f';
  const SECOND_ID = '7a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d';
  const THIRD_ID = '8b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e';
  const MENTEE_USER_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
  const TERM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
  const request = { name: 'Write a design doc', description: 'One page on the plan.', dueDate: '2026-11-30' };
  let service: InstanceType<typeof MentorshipTaskService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const application = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    program_term_id: TERM_ID,
    user_id: MENTEE_USER_ID,
    role: 'mentee',
    status: 'accepted',
    tasks_submitted: false,
    admin_notified: false,
    created_on: '2026-06-01T10:00:00Z',
    updated_on: '2026-06-02T10:00:00Z',
    ...overrides,
  });

  /** Answers GET /me, each GET /applications/{id} and each POST /applications/{id}/tasks; `fail` maps an id to its POST failure. */
  function routeUpstream(fail: Record<string, unknown> = {}, applications: Record<string, unknown> = {}): void {
    proxyRequest.mockImplementation(async (_req, _service, path, method) => {
      if (path === ME_PATH) return { id: CALLER_USER_ID };
      const match = /^\/mentorship\/v1\/applications\/([^/]+)(\/tasks)?$/.exec(path);
      if (!match) throw new Error(`unexpected path ${path}`);
      const id = match[1];
      if (!match[2]) return applications[id] ?? application(id);
      expect(method).toBe('POST');
      if (fail[id]) throw fail[id];
      return { id: `task-${id}` };
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.debug).mockClear();
    vi.mocked(logger.warning).mockClear();
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipTaskService();
  });

  it("creates the task with the application's mentee and term, owned by the caller's local user id", async () => {
    routeUpstream();

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: [FIRST_ID] })).resolves.toEqual({ created: [FIRST_ID], failed: [] });
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/mentorship/v1/applications/${FIRST_ID}/tasks`, 'POST', undefined, {
      assignee_id: MENTEE_USER_ID,
      program_term_id: TERM_ID,
      owner_id: CALLER_USER_ID,
      created_by: CALLER_USER_ID,
      name: request.name,
      description: request.description,
      category: 'non_prerequisite',
      custom: true,
      due_date: '2026-11-30',
    });
    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain(request.name);
  });

  it("passes a single application's upstream failure through", async () => {
    const failure = upstreamError(403, { error: 'forbidden' });
    routeUpstream({ [FIRST_ID]: failure });

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: [FIRST_ID] })).rejects.toBe(failure);
  });

  it('refuses an application that is not an accepted mentee, without creating anything', async () => {
    routeUpstream({}, { [FIRST_ID]: application(FIRST_ID, { status: 'graduated' }) });

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: [FIRST_ID] })).rejects.toMatchObject({ statusCode: 400 });
    expect(proxyRequest).not.toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', expect.stringMatching(/\/tasks$/), 'POST', undefined, expect.anything());
  });

  it('reads the caller once and lists, in order, the applications whose task was not created', async () => {
    routeUpstream({ [SECOND_ID]: upstreamError(422, { error: 'referenced resource does not exist' }) });

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: [FIRST_ID, SECOND_ID, THIRD_ID] })).resolves.toEqual({
      created: [FIRST_ID, THIRD_ID],
      failed: [SECOND_ID],
    });
    expect(proxyRequest.mock.calls.filter(([, , path]) => path === ME_PATH)).toHaveLength(1);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'create_mentorship_tasks', expect.any(String), {
      applicationId: SECOND_ID,
      status: 422,
      code: expect.any(String),
    });
  });

  it('runs at most three creates at once', async () => {
    const ids = Array.from({ length: 7 }, (_, index) => `5d1c8e2f-3a4b-4c6d-8e9f-${index.toString(16).padStart(12, '0')}`);
    let inFlight = 0;
    let peak = 0;
    proxyRequest.mockImplementation(async (_req, _service, path) => {
      if (path === ME_PATH) return { id: CALLER_USER_ID };
      if (!path.endsWith('/tasks')) return application(path.split('/').pop() as string);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return {};
    });

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: ids })).resolves.toEqual({ created: ids, failed: [] });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('fails the whole create when the caller has no valid local user id', async () => {
    proxyRequest.mockResolvedValueOnce({ id: 'not-a-uuid' });

    await expect(service.createTasks(buildReq(), { ...request, applicationIds: [FIRST_ID, SECOND_ID] })).rejects.toMatchObject({
      statusCode: 502,
      code: 'MENTORSHIP_INVALID_USER',
    });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });
});

describe('MentorshipTaskService.updateTask', () => {
  const TASK_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const upstreamTask = {
    id: TASK_ID,
    application_id: APPLICATION_ID,
    assignee_id: 'mentee',
    status: 'complete',
    name: 'Read the guide',
    description: 'private-task-text',
    category: 'non_prerequisite',
    custom: true,
    submit_file: 'required',
    due_date: '2030-01-31',
    created_on: '2026-08-01T00:00:00Z',
    updated_on: '2026-08-02T00:00:00Z',
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.debug).mockClear();
  });

  it('patches the task upstream with the upstream spelling and returns the mapped task', async () => {
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue(upstreamTask as never);

    const task = await new MentorshipTaskService().updateTask(buildReq(), TASK_ID, {
      name: 'Read the guide',
      status: 'completed',
      dueDate: '',
      requiresFileSubmission: true,
    });

    expect(task).toMatchObject({ id: TASK_ID, status: 'completed', requiresFileSubmission: true, dueOn: '2030-01-31' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, , path, method, , body] = spy.mock.calls[0];
    expect(path).toBe(`/mentorship/v1/tasks/${TASK_ID}`);
    expect(method).toBe('PATCH');
    expect(body).toEqual({ name: 'Read the guide', status: 'complete', due_date: '', submit_file: 'required' });
  });

  it('makes no other upstream call, so the task list is not read again', async () => {
    const spy = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue(upstreamTask as never);

    await new MentorshipTaskService().updateTask(buildReq(), TASK_ID, { status: 'pending' });

    expect(spy.mock.calls.map((call) => call[3])).toEqual(['PATCH']);
  });

  it.each([400, 403, 404])('passes an upstream %i on', async (status) => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockRejectedValue(new MicroserviceError('upstream', status, 'UPSTREAM'));

    await expect(new MentorshipTaskService().updateTask(buildReq(), TASK_ID, { status: 'submitted' })).rejects.toMatchObject({ statusCode: status });
  });

  it('logs the task id and the field names, never the task text', async () => {
    vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest').mockResolvedValue(upstreamTask as never);

    await new MentorshipTaskService().updateTask(buildReq(), TASK_ID, { name: 'private-task-name', description: 'private-task-text' });

    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls.map((call) => call.slice(1)));
    expect(logged).toContain(TASK_ID);
    expect(logged).toContain('"fields":["name","description"]');
    expect(logged).not.toContain('private-task-name');
    expect(logged).not.toContain('private-task-text');
  });
});

describe('MentorshipTaskService.openTaskFile', () => {
  const TASK_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
  const DOWNLOAD_PATH = `/mentorship/v1/tasks/${TASK_ID}/file-download`;
  let proxyStreamRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyStreamRequest']>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(logger.debug).mockClear();
    proxyStreamRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyStreamRequest');
  });

  it('streams the file download uncompressed, with the transfer timeout and no range header when none is given', async () => {
    const upstream = new Response('file-bytes', { status: 200 });
    proxyStreamRequest.mockResolvedValueOnce(upstream);

    await expect(new MentorshipTaskService().openTaskFile(buildReq(), TASK_ID)).resolves.toBe(upstream);

    expect(proxyStreamRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      DOWNLOAD_PATH,
      'GET',
      undefined,
      { 'Accept-Encoding': 'identity' },
      { timeoutMs: 120_000 }
    );
  });

  it('forwards a byte range as the Range header, still asking for the bytes uncompressed', async () => {
    proxyStreamRequest.mockResolvedValueOnce(new Response('le-by', { status: 206 }));

    await new MentorshipTaskService().openTaskFile(buildReq(), TASK_ID, 'bytes=2-6');

    expect(proxyStreamRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      DOWNLOAD_PATH,
      'GET',
      undefined,
      { 'Accept-Encoding': 'identity', Range: 'bytes=2-6' },
      { timeoutMs: 120_000 }
    );
  });

  it('URL-encodes the task id in the path', async () => {
    proxyStreamRequest.mockResolvedValueOnce(new Response(''));

    await new MentorshipTaskService().openTaskFile(buildReq(), 'a/b?c');

    expect(proxyStreamRequest.mock.calls[0][2]).toBe('/mentorship/v1/tasks/a%2Fb%3Fc/file-download');
  });

  it('makes no other upstream call, so there is no provisioning retry', async () => {
    const proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    proxyStreamRequest.mockResolvedValueOnce(new Response(''));

    await new MentorshipTaskService().openTaskFile(buildReq(), TASK_ID);

    expect(proxyStreamRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 416, 503])('passes an upstream %i on', async (status) => {
    const error = new MicroserviceError('upstream', status, 'UPSTREAM');
    proxyStreamRequest.mockRejectedValueOnce(error);

    await expect(new MentorshipTaskService().openTaskFile(buildReq(), TASK_ID)).rejects.toBe(error);
    expect(proxyStreamRequest).toHaveBeenCalledTimes(1);
  });

  it('logs the task id and whether a range was asked for, never the range itself', async () => {
    proxyStreamRequest.mockResolvedValueOnce(new Response(''));

    await new MentorshipTaskService().openTaskFile(buildReq(), TASK_ID, 'bytes=2-6');

    expect(logger.debug).toHaveBeenCalledWith(expect.anything(), 'mentorship_open_task_file', expect.any(String), { taskId: TASK_ID, ranged: true });
  });
});
