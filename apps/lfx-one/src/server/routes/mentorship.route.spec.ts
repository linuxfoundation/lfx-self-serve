// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The import graph transitively reaches Angular's partially-compiled @angular/common,
// which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const mentorshipRouter = (await import('./mentorship.route')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/mentorship', mentorshipRouter);
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

describe('mentorship router — write endpoints removed (GH-2717)', () => {
  it('rejects POST /api/mentorship/programs with 404 (former enrollment endpoint)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/programs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });

    expect(res.status).toBe(404);
  });

  it('still routes GET /api/mentorship/programs (not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/programs`);

    // The route exists — it returns 401 (auth required), not 404.
    expect(res.status).toBe(401);
  });
});

describe('mentorship router — mentee endpoints (GH-2755)', () => {
  it('rejects unauthenticated GET /api/mentorship/mentee/has-profile with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/has-profile`);
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated GET /api/mentorship/mentee/overview with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/overview`);
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated GET /api/mentorship/mentee/tasks with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/tasks`);
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated GET /api/mentorship/mentee/profile with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`);
    expect(res.status).toBe(401);
  });

  it('requires auth before phase validation runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/overview?phase=invalid`);
    // Auth check fires before phase validation — unauthenticated requests get 401.
    expect(res.status).toBe(401);
  });
});
