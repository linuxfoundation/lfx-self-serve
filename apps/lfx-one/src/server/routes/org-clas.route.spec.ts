// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { listClaGroups, getPdfUrl, getSignOptions, requestCorporateSignature } = vi.hoisted(() => ({
  listClaGroups: vi.fn(),
  getPdfUrl: vi.fn(),
  getSignOptions: vi.fn(),
  requestCorporateSignature: vi.fn(),
}));

vi.mock('../controllers/org-clas.controller', () => ({
  OrgClasController: class {
    public listClaGroups = listClaGroups;
    public getPdfUrl = getPdfUrl;
    public getSignOptions = getSignOptions;
    public requestCorporateSignature = requestCorporateSignature;
  },
}));

const getAccessAwareOrgs = vi.fn();

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
// /api/orgs mount and matches the CLA path without owning a route for it. Mounted here in the
// same order as server.ts so the sibling-path case below asserts against the real arrangement.
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
  isImpersonating.mockReturnValue(false);
  listClaGroups.mockImplementation(ok);
  getPdfUrl.mockImplementation((_req: express.Request, res: express.Response) => {
    res.json({ url: 'https://s3.example.org/ccla.pdf' });
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
