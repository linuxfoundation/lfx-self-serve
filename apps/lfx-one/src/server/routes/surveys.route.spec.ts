// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the survey impersonation gate (lfx-self-serve-ops#148).
 *
 * `blockDuringImpersonation` has its own unit tests, but those call it directly — they would keep
 * passing if the middleware were dropped from one of these routes. Survey create and delete must
 * be refused while impersonating, because upstream records them as the target; every read must
 * stay open.
 */

const surveyHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});

vi.mock('../controllers/survey.controller', () => ({
  SurveyController: class {
    public createSurvey = surveyHandler;
    public getSurveys = surveyHandler;
    public getMySurveys = surveyHandler;
    public getMyResponse = surveyHandler;
    public getSurveyResponses = surveyHandler;
    public getSurveyById = surveyHandler;
    public deleteSurvey = surveyHandler;
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

const surveysRouter = (await import('./surveys.route')).default;

const UID = '5b0f2f7e-3c1a-4a8e-9d6b-2f1e0c9a7b31';

const WRITES: [string, string, string][] = [
  ['create', 'POST', '/'],
  ['delete', 'DELETE', `/${UID}`],
];

let server: Server;
let baseUrl: string;

function send(method: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}/api/surveys${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({}) : undefined,
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/surveys', surveysRouter);
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

describe('surveys router — impersonation gate', () => {
  it.each([
    ['list', '/'],
    ['my surveys', '/my-surveys'],
    ['detail', `/${UID}`],
    ['my response', `/${UID}/my-response`],
    ['responses', `/${UID}/responses`],
  ])('admits the %s read while impersonating', async (_label, path) => {
    const res = await send('GET', path);

    expect(res.status).toBe(200);
    expect(surveyHandler).toHaveBeenCalledTimes(1);
  });

  it.each(WRITES)('refuses %s with 403 while impersonating and never reaches the controller', async (_label, method, path) => {
    const res = await send(method, path);

    expect(res.status).toBe(403);
    expect(surveyHandler).not.toHaveBeenCalled();
  });

  it.each(WRITES)('admits %s when not impersonating', async (_label, method, path) => {
    impersonatingStub = false;

    const res = await send(method, path);

    expect(res.status).toBe(200);
    expect(surveyHandler).toHaveBeenCalledTimes(1);
  });
});
