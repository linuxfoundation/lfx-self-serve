// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { MENTORSHIP_ENROLL_LOGO_MAX_BYTES } from '@lfx-one/shared/constants';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the impersonation gate on the admin reviewer-note write, the task create and the mentor status change. The
 * middleware has its own unit tests, but those call it directly and would keep passing if it were dropped from these
 * routes.
 */

const noteHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(204).end();
});

const taskUpdateHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.json({ id: 'task' });
});

const mentorHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(204).end();
});

const tasksHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.json({ created: [], failed: [] });
});

const createProgramHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(201).json({ id: 'program' });
});

const enrollTemplateHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.json({ name: 'Example Program' });
});

// Records what the raw parser left on `req.body`, which is what the real controller's 415 and empty-body checks read.
const logoHandler = vi.fn((req: express.Request, res: express.Response) => {
  res.status(201).json({ isBuffer: Buffer.isBuffer(req.body), length: Buffer.isBuffer(req.body) ? req.body.byteLength : 0 });
});

vi.mock('../controllers/mentorship-admin.controller', () => ({
  MentorshipAdminController: class {
    public createProgram = createProgramHandler;
    public getEnrollTemplate = enrollTemplateHandler;
    public uploadProgramLogo = logoHandler;
    public updateApplicationNote = noteHandler;
    public createTasks = tasksHandler;
    public updateTask = taskUpdateHandler;
    public updateProgramMentor = mentorHandler;
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

const adminRouter = (await import('./mentorship-admin.route')).default;

const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

let server: Server;
let baseUrl: string;

const PROGRAM_ID = '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b';

const patchMentor = (): Promise<Response> =>
  fetch(`${baseUrl}/api/mentorship/admin/programs/${PROGRAM_ID}/mentors/${APPLICATION_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  });

const putNote = (): Promise<Response> =>
  fetch(`${baseUrl}/api/mentorship/admin/applications/${APPLICATION_ID}/note`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'needs a second look' }),
  });

const postTasks = (): Promise<Response> =>
  fetch(`${baseUrl}/api/mentorship/admin/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationIds: [APPLICATION_ID], name: 'Read the guide', description: 'Start with chapter one' }),
  });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mentorship/admin', adminRouter);
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

describe('mentorship admin router — reviewer note impersonation gate', () => {
  it('refuses the note write with 403 while impersonating and never reaches the controller', async () => {
    const res = await putNote();

    expect(res.status).toBe(403);
    expect(noteHandler).not.toHaveBeenCalled();
  });

  it('admits the note write when not impersonating', async () => {
    impersonatingStub = false;

    const res = await putNote();

    expect(res.status).toBe(204);
    expect(noteHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship admin router — task create impersonation gate', () => {
  it('refuses the task create with 403 while impersonating and never reaches the controller', async () => {
    const res = await postTasks();

    expect(res.status).toBe(403);
    expect(tasksHandler).not.toHaveBeenCalled();
  });

  it('admits the task create when not impersonating', async () => {
    impersonatingStub = false;

    const res = await postTasks();

    expect(res.status).toBe(200);
    expect(tasksHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship admin router — task edit impersonation gate', () => {
  const patchTask = (): Promise<Response> =>
    fetch(`${baseUrl}/api/mentorship/admin/tasks/${APPLICATION_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

  it('refuses the task edit with 403 while impersonating and never reaches the controller', async () => {
    const res = await patchTask();

    expect(res.status).toBe(403);
    expect(taskUpdateHandler).not.toHaveBeenCalled();
  });

  it('admits the task edit when not impersonating', async () => {
    impersonatingStub = false;

    const res = await patchTask();

    expect(res.status).toBe(200);
    expect(taskUpdateHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship admin router — mentor status change impersonation gate', () => {
  it('refuses the mentor change with 403 while impersonating and never reaches the controller', async () => {
    const res = await patchMentor();

    expect(res.status).toBe(403);
    expect(mentorHandler).not.toHaveBeenCalled();
  });

  it('admits the mentor change when not impersonating', async () => {
    impersonatingStub = false;

    const res = await patchMentor();

    expect(res.status).toBe(204);
    expect(mentorHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship admin router — program create impersonation gate', () => {
  const postProgram = (): Promise<Response> =>
    fetch(`${baseUrl}/api/mentorship/admin/programs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Example Program' }),
    });

  it('refuses the program create with 403 while impersonating and never reaches the controller', async () => {
    const res = await postProgram();

    expect(res.status).toBe(403);
    expect(createProgramHandler).not.toHaveBeenCalled();
  });

  it('admits the program create when not impersonating', async () => {
    impersonatingStub = false;

    const res = await postProgram();

    expect(res.status).toBe(201);
    expect(createProgramHandler).toHaveBeenCalledTimes(1);
  });
});

describe('mentorship admin router — GET /programs/:programId/enroll-template', () => {
  it('reaches the controller while impersonating, since it only reads', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/admin/programs/${PROGRAM_ID}/enroll-template`);

    expect(res.status).toBe(200);
    expect(enrollTemplateHandler).toHaveBeenCalledTimes(1);
  });
});

/**
 * The logo route's `express.raw()` limits and its 413 conversion live on the route registration, not in the controller, so
 * a controller unit test would keep passing if that wiring were dropped.
 */
describe('mentorship admin router — POST /programs/:programId/logo', () => {
  const logoUrl = (): string => `${baseUrl}/api/mentorship/admin/programs/${PROGRAM_ID}/logo`;
  const postLogo = (contentType: string, body: Buffer<ArrayBuffer>): Promise<Response> =>
    fetch(logoUrl(), { method: 'POST', headers: { 'Content-Type': contentType }, body });

  beforeEach(() => {
    impersonatingStub = false;
  });

  it.each(['image/png', 'image/jpeg'])('parses %s as a raw buffer for the controller', async (contentType) => {
    const res = await postLogo(contentType, Buffer.from([1, 2, 3]));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ isBuffer: true, length: 3 });
  });

  it('leaves a type that is not on the list unparsed, so the controller can answer 415', async () => {
    const res = await postLogo('text/plain', Buffer.from('not-an-image'));

    expect(await res.json()).toEqual({ isBuffer: false, length: 0 });
  });

  it('accepts a body of exactly the largest size', async () => {
    const res = await postLogo('image/png', Buffer.alloc(MENTORSHIP_ENROLL_LOGO_MAX_BYTES));

    expect(res.status).toBe(201);
  });

  it('converts a body one byte over the largest size to a 413 and never reaches the controller', async () => {
    const res = await postLogo('image/png', Buffer.alloc(MENTORSHIP_ENROLL_LOGO_MAX_BYTES + 1));

    expect(res.status).toBe(413);
    expect(logoHandler).not.toHaveBeenCalled();
  });

  it('refuses the upload with 403 while impersonating and never reaches the controller', async () => {
    impersonatingStub = true;

    const res = await postLogo('image/png', Buffer.from([1]));

    expect(res.status).toBe(403);
    expect(logoHandler).not.toHaveBeenCalled();
  });
});
