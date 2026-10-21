// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as profile.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SELF_RESEND_INVITE_RATE_LIMIT_MAX } from '../../../../../packages/shared/src/constants/meeting-registrant.constants';

/**
 * Router-level coverage for the two resend-invitation routes.
 *
 * The controller and limiter have their own unit tests, but those call them directly: they would keep
 * passing if the limiter were dropped from the self route, or if the self route slipped below the
 * `:registrantId/resend` route, which would then match `self` as a registrant ID and send a registrant's
 * request to the organizer-only handler.
 */

const selfHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});
const organizerHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});

vi.mock('../controllers/meeting.controller', () => ({
  MeetingController: class {
    public resendMyMeetingInvitation = selfHandler;
    public resendMeetingInvitation = organizerHandler;
  },
}));
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

const meetingsRouter = (await import('./meetings.route')).default;

const MEETING_UID = '5b0f2f7e-3c1a-4a8e-9d6b-2f1e0c9a7b31';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/meetings', meetingsRouter);
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
});

const post = (path: string) =>
  fetch(`${baseUrl}/api/meetings/${MEETING_UID}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

describe('meetings router — removed per-meeting calendar download', () => {
  it('no longer serves GET /:uid/calendar.ics, and no handler is reached for it', async () => {
    const res = await fetch(`${baseUrl}/api/meetings/${MEETING_UID}/calendar.ics?scope=series`);

    expect(res.status).toBe(404);
    expect(selfHandler).not.toHaveBeenCalled();
    expect(organizerHandler).not.toHaveBeenCalled();
  });
});

describe('meetings router — resend invitation routes', () => {
  it('routes the self path to the self handler, not the organizer handler', async () => {
    const res = await post('/registrants/self/resend');

    expect(res.status).toBe(200);
    expect(selfHandler).toHaveBeenCalledTimes(1);
    expect(organizerHandler).not.toHaveBeenCalled();
  });

  it('still routes a registrant id to the organizer handler', async () => {
    const res = await post('/registrants/reg-123/resend');

    expect(res.status).toBe(200);
    expect(organizerHandler).toHaveBeenCalledTimes(1);
    expect(selfHandler).not.toHaveBeenCalled();
  });

  // Runs last on purpose: the limiter's counter is process-wide, so spending the budget here would
  // starve the self-route tests above if it ran first.
  it('limits the self route per user, and leaves the organizer route unthrottled', async () => {
    // One request is already counted by the first test, so the budget is spent a request early.
    let rejected: Response | undefined;
    for (let attempt = 0; attempt <= SELF_RESEND_INVITE_RATE_LIMIT_MAX && !rejected; attempt++) {
      const res = await post('/registrants/self/resend');
      if (res.status === 429) {
        rejected = res;
      }
    }

    expect(rejected?.status).toBe(429);
    expect(await rejected?.json()).toEqual({ error: 'You have resent your invitation too many times. Please try again later.', code: 'RATE_LIMITED' });

    selfHandler.mockClear();
    const blocked = await post('/registrants/self/resend');
    expect(blocked.status).toBe(429);
    expect(selfHandler).not.toHaveBeenCalled();

    const organizer = await post('/registrants/reg-123/resend');
    expect(organizer.status).toBe(200);
    expect(organizerHandler).toHaveBeenCalledTimes(1);
  });
});
