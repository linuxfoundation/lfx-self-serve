// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listClaGroups,
  getPdfUrl,
  getCclaPreview,
  getSignOptions,
  requestCorporateSignature,
  getApprovalList,
  updateApprovalList,
  checkPermission,
  listManagers,
  addManager,
  removeManager,
} = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getCclaPreview: vi.fn(),
  getSignOptions: vi.fn(),
  requestCorporateSignature: vi.fn(),
  getApprovalList: vi.fn(),
  updateApprovalList: vi.fn(),
  checkPermission: vi.fn(),
  listManagers: vi.fn(),
  addManager: vi.fn(),
  removeManager: vi.fn(),
}));

vi.mock('../controllers/org-clas.controller', () => ({
  OrgClasController: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getCclaPreview = getCclaPreview;
    public getSignOptions = getSignOptions;
    public requestCorporateSignature = requestCorporateSignature;
    public getApprovalList = getApprovalList;
    public updateApprovalList = updateApprovalList;
    public checkPermission = checkPermission;
    public listManagers = listManagers;
    public addManager = addManager;
    public removeManager = removeManager;
  },
}));

const getAccessAwareOrgs = vi.fn();
const checkSingleAccessStrict = vi.fn();

// `requireOrgLensAccess` also asks the authorizer for `b2b_org:<uid>#auditor`; default "not an auditor"
// keeps the ungranted cases answering 403 rather than 503 from an unmocked upstream.
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
// `isImpersonating` is a spy rather than a literal so the write route's guard can be driven from
// a test. `blockDuringImpersonation` reads it, and it is the only input that guard has.
const isImpersonating = vi.fn(() => false);
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'alice', isImpersonating: () => isImpersonating() }));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
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
  app.use('/api/orgs', orgClasRouter);
  const orgsLike = express.Router();
  orgsLike.use('/:orgUid/lens', genericLensGuard);
  app.use('/api/orgs', orgsLike);
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
  getCclaPreview.mockImplementation((_req: express.Request, res: express.Response) => {
    res.type('application/pdf').send(Buffer.from('%PDF-1.4'));
  });
  getApprovalList.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
  });
  updateApprovalList.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signatureId: 'signature-uuid-1', entries: [], canEdit: true });
  });
  getSignOptions.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ searchTerm: 'cascade', resultCount: 0, truncated: false, results: [] });
  });
  requestCorporateSignature.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signUrl: 'https://signing.example.org/session/1' });
  });
  getSignOptions.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ searchTerm: 'cascade', resultCount: 0, truncated: false, results: [] });
  });
  requestCorporateSignature.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signUrl: 'https://docusign.example.org/session/1' });
  });
  checkPermission.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ allowed: true });
  });
  listManagers.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ signatureId: 'signature-uuid-1', managers: [] });
  });
  addManager.mockImplementation((_req: express.Request, res: express.Response) => {
    res.status(201).json({ lfUsername: 'aporter' });
  });
  removeManager.mockImplementation((_req: express.Request, res: express.Response) => {
    res.status(204).send();
  });
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
  checkSingleAccessStrict.mockResolvedValue(false);
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

  it('refuses the CCLA review copy for an org the caller holds no grant on', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups/7c1a9000-0000-4000-8000-000000000001/ccla-preview`);

    expect(res.status).toBe(403);
    expect(getCclaPreview).not.toHaveBeenCalled();
  });

  it('admits the CCLA review copy for a granted org', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/7c1a9000-0000-4000-8000-000000000001/ccla-preview`);

    expect(res.status).toBe(200);
    expect(getCclaPreview).toHaveBeenCalled();
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

  /**
   * The corporate signing routes (#1983), asserted at the layer where their guards are wired. A
   * controller test cannot see any of this: it is handed a request that has already passed
   * everything the router put in front of it, so a guard deleted from a route line would leave
   * every controller test green.
   *
   * There is no environment gate to assert. The module's server-side flag was removed on the
   * parent branch, leaving the LaunchDarkly `org-lens-cla-m3-enabled` flag as the only one — and
   * that hides the route and the nav without closing the BFF. So what stands in front of these
   * two routes is exactly what is asserted below: the Org Lens grant on both, the impersonation
   * guard on the write, and the CLA service's own signing-authority check past them. A shorter
   * list than it was, which makes each of these cases more load-bearing rather than less.
   */

  /**
   * Choosing a CLA Group to sign for. A read, so impersonation stays allowed — exactly as on the
   * Me-lens picker, and unlike the write next door.
   *
   * The literal `sign-options` segment also has to beat the `:signatureId` route declared after
   * it; if the declaration order ever flipped, this would arrive at `getPdfUrl` instead.
   */
  describe('sign-options', () => {
    it('refuses a search for an org the caller holds no grant on', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/cla-groups/sign-options?search=cascade`);

      expect(res.status).toBe(403);
      expect(getSignOptions).not.toHaveBeenCalled();
    });

    it('admits a search for a granted org, and not as a signature id', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/sign-options?search=cascade`);

      expect(res.status).toBe(200);
      expect(getSignOptions).toHaveBeenCalled();
      expect(getPdfUrl).not.toHaveBeenCalled();
    });

    it('stays available while impersonating, because it reads nothing and writes nothing', async () => {
      isImpersonating.mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/cla-groups/sign-options?search=cascade`);

      expect(res.status).toBe(200);
      expect(getSignOptions).toHaveBeenCalled();
    });
  });

  /**
   * Opening the signing session: the one write in this router, and the one that creates a
   * signature record and a DocuSign envelope against a company's legal position.
   *
   * Each guard is asserted to run *before* the next thing, not merely to be present. The payload
   * below is a valid one throughout, so nothing here can pass by being rejected for its shape.
   */
  describe('sign', () => {
    const body = {
      projectSfid: 'a09410000182dD2AAI',
      claGroupId: '11111111-1111-4111-8111-111111111111',
      authorityAcked: true,
      embargoAcked: true,
    };

    function sign(orgUid: string): Promise<Response> {
      return fetch(`${baseUrl}/api/orgs/${orgUid}/lens/cla-groups/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('refuses a signing request for an org the caller holds no grant on', async () => {
      const res = await sign(UNGRANTED);

      expect(res.status).toBe(403);
      expect(requestCorporateSignature).not.toHaveBeenCalled();
    });

    it('admits a signing request for a granted org', async () => {
      const res = await sign(GRANTED);

      expect(res.status).toBe(200);
      expect(requestCorporateSignature).toHaveBeenCalled();
    });

    /**
     * The payload carries no caller identity — the signatory is whoever the gateway token names.
     * Under impersonation that is the wrong person, on a corporate agreement, and there is nothing
     * in the record afterwards to say so. Refused before the controller runs, so no part of the
     * request is acted on.
     */
    it('refuses a signing request while impersonating, before the controller runs', async () => {
      isImpersonating.mockReturnValue(true);

      const res = await sign(GRANTED);

      expect(res.status).toBe(403);
      expect(requestCorporateSignature).not.toHaveBeenCalled();
    });
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

describe('permissions/checks', () => {
  function check(orgUid: string): Promise<Response> {
    return fetch(`${baseUrl}/api/orgs/${orgUid}/lens/cla-groups/permissions/checks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sign' }),
    });
  }

  it('refuses a check for an org the caller holds no grant on', async () => {
    const res = await check(UNGRANTED);

    expect(res.status).toBe(403);
    expect(checkPermission).not.toHaveBeenCalled();
  });

  it('admits a check for a granted org, and not as a signature id', async () => {
    const res = await check(GRANTED);

    expect(res.status).toBe(200);
    expect(checkPermission).toHaveBeenCalled();
    expect(getPdfUrl).not.toHaveBeenCalled();
  });

  it('stays available while impersonating, because it writes nothing', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await check(GRANTED);

    expect(res.status).toBe(200);
    expect(checkPermission).toHaveBeenCalled();
  });
});

const MANAGERS = 'lens/cla-groups/signature-uuid-1/managers';

describe('org-clas router — CLA managers', () => {
  describe.each([
    ['read', 'GET', MANAGERS, () => listManagers],
    ['add', 'POST', MANAGERS, () => addManager],
    ['remove', 'DELETE', `${MANAGERS}/aporter`, () => removeManager],
  ] as const)('%s', (_name, method, path, handler) => {
    it('refuses an org the caller holds no grant on', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/${path}`, { method });

      expect(res.status).toBe(403);
      expect(handler()).not.toHaveBeenCalled();
    });

    it('admits a granted org', async () => {
      const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/${path}`, { method });

      expect(res.status).toBeLessThan(400);
      expect(handler()).toHaveBeenCalled();
    });
  });

  describe('while impersonating', () => {
    it('still allows the read', async () => {
      isImpersonating.mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/${MANAGERS}`);

      expect(res.status).toBe(200);
      expect(listManagers).toHaveBeenCalled();
    });

    it.each([
      ['add', 'POST', MANAGERS, () => addManager],
      ['remove', 'DELETE', `${MANAGERS}/aporter`, () => removeManager],
    ] as const)('blocks the %s before it reaches the controller', async (_name, method, path, handler) => {
      isImpersonating.mockReturnValue(true);

      const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/${path}`, { method });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'IMPERSONATION_READ_ONLY' });
      expect(handler()).not.toHaveBeenCalled();
    });
  });
});
