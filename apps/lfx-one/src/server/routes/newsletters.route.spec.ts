// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { respond, blockDuringImpersonation, newsletterTestSendRateLimiter } = vi.hoisted(() => ({
  respond: vi.fn((_req: unknown, res: Response) => res.json({})),
  blockDuringImpersonation: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  newsletterTestSendRateLimiter: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../controllers/newsletter.controller', () => ({
  NewsletterController: class {
    public cancelScheduleNewsletter = respond;
    public createNewsletter = respond;
    public deleteNewsletter = respond;
    public deleteOptOut = respond;
    public generate = respond;
    public getAnalytics = respond;
    public getNewsletter = respond;
    public getRecipientCount = respond;
    public getRecipientEngagement = respond;
    public getRecipients = respond;
    public getStatusCounts = respond;
    public getTemplateManifest = respond;
    public getTemplates = respond;
    public listNewsletters = respond;
    public listOptOuts = respond;
    public renderPreview = respond;
    public scheduleNewsletter = respond;
    public sendNewsletter = respond;
    public testSend = respond;
    public updateNewsletter = respond;
  },
}));
vi.mock('../middleware/impersonation-readonly.middleware', () => ({ blockDuringImpersonation }));
vi.mock('../middleware/rate-limit.middleware', () => ({ newsletterTestSendRateLimiter }));

import router from './newsletters.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectUid/newsletters', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  baseUrl = `http://127.0.0.1:${address.port}/api/projects/p-1/newsletters`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

// [method, path, blocked while impersonating, test-send limiter] for every route. Every write is
// blocked while impersonating (#4358 F3), and test send is rate limited per user (#4358 F1).
const ROUTES: [string, string, boolean, boolean][] = [
  ['POST', '/generate', false, false],
  ['POST', '/recipient-count', false, false],
  ['POST', '/recipients', false, false],
  ['POST', '/test-send', true, true],
  ['POST', '/render-preview', false, false],
  ['GET', '/templates', false, false],
  ['GET', '/templates/t-1/manifest', false, false],
  ['GET', '/', false, false],
  ['POST', '/', true, false],
  ['GET', '/status-counts', false, false],
  ['GET', '/opt-outs', false, false],
  ['DELETE', '/opt-outs/11111111-1111-1111-1111-111111111111', true, false],
  ['GET', '/n-1', false, false],
  ['PUT', '/n-1', true, false],
  ['DELETE', '/n-1', true, false],
  ['POST', '/n-1/send', true, false],
  ['POST', '/n-1/schedule', true, false],
  ['POST', '/n-1/cancel-schedule', true, false],
  ['GET', '/n-1/analytics', false, false],
  ['GET', '/n-1/analytics/recipients', false, false],
];

describe('newsletter project routes: impersonation block and test-send limiter (#4358)', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ROUTES)('%s %s', async (method, path, blocked, limited) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
    expect(response.status).toBe(200);
    expect(respond).toHaveBeenCalledOnce();
    expect(blockDuringImpersonation).toHaveBeenCalledTimes(blocked ? 1 : 0);
    expect(newsletterTestSendRateLimiter).toHaveBeenCalledTimes(limited ? 1 : 0);
  });
});
