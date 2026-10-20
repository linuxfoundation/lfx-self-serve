// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { summary, statusCounts, byId, reminderRecipients, sendReminders, voteWriteRateLimiter } = vi.hoisted(() => ({
  summary: vi.fn((_req: unknown, res: Response) => res.json({ active_votes: 2, closing_soon: 1 })),
  statusCounts: vi.fn((_req: unknown, res: Response) => res.json({ all: 3, active: 1, disabled: 1, ended: 1 })),
  byId: vi.fn(),
  reminderRecipients: vi.fn((_req: unknown, res: Response) => res.json([{ uid: 'r-1' }])),
  sendReminders: vi.fn((_req: unknown, res: Response) => res.json({ recipient_count: 1 })),
  voteWriteRateLimiter: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../controllers/vote.controller', () => ({
  VoteController: class {
    public getVotesSummary = summary;
    public getVoteStatusCounts = statusCounts;
    public getVoteById = byId;
    public getVoteReminderRecipients = reminderRecipients;
    public sendVoteReminders = sendReminders;
  },
}));
vi.mock('../middleware/rate-limit.middleware', () => ({ voteWriteRateLimiter }));

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

  it('dispatches the literal status-counts path before the vote UID handler', async () => {
    const response = await fetch(`${baseUrl}/api/votes/status-counts?parent=project:synthetic`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ all: 3, active: 1, disabled: 1, ended: 1 });
    expect(statusCounts).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
  });
});

describe('vote reminder route dispatch (#3769)', () => {
  it('dispatches GET /:uid/reminder-recipients to its handler, not the vote UID handler, without the write limiter', async () => {
    voteWriteRateLimiter.mockClear();
    const response = await fetch(`${baseUrl}/api/votes/vote-1/reminder-recipients`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ uid: 'r-1' }]);
    expect(reminderRecipients).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
    expect(voteWriteRateLimiter).not.toHaveBeenCalled();
  });

  it('dispatches POST /:uid/reminders through the vote write rate limiter', async () => {
    voteWriteRateLimiter.mockClear();
    const response = await fetch(`${baseUrl}/api/votes/vote-1/reminders`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recipient_count: 1 });
    expect(voteWriteRateLimiter).toHaveBeenCalledOnce();
    expect(sendReminders).toHaveBeenCalledOnce();
  });
});
