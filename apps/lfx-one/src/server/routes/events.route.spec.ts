// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph can reach Angular's partially-compiled
// @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the visa letter impersonation gate. A direct middleware test would keep
 * passing if `blockDuringImpersonation` were dropped from the route, letting an impersonator download
 * a letter built from their own token, so this asserts the assembled router.
 */

const eventsHandler = vi.fn((_req: express.Request, res: express.Response) => {
  res.status(200).end();
});

vi.mock('../controllers/events.controller', () => ({
  EventsController: class {
    public getVisaLetter = eventsHandler;
    public getCertificate = eventsHandler;
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

const eventsRouter = (await import('./events.route')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/events', eventsRouter);
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

describe('events router — visa letter impersonation gate', () => {
  it('refuses the visa letter with 403 while impersonating and never reaches the controller', async () => {
    const res = await fetch(`${baseUrl}/api/events/visa-letter?eventId=evt-1`);

    expect(res.status).toBe(403);
    expect(eventsHandler).not.toHaveBeenCalled();
  });

  it('admits the visa letter when not impersonating', async () => {
    impersonatingStub = false;

    const res = await fetch(`${baseUrl}/api/events/visa-letter?eventId=evt-1`);

    expect(res.status).toBe(200);
    expect(eventsHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps the certificate open while impersonating', async () => {
    const res = await fetch(`${baseUrl}/api/events/certificate?eventId=evt-1`);

    expect(res.status).toBe(200);
    expect(eventsHandler).toHaveBeenCalledTimes(1);
  });
});
