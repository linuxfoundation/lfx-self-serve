// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '../errors';

const calls = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), delete: vi.fn(), generate: vi.fn(), share: vi.fn() }));
vi.mock('../controllers/linkedin-post.controller', () => ({
  LinkedinPostController: class {
    public saveShareLink(_req: Request, res: Response) {
      calls.share();
      res.json({ share_link: '' });
    }
    public getProfile(_req: Request, res: Response) {
      calls.read();
      res.json({ profile: null });
    }
    public saveProfile(_req: Request, res: Response) {
      calls.save();
      res.json({ saved: true });
    }
    public deleteProfile(_req: Request, res: Response) {
      calls.delete();
      res.status(204).end();
    }
    public generate(_req: Request, res: Response) {
      calls.generate();
      res.json({ started: true });
    }
  },
}));
vi.mock('../controllers/mktg-agents.controller', () => ({ MktgAgentsController: class {} }));
vi.mock('../controllers/mktg-documents.controller', () => ({ MktgDocumentsController: class {} }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));
import router from './mktg-agents.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.impersonationActive = req.get('x-test-impersonating') === 'true';
    next();
  });
  app.use('/api/mktg-agents', router);
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AuthorizationError) res.status(error.statusCode).json({ code: error.code });
    else res.status(500).json({ code: 'UNEXPECTED_TEST_ERROR' });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic test listener is unavailable');
  baseUrl = `http://127.0.0.1:${address.port}/api/mktg-agents`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => vi.clearAllMocks());

const setup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' };
describe('LinkedIn profile impersonation route guards', () => {
  it.each(['PUT', 'DELETE'])('blocks %s profile before its controller while impersonating', async (method) => {
    const response = await fetch(`${baseUrl}/linkedin-post/profile`, {
      method,
      headers: { 'x-test-impersonating': 'true', 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ setup }) : undefined,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'IMPERSONATION_READ_ONLY' });
    expect(calls.save).not.toHaveBeenCalled();
    expect(calls.delete).not.toHaveBeenCalled();
  });
  it('blocks document share-link edits before the controller while impersonating', async () => {
    const response = await fetch(`${baseUrl}/linkedin-post/documents/run-0123456789abcdef01234567/share-link`, {
      method: 'PATCH',
      headers: { 'x-test-impersonating': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'project-one', share_link: '' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'IMPERSONATION_READ_ONLY' });
    expect(calls.share).not.toHaveBeenCalled();
  });
  it('blocks a first-run setup generate while impersonating', async () => {
    const response = await fetch(`${baseUrl}/linkedin-post/generate`, {
      method: 'POST',
      headers: { 'x-test-impersonating': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ setup }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'IMPERSONATION_READ_ONLY' });
    expect(calls.generate).not.toHaveBeenCalled();
  });
  it('keeps profile reads and saved-profile runs open during impersonation', async () => {
    const read = await fetch(`${baseUrl}/linkedin-post/profile`, { headers: { 'x-test-impersonating': 'true' } });
    expect(read.status).toBe(200);
    await read.json();
    expect(calls.read).toHaveBeenCalledOnce();
    const run = await fetch(`${baseUrl}/linkedin-post/generate`, {
      method: 'POST',
      headers: { 'x-test-impersonating': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { content_source: 'text', content_text: 'Synthetic source' } }),
    });
    expect(run.status).toBe(200);
    await run.json();
    expect(calls.generate).toHaveBeenCalledOnce();
  });
  it('admits ordinary profile writes and first-run setup when not impersonating', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const response = await fetch(`${baseUrl}/linkedin-post/profile`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ setup }) : undefined,
      });
      expect(response.status).toBe(method === 'PUT' ? 200 : 204);
      if (method === 'PUT') await response.json();
    }
    const response = await fetch(`${baseUrl}/linkedin-post/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ setup }),
    });
    expect(response.status).toBe(200);
    await response.json();
    expect(calls.save).toHaveBeenCalledOnce();
    expect(calls.delete).toHaveBeenCalledOnce();
    expect(calls.generate).toHaveBeenCalledOnce();
  });
});
