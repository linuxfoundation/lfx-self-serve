// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { listClaGroups } = vi.hoisted(() => ({ listClaGroups: vi.fn() }));

vi.mock('../controllers/org-clas.controller', () => ({
  OrgClasController: class {
    public listClaGroups = listClaGroups;
  },
}));

const getAccessAwareOrgs = vi.fn();

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'alice', isImpersonating: () => false }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
  },
}));

const orgClasRouter = (await import('./org-clas.route')).default;

const GRANTED = '0014100000Te2ovAAB';
const UNGRANTED = '0014100000Te2QjAAJ';

let server: Server;
let baseUrl: string;

function ok(_req: express.Request, res: express.Response): void {
  res.json({ orgUid: GRANTED, claGroups: [] });
}

// Mirrors orgsRouter's `router.use('/:orgUid/lens', requireOrgLensAccess)`, which shares the
// /api/orgs mount and matches the CLA path. Mounting it here in the same order as server.ts is
// what makes the flag-off case a real assertion: with the CLA router mounted second, this guard
// would run first and the module would answer 403 rather than 409.
const genericLensGuard = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgClasRouter);
  const orgsLike = express.Router();
  orgsLike.use('/:orgUid/lens', genericLensGuard);
  app.use('/api/orgs', orgsLike);
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
  process.env['LFX_ORG_LENS_CLA_M3_ENABLED'] = 'true';
  listClaGroups.mockImplementation(ok);
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
});

afterEach(() => {
  delete process.env['LFX_ORG_LENS_CLA_M3_ENABLED'];
});

describe('org-clas router', () => {
  it('refuses the list for an org the caller holds no grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups`);

    expect(res.status).toBe(403);
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('admits the list for an org the caller holds a grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups`);

    expect(res.status).toBe(200);
    expect(listClaGroups).toHaveBeenCalled();
    expect(await res.json()).toEqual({ orgUid: GRANTED, claGroups: [] });
  });

  // The client flag only hides the page; this is what makes the dark launch a real kill switch.
  // The generic-guard assertion is the ordering regression test — see genericLensGuard above.
  it('refuses the list for a granted org when the server flag is off, before any grant lookup', async () => {
    delete process.env['LFX_ORG_LENS_CLA_M3_ENABLED'];

    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups`);

    expect(res.status).toBe(409);
    expect(listClaGroups).not.toHaveBeenCalled();
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
    expect(genericLensGuard).not.toHaveBeenCalled();
  });

  // The gate is scoped to the CLA prefix precisely so mounting this router first cannot
  // 409 the rest of the /api/orgs family.
  it('leaves sibling org-lens paths untouched when the server flag is off', async () => {
    delete process.env['LFX_ORG_LENS_CLA_M3_ENABLED'];

    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/memberships`);

    expect(res.status).not.toBe(409);
    expect(genericLensGuard).toHaveBeenCalled();
  });
});
