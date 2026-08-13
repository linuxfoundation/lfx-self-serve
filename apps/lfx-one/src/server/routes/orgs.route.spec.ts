// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for the Org Lens read gate.
 *
 * The middleware has its own unit tests, but those call it directly — they would keep passing if the
 * `router.use('/:orgUid/lens', …)` registration were deleted, moved below a route, or scoped so
 * narrowly that it missed the `:accountId` routes. Since that registration *is* the fix for the
 * cross-org exposure, these tests drive real HTTP requests through the assembled router.
 *
 * Only the gate is asserted. A blocked request must be refused with 403; an admitted one only has to
 * get *past* the gate — whatever the downstream handler then does with no upstreams configured is
 * irrelevant here and deliberately not stubbed, which keeps this test from re-encoding every
 * controller's wiring.
 */

const getAccessAwareOrgs = vi.fn();

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'lguerra' }));
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

const orgsRouter = (await import('./orgs.route')).default;

const GRANTED = '0014100000Te2ovAAB';
const UNGRANTED = '0014100000Te2QjAAJ';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgsRouter);
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
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
});

describe('orgs router — Org Lens read gate', () => {
  // `:orgUid` and `:accountId` name the same SFID; both must be gated, which is why the mount sits on
  // the shared `/lens` prefix rather than on individual routes.
  it.each([
    ['people roster (:orgUid)', `/lens/people/all`],
    ['events (:accountId)', `/lens/events`],
    ['memberships', `/lens/memberships/active`],
    ['contributions', `/lens/contributions/summary`],
  ])('refuses %s for an org the caller holds no grant on', async (_label, path) => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}${path}`);

    expect(res.status).toBe(403);
  });

  it('admits a granted org past the gate', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/people/all`);

    expect(res.status).not.toBe(403);
    // The gate must have run and allowed it — without this the assertion above also holds when the
    // gate is absent entirely, which is exactly the regression these tests exist to catch.
    expect(getAccessAwareOrgs).toHaveBeenCalled();
  });

  it('refuses with 503, not 403, when the grant lookup cannot be completed', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: true });

    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/people/all`);

    // Asserted together: a downstream failure can also surface as 503, so the status alone does not
    // prove the gate produced it.
    expect(res.status).toBe(503);
    expect(getAccessAwareOrgs).toHaveBeenCalled();
  });

  it('does not gate the non-lens identity routes', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/me/role-grants`);

    expect(res.status).not.toBe(403);
  });
});
