// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the impersonation gate on the task create and edit that the admin and mentor pages share. The
 * middleware has its own unit tests, but those call it directly and would keep passing if it were dropped from these routes.
 */

const createHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.json({ created: [], failed: [] });
});

const updateHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.json({ id: 'task' });
});

const downloadHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).send('file-bytes');
});

vi.mock('../controllers/mentorship-task.controller', () => ({
  MentorshipTaskController: class {
    public createTasks = createHandler;
    public updateTask = updateHandler;
    public downloadTaskFile = downloadHandler;
  },
}));
let impersonatingStub = false;
vi.mock('../utils/auth-helper', () => ({ isImpersonating: () => impersonatingStub }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
  },
}));

const taskRouter = (await import('./mentorship-task.route')).default;

const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const TASK_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

let server: Server;
let baseUrl: string;

const postTasks = (): Promise<Response> =>
  fetch(`${baseUrl}/api/mentorship/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationIds: [APPLICATION_ID], name: 'Read the guide', description: 'Start with chapter one' }),
  });

const patchTask = (): Promise<Response> =>
  fetch(`${baseUrl}/api/mentorship/tasks/${TASK_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mentorship/tasks', taskRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  impersonatingStub = true;
});

describe('mentorship task router — task create impersonation gate', () => {
  it('refuses the task create with 403 while impersonating and never reaches the controller', async () => {
    const res = await postTasks();

    expect(res.status).toBe(403);
    expect(createHandler).not.toHaveBeenCalled();
  });

  it('admits the task create when not impersonating', async () => {
    impersonatingStub = false;

    const res = await postTasks();

    expect(res.status).toBe(200);
    expect(createHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship task router — task edit impersonation gate', () => {
  it('refuses the task edit with 403 while impersonating and never reaches the controller', async () => {
    const res = await patchTask();

    expect(res.status).toBe(403);
    expect(updateHandler).not.toHaveBeenCalled();
  });

  it('admits the task edit when not impersonating', async () => {
    impersonatingStub = false;

    const res = await patchTask();

    expect(res.status).toBe(200);
    expect(updateHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship task router — GET /:taskId/file', () => {
  it('reaches the controller while impersonating, since it only reads', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/tasks/${TASK_ID}/file`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('file-bytes');
    expect(downloadHandler).toHaveBeenCalledTimes(1);
  });
});
