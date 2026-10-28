// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express from 'express';
import type { Request, NextFunction, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { summary, statusCounts, byId, reminderRecipients, voters, sendReminders, myBallot, updateVote, submitBallot, voteWriteRateLimiter } = vi.hoisted(() => ({
  summary: vi.fn((_req: unknown, res: Response) => res.json({ active_votes: 2, closing_soon: 1 })),
  statusCounts: vi.fn((_req: unknown, res: Response) => res.json({ all: 3, active: 1, disabled: 1, ended: 1 })),
  byId: vi.fn(),
  reminderRecipients: vi.fn((_req: unknown, res: Response) => res.json([{ uid: 'r-1' }])),
  voters: vi.fn((_req: unknown, res: Response) => res.json([{ uid: 'b-1', status: 'voted' }])),
  sendReminders: vi.fn((_req: unknown, res: Response) => res.json({ recipient_count: 1 })),
  myBallot: vi.fn((_req: unknown, res: Response) => res.json({ vote_response_uid: 'vr-1' })),
  updateVote: vi.fn(),
  submitBallot: vi.fn((_req: unknown, res: Response) => res.status(204).send()),
  voteWriteRateLimiter: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock('../controllers/vote.controller', () => ({
  VoteController: class {
    public getVotesSummary = summary;
    public getVoteStatusCounts = statusCounts;
    public getVoteById = byId;
    public getVoteReminderRecipients = reminderRecipients;
    public getVoteVoters = voters;
    public sendVoteReminders = sendReminders;
    public getMyVoteBallot = myBallot;
    public updateVote = updateVote;
    public createVoteResponse = submitBallot;
  },
}));
vi.mock('../middleware/rate-limit.middleware', () => ({ voteWriteRateLimiter }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn() } }));

import router from './votes.route';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.impersonationActive = req.headers['x-test-impersonating'] === 'true';
    next();
  });
  app.use('/api/votes', router);
  app.use((error: { statusCode: number; code: string }, _req: Request, res: Response, _next: NextFunction) => {
    void _next; // Express identifies error middleware by its four-argument signature.
    res.status(error.statusCode).json({ code: error.code });
  });
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

describe('vote voters route dispatch (#3911)', () => {
  it('dispatches GET /:uid/voters to its handler, not the vote UID handler, without the write limiter', async () => {
    voteWriteRateLimiter.mockClear();
    const response = await fetch(`${baseUrl}/api/votes/vote-1/voters`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ uid: 'b-1', status: 'voted' }]);
    expect(voters).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
    expect(voteWriteRateLimiter).not.toHaveBeenCalled();
  });
});

describe('ballot writes during impersonation (#4331)', () => {
  it('rejects before the submission controller runs', async () => {
    submitBallot.mockClear();
    const response = await fetch(`${baseUrl}/api/votes/responses`, { method: 'POST', headers: { 'x-test-impersonating': 'true' } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'IMPERSONATION_READ_ONLY' });
    expect(submitBallot).not.toHaveBeenCalled();
  });

  it('preserves ordinary first-ballot submission', async () => {
    submitBallot.mockClear();
    const response = await fetch(`${baseUrl}/api/votes/responses`, { method: 'POST' });
    expect(response.status).toBe(204);
    expect(submitBallot).toHaveBeenCalledOnce();
  });
});

describe('own ballot route dispatch (#4331)', () => {
  it('dispatches GET /:uid/my-ballot to its handler, not the vote UID handler', async () => {
    const response = await fetch(`${baseUrl}/api/votes/vote-1/my-ballot`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vote_response_uid: 'vr-1' });
    expect(myBallot).toHaveBeenCalledOnce();
    expect(byId).not.toHaveBeenCalled();
  });

  it('does not expose PUT /responses/:responseUid for submitted ballots', async () => {
    const response = await fetch(`${baseUrl}/api/votes/responses/vr-1`, { method: 'PUT' });
    expect(response.status).toBe(404);
    expect(updateVote).not.toHaveBeenCalled();
  });
});
