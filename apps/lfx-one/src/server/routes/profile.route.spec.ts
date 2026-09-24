// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the LFX Insights API token impersonation gate.
 *
 * `blockDuringImpersonation` has its own unit tests, but those call it directly — they would keep
 * passing if the middleware were dropped from (or added to) one of these routes. The split matters:
 * reads must stay open so an impersonator can see the target's tokens, while create and revoke must
 * be refused because a minted token is a live credential the impersonator would keep.
 */

const insightsHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});

vi.mock('../controllers/insights-tokens.controller', () => ({
  InsightsTokensController: class {
    public listTokens = insightsHandler;
    public getEligibility = insightsHandler;
    public createToken = insightsHandler;
    public revokeToken = insightsHandler;
  },
}));
vi.mock('../controllers/profile.controller', () => ({
  ProfileController: class {},
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

const profileRouter = (await import('./profile.route')).default;

const UID = '5b0f2f7e-3c1a-4a8e-9d6b-2f1e0c9a7b31';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRouter);
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

describe('profile router — Insights token impersonation gate', () => {
  it.each([
    ['list', '/insights-tokens'],
    ['eligibility', '/insights-tokens/eligibility'],
  ])('admits the %s read while impersonating', async (_label, path) => {
    const res = await fetch(`${baseUrl}/api/profile${path}`);

    expect(res.status).toBe(200);
    expect(insightsHandler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create', 'POST', '/insights-tokens'],
    ['revoke', 'DELETE', `/insights-tokens/${UID}`],
  ])('refuses %s with 403 while impersonating and never reaches the controller', async (_label, method, path) => {
    const res = await fetch(`${baseUrl}/api/profile${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ name: 'ci-pipeline' }) : undefined,
    });

    expect(res.status).toBe(403);
    expect(insightsHandler).not.toHaveBeenCalled();
  });

  it.each([
    ['create', 'POST', '/insights-tokens'],
    ['revoke', 'DELETE', `/insights-tokens/${UID}`],
  ])('admits %s when not impersonating', async (_label, method, path) => {
    impersonatingStub = false;

    const res = await fetch(`${baseUrl}/api/profile${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ name: 'ci-pipeline' }) : undefined,
    });

    expect(res.status).toBe(200);
    expect(insightsHandler).toHaveBeenCalledTimes(1);
  });
});
