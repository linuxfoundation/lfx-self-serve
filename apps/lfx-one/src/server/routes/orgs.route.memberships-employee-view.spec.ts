// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #5855 (epic #5845) — every API route behind the Memberships page and the membership detail page (board/committee and
 * documentation tabs, key contacts, the people pickers) answers 403 EMPLOYEE_VIEW_FORBIDDEN in the all employee view,
 * and is untouched in the full view. Driven over HTTP through the assembled router so removing `blockEmployeeView` from
 * any one route fails here. The read gate and the controllers are stubbed: only the view-mode block is under test.
 */

const resolveOrgLensViewMode = vi.fn();

vi.mock('../helpers/org-lens-read-access.helper', () => ({ resolveOrgLensViewMode: (...args: unknown[]) => resolveOrgLensViewMode(...args) }));
vi.mock('../middleware/require-org-lens-access.middleware', () => ({
  requireOrgLensAccess: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../middleware/require-org-lens-roi-audience.middleware', () => ({
  requireOrgLensRoiAudience: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../middleware/impersonation-readonly.middleware', () => ({
  blockDuringImpersonation: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Every controller method answers 200 so a request that gets past the block is visible as a non-403.
const stubController = () =>
  class {
    public constructor() {
      return new Proxy(this, {
        get: (_target, prop) => (typeof prop === 'string' ? (_req: unknown, res: { json: (body: unknown) => void }) => res.json({ stub: true }) : undefined),
      });
    }
  };
vi.mock('../controllers/org-lens-memberships.controller', () => ({ OrgLensMembershipsController: stubController() }));
vi.mock('../controllers/org-lens-board-committee.controller', () => ({ OrgLensBoardCommitteeController: stubController() }));
vi.mock('../controllers/org-lens-documents.controller', () => ({ OrgLensDocumentsController: stubController() }));
vi.mock('../controllers/org-lens-key-contacts.controller', () => ({ OrgLensKeyContactsController: stubController() }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => Date.now()), success: vi.fn() },
}));

const orgsRouter = (await import('./orgs.route')).default;

const ORG = '0014100000Te2ovAAB';
const FOUNDATION = 'foundation-1';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const ROUTES: readonly [family: string, method: Method, path: string][] = [
  ['memberships list', 'GET', '/lens/memberships/active'],
  ['memberships list', 'GET', '/lens/memberships/expired'],
  ['memberships list', 'GET', '/lens/memberships/discover'],
  ['membership detail', 'GET', `/lens/memberships/${FOUNDATION}`],
  ['membership projects drawer', 'GET', `/lens/memberships/${FOUNDATION}/projects`],
  ['board/committee tab', 'GET', `/lens/memberships/${FOUNDATION}/seats`],
  ['board/committee tab', 'GET', `/lens/memberships/${FOUNDATION}/voting-history`],
  ['board/committee tab', 'PATCH', `/lens/memberships/${FOUNDATION}/committee-seats/seat-1/reassign`],
  ['board/committee tab', 'GET', '/lens/employees'],
  ['documentation tab', 'GET', `/lens/memberships/${FOUNDATION}/documents`],
  ['key contacts', 'GET', '/lens/key-contacts/employees'],
  ['key contacts', 'POST', `/lens/memberships/${FOUNDATION}/key-contacts`],
  ['key contacts', 'PUT', `/lens/memberships/${FOUNDATION}/key-contacts/contact-1`],
  ['key contacts', 'DELETE', `/lens/memberships/${FOUNDATION}/key-contacts/contact-1`],
  ['key contacts by slug', 'GET', `/lens/key-contacts/membership/${FOUNDATION}`],
  ['key contacts by slug', 'POST', `/lens/key-contacts/membership/${FOUNDATION}`],
  ['key contacts by slug', 'PUT', `/lens/key-contacts/membership/${FOUNDATION}/contact-1`],
  ['key contacts by slug', 'DELETE', `/lens/key-contacts/membership/${FOUNDATION}/contact-1`],
];

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgsRouter);
  app.use((err: { statusCode?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
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
});

const call = (method: Method, path: string) =>
  fetch(`${baseUrl}/api/orgs/${ORG}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });

describe('orgs router — Memberships pages are closed in the all employee view (#5855)', () => {
  it.each(ROUTES)('refuses %s (%s %s) with 403 EMPLOYEE_VIEW_FORBIDDEN', async (_family, method, path) => {
    resolveOrgLensViewMode.mockResolvedValue('employee');

    const res = await call(method, path);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'EMPLOYEE_VIEW_FORBIDDEN' });
  });

  it.each(ROUTES)('leaves %s (%s %s) open in the full view', async (_family, method, path) => {
    resolveOrgLensViewMode.mockResolvedValue('full');

    const res = await call(method, path);

    expect(res.status).toBe(200);
  });
});
