// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { listClaGroups, getPdfUrl, getApprovalList, updateApprovalList } = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getApprovalList: vi.fn(),
  updateApprovalList: vi.fn(),
}));

vi.mock('../controllers/org-clas.controller', () => ({
  OrgClasController: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getApprovalList = getApprovalList;
    public updateApprovalList = updateApprovalList;
  },
}));

const getAccessAwareOrgs = vi.fn();

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
// `isImpersonating` is a spy rather than a constant because `blockDuringImpersonation` reads it,
// and the write route below has to be exercised both ways.
const { isImpersonating } = vi.hoisted(() => ({ isImpersonating: vi.fn(() => false) }));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'alice', isImpersonating }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    // `apiErrorHandler` reads this to prefer the controller's registered operation name. Omitting
    // it makes the handler itself throw, which express answers with a 500 HTML page — so every
    // assertion about a refusal's status would fail for a reason unrelated to what it tests.
    getLastOperation: vi.fn(() => undefined),
  },
}));

const orgClasRouter = (await import('./org-clas.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

const GRANTED = '0014100000Te2ovAAB';
const UNGRANTED = '0014100000Te2QjAAJ';

let server: Server;
let baseUrl: string;

function ok(_req: express.Request, res: express.Response): void {
  res.json({ orgUid: GRANTED, claGroups: [] });
}

// Mirrors orgsRouter's `router.use('/:orgUid/lens', requireOrgLensAccess)`, which shares the
// /api/orgs mount and matches the CLA path without owning a route for it. Mounted here in the
// same order as server.ts so the sibling-path case below asserts against the real arrangement.
const genericLensGuard = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orgs', orgClasRouter);
  const orgsLike = express.Router();
  orgsLike.use('/:orgUid/lens', genericLensGuard);
  app.use('/api/orgs', orgsLike);
  // The app's own handler, not a stand-in: the status and code a blocked write returns are part of
  // what these tests assert, so they should come from where production's come from.
  app.use(apiErrorHandler);
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
  isImpersonating.mockReturnValue(false);
  listClaGroups.mockImplementation(ok);
  getPdfUrl.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ url: 'https://s3.example.org/ccla.pdf' });
  });
  getApprovalList.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
  });
  updateApprovalList.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
  });
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
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

  // This router mounts on the shared /api/orgs prefix ahead of orgsRouter, so it must claim the
  // CLA paths and nothing else. If it ever widened, sibling lens paths would stop reaching the
  // router that owns them.
  it('leaves sibling org-lens paths to the router that owns them', async () => {
    await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/memberships`);

    expect(genericLensGuard).toHaveBeenCalled();
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('refuses the signed-document url for an org the caller holds no grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups/signature-uuid-1/pdf-url`);

    expect(res.status).toBe(403);
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('admits the signed-document url for a granted org', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/signature-uuid-1/pdf-url`);

    expect(res.status).toBe(200);
    expect(getPdfUrl).toHaveBeenCalled();
    expect(await res.json()).toEqual({ url: 'https://s3.example.org/ccla.pdf' });
  });

  it('refuses the approval list for an org the caller holds no grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups/signature-uuid-1/approval-list`);

    expect(res.status).toBe(403);
    expect(getApprovalList).not.toHaveBeenCalled();
  });

  it('admits the approval list for a granted org', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/signature-uuid-1/approval-list`);

    expect(res.status).toBe(200);
    expect(getApprovalList).toHaveBeenCalled();
  });
});

/**
 * Router-level coverage for the read-only-impersonation gate on the approval-list write (#1985).
 *
 * The middleware has its own behaviour; what these tests protect is the *registration*. A unit
 * test of the controller keeps passing if the middleware is dropped from the route — and that is
 * the regression that matters here, because an approval-list change revokes contributors'
 * acknowledgements, emails them, and is recorded in the agreement's activity log against the
 * impersonated CLA manager rather than the administrator who caused it.
 *
 * The read is asserted alongside it: impersonated *viewing* of an approval list must keep
 * working, so a blanket `router.use` would be a bug rather than a safer default.
 */
describe('org-clas router — approval-list write during impersonation', () => {
  function put(): Promise<Response> {
    return fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/signature-uuid-1/approval-list`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ add: [{ kind: 'domain', value: 'example.com' }], remove: [] }),
    });
  }

  it('applies the change when not impersonating', async () => {
    const res = await put();

    expect(res.status).toBe(200);
    expect(updateApprovalList).toHaveBeenCalled();
  });

  it('refuses to change the approval list while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await put();

    expect(res.status).toBe(403);
    // Asserted together with the status: the grant check also answers 403, so the status alone
    // would not prove the impersonation gate is what produced it.
    expect(updateApprovalList).not.toHaveBeenCalled();
  });

  it('reports the read-only impersonation code, so the UI can explain it', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await put();

    expect(JSON.stringify(await res.json())).toContain('IMPERSONATION_READ_ONLY');
  });

  it('still serves the approval list while impersonating', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/signature-uuid-1/approval-list`);

    expect(res.status).toBe(200);
    expect(getApprovalList).toHaveBeenCalled();
  });
});
