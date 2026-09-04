// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgClasRouter);
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
  listClaGroups.mockImplementation(ok);
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
});

describe('org-clas router', () => {
  it('refuses the list for an org the caller holds no grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups`);

    expect(res.status).toBe(403);
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('admits the list for a granted org and stays readable while impersonating', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups`);

    expect(res.status).toBe(200);
    expect(listClaGroups).toHaveBeenCalled();
    expect(await res.json()).toEqual({ orgUid: GRANTED, claGroups: [] });
  });
});
