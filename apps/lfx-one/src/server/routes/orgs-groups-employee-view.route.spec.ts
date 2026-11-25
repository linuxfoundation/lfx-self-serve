// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Epic #5845 / #5859: every API route behind the Groups page answers 403 EMPLOYEE_VIEW_FORBIDDEN in the all
 * employee view and is untouched in the full view. Drives real HTTP requests through the assembled router.
 * The read gate is stubbed to a fixed view mode; its own behaviour is covered by its spec.
 */

let mode: 'full' | 'employee' = 'full';
const getGroups = vi.fn();
const getCommitteeMembers = vi.fn();

vi.mock('../helpers/org-lens-read-access.helper', () => ({
  assertOrgLensRead: vi.fn(async () => 'org-grant'),
  getOrgLensViewMode: () => mode,
  resolveOrgLensViewMode: async () => mode,
}));
vi.mock('../helpers/org-lens-roll-up.helper', () => ({ resolveOrgLensRollUp: vi.fn() }));
vi.mock('../controllers/org-lens-groups.controller', () => ({
  OrgLensGroupsController: class {
    public getGroups = getGroups;
  },
}));
vi.mock('../controllers/org-lens-people.controller', () => ({
  OrgLensPeopleController: class {
    public getCommitteeMembers = getCommitteeMembers;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'employee', isImpersonating: () => false }));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkLFStaff: async () => false } }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => Date.now()), success: vi.fn() },
}));

const orgsRouter = (await import('./orgs.route')).default;

const ORG = '0014100000Te2ovAAB';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgsRouter);
  // Express only treats a four-argument handler as an error handler.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({ code: err.code });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  mode = 'full';
  getGroups.mockImplementation((_req, res) => res.json({ groups: [] }));
  getCommitteeMembers.mockImplementation((_req, res) => res.json({ assignments: [] }));
});

describe('orgs router: Groups page routes in the all employee view (#5859)', () => {
  it.each([
    ['the Groups page list', 'lens/groups', () => getGroups],
    ['the seat-holders drawer roster', 'lens/people/committee-members', () => getCommitteeMembers],
  ])('answers 403 EMPLOYEE_VIEW_FORBIDDEN for %s without reaching the handler', async (_label, path, handler) => {
    mode = 'employee';

    const res = await fetch(`${baseUrl}/api/orgs/${ORG}/${path}`);

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('EMPLOYEE_VIEW_FORBIDDEN');
    expect(handler()).not.toHaveBeenCalled();
  });

  it.each([
    ['the Groups page list', 'lens/groups', () => getGroups],
    ['the seat-holders drawer roster', 'lens/people/committee-members', () => getCommitteeMembers],
  ])('leaves %s unchanged in the full view', async (_label, path, handler) => {
    const res = await fetch(`${baseUrl}/api/orgs/${ORG}/${path}`);

    expect(res.status).toBe(200);
    expect(handler()).toHaveBeenCalledTimes(1);
  });
});
