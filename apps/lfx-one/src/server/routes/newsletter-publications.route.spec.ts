// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { respond, blockDuringImpersonation } = vi.hoisted(() => ({
  respond: vi.fn((_req: unknown, res: Response) => res.json({})),
  blockDuringImpersonation: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../controllers/newsletter-publications.controller', () => ({
  NewsletterPublicationsController: class {
    public createEdition = respond;
    public createPublication = respond;
    public getPublication = respond;
    public listEditions = respond;
    public listPublications = respond;
    public updatePublication = respond;
  },
}));
vi.mock('../middleware/impersonation-readonly.middleware', () => ({ blockDuringImpersonation }));

import router from './newsletter-publications.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectUid/newsletter-publications', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}/api/projects/p-1/newsletter-publications`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

// [method, path, blocked while impersonating] for every route.
const ROUTES: [string, string, boolean][] = [
  ['GET', '/', false],
  ['POST', '/', true],
  ['GET', '/pub-1', false],
  ['PUT', '/pub-1', true],
  ['GET', '/pub-1/editions', false],
  ['POST', '/pub-1/editions', true],
];

describe('newsletter publication routes: impersonation block (#4349)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROUTES)('%s %s', async (method, path, blocked) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    expect(response.status).toBe(200);
    expect(respond).toHaveBeenCalledOnce();
    expect(blockDuringImpersonation).toHaveBeenCalledTimes(blocked ? 1 : 0);
  });
});
