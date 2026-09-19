// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the `requireDashboardAccess` gate on the Health Metrics Overview
 * "Foundation" rail endpoints (LFXV2-3365).
 *
 * The middleware has its own unit tests, but those call it directly — they would keep passing if
 * `router.get('/foundation-profile-summary', requireDashboardAccess, ...)` had the middleware
 * dropped or reordered. Since that registration *is* the fix, these tests drive real HTTP requests
 * through the assembled router.
 *
 * Only the gate is asserted, but the admitted path still runs the real controller/service code,
 * so Snowflake is mocked to return empty rows (the documented missing-object/no-data default
 * path) rather than left as a real client that could attempt a network connection.
 */

const getPersonas = vi.fn();
const execute = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas },
}));
vi.mock('../services/snowflake.service', () => ({
  SnowflakeService: {
    getInstance: () => ({ execute }),
    isMissingObjectError: () => false,
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

const analyticsRouter = (await import('./analytics.route')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
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
  execute.mockResolvedValue({ rows: [] });
});

describe.each([
  ['/foundation-profile-summary', 'foundationSlug'],
  ['/health-overview-revenue', 'foundationSlug'],
  ['/health-overview-kpis', 'foundationSlug'],
])('analytics router — dashboard access gate on %s', (path, slugParam) => {
  it('refuses a caller without ED or LF Staff access', async () => {
    getPersonas.mockResolvedValue({ personas: [], isLFStaff: false, isRootWriter: false, personaProjects: {} });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(403);
  });

  it('admits LF Staff past the gate', async () => {
    getPersonas.mockResolvedValue({ personas: [], isLFStaff: true, isRootWriter: false, personaProjects: {} });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(200);
    expect(getPersonas).toHaveBeenCalled();
  });

  it('refuses an ED scoped to a different foundation', async () => {
    getPersonas.mockResolvedValue({
      personas: ['executive-director'],
      isLFStaff: false,
      isRootWriter: false,
      personaProjects: { 'executive-director': [{ projectSlug: 'kubernetes' }] },
    });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(403);
  });

  it('admits an ED scoped to the requested foundation', async () => {
    getPersonas.mockResolvedValue({
      personas: ['executive-director'],
      isLFStaff: false,
      isRootWriter: false,
      personaProjects: { 'executive-director': [{ projectSlug: 'cncf' }] },
    });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(200);
    expect(getPersonas).toHaveBeenCalled();
  });
});
