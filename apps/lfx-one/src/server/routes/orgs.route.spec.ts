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
const checkSingleAccessStrict = vi.fn();
const proxyRequest = vi.fn();
const proxyRequestWithResponse = vi.fn();

// The read gate asks the authorizer for `b2b_org:<uid>#auditor` alongside the roster; unmocked, the
// real service would hit the bare `proxyRequest` stub and turn every ungranted case into a 503.
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
vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
// `isImpersonating` is needed because the LFXV2-3288 logo route now runs `blockDuringImpersonation`
// before its raw body parser (mirrors profile.route.ts's picture-upload gate). A partial mock that
// omitted it would make the middleware call `undefined(req)` and 500 every test in this file.
// Toggled via `impersonatingStub` so the impersonation-blocked scenario can flip it per test.
let impersonatingStub = false;
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'lguerra', isImpersonating: () => impersonatingStub }));
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
const UNGRANTED = '0014100000BetaAAAA';

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
  impersonatingStub = false;
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
  checkSingleAccessStrict.mockResolvedValue(false);
});

describe('orgs router — Org Lens read gate', () => {
  // `:orgUid` and `:accountId` name the same SFID; both must be gated, which is why the mount sits on
  // the shared `/lens` prefix rather than on individual routes.
  it.each([
    ['people roster (:orgUid)', `/lens/people/all`],
    ['events (:accountId)', `/lens/events`],
    ['memberships', `/lens/memberships/active`],
    ['contributions', `/lens/contributions/summary`],
    ['the read-check probe (#2961)', `/lens/read-check`],
  ])('refuses %s for an org the caller holds no grant on', async (_label, path) => {
    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}${path}`);

    expect(res.status).toBe(403);
  });

  // #2961: the page reads this probe as the server's verdict — 403 when refused, 204 when admitted (by
  // the roster, or by the authorizer alone, e.g. a key contact that no roster lists). The FORBIDDEN code
  // on the body is the gate helper's own contract, covered by its spec.
  it('answers the read-check probe with 403 when refused and 204 when admitted', async () => {
    expect((await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/read-check`)).status).toBe(403);

    const admitted = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/read-check`);
    expect(admitted.status).toBe(204);
    // A per-user verdict must never be reused from a cache after the grant changes.
    expect(admitted.headers.get('cache-control')).toBe('no-store');

    checkSingleAccessStrict.mockResolvedValue(true);
    expect((await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/read-check`)).status).toBe(204);
  });

  it('admits a granted org past the gate', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${GRANTED}/lens/people/all`);

    expect(res.status).not.toBe(403);
    // The gate must have run and allowed it — without this the assertion above also holds when the
    // gate is absent entirely, which is exactly the regression these tests exist to catch.
    expect(getAccessAwareOrgs).toHaveBeenCalled();
  });

  it('admits an org the roster does not list when the authorizer confirms auditor (LF team, cascade, key contact)', async () => {
    // Spec 044 / DR-001: the gate asks `b2b_org:<uid>#auditor` instead of consulting a team list.
    checkSingleAccessStrict.mockResolvedValue(true);
    // Asserted as a real 200 rather than `not 403`, which a 503 from the gate's fail-closed branch
    // would also satisfy. This route's only upstream is the query-service employee search, so an
    // empty page is a complete happy path.
    proxyRequest.mockResolvedValue({ resources: [] });

    const res = await fetch(`${baseUrl}/api/orgs/${UNGRANTED}/lens/key-contacts/employees`);

    expect(res.status).toBe(200);
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: UNGRANTED, access: 'auditor' });
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

/**
 * LFXV2-3288 — the logo upload route's `express.raw()` middleware and its 413-conversion handler.
 * Router-level (real HTTP, real body-size enforcement) because the size limit and content-type
 * filter are configured on the route registration, not inside the controller — a unit test that
 * calls the controller directly would keep passing even if the raw-parser wiring were removed.
 */
describe('orgs router — POST /uid/:uid/logo', () => {
  const UID = '0014100000Te2ovAAB';
  const rawOrg = { uid: UID, name: 'Acme', logo_url: 'https://cdn.example.com/logo.png?v=1' };

  it('parses an allowed content type as a raw buffer and proxies it', async () => {
    proxyRequestWithResponse.mockResolvedValue({ data: rawOrg, status: 200, statusText: 'OK', headers: { etag: 'W/"etag-1"' } });
    proxyRequest.mockResolvedValue(rawOrg);
    const body = Buffer.from('fake-png-bytes');

    const res = await fetch(`${baseUrl}/api/orgs/uid/${UID}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body,
    });

    expect(res.status).toBe(200);
    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/b2b_orgs/${UID}/logo`, 'POST', undefined, expect.any(Buffer), {
      'Content-Type': 'image/png',
      'If-Match': 'W/"etag-1"',
    });
  });

  it('rejects a disallowed content type with a 400 and never forwards it upstream', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/uid/${UID}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: Buffer.from('not-an-image'),
    });

    // express.raw()'s type filter skips parsing for a non-matching content-type, so req.body is
    // never populated as a Buffer; the controller's own empty-body check then rejects it (400),
    // rather than ever forwarding to member-service.
    expect(res.status).toBe(400);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('converts an oversized body to 413 rather than a generic 500', async () => {
    // MAX_ORG_LOGO_SIZE_BYTES is enforced by express.raw({ limit }); one byte over it must trip
    // handleLogoUploadParseError's entity.too.large branch.
    const { MAX_ORG_LOGO_SIZE_BYTES } = await import('@lfx-one/shared/constants');
    const oversized = Buffer.alloc(MAX_ORG_LOGO_SIZE_BYTES + 1);

    const res = await fetch(`${baseUrl}/api/orgs/uid/${UID}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: oversized,
    });

    expect(res.status).toBe(413);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  /**
   * PR #1583 — pins that `blockDuringImpersonation` is wired on this route (not just imported).
   * Without a router-level assertion, a future refactor could drop the middleware and every other
   * test in this file would still pass, since they exercise the raw parser + proxy path with
   * impersonation off. The middleware's own unit tests can't catch a wiring regression here.
   */
  it('refuses the upload with 403 while impersonating and never forwards it upstream', async () => {
    impersonatingStub = true;

    const res = await fetch(`${baseUrl}/api/orgs/uid/${UID}/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: Buffer.from('fake-png-bytes'),
    });

    expect(res.status).toBe(403);
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });
});
