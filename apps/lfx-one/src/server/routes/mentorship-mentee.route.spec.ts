// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES, MENTORSHIP_MENTEE_TASK_FILE_NAME_HEADER } from '@lfx-one/shared/constants';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the task file upload and delete. The impersonation gate, the `express.raw()` type and size
 * limit, and the 413 conversion all live on the route registration, not in the controller, so a controller unit test
 * would keep passing if that wiring were dropped.
 */

// Records what the raw parser left on `req.body`, which is what the real controller's 415 and empty-body checks read.
const uploadHandler = vi.fn((req: express.Request, res: express.Response) => {
  res.status(201).json({ isBuffer: Buffer.isBuffer(req.body), length: Buffer.isBuffer(req.body) ? req.body.byteLength : 0 });
});

const deleteHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(204).end();
});

vi.mock('../controllers/mentorship-mentee.controller', () => ({
  MentorshipMenteeController: class {
    public uploadMenteeTaskFile = uploadHandler;
    public deleteMenteeTaskFile = deleteHandler;
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
    getLastOperation: vi.fn(() => undefined),
  },
}));

const menteeRouter = (await import('./mentorship-mentee.route')).default;
// The app's own error handler, which keeps a status only for a BaseApiError and turns anything else into a 500.
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

const TASK_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

let server: Server;
let baseUrl: string;

const fileUrl = (): string => `${baseUrl}/api/mentorship/mentee/tasks/${TASK_ID}/file`;

const postFile = (contentType: string, body: Buffer<ArrayBuffer>): Promise<Response> =>
  fetch(fileUrl(), { method: 'POST', headers: { 'Content-Type': contentType, [MENTORSHIP_MENTEE_TASK_FILE_NAME_HEADER]: 'report.pdf' }, body });

const deleteFile = (): Promise<Response> => fetch(fileUrl(), { method: 'DELETE' });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/mentorship/mentee', menteeRouter);
  app.use(apiErrorHandler);
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
  impersonatingStub = false;
});

describe('mentorship mentee router — POST /tasks/:taskId/file', () => {
  it('parses application/octet-stream as a raw buffer for the controller', async () => {
    const res = await postFile('application/octet-stream', Buffer.from([1, 2, 3]));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ isBuffer: true, length: 3 });
    expect(uploadHandler).toHaveBeenCalledTimes(1);
    expect(uploadHandler.mock.calls[0][0].headers['x-file-name']).toBe('report.pdf');
  });

  it.each(['application/pdf', 'text/plain', 'application/json'])('leaves %s unparsed, so the controller can answer 415', async (contentType) => {
    const res = await postFile(contentType, Buffer.from('{"not":"a file"}'));

    expect(await res.json()).toEqual({ isBuffer: false, length: 0 });
  });

  it('accepts a body of exactly the largest size', async () => {
    const res = await postFile('application/octet-stream', Buffer.alloc(MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ isBuffer: true, length: MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES });
  });

  it('converts a body one byte over the largest size to a 413 and never reaches the controller', async () => {
    const res = await postFile('application/octet-stream', Buffer.alloc(MENTORSHIP_MENTEE_TASK_FILE_MAX_BYTES + 1));

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(uploadHandler).not.toHaveBeenCalled();
  });

  it('refuses the upload with 403 while impersonating and never reaches the controller', async () => {
    impersonatingStub = true;

    const res = await postFile('application/octet-stream', Buffer.from([1]));

    expect(res.status).toBe(403);
    expect(uploadHandler).not.toHaveBeenCalled();
  });
});

describe('mentorship mentee router — DELETE /tasks/:taskId/file', () => {
  it('refuses the delete with 403 while impersonating and never reaches the controller', async () => {
    impersonatingStub = true;

    const res = await deleteFile();

    expect(res.status).toBe(403);
    expect(deleteHandler).not.toHaveBeenCalled();
  });

  it('admits the delete when not impersonating', async () => {
    const res = await deleteFile();

    expect(res.status).toBe(204);
    expect(deleteHandler).toHaveBeenCalledTimes(1);
  });
});
