// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the vote impersonation gate (lfx-self-serve-ops#148).
 *
 * `blockDuringImpersonation` has its own unit tests, but those call it directly — they would keep
 * passing if the middleware were dropped from one of these routes. Every write (ballot cast and
 * vote create/update/enable/delete) must be refused while impersonating, because upstream records
 * it as the target; every read must stay open.
 */

const voteHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});

vi.mock('../controllers/vote.controller', () => ({
  VoteController: class {
    public getVotes = voteHandler;
    public getVotesCount = voteHandler;
    public getMyVotes = voteHandler;
    public createVoteResponse = voteHandler;
    public getMyVoteResponse = voteHandler;
    public getVoteResults = voteHandler;
    public getVoteById = voteHandler;
    public createVote = voteHandler;
    public updateVote = voteHandler;
    public deleteVote = voteHandler;
    public enableVote = voteHandler;
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

const votesRouter = (await import('./votes.route')).default;

const UID = '5b0f2f7e-3c1a-4a8e-9d6b-2f1e0c9a7b31';

const WRITES: [string, string, string][] = [
  ['ballot cast', 'POST', '/responses'],
  ['create', 'POST', '/'],
  ['update', 'PUT', `/${UID}`],
  ['enable', 'PUT', `/${UID}/enable`],
  ['delete', 'DELETE', `/${UID}`],
];

let server: Server;
let baseUrl: string;

function send(method: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}/api/votes${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' || method === 'PUT' ? JSON.stringify({}) : undefined,
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/votes', votesRouter);
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

describe('votes router — impersonation gate', () => {
  it.each([
    ['list', '/'],
    ['count', '/count'],
    ['my votes', '/my-votes'],
    ['detail', `/${UID}`],
    ['results', `/${UID}/results`],
    ['my response', `/${UID}/my-response`],
  ])('admits the %s read while impersonating', async (_label, path) => {
    const res = await send('GET', path);

    expect(res.status).toBe(200);
    expect(voteHandler).toHaveBeenCalledTimes(1);
  });

  it.each(WRITES)('refuses %s with 403 while impersonating and never reaches the controller', async (_label, method, path) => {
    const res = await send(method, path);

    expect(res.status).toBe(403);
    expect(voteHandler).not.toHaveBeenCalled();
  });

  it.each(WRITES)('admits %s when not impersonating', async (_label, method, path) => {
    impersonatingStub = false;

    const res = await send(method, path);

    expect(res.status).toBe(200);
    expect(voteHandler).toHaveBeenCalledTimes(1);
  });

  it('refuses impersonated creates before voteWriteRateLimiter counts them', async () => {
    // The limiter allows 10 writes per minute; 11 refused creates must not spend that budget.
    for (let i = 0; i < 11; i++) {
      expect((await send('POST', '/')).status).toBe(403);
    }

    impersonatingStub = false;
    const res = await send('POST', '/');

    expect(res.status).toBe(200);
    expect(voteHandler).toHaveBeenCalledTimes(1);
  });
});
