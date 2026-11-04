// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { byId, reminders, resyncPreview, resync, surveyWriteRateLimiter } = vi.hoisted(() => ({
  byId: vi.fn((_req: unknown, res: Response) => res.json({})),
  reminders: vi.fn((_req: unknown, res: Response) => res.json({ recipient_count: 1 })),
  resyncPreview: vi.fn((_req: unknown, res: Response) => res.json({ affected_recipients: [], affected_committees: [] })),
  resync: vi.fn((_req: unknown, res: Response) => res.status(204).send()),
  surveyWriteRateLimiter: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../controllers/survey.controller', () => ({
  SurveyController: class {
    public getSurveyById = byId;
    public sendSurveyReminders = reminders;
    public getResyncPreview = resyncPreview;
    public resyncRecipients = resync;
  },
}));
vi.mock('../middleware/rate-limit.middleware', () => ({ surveyWriteRateLimiter }));

import router from './surveys.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use('/api/surveys', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

describe('survey follow-up route dispatch (#4340)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches POST /:uid/reminders through the survey write rate limiter', async () => {
    const response = await fetch(`${baseUrl}/api/surveys/s-1/reminders`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(reminders).toHaveBeenCalledOnce();
    expect(surveyWriteRateLimiter).toHaveBeenCalledOnce();
  });

  it('dispatches POST /:uid/resync through the survey write rate limiter', async () => {
    const response = await fetch(`${baseUrl}/api/surveys/s-1/resync`, { method: 'POST' });
    expect(response.status).toBe(204);
    expect(resync).toHaveBeenCalledOnce();
    expect(surveyWriteRateLimiter).toHaveBeenCalledOnce();
  });

  it('dispatches GET /:uid/resync-preview without the write limiter and not to the survey UID handler', async () => {
    const response = await fetch(`${baseUrl}/api/surveys/s-1/resync-preview`);
    expect(response.status).toBe(200);
    expect(resyncPreview).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
    expect(surveyWriteRateLimiter).not.toHaveBeenCalled();
  });
});
