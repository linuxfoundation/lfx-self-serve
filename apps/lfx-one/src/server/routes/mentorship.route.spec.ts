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
  // Auth middleware sets this in the app; here a header stands in for an impersonation session.
  app.use((req, _res, next) => {
    req.impersonationActive = req.headers['x-test-impersonating'] === 'true';
    next();
  });
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

  it('rejects unauthenticated GET /api/mentorship/mentee/applications with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/applications?withTasks=true`);
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated GET /api/mentorship/mentee/profile with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`);
    expect(res.status).toBe(401);
  });

  it('requires auth before withTasks validation runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/applications?withTasks=invalid`);
    // Auth check fires before withTasks validation — unauthenticated requests get 401.
    expect(res.status).toBe(401);
  });

  it('routes POST /api/mentorship/mentee/applications/:applicationId/withdraw (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/applications/6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f/withdraw`, { method: 'POST' });

    expect(res.status).toBe(401);
  });

  it('refuses a withdraw while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/applications/6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f/withdraw`, {
      method: 'POST',
      headers: { 'x-test-impersonating': 'true' },
    });

    // 403 rather than the controller's 401 shows the guard ran first.
    expect(res.status).toBe(403);
  });

  it('routes POST /api/mentorship/mentee/profile (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
  });
  it('routes PATCH /api/mentorship/mentee/tasks/:taskId (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/tasks/7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(401);
  });

  it('refuses a mentee registration while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-impersonating': 'true' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
  // 403 rather than the controller's 401 shows the guard ran first.
  it('refuses a task status change while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/tasks/7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-test-impersonating': 'true' },
      body: JSON.stringify({ status: 'in_progress' }),
    });

    expect(res.status).toBe(403);
  });

  const applyIds = { programId: '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e', programTermId: '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e' };

  it('rejects unauthenticated GET /api/mentorship/mentee/apply-target with 401', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/apply-target?${new URLSearchParams(applyIds)}`);
    expect(res.status).toBe(401);
  });

  it('requires auth before apply-target parameter validation runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/apply-target`);
    // Auth check fires before missing-parameter validation — unauthenticated requests get 401, not 400.
    expect(res.status).toBe(401);
  });

  it('routes POST /api/mentorship/mentee/apply (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applyIds),
    });

    expect(res.status).toBe(401);
  });

  it('refuses an apply while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-impersonating': 'true' },
      body: JSON.stringify(applyIds),
    });

    // 403 rather than the controller's 401 shows the guard ran first.
    expect(res.status).toBe(403);
  });
});

describe('mentorship router — program review', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  it('routes GET /api/mentorship/program-review/:programId (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/program-review/${programId}`);

    expect(res.status).toBe(401);
  });

  it('routes POST /api/mentorship/program-review/:programId/decision (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/program-review/${programId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });

    expect(res.status).toBe(401);
  });

  it('refuses the decision while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/program-review/${programId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-impersonating': 'true' },
      body: JSON.stringify({ decision: 'approve' }),
    });

    // 403 rather than the controller's 401 shows the guard ran first.
    expect(res.status).toBe(403);
  });

  it('still allows reading the program while impersonating', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/program-review/${programId}`, { headers: { 'x-test-impersonating': 'true' } });

    expect(res.status).toBe(401);
  });
});

describe('mentorship router — mentee profile update', () => {
  const body = JSON.stringify({ introduction: 'Test intro' });

  it('routes PATCH /api/mentorship/mentee/profile (auth required, not 404)', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });

    expect(res.status).toBe(401);
  });

  it('refuses a profile update while impersonating, before the controller runs', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-test-impersonating': 'true' },
      body,
    });

    // 403 rather than the controller's 401 shows the guard ran first.
    expect(res.status).toBe(403);
  });

  it('still allows reading the profile while impersonating', async () => {
    const res = await fetch(`${baseUrl}/api/mentorship/mentee/profile`, { headers: { 'x-test-impersonating': 'true' } });

    expect(res.status).toBe(401);
  });
});
