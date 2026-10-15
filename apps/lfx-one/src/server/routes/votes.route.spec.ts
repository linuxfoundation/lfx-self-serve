// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { summary, byId } = vi.hoisted(() => ({
  summary: vi.fn((_req: unknown, res: Response) => res.json({ active_votes: 2, closing_soon: 1 })),
  byId: vi.fn(),
}));
vi.mock('../controllers/vote.controller', () => ({
  VoteController: class {
    public getVotesSummary = summary;
    public getVoteById = byId;
  },
}));
vi.mock('../middleware/rate-limit.middleware', () => ({ voteWriteRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }));

import router from './votes.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use('/api/votes', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

describe('votes summary route dispatch', () => {
  it('dispatches the literal summary path before the vote UID handler', async () => {
    const response = await fetch(`${baseUrl}/api/votes/summary?parent=project:synthetic`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active_votes: 2, closing_soon: 1 });
    expect(summary).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
  });
});
