// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_LINK_RATE_LIMITED_REQUESTS } from '@lfx-one/shared/constants';
import express from 'express';
import type { NextFunction, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { getLinkBallot, submitLinkResponse, updateLinkResponse, voteLinkRateLimiter } = vi.hoisted(() => ({
  getLinkBallot: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'ballot' })),
  submitLinkResponse: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'submit' })),
  updateLinkResponse: vi.fn((_req: unknown, res: Response) => res.json({ handler: 'update' })),
  voteLinkRateLimiter: vi.fn((_req: unknown, _res: unknown, next: NextFunction) => next()),
}));
vi.mock('../controllers/public-vote-link.controller', () => ({
  PublicVoteLinkController: class {
    public getLinkBallot = getLinkBallot;
    public submitLinkResponse = submitLinkResponse;
    public updateLinkResponse = updateLinkResponse;
  },
}));
vi.mock('../middleware/rate-limit.middleware', () => ({ voteLinkRateLimiter }));

import router from './public-votes.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use('/public/api/votes', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

beforeEach(() => vi.clearAllMocks());

// publicApiRateLimiter skips these paths, so voteLinkRateLimiter is their only limit (#5964).
describe('public vote-link routes rate limiting (#5964)', () => {
  it.each([
    ['POST', '/link-ballot', 'ballot'],
    ['POST', '/link-responses', 'submit'],
    ['PUT', '/link-responses', 'update'],
  ])('%s %s runs voteLinkRateLimiter before its handler', async (method, path, handler) => {
    const response = await fetch(`${baseUrl}/public/api/votes${path}`, { method });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ handler });
    expect(voteLinkRateLimiter).toHaveBeenCalledOnce();
  });

  it('does not run a handler when voteLinkRateLimiter rejects the request', async () => {
    voteLinkRateLimiter.mockImplementationOnce((_req: unknown, res: unknown) => {
      (res as Response).status(429).json({ error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' });
    });

    const response = await fetch(`${baseUrl}/public/api/votes/link-ballot`, { method: 'POST' });

    expect(response.status).toBe(429);
    expect(getLinkBallot).not.toHaveBeenCalled();
  });

  it('mounts exactly the method/path pairs publicApiRateLimiter skips', () => {
    const mounted = (router.stack as { route?: { path: string; methods: Record<string, boolean> } }[]).flatMap((layer) => {
      if (!layer.route) return [];
      const { path, methods } = layer.route;
      return Object.keys(methods).map((method) => `${method.toUpperCase()} /votes${path}`);
    });

    expect(mounted.sort()).toEqual([...VOTE_LINK_RATE_LIMITED_REQUESTS].sort());
  });
});
