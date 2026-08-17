// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for LFXV2-3294: every endpoint on this router must be gated by
 * `requireExecutiveDirector`. The middleware has its own unit tests, but those call it directly —
 * they would keep passing if a route's `requireExecutiveDirector` argument were dropped, or if a
 * newly added route forgot it entirely. This drives real HTTP requests through the assembled
 * router so a missing gate shows up as a non-403 response instead of silently passing.
 *
 * Only the gate is asserted. A blocked request must be refused with 403; an admitted one only has
 * to get past the gate — whatever the (unstubbed) controller does next with no upstream services
 * configured is irrelevant here, same rationale as orgs.route.spec.ts.
 */

const getPersonas = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: () => getPersonas() },
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

const campaignsRouter = (await import('./campaigns.route')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', campaignsRouter);
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
  getPersonas.mockReset();
});

const NON_ED = { personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false };
const ED = { personas: ['executive-director'], personaProjects: {}, isRootWriter: false, isLFStaff: false };

describe('campaigns router — ED gate', () => {
  // A representative sample across the file, including a write and a param route — not all 20,
  // since the point is to catch a missing/deleted gate on the registration, not to re-test the
  // middleware's own branching (covered by require-executive-director.middleware.spec.ts).
  it.each([
    ['brief generate (write)', 'post', '/brief/generate'],
    ['create (write)', 'post', '/create'],
    ['monitor (read)', 'get', '/monitor'],
    ['keywords (read)', 'get', '/keywords'],
    ['status update (write, param route)', 'patch', '/some-campaign-id/status'],
  ])('refuses %s for a non-ED caller', async (_label, method, path) => {
    getPersonas.mockResolvedValue(NON_ED);

    const res = await fetch(`${baseUrl}/api/campaigns${path}`, { method: method.toUpperCase() });

    expect(res.status).toBe(403);
  });

  it('admits an ED caller past the gate', async () => {
    getPersonas.mockResolvedValue(ED);

    const res = await fetch(`${baseUrl}/api/campaigns/monitor`);

    expect(res.status).not.toBe(403);
    // The gate must have run — without this the assertion above also holds when the gate is
    // absent entirely, which is exactly the regression these tests exist to catch.
    expect(getPersonas).toHaveBeenCalled();
  });

  // The middleware requires the ED persona unconditionally — isRootWriter/isLFStaff only bypass
  // the foundationSlug scope check further down, not the initial gate. A caller without the ED
  // persona is refused here regardless of those flags.
  it('refuses a root writer without the ED persona', async () => {
    getPersonas.mockResolvedValue({ personas: [], personaProjects: {}, isRootWriter: true, isLFStaff: false });

    const res = await fetch(`${baseUrl}/api/campaigns/monitor`);

    expect(res.status).toBe(403);
  });

  it('refuses LF staff without the ED persona', async () => {
    getPersonas.mockResolvedValue({ personas: [], personaProjects: {}, isRootWriter: false, isLFStaff: true });

    const res = await fetch(`${baseUrl}/api/campaigns/monitor`);

    expect(res.status).toBe(403);
  });
});
