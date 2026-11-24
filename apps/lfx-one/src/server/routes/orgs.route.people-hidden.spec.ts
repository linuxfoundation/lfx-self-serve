// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #5856 — the People page is hidden in the all employee view (epic #5845). Router-level: drives real requests through
 * the assembled orgs router with the read gate passing and `blockEmployeeView` stubbed to answer 403 for the employee
 * view, so a People route that lost its block (or a new one added outside the guarded prefix) fails here. The
 * middleware's own verdict logic is covered by block-employee-view.middleware.spec.ts.
 */
let employeeView = false;
const blockCalls: string[] = [];

vi.mock('../middleware/require-org-lens-access.middleware', () => ({
  requireOrgLensAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../middleware/block-employee-view.middleware', () => ({
  blockEmployeeView: (req: Request, res: Response, next: NextFunction) => {
    blockCalls.push(req.params['orgUid']);
    if (employeeView) {
      res.status(403).json({ error: { code: 'EMPLOYEE_VIEW_FORBIDDEN' } });
      return;
    }
    next();
  },
}));
vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = vi.fn().mockResolvedValue({});
    public proxyRequestWithResponse = vi.fn().mockResolvedValue({});
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => Date.now()), success: vi.fn() },
}));

const orgsRouter = (await import('./orgs.route')).default;

const ORG = '0014100000Te2ovAAB';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orgs', orgsRouter);
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
  employeeView = false;
  blockCalls.length = 0;
});

// One entry per route family behind the People page: each tab, the CSV source, the drawers and the writes.
const PEOPLE_ROUTES: [string, string, string][] = [
  ['All Employees', 'GET', '/lens/people/all'],
  ['All Employees (former, CSV source)', 'GET', '/lens/people/former'],
  ['Contributors', 'GET', '/lens/people/contributors'],
  ['Committee Members', 'GET', '/lens/people/committee-members'],
  ['Committee Members reassign', 'PATCH', '/lens/people/committee-members/seat-1/reassign'],
  ['Board Members', 'GET', '/lens/people/board-members'],
  ['Board Members reassign', 'PATCH', '/lens/people/board-members/seat-1/reassign'],
  ['Key Contacts', 'GET', '/lens/people/key-contacts'],
  ['Trainees (Training learners tab)', 'GET', '/lens/people/trainees'],
  ['Event Attendees tab', 'GET', '/lens/people/event-attendees'],
  ['person drawer', 'GET', '/lens/people/person-key-1/detail'],
  ['person drawer company emails', 'GET', '/lens/people/person-key-1/company-emails'],
  ['person drawer key contacts', 'GET', '/lens/people/person-key-1/key-contacts'],
  ['person drawer by username', 'GET', '/lens/people/by-username/someone/detail'],
  ['person drawer emails by username', 'GET', '/lens/people/by-username/someone/company-emails'],
  ['person drawer key contacts by username', 'GET', '/lens/people/by-username/someone/key-contacts'],
  ['person drawer emails by key contact', 'GET', '/lens/people/by-key-contact/company-emails'],
  ['Company Lens Access list', 'GET', '/lens/access/users'],
  ['Company Lens Access add', 'POST', '/lens/access/users'],
  ['Company Lens Access change role', 'PUT', '/lens/access/users/someone%40example.com'],
  ['Company Lens Access remove', 'DELETE', '/lens/access/users/someone%40example.com'],
];

const call = (method: string, path: string) =>
  fetch(`${baseUrl}/api/orgs/${ORG}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });

describe('orgs router — People page in the all employee view (#5856)', () => {
  it.each(PEOPLE_ROUTES)('answers 403 EMPLOYEE_VIEW_FORBIDDEN on %s (%s %s) in the employee view', async (_label, method, path) => {
    employeeView = true;

    const res = await call(method, path);

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('EMPLOYEE_VIEW_FORBIDDEN');
    expect(blockCalls).toEqual([ORG]);
  });

  it.each(PEOPLE_ROUTES)('runs the block, then lets the full view through, on %s (%s %s)', async (_label, method, path) => {
    const res = await call(method, path);

    expect(blockCalls).toEqual([ORG]);
    // A handler may still refuse for its own reasons (no upstream here); only the employee-view refusal is ruled out.
    expect(await res.text()).not.toContain('EMPLOYEE_VIEW_FORBIDDEN');
  });
});
